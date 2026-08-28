# Métricas Reais de Execução (checkout + tempo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capturar e persistir o tempo real de execução por exercício e por sessão, com checkout explícito e tela de resumo no app do atleta, e expor as métricas nas telas do coach (dashboard, listagem de alunos, plan-builder) e do atleta (histórico).

**Architecture:** Backend NestJS ganha `WorkoutLog.durationSeconds` (gravado incrementalmente junto do log de conclusão do exercício) e um model novo `WorkoutSession` gravado só no checkout via `POST /workout-sessions` — sem estado de "sessão em andamento" no servidor. Frontend Angular: o `active-workout` passa a ter cronômetro count-up por exercício (Iniciar/Concluir), rascunho em `localStorage` por `sessionId`, e uma tela de resumo antes do checkout. Agregações (média, tendência, tempo por exercício) são calculadas no backend em endpoints dedicados, todos com ownership check via `StudentsService.findOne`.

**Tech Stack:** NestJS 10, Prisma 5 + PostgreSQL 16, Jest (ts-jest), class-validator; Angular 21 standalone + signals, RxJS, Tailwind.

**Spec:** `backend/docs/superpowers/specs/2026-08-28-metricas-tempo-execucao-design.md`

## Global Constraints

- **Migração Prisma**: SEMPRE via container-sombra descartável. NUNCA `prisma migrate dev` não-interativo, NUNCA `--shadow-database-url` apontando pro banco real. O SQL gerado tem de ser puramente aditivo — se aparecer qualquer `DROP`, parar e reportar.
- **Node para tarefas Prisma/audit**: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use v20.20.0` antes de rodar `npx prisma ...`. Testes Jest rodam em Node 20 normal.
- **Banco de dev**: `postgresql://postgres:password@localhost:5434/aevonfit` (container `aevonfit-db`). Redis dev na 6380.
- **Ownership (anti-IDOR)**: toda rota que recebe `:studentId` DEVE chamar `this.studentsService.findOne(studentId, user)` ANTES de qualquer query de dado, e propagar a `ForbiddenException` sem buscar nada. Padrão consolidado no projeto (`daily-intake`, `workout-logs`, `personal-records`).
- **Guards de controller**: `@UseGuards(JwtAuthGuard, RolesGuard)` no controller + `@Roles('coach')` / `@Roles('athlete')` por rota. `RolesGuard` NUNCA global neste projeto.
- **Testes**: cada service novo com testes Jest (mock de `PrismaService` e `StudentsService`, padrão de `daily-intake.service.spec.ts`). Suíte completa (`npm test`) verde antes de qualquer commit de fim de task.
- **Commits**: frequentes, um por task no mínimo. Mensagem em português, com trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- **Idioma**: todo texto visível ao usuário em português-BR.
- **Repos**: backend `aevonfit-back` e frontend `aevonfit-front` são git roots separados. Branch `feat/metricas-tempo-execucao` nos dois. Frontend push via remote `upstream` (SSH), não `origin`.

---

## File Structure

### Backend (`aevonfit-back`)

| Arquivo | Responsabilidade |
|---|---|
| `prisma/schema.prisma` | + `WorkoutLog.durationSeconds`, model `WorkoutSession`, enum `WorkoutSessionStatus`, relações em `Session` e `User` |
| `prisma/migrations/<ts>_add_workout_session_and_duration/migration.sql` | migração aditiva |
| `src/workout-logs/dto/create-workout-log.dto.ts` | + campo opcional `durationSeconds` |
| `src/workout-logs/workout-logs.service.ts` | grava `durationSeconds` no `create` |
| `src/workout-sessions/workout-sessions.module.ts` | módulo novo, importa `StudentsModule` |
| `src/workout-sessions/workout-sessions.controller.ts` | 5 rotas |
| `src/workout-sessions/workout-sessions.service.ts` | checkout + agregações + ownership |
| `src/workout-sessions/dto/checkout-workout-session.dto.ts` | body do `POST` |
| `src/workout-sessions/workout-sessions.service.spec.ts` | testes de service |
| `src/app.module.ts` | registra `WorkoutSessionsModule` |

### Frontend (`aevonfit-front`)

| Arquivo | Responsabilidade |
|---|---|
| `src/app/core/models/training.model.ts` | + tipos `WorkoutSessionStatus`, `WorkoutSessionRecord`, `SessionTimeSummary`, `SessionTimeDetail`, `CoachAvgDuration`; `Exercise`/`WorkoutLog` inalterados |
| `src/app/core/services/api.service.ts` | `logExercise` ganha `durationSeconds?`; + 5 métodos novos |
| `src/app/shared/utils/workout-draft.ts` | util de rascunho `localStorage` (novo) |
| `src/app/shared/utils/workout-draft.spec.ts` | testes do util (novo) |
| `src/app/features/athlete/active-workout/active-workout.component.{ts,html}` | cronômetro Iniciar/Concluir, rascunho, tela de resumo, checkout |
| `src/app/features/coach/dashboard/dashboard.component.{ts,html}` | card "Tempo médio de treino" |
| `src/app/features/coach/students/students.component.{ts,html}` | tempo médio por linha |
| `src/app/features/coach/plan-builder/plan-builder.component.{ts,html}` | seção recolhível "Tempo de execução" + tempos por sessão executada |
| `src/app/features/athlete/history/history.component.{ts,html}` | stat "tempo médio de treino" |

---

## Task 1: Schema + migração (WorkoutSession, durationSeconds, enum)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_workout_session_and_duration/migration.sql`

**Interfaces:**
- Produces (para as tasks seguintes):
  - `WorkoutLog.durationSeconds: Int?` (segundos)
  - `model WorkoutSession { id, sessionId, athleteId, startedAt, finishedAt, elapsedSeconds Int, activeSeconds Int, status WorkoutSessionStatus, createdAt }`
  - `enum WorkoutSessionStatus { Completed  Partial }`
  - `prisma.workoutSession` disponível no client

- [ ] **Step 1: Adicionar o campo em `WorkoutLog`**

No `model WorkoutLog` (por volta da linha 223), logo depois de `setsCompleted Int`:

```prisma
model WorkoutLog {
  id              String   @id @default(uuid())
  exerciseId      String
  athleteId       String
  completedAt     DateTime @default(now())
  setsCompleted   Int
  durationSeconds Int?
  notes           String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // Relations
  exercise Exercise @relation(fields: [exerciseId], references: [id], onDelete: Cascade)
  athlete  User     @relation(fields: [athleteId], references: [id], onDelete: Cascade)

  @@map("workout_logs")
}
```

- [ ] **Step 2: Adicionar o enum e o model `WorkoutSession`**

Logo depois do `model WorkoutLog` (antes de `enum SkipReason`):

```prisma
enum WorkoutSessionStatus {
  Completed
  Partial
}

model WorkoutSession {
  id             String               @id @default(uuid())
  sessionId      String
  athleteId      String
  startedAt      DateTime
  finishedAt     DateTime
  elapsedSeconds Int
  activeSeconds  Int
  status         WorkoutSessionStatus
  createdAt      DateTime             @default(now())

  session Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  athlete User    @relation(fields: [athleteId], references: [id], onDelete: Cascade)

  @@index([athleteId])
  @@index([sessionId])
  @@map("workout_sessions")
}
```

- [ ] **Step 3: Adicionar as relações inversas**

No `model Session` (linha ~130), adicionar na lista de relações, depois de `workoutSkips WorkoutSkip[]`:

```prisma
  workoutSessions WorkoutSession[]
```

No `model User` (linha ~35), adicionar depois de `notifications    Notification[]`:

```prisma
  workoutSessions  WorkoutSession[]
```

- [ ] **Step 4: Gerar o diff da migração via container-sombra descartável**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use v20.20.0
cd <repo-root-do-backend>

docker run -d --name aevonfit-shadow-tmp -e POSTGRES_PASSWORD=shadow -p 5439:5432 postgres:16-alpine
sleep 3

npx prisma migrate diff \
  --from-url "postgresql://postgres:password@localhost:5434/aevonfit" \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://postgres:shadow@localhost:5439/postgres" \
  --script > /tmp/workout-session-migration-diff.sql

cat /tmp/workout-session-migration-diff.sql

docker rm -f aevonfit-shadow-tmp
```

- [ ] **Step 5: Revisar o SQL gerado**

Ler `/tmp/workout-session-migration-diff.sql`. Deve conter APENAS:
- `CREATE TYPE "WorkoutSessionStatus" AS ENUM ('Completed', 'Partial');`
- `ALTER TABLE "workout_logs" ADD COLUMN "durationSeconds" INTEGER;`
- `CREATE TABLE "workout_sessions" (...)` com as colunas descritas
- `CREATE INDEX` para `athleteId` e `sessionId`
- `ADD CONSTRAINT ... FOREIGN KEY` para `session` e `athlete`

**Nenhum `DROP` pode aparecer.** Se aparecer qualquer coisa destrutiva ou não relacionada, PARAR e reportar.

- [ ] **Step 6: Criar a pasta da migração e aplicar**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use v20.20.0
TS=$(date +%Y%m%d%H%M%S)
mkdir -p "prisma/migrations/${TS}_add_workout_session_and_duration"
cp /tmp/workout-session-migration-diff.sql "prisma/migrations/${TS}_add_workout_session_and_duration/migration.sql"
npx prisma migrate deploy
npx prisma generate
```

- [ ] **Step 7: Confirmar build e suíte**

```bash
npm run build
npm test
```
Expected: build OK, suíte verde (nenhum teste novo ainda; só garantir que o `prisma generate` não quebrou nada).

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "$(cat <<'EOF'
feat(schema): WorkoutSession + WorkoutLog.durationSeconds

Model novo pra sessão executada (gravado no checkout) e campo de tempo
de execução por exercício. Migração aditiva via container-sombra.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `durationSeconds` no log de exercício

**Files:**
- Modify: `src/workout-logs/dto/create-workout-log.dto.ts`
- Modify: `src/workout-logs/workout-logs.service.ts:20-31`
- Test: `src/workout-logs/workout-logs.service.spec.ts` (adicionar casos ao `describe` existente `WorkoutLogsService.logExercise`)

**Interfaces:**
- Consumes: `CreateWorkoutLogDto` (existente)
- Produces: `logExercise(user, dto)` grava `durationSeconds` quando presente no dto; `CreateWorkoutLogDto.durationSeconds?: number`

- [ ] **Step 1: Escrever o teste que falha**

Em `src/workout-logs/workout-logs.service.spec.ts`, dentro do `describe('WorkoutLogsService.logExercise', ...)` existente, adicionar:

```typescript
  it('grava durationSeconds quando informado no dto', async () => {
    await service.logExercise(athleteUser, { ...dto, durationSeconds: 95 } as any);

    expect(prisma.workoutLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ durationSeconds: 95 }),
      }),
    );
  });

  it('grava durationSeconds como null quando ausente', async () => {
    await service.logExercise(athleteUser, dto as any);

    expect(prisma.workoutLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ durationSeconds: null }),
      }),
    );
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- workout-logs.service`
Expected: FAIL — os 2 casos novos quebram (`durationSeconds` não passado ao `create`).

- [ ] **Step 3: Adicionar o campo no DTO**

Em `src/workout-logs/dto/create-workout-log.dto.ts`, importar `IsInt` e `Min` (já importa `IsNumber, IsOptional, IsDateString, IsString`) e adicionar:

```typescript
import { IsString, IsNumber, IsInt, Min, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWorkoutLogDto {
  @ApiProperty({ description: 'ID do exercício concluído' })
  @IsString()
  exerciseId: string;

  @ApiProperty({ example: 3, description: 'Séries realizadas' })
  @IsNumber()
  setsCompleted: number;

  @ApiPropertyOptional({ example: 95, description: 'Tempo de execução real do exercício em segundos' })
  @IsInt()
  @Min(0)
  @IsOptional()
  durationSeconds?: number;

  @ApiPropertyOptional({ example: 'Aumentei 5kg na última série' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: 'ISO date — padrão: agora' })
  @IsDateString()
  @IsOptional()
  completedAt?: string;
}
```

- [ ] **Step 4: Gravar no service**

Em `src/workout-logs/workout-logs.service.ts`, no `logExercise`, alterar o objeto `data` do `create`:

```typescript
    return this.prisma.workoutLog.create({
      data: {
        exerciseId: dto.exerciseId,
        athleteId: user.id,
        setsCompleted: dto.setsCompleted,
        durationSeconds: dto.durationSeconds ?? null,
        notes: dto.notes,
        completedAt: dto.completedAt ? new Date(dto.completedAt) : new Date(),
      },
      include: {
        exercise: { select: { id: true, name: true, sessionId: true } },
      },
    });
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm test -- workout-logs.service`
Expected: PASS (todos, incluindo os pré-existentes).

- [ ] **Step 6: Commit**

```bash
git add src/workout-logs
git commit -m "$(cat <<'EOF'
feat(workout-logs): aceita durationSeconds no log de exercício

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Módulo `workout-sessions` + `POST /workout-sessions` (checkout)

**Files:**
- Create: `src/workout-sessions/dto/checkout-workout-session.dto.ts`
- Create: `src/workout-sessions/workout-sessions.service.ts`
- Create: `src/workout-sessions/workout-sessions.controller.ts`
- Create: `src/workout-sessions/workout-sessions.module.ts`
- Create: `src/workout-sessions/workout-sessions.service.spec.ts`
- Modify: `src/app.module.ts` (registrar o módulo)

**Interfaces:**
- Consumes: `PrismaService`, `StudentsService.findOne(studentId, user) → Promise<{ id, userId, coachId }>`
- Produces:
  - `WorkoutSessionsService.checkout(user: {id,role}, dto: CheckoutWorkoutSessionDto) → Promise<WorkoutSession & { session: { name } }>`
  - `CheckoutWorkoutSessionDto { sessionId: string; startedAt: string; finishedAt: string }`
  - rota `POST /workout-sessions`

- [ ] **Step 1: DTO**

Create `src/workout-sessions/dto/checkout-workout-session.dto.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsDateString } from 'class-validator';

export class CheckoutWorkoutSessionDto {
  @ApiProperty({ description: 'ID da sessão do plano que foi executada' })
  @IsString()
  sessionId!: string;

  @ApiProperty({ description: 'ISO — momento do primeiro "Iniciar exercício"' })
  @IsDateString()
  startedAt!: string;

  @ApiProperty({ description: 'ISO — momento do "Finalizar treino"' })
  @IsDateString()
  finishedAt!: string;
}
```

- [ ] **Step 2: Escrever os testes que falham**

Create `src/workout-sessions/workout-sessions.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { WorkoutSessionsService } from './workout-sessions.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';

const athleteUser = { id: 'athlete-1', role: 'athlete' };

function buildPrisma(overrides: any = {}) {
  return {
    session: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'session-1',
        day: { week: { plan: { studentId: 'student-1', student: { userId: 'athlete-1' } } } },
        exercises: [{ id: 'ex-1' }, { id: 'ex-2' }],
      }),
    },
    workoutLog: {
      findMany: jest.fn().mockResolvedValue([
        { exerciseId: 'ex-1', durationSeconds: 60 },
        { exerciseId: 'ex-2', durationSeconds: 90 },
      ]),
    },
    workoutSession: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'ws-1', ...data, session: { name: 'A' } })),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

describe('WorkoutSessionsService.checkout', () => {
  let service: WorkoutSessionsService;
  let prisma: any;
  let studentsService: { findOne: jest.Mock };

  beforeEach(async () => {
    prisma = buildPrisma();
    studentsService = { findOne: jest.fn().mockResolvedValue({ id: 'student-1', userId: 'athlete-1', coachId: 'coach-1' }) };
    const module = await Test.createTestingModule({
      providers: [
        WorkoutSessionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: studentsService },
      ],
    }).compile();
    service = module.get(WorkoutSessionsService);
  });

  const dto = { sessionId: 'session-1', startedAt: '2026-08-28T10:00:00.000Z', finishedAt: '2026-08-28T10:45:00.000Z' };

  it('confere posse do aluno antes de gravar', async () => {
    await service.checkout(athleteUser, dto);
    expect(studentsService.findOne).toHaveBeenCalledWith('student-1', athleteUser);
  });

  it('propaga ForbiddenException sem gravar nada', async () => {
    studentsService.findOne.mockRejectedValue(new ForbiddenException());
    await expect(service.checkout(athleteUser, dto)).rejects.toThrow(ForbiddenException);
    expect(prisma.workoutSession.create).not.toHaveBeenCalled();
  });

  it('calcula elapsedSeconds a partir de startedAt/finishedAt', async () => {
    await service.checkout(athleteUser, dto);
    expect(prisma.workoutSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ elapsedSeconds: 2700 }) }),
    );
  });

  it('soma activeSeconds dos durationSeconds dos logs do atleta na sessão', async () => {
    await service.checkout(athleteUser, dto);
    expect(prisma.workoutSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ activeSeconds: 150 }) }),
    );
  });

  it('marca Completed quando todos os exercícios têm log do atleta', async () => {
    await service.checkout(athleteUser, dto);
    expect(prisma.workoutSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Completed' }) }),
    );
  });

  it('marca Partial quando falta log de algum exercício', async () => {
    prisma.workoutLog.findMany.mockResolvedValue([{ exerciseId: 'ex-1', durationSeconds: 60 }]);
    await service.checkout(athleteUser, dto);
    expect(prisma.workoutSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Partial' }) }),
    );
  });

  it('rejeita quando finishedAt é anterior a startedAt', async () => {
    await expect(
      service.checkout(athleteUser, { ...dto, finishedAt: '2026-08-28T09:00:00.000Z' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('lança BadRequestException quando a sessão não existe', async () => {
    prisma.session.findUnique.mockResolvedValue(null);
    await expect(service.checkout(athleteUser, dto)).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npm test -- workout-sessions.service`
Expected: FAIL — `Cannot find module './workout-sessions.service'`.

- [ ] **Step 4: Implementar o service (só o `checkout` por enquanto)**

Create `src/workout-sessions/workout-sessions.service.ts`:

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { CheckoutWorkoutSessionDto } from './dto/checkout-workout-session.dto';

type AuthUser = { id: string; role: string };

@Injectable()
export class WorkoutSessionsService {
  constructor(
    private prisma: PrismaService,
    private studentsService: StudentsService,
  ) {}

  /** Grava a sessão executada. Chamado no "Finalizar treino" do atleta. */
  async checkout(user: AuthUser, dto: CheckoutWorkoutSessionDto) {
    const started = new Date(dto.startedAt);
    const finished = new Date(dto.finishedAt);
    if (finished.getTime() < started.getTime()) {
      throw new BadRequestException('finishedAt não pode ser anterior a startedAt');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: dto.sessionId },
      include: {
        day: { include: { week: { include: { plan: { select: { studentId: true } } } } } },
        exercises: { select: { id: true } },
      },
    });
    if (!session) throw new BadRequestException('Sessão não encontrada');

    const studentId = session.day.week.plan.studentId;
    await this.studentsService.findOne(studentId, user); // ownership: 403 se não for dono/self

    const logs = await this.prisma.workoutLog.findMany({
      where: { athleteId: user.id, exercise: { sessionId: dto.sessionId } },
      select: { exerciseId: true, durationSeconds: true },
    });

    const activeSeconds = logs.reduce((sum, l) => sum + (l.durationSeconds ?? 0), 0);
    const loggedExerciseIds = new Set(logs.map(l => l.exerciseId));
    const allLogged = session.exercises.length > 0
      && session.exercises.every(e => loggedExerciseIds.has(e.id));

    const elapsedSeconds = Math.max(0, Math.round((finished.getTime() - started.getTime()) / 1000));

    return this.prisma.workoutSession.create({
      data: {
        sessionId: dto.sessionId,
        athleteId: user.id,
        startedAt: started,
        finishedAt: finished,
        elapsedSeconds,
        activeSeconds,
        status: allLogged ? 'Completed' : 'Partial',
      },
      include: { session: { select: { name: true } } },
    });
  }
}
```

- [ ] **Step 5: Controller**

Create `src/workout-sessions/workout-sessions.controller.ts`:

```typescript
import { Controller, Get, Post, Body, Param, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { WorkoutSessionsService } from './workout-sessions.service';
import { CheckoutWorkoutSessionDto } from './dto/checkout-workout-session.dto';

@ApiTags('workout-sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('workout-sessions')
export class WorkoutSessionsController {
  constructor(private readonly service: WorkoutSessionsService) {}

  @Roles('athlete')
  @Post()
  @ApiOperation({ summary: 'Checkout: grava a sessão executada (atleta logado)' })
  checkout(@Request() req: any, @Body() dto: CheckoutWorkoutSessionDto) {
    return this.service.checkout(req.user, dto);
  }
}
```

- [ ] **Step 6: Module + registro**

Create `src/workout-sessions/workout-sessions.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { WorkoutSessionsService } from './workout-sessions.service';
import { WorkoutSessionsController } from './workout-sessions.controller';
import { StudentsModule } from '../students/students.module';

@Module({
  imports: [StudentsModule],
  controllers: [WorkoutSessionsController],
  providers: [WorkoutSessionsService],
  exports: [WorkoutSessionsService],
})
export class WorkoutSessionsModule {}
```

Em `src/app.module.ts`: importar e adicionar `WorkoutSessionsModule` na lista de `imports` (logo depois de `WorkoutLogsModule`):

```typescript
import { WorkoutSessionsModule } from './workout-sessions/workout-sessions.module';
// ...
    WorkoutLogsModule,
    WorkoutSessionsModule,
```

- [ ] **Step 7: Rodar e confirmar que passa**

Run: `npm test -- workout-sessions.service`
Expected: PASS (8 casos).

- [ ] **Step 8: Build + suíte completa**

```bash
npm run build && npm test
```
Expected: verde.

- [ ] **Step 9: Commit**

```bash
git add src/workout-sessions src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(workout-sessions): checkout de sessão executada (POST /workout-sessions)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `GET /workout-sessions/me` (histórico do atleta)

**Files:**
- Modify: `src/workout-sessions/workout-sessions.service.ts`
- Modify: `src/workout-sessions/workout-sessions.controller.ts`
- Test: `src/workout-sessions/workout-sessions.service.spec.ts`

**Interfaces:**
- Produces: `WorkoutSessionsService.listMine(athleteId: string) → Promise<Array<{ id, sessionId, sessionName, sessionType, startedAt, elapsedSeconds, activeSeconds, status }>>`; rota `GET /workout-sessions/me`

- [ ] **Step 1: Teste que falha**

Adicionar ao spec um `describe` novo:

```typescript
describe('WorkoutSessionsService.listMine', () => {
  let service: WorkoutSessionsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      workoutSession: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'ws-1', sessionId: 's-1', startedAt: new Date('2026-08-28T10:00:00Z'),
            elapsedSeconds: 2700, activeSeconds: 1800, status: 'Completed',
            session: { name: 'Segunda A', type: 'Metcon' },
          },
        ]),
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        WorkoutSessionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: { findOne: jest.fn() } },
      ],
    }).compile();
    service = module.get(WorkoutSessionsService);
  });

  it('lista as sessões do próprio atleta, mais recentes primeiro', async () => {
    const result = await service.listMine('athlete-1');

    expect(prisma.workoutSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { athleteId: 'athlete-1' },
        orderBy: { startedAt: 'desc' },
        take: 50,
      }),
    );
    expect(result[0]).toEqual({
      id: 'ws-1', sessionId: 's-1', sessionName: 'Segunda A', sessionType: 'Metcon',
      startedAt: new Date('2026-08-28T10:00:00Z'), elapsedSeconds: 2700, activeSeconds: 1800, status: 'Completed',
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npm test -- workout-sessions.service`
Expected: FAIL — `service.listMine is not a function`.

- [ ] **Step 3: Implementar**

No service:

```typescript
  async listMine(athleteId: string) {
    const rows = await this.prisma.workoutSession.findMany({
      where: { athleteId },
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: { session: { select: { name: true, type: true } } },
    });
    return rows.map(r => ({
      id: r.id,
      sessionId: r.sessionId,
      sessionName: r.session.name,
      sessionType: r.session.type,
      startedAt: r.startedAt,
      elapsedSeconds: r.elapsedSeconds,
      activeSeconds: r.activeSeconds,
      status: r.status,
    }));
  }
```

No controller:

```typescript
  @Roles('athlete')
  @Get('me')
  @ApiOperation({ summary: 'Histórico de sessões executadas do atleta logado' })
  listMine(@Request() req: any) {
    return this.service.listMine(req.user.id);
  }
```

- [ ] **Step 4: Rodar e confirmar passa**

Run: `npm test -- workout-sessions.service` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workout-sessions
git commit -m "feat(workout-sessions): GET /me — histórico do atleta

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `GET /workout-sessions/student/:studentId/summary` (coach)

**Files:**
- Modify: `src/workout-sessions/workout-sessions.service.ts`
- Modify: `src/workout-sessions/workout-sessions.controller.ts`
- Test: `src/workout-sessions/workout-sessions.service.spec.ts`

**Interfaces:**
- Produces: `WorkoutSessionsService.studentSummary(studentId: string, user: AuthUser) → Promise<{ count: number; avgElapsedSeconds: number; trend: { direction: 'faster'|'slower'|'equal'|'new'; deltaSeconds: number }; perExercise: Array<{ exerciseName: string; avgSeconds: number; samples: number }> }>`; rota `GET /workout-sessions/student/:studentId/summary`

- [ ] **Step 1: Teste que falha**

```typescript
describe('WorkoutSessionsService.studentSummary', () => {
  let service: WorkoutSessionsService;
  let prisma: any;
  let studentsService: { findOne: jest.Mock };
  const coachUser = { id: 'coach-1', role: 'coach' };

  beforeEach(async () => {
    prisma = {
      workoutSession: {
        findMany: jest.fn().mockResolvedValue([
          { elapsedSeconds: 3000, startedAt: new Date('2026-08-28T00:00:00Z') },
          { elapsedSeconds: 3200, startedAt: new Date('2026-08-27T00:00:00Z') },
          { elapsedSeconds: 3100, startedAt: new Date('2026-08-26T00:00:00Z') },
          { elapsedSeconds: 3600, startedAt: new Date('2026-08-25T00:00:00Z') },
          { elapsedSeconds: 3800, startedAt: new Date('2026-08-24T00:00:00Z') },
          { elapsedSeconds: 4000, startedAt: new Date('2026-08-23T00:00:00Z') },
        ]),
      },
      workoutLog: {
        findMany: jest.fn().mockResolvedValue([
          { durationSeconds: 60, exercise: { name: 'Back Squat' } },
          { durationSeconds: 80, exercise: { name: 'Back Squat' } },
          { durationSeconds: 40, exercise: { name: 'Snatch' } },
        ]),
      },
    };
    studentsService = { findOne: jest.fn().mockResolvedValue({ id: 'student-1', userId: 'athlete-1', coachId: 'coach-1' }) };
    const module = await Test.createTestingModule({
      providers: [
        WorkoutSessionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: studentsService },
      ],
    }).compile();
    service = module.get(WorkoutSessionsService);
  });

  it('checa posse antes de consultar', async () => {
    studentsService.findOne.mockRejectedValue(new ForbiddenException());
    await expect(service.studentSummary('student-1', coachUser)).rejects.toThrow(ForbiddenException);
    expect(prisma.workoutSession.findMany).not.toHaveBeenCalled();
  });

  it('consulta pelas sessões do userId do aluno', async () => {
    await service.studentSummary('student-1', coachUser);
    expect(prisma.workoutSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { athleteId: 'athlete-1' } }),
    );
  });

  it('calcula média, tendência (últimas 3 vs 3 anteriores) e tempo médio por exercício', async () => {
    const result = await service.studentSummary('student-1', coachUser);

    expect(result.count).toBe(6);
    expect(result.avgElapsedSeconds).toBe(3450); // média das 6
    // últimas 3 (3000,3200,3100 → 3100) vs 3 anteriores (3600,3800,4000 → 3800)
    expect(result.trend).toEqual({ direction: 'faster', deltaSeconds: -700 });
    expect(result.perExercise).toEqual([
      { exerciseName: 'Back Squat', avgSeconds: 70, samples: 2 },
      { exerciseName: 'Snatch', avgSeconds: 40, samples: 1 },
    ]);
  });

  it('retorna trend new quando há menos de 6 sessões', async () => {
    prisma.workoutSession.findMany.mockResolvedValue([
      { elapsedSeconds: 3000, startedAt: new Date() },
      { elapsedSeconds: 3200, startedAt: new Date() },
    ]);
    const result = await service.studentSummary('student-1', coachUser);
    expect(result.trend.direction).toBe('new');
  });

  it('retorna zerado quando não há sessão nenhuma', async () => {
    prisma.workoutSession.findMany.mockResolvedValue([]);
    const result = await service.studentSummary('student-1', coachUser);
    expect(result).toEqual({
      count: 0, avgElapsedSeconds: 0,
      trend: { direction: 'new', deltaSeconds: 0 }, perExercise: [],
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npm test -- workout-sessions.service` → FAIL.

- [ ] **Step 3: Implementar**

No service:

```typescript
  private mean(nums: number[]): number {
    return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;
  }

  async studentSummary(studentId: string, user: AuthUser) {
    const student = await this.studentsService.findOne(studentId, user);
    const athleteId = student.userId;

    const sessions = await this.prisma.workoutSession.findMany({
      where: { athleteId },
      orderBy: { startedAt: 'desc' },
      take: 20,
      select: { elapsedSeconds: true, startedAt: true },
    });

    const durations = sessions.map(s => s.elapsedSeconds);
    let trend: { direction: 'faster' | 'slower' | 'equal' | 'new'; deltaSeconds: number } = {
      direction: 'new', deltaSeconds: 0,
    };
    if (durations.length >= 6) {
      const recent = this.mean(durations.slice(0, 3));
      const previous = this.mean(durations.slice(3, 6));
      const delta = recent - previous;
      trend = {
        direction: delta < 0 ? 'faster' : delta > 0 ? 'slower' : 'equal',
        deltaSeconds: delta,
      };
    }

    const logs = await this.prisma.workoutLog.findMany({
      where: { athleteId, durationSeconds: { not: null } },
      select: { durationSeconds: true, exercise: { select: { name: true } } },
    });
    const byName = new Map<string, number[]>();
    for (const l of logs) {
      const arr = byName.get(l.exercise.name) ?? [];
      arr.push(l.durationSeconds as number);
      byName.set(l.exercise.name, arr);
    }
    const perExercise = Array.from(byName.entries())
      .map(([exerciseName, vals]) => ({ exerciseName, avgSeconds: this.mean(vals), samples: vals.length }))
      .sort((a, b) => b.samples - a.samples || a.exerciseName.localeCompare(b.exerciseName))
      .slice(0, 10);

    return {
      count: sessions.length,
      avgElapsedSeconds: this.mean(durations),
      trend,
      perExercise,
    };
  }
```

No controller:

```typescript
  @Roles('coach')
  @Get('student/:studentId/summary')
  @ApiOperation({ summary: 'Resumo de tempo de execução de um aluno (coach dono)' })
  studentSummary(@Param('studentId') studentId: string, @Request() req: any) {
    return this.service.studentSummary(studentId, req.user);
  }
```

- [ ] **Step 4: Rodar e confirmar passa**

Run: `npm test -- workout-sessions.service` → PASS.

Nota: o teste "calcula média..." espera `avgElapsedSeconds: 3450` — média das 6 (3000+3200+3100+3600+3800+4000 = 20700 / 6 = 3450). Confirmar que `take: 20` não corta (só há 6 no mock).

- [ ] **Step 5: Commit**

```bash
git add src/workout-sessions
git commit -m "feat(workout-sessions): GET student/:id/summary — média, tendência, tempo por exercício

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: `GET /workout-sessions/student/:studentId/session/:sessionId` (detalhe)

**Files:**
- Modify: `src/workout-sessions/workout-sessions.service.ts`
- Modify: `src/workout-sessions/workout-sessions.controller.ts`
- Test: `src/workout-sessions/workout-sessions.service.spec.ts`

**Interfaces:**
- Produces: `WorkoutSessionsService.sessionDetail(studentId: string, sessionId: string, user: AuthUser) → Promise<{ sessionId: string; sessionName: string; exercises: Array<{ id: string; name: string; durationSeconds: number | null; completed: boolean }>; lastExecution: { startedAt: Date; finishedAt: Date; elapsedSeconds: number; activeSeconds: number; status: string } | null; executionCount: number }>`; rota `GET /workout-sessions/student/:studentId/session/:sessionId`

- [ ] **Step 1: Teste que falha**

```typescript
describe('WorkoutSessionsService.sessionDetail', () => {
  let service: WorkoutSessionsService;
  let prisma: any;
  let studentsService: { findOne: jest.Mock };
  const coachUser = { id: 'coach-1', role: 'coach' };

  beforeEach(async () => {
    prisma = {
      session: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1', name: 'Segunda A',
          exercises: [
            { id: 'ex-1', name: 'Back Squat', workoutLogs: [{ durationSeconds: 75 }] },
            { id: 'ex-2', name: 'Snatch', workoutLogs: [] },
          ],
        }),
      },
      workoutSession: {
        findMany: jest.fn().mockResolvedValue([
          { startedAt: new Date('2026-08-28T10:00:00Z'), finishedAt: new Date('2026-08-28T10:40:00Z'),
            elapsedSeconds: 2400, activeSeconds: 1500, status: 'Partial' },
        ]),
      },
    };
    studentsService = { findOne: jest.fn().mockResolvedValue({ id: 'student-1', userId: 'athlete-1', coachId: 'coach-1' }) };
    const module = await Test.createTestingModule({
      providers: [
        WorkoutSessionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: studentsService },
      ],
    }).compile();
    service = module.get(WorkoutSessionsService);
  });

  it('checa posse antes de consultar', async () => {
    studentsService.findOne.mockRejectedValue(new ForbiddenException());
    await expect(service.sessionDetail('student-1', 'session-1', coachUser)).rejects.toThrow(ForbiddenException);
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });

  it('retorna tempo por exercício (último log do aluno) e a última execução', async () => {
    const result = await service.sessionDetail('student-1', 'session-1', coachUser);
    expect(result).toEqual({
      sessionId: 'session-1',
      sessionName: 'Segunda A',
      exercises: [
        { id: 'ex-1', name: 'Back Squat', durationSeconds: 75, completed: true },
        { id: 'ex-2', name: 'Snatch', durationSeconds: null, completed: false },
      ],
      lastExecution: {
        startedAt: new Date('2026-08-28T10:00:00Z'), finishedAt: new Date('2026-08-28T10:40:00Z'),
        elapsedSeconds: 2400, activeSeconds: 1500, status: 'Partial',
      },
      executionCount: 1,
    });
    expect(prisma.session.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1' },
        include: expect.objectContaining({
          exercises: expect.objectContaining({
            include: { workoutLogs: expect.objectContaining({ where: { athleteId: 'athlete-1' } }) },
          }),
        }),
      }),
    );
  });

  it('lastExecution null quando o aluno nunca executou', async () => {
    prisma.workoutSession.findMany.mockResolvedValue([]);
    const result = await service.sessionDetail('student-1', 'session-1', coachUser);
    expect(result.lastExecution).toBeNull();
    expect(result.executionCount).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npm test -- workout-sessions.service` → FAIL.

- [ ] **Step 3: Implementar**

No service:

```typescript
  async sessionDetail(studentId: string, sessionId: string, user: AuthUser) {
    const student = await this.studentsService.findOne(studentId, user);
    const athleteId = student.userId;

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        exercises: {
          orderBy: { order: 'asc' },
          include: {
            workoutLogs: {
              where: { athleteId },
              orderBy: { completedAt: 'desc' },
              take: 1,
              select: { durationSeconds: true },
            },
          },
        },
      },
    });
    if (!session) throw new BadRequestException('Sessão não encontrada');

    const executions = await this.prisma.workoutSession.findMany({
      where: { sessionId, athleteId },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true, finishedAt: true, elapsedSeconds: true, activeSeconds: true, status: true },
    });

    return {
      sessionId: session.id,
      sessionName: session.name,
      exercises: session.exercises.map(e => ({
        id: e.id,
        name: e.name,
        durationSeconds: e.workoutLogs[0]?.durationSeconds ?? null,
        completed: e.workoutLogs.length > 0,
      })),
      lastExecution: executions[0] ?? null,
      executionCount: executions.length,
    };
  }
```

No controller:

```typescript
  @Roles('coach')
  @Get('student/:studentId/session/:sessionId')
  @ApiOperation({ summary: 'Tempo por exercício + última execução de uma sessão (coach dono)' })
  sessionDetail(
    @Param('studentId') studentId: string,
    @Param('sessionId') sessionId: string,
    @Request() req: any,
  ) {
    return this.service.sessionDetail(studentId, sessionId, req.user);
  }
```

- [ ] **Step 4: Rodar e confirmar passa**

Run: `npm test -- workout-sessions.service` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workout-sessions
git commit -m "feat(workout-sessions): GET student/:id/session/:id — detalhe de tempo por exercício

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: `GET /workout-sessions/coach/avg-duration` (dashboard + listagem)

**Files:**
- Modify: `src/workout-sessions/workout-sessions.service.ts`
- Modify: `src/workout-sessions/workout-sessions.controller.ts`
- Test: `src/workout-sessions/workout-sessions.service.spec.ts`

**Interfaces:**
- Produces: `WorkoutSessionsService.coachAvgDuration(coachId: string) → Promise<{ overallAvgSeconds: number; totalSessions: number; byStudent: Array<{ studentId: string; avgSeconds: number; count: number }> }>`; rota `GET /workout-sessions/coach/avg-duration`

- [ ] **Step 1: Teste que falha**

```typescript
describe('WorkoutSessionsService.coachAvgDuration', () => {
  let service: WorkoutSessionsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      student: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'student-1', userId: 'athlete-1' },
          { id: 'student-2', userId: 'athlete-2' },
        ]),
      },
      workoutSession: {
        findMany: jest.fn().mockResolvedValue([
          { athleteId: 'athlete-1', elapsedSeconds: 3000 },
          { athleteId: 'athlete-1', elapsedSeconds: 3600 },
          { athleteId: 'athlete-2', elapsedSeconds: 1800 },
        ]),
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        WorkoutSessionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: { findOne: jest.fn() } },
      ],
    }).compile();
    service = module.get(WorkoutSessionsService);
  });

  it('agrega por aluno do coach e no geral, últimos 30 dias', async () => {
    const result = await service.coachAvgDuration('coach-1');

    expect(prisma.student.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { coachId: 'coach-1' } }),
    );
    expect(prisma.workoutSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          athleteId: { in: ['athlete-1', 'athlete-2'] },
          startedAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }),
    );
    expect(result.overallAvgSeconds).toBe(2800); // (3000+3600+1800)/3
    expect(result.totalSessions).toBe(3);
    expect(result.byStudent).toEqual([
      { studentId: 'student-1', avgSeconds: 3300, count: 2 },
      { studentId: 'student-2', avgSeconds: 1800, count: 1 },
    ]);
  });

  it('retorna zerado e byStudent com zeros quando não há sessão', async () => {
    prisma.workoutSession.findMany.mockResolvedValue([]);
    const result = await service.coachAvgDuration('coach-1');
    expect(result.overallAvgSeconds).toBe(0);
    expect(result.totalSessions).toBe(0);
    expect(result.byStudent).toEqual([
      { studentId: 'student-1', avgSeconds: 0, count: 0 },
      { studentId: 'student-2', avgSeconds: 0, count: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npm test -- workout-sessions.service` → FAIL.

- [ ] **Step 3: Implementar**

No service:

```typescript
  async coachAvgDuration(coachId: string) {
    const students = await this.prisma.student.findMany({
      where: { coachId },
      select: { id: true, userId: true },
    });
    const userIdToStudentId = new Map(students.map(s => [s.userId, s.id]));

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const sessions = await this.prisma.workoutSession.findMany({
      where: { athleteId: { in: students.map(s => s.userId) }, startedAt: { gte: since } },
      select: { athleteId: true, elapsedSeconds: true },
    });

    const all = sessions.map(s => s.elapsedSeconds);
    const byAthlete = new Map<string, number[]>();
    for (const s of sessions) {
      const arr = byAthlete.get(s.athleteId) ?? [];
      arr.push(s.elapsedSeconds);
      byAthlete.set(s.athleteId, arr);
    }

    const byStudent = students.map(s => {
      const vals = byAthlete.get(s.userId) ?? [];
      return { studentId: s.id, avgSeconds: this.mean(vals), count: vals.length };
    });

    return {
      overallAvgSeconds: this.mean(all),
      totalSessions: sessions.length,
      byStudent,
    };
  }
```

(`this.mean` já foi criado na Task 5.)

No controller:

```typescript
  @Roles('coach')
  @Get('coach/avg-duration')
  @ApiOperation({ summary: 'Tempo médio de treino dos alunos do coach (últimos 30 dias)' })
  coachAvgDuration(@Request() req: any) {
    return this.service.coachAvgDuration(req.user.id);
  }
```

**Atenção à ordem das rotas no controller:** `@Get('coach/avg-duration')` e `@Get('me')` são rotas estáticas — devem ser declaradas ANTES de qualquer `@Get(':algo')` dinâmico. Como não há `@Get(':id')` neste controller, não há conflito, mas manter `me` e `coach/avg-duration` no topo dos GETs por clareza.

- [ ] **Step 4: Rodar e confirmar passa**

Run: `npm test -- workout-sessions.service` → PASS (todos os describes).

- [ ] **Step 5: Build + suíte completa + commit**

```bash
npm run build && npm test
git add src/workout-sessions
git commit -m "feat(workout-sessions): GET coach/avg-duration — agregado do dashboard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Frontend — models + métodos no `ApiService`

**Files:**
- Modify: `src/app/core/models/training.model.ts`
- Modify: `src/app/core/services/api.service.ts`

**Interfaces:**
- Produces (para as tasks de UI):
  - `WorkoutSessionStatus = 'Completed' | 'Partial'`
  - `WorkoutSessionRecord { id; sessionId; sessionName; sessionType; startedAt: string; elapsedSeconds; activeSeconds; status: WorkoutSessionStatus }`
  - `SessionTimeSummary { count; avgElapsedSeconds; trend: { direction: 'faster'|'slower'|'equal'|'new'; deltaSeconds }; perExercise: { exerciseName; avgSeconds; samples }[] }`
  - `SessionTimeDetail { sessionId; sessionName; exercises: { id; name; durationSeconds: number|null; completed: boolean }[]; lastExecution: { startedAt: string; finishedAt: string; elapsedSeconds; activeSeconds; status: string } | null; executionCount }`
  - `CoachAvgDuration { overallAvgSeconds; totalSessions; byStudent: { studentId; avgSeconds; count }[] }`
  - `ApiService.logExercise(exerciseId, setsCompleted, notes?, durationSeconds?)`
  - `ApiService.checkoutWorkoutSession(sessionId, startedAt, finishedAt) → Observable<WorkoutSessionRecord>`
  - `ApiService.getMyWorkoutSessions() → Observable<WorkoutSessionRecord[]>`
  - `ApiService.getStudentSessionSummary(studentId) → Observable<SessionTimeSummary>`
  - `ApiService.getStudentSessionDetail(studentId, sessionId) → Observable<SessionTimeDetail>`
  - `ApiService.getCoachAvgDuration() → Observable<CoachAvgDuration>`

- [ ] **Step 1: Tipos**

Em `src/app/core/models/training.model.ts`, ao final do arquivo:

```typescript
export type WorkoutSessionStatus = 'Completed' | 'Partial';

export interface WorkoutSessionRecord {
  id: string;
  sessionId: string;
  sessionName: string;
  sessionType: string;
  startedAt: string;
  elapsedSeconds: number;
  activeSeconds: number;
  status: WorkoutSessionStatus;
}

export interface SessionTimeSummary {
  count: number;
  avgElapsedSeconds: number;
  trend: { direction: 'faster' | 'slower' | 'equal' | 'new'; deltaSeconds: number };
  perExercise: { exerciseName: string; avgSeconds: number; samples: number }[];
}

export interface SessionTimeDetail {
  sessionId: string;
  sessionName: string;
  exercises: { id: string; name: string; durationSeconds: number | null; completed: boolean }[];
  lastExecution:
    | { startedAt: string; finishedAt: string; elapsedSeconds: number; activeSeconds: number; status: string }
    | null;
  executionCount: number;
}

export interface CoachAvgDuration {
  overallAvgSeconds: number;
  totalSessions: number;
  byStudent: { studentId: string; avgSeconds: number; count: number }[];
}
```

- [ ] **Step 2: `logExercise` ganha `durationSeconds`**

Em `src/app/core/services/api.service.ts`, localizar `logExercise` (linha ~367) e trocar por:

```typescript
  logExercise(exerciseId: string, setsCompleted: number, notes?: string, durationSeconds?: number): Observable<WorkoutLog> {
    return this.http.post<WorkoutLog>(`${this.base}/workout-logs`, {
      exerciseId,
      setsCompleted,
      notes,
      durationSeconds,
    });
  }
```

- [ ] **Step 3: Métodos novos**

Adicionar ao import de `../models` os tipos novos: `WorkoutSessionRecord, SessionTimeSummary, SessionTimeDetail, CoachAvgDuration`.

Logo depois do `logExercise`, adicionar uma seção nova:

```typescript
  // ── Workout Sessions (tempo de execução) ─────────────────────────────────

  checkoutWorkoutSession(sessionId: string, startedAt: string, finishedAt: string): Observable<WorkoutSessionRecord> {
    return this.http.post<WorkoutSessionRecord>(`${this.base}/workout-sessions`, { sessionId, startedAt, finishedAt });
  }

  getMyWorkoutSessions(): Observable<WorkoutSessionRecord[]> {
    return this.http.get<WorkoutSessionRecord[]>(`${this.base}/workout-sessions/me`);
  }

  getStudentSessionSummary(studentId: string): Observable<SessionTimeSummary> {
    return this.http.get<SessionTimeSummary>(`${this.base}/workout-sessions/student/${studentId}/summary`);
  }

  getStudentSessionDetail(studentId: string, sessionId: string): Observable<SessionTimeDetail> {
    return this.http.get<SessionTimeDetail>(`${this.base}/workout-sessions/student/${studentId}/session/${sessionId}`);
  }

  getCoachAvgDuration(): Observable<CoachAvgDuration> {
    return this.http.get<CoachAvgDuration>(`${this.base}/workout-sessions/coach/avg-duration`);
  }
```

- [ ] **Step 4: Type-check + build**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use v20.20.0
npx tsc --noEmit -p tsconfig.json || npx ng build --configuration development
```
Expected: sem erros de tipo.

- [ ] **Step 5: Commit**

```bash
git add src/app/core
git commit -m "feat(api): tipos e métodos de workout-sessions no ApiService

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: `workout-draft.ts` — rascunho em localStorage

**Files:**
- Create: `src/app/shared/utils/workout-draft.ts`
- Create: `src/app/shared/utils/workout-draft.spec.ts`

**Interfaces:**
- Produces:
  - `interface WorkoutDraft { sessionId: string; startedAt: string; currentIndex: number; perExercise: Record<string, number>; updatedAt: string }`
  - `loadDraft(sessionId: string): WorkoutDraft | null`
  - `saveDraft(draft: WorkoutDraft): void`
  - `clearDraft(sessionId: string): void`

- [ ] **Step 1: Teste que falha**

Create `src/app/shared/utils/workout-draft.spec.ts`:

```typescript
import { loadDraft, saveDraft, clearDraft, WorkoutDraft } from './workout-draft';

describe('workout-draft', () => {
  beforeEach(() => localStorage.clear());

  const draft: WorkoutDraft = {
    sessionId: 's-1',
    startedAt: '2026-08-28T10:00:00.000Z',
    currentIndex: 2,
    perExercise: { 'ex-1': 60, 'ex-2': 90 },
    updatedAt: '2026-08-28T10:05:00.000Z',
  };

  it('salva e carrega o rascunho da mesma sessão', () => {
    saveDraft(draft);
    expect(loadDraft('s-1')).toEqual(draft);
  });

  it('retorna null quando não há rascunho', () => {
    expect(loadDraft('inexistente')).toBeNull();
  });

  it('retorna null quando o rascunho é de outra sessão', () => {
    saveDraft(draft);
    expect(loadDraft('s-2')).toBeNull();
  });

  it('clearDraft remove o rascunho', () => {
    saveDraft(draft);
    clearDraft('s-1');
    expect(loadDraft('s-1')).toBeNull();
  });

  it('loadDraft retorna null quando o JSON está corrompido', () => {
    localStorage.setItem('workout-draft:s-1', '{quebrado');
    expect(loadDraft('s-1')).toBeNull();
  });

  it('não lança quando localStorage não está disponível', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => saveDraft(draft)).not.toThrow();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npm test -- workout-draft`
Expected: FAIL — módulo não existe.

(Nota: se o `npm test` do frontend estiver quebrado no ambiente — pendência conhecida do vitest sem browser provider — rodar via `npx vitest run src/app/shared/utils/workout-draft.spec.ts` ou o runner configurado no projeto. Confirmar o runner em `package.json`/`angular.json` antes.)

- [ ] **Step 3: Implementar**

Create `src/app/shared/utils/workout-draft.ts`:

```typescript
export interface WorkoutDraft {
  sessionId: string;
  /** ISO — momento do primeiro "Iniciar exercício" do treino */
  startedAt: string;
  currentIndex: number;
  /** exerciseId -> tempo de execução em segundos (exercícios já concluídos) */
  perExercise: Record<string, number>;
  updatedAt: string;
}

const key = (sessionId: string) => `workout-draft:${sessionId}`;

export function loadDraft(sessionId: string): WorkoutDraft | null {
  try {
    const raw = localStorage.getItem(key(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkoutDraft;
    if (!parsed || parsed.sessionId !== sessionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(draft: WorkoutDraft): void {
  try {
    localStorage.setItem(key(draft.sessionId), JSON.stringify(draft));
  } catch {
    /* localStorage indisponível (aba anônima, storage bloqueado) — segue sem rascunho */
  }
}

export function clearDraft(sessionId: string): void {
  try {
    localStorage.removeItem(key(sessionId));
  } catch {
    /* idem */
  }
}
```

- [ ] **Step 4: Rodar e confirmar passa**

Run: `npm test -- workout-draft` → PASS (6 casos).

- [ ] **Step 5: Commit**

```bash
git add src/app/shared/utils/workout-draft.ts src/app/shared/utils/workout-draft.spec.ts
git commit -m "feat(athlete): util de rascunho de treino em localStorage

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: `active-workout` — cronômetro Iniciar/Concluir + `durationSeconds` + rascunho

**Files:**
- Modify: `src/app/features/athlete/active-workout/active-workout.component.ts`
- Modify: `src/app/features/athlete/active-workout/active-workout.component.html`

**Interfaces:**
- Consumes: `loadDraft`, `saveDraft`, `clearDraft` (Task 9); `ApiService.logExercise(..., durationSeconds)` (Task 8)
- Produces: estado interno — `exElapsed` (signal, count-up em segundos), `sessionStartedAt` (string|null), `perExercise` map; a fase `done` continua existindo mas sem UI nova ainda (Task 11 faz o resumo)

- [ ] **Step 1: Reescrever o componente TS**

Substituir o conteúdo de `active-workout.component.ts` por (mantém a estrutura de fases e o timer de descanso; troca o timer de exercício de contagem-regressiva por count-up cronometrado, unificado para todo exercício):

```typescript
import { Component, OnInit, signal, computed, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { Session, Exercise, SkipReason, SkipDecision } from '../../../core/models';
import { SkipReasonModalComponent } from '../../../shared/components/skip-reason-modal/skip-reason-modal.component';
import { Subject, interval, takeUntil } from 'rxjs';
import { loadDraft, saveDraft, clearDraft, WorkoutDraft } from '../../../shared/utils/workout-draft';

type Phase = 'exercise' | 'rest' | 'done';

@Component({
  selector: 'app-active-workout',
  standalone: true,
  imports: [CommonModule, SkipReasonModalComponent],
  templateUrl: './active-workout.component.html',
  styleUrl: './active-workout.component.scss',
})
export class ActiveWorkoutComponent implements OnInit, OnDestroy {
  session       = signal<Session | null>(null);
  currentIndex  = signal(0);
  skipModalOpen = signal(false);
  skipError     = signal('');
  phase         = signal<Phase>('exercise');
  resumedToast  = signal(false);

  /** ISO do primeiro "Iniciar exercício" do treino (relógio de parede da sessão) */
  sessionStartedAt = signal<string | null>(null);

  // ── Cronômetro do exercício (count-up) ──
  exRunning = signal(false);
  exPaused  = signal(false);
  exElapsed = signal(0);               // segundos decorridos no exercício atual
  private exStartMs = 0;               // Date.now() de quando iniciou/retomou
  private exAccumBeforePause = 0;      // segundos acumulados antes da pausa atual

  // ── Timer de descanso (countdown, inalterado) ──
  restSecs   = signal(0);
  restTarget = signal(0);
  restPaused = signal(false);

  /** exerciseId -> durationSeconds dos já concluídos (fonte da tela de resumo) */
  private perExercise: Record<string, number> = {};

  private destroy$   = new Subject<void>();
  private timerStop$ = new Subject<void>();

  currentExercise = computed(() => {
    const s = this.session();
    return s ? (s.exercises[this.currentIndex()] ?? null) : null;
  });

  nextExercise = computed(() => {
    const s = this.session();
    if (!s) return null;
    return s.exercises[this.currentIndex() + 1] ?? null;
  });

  /** alvo de duração parseável, só como guia visual */
  durationTarget = computed(() => {
    const ex = this.currentExercise();
    return ex?.duration ? this.parseDuration(ex.duration) : 0;
  });

  restProgress = computed(() => {
    const t = this.restTarget();
    return t ? ((t - this.restSecs()) / t) * 100 : 0;
  });

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('sessionId') ?? '';
    this.api.getSession(id).subscribe(s => {
      this.session.set(s);
      this.restoreDraftIfAny(s);
      this.enterExercise();
    });
  }

  ngOnDestroy(): void {
    this.timerStop$.next();
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Rascunho ───────────────────────────────────────────────────────────────

  private restoreDraftIfAny(s: Session): void {
    const draft = loadDraft(s.id);
    if (!draft) return;
    this.sessionStartedAt.set(draft.startedAt);
    this.perExercise = { ...draft.perExercise };
    // marca como concluídos os exercícios que já têm tempo no rascunho
    this.session.update(cur => cur ? {
      ...cur,
      exercises: cur.exercises.map(e =>
        draft.perExercise[e.id] != null ? { ...e, completed: true } : e),
    } : cur);
    const idx = Math.min(draft.currentIndex, s.exercises.length - 1);
    this.currentIndex.set(Math.max(0, idx));
    this.resumedToast.set(true);
    setTimeout(() => this.resumedToast.set(false), 3000);
  }

  private persistDraft(): void {
    const s = this.session();
    const startedAt = this.sessionStartedAt();
    if (!s || !startedAt) return;
    const draft: WorkoutDraft = {
      sessionId: s.id,
      startedAt,
      currentIndex: this.currentIndex(),
      perExercise: { ...this.perExercise },
      updatedAt: new Date().toISOString(),
    };
    saveDraft(draft);
  }

  // ── Navegação ──────────────────────────────────────────────────────────────

  exitWorkout(): void {
    this.stopTimers();
    const s = this.session();
    this.router.navigate(s ? ['/athlete/session', s.id] : ['/athlete/home']);
  }

  // ── Fase exercício ─────────────────────────────────────────────────────────

  private enterExercise(): void {
    this.stopTimers();
    const ex = this.currentExercise();
    if (!ex) { this.phase.set('done'); return; }
    this.phase.set('exercise');
    this.exRunning.set(false);
    this.exPaused.set(false);
    this.exElapsed.set(0);
    this.exAccumBeforePause = 0;
  }

  startExercise(): void {
    if (this.exRunning()) return;
    if (!this.sessionStartedAt()) this.sessionStartedAt.set(new Date().toISOString());
    this.exRunning.set(true);
    this.exPaused.set(false);
    this.exStartMs = Date.now();
    this.persistDraft();

    interval(1000).pipe(takeUntil(this.timerStop$)).subscribe(() => {
      if (this.exPaused()) return;
      const running = Math.round((Date.now() - this.exStartMs) / 1000);
      this.exElapsed.set(this.exAccumBeforePause + running);
    });
  }

  toggleExPause(): void {
    if (!this.exRunning()) return;
    if (this.exPaused()) {
      this.exPaused.set(false);
      this.exStartMs = Date.now();
    } else {
      this.exPaused.set(true);
      this.exAccumBeforePause += Math.round((Date.now() - this.exStartMs) / 1000);
      this.exElapsed.set(this.exAccumBeforePause);
    }
  }

  /** "Concluir exercício" */
  completeExercise(): void {
    const ex = this.currentExercise();
    if (!ex) return;

    let duration = this.exElapsed();
    if (this.exRunning() && !this.exPaused()) {
      duration = this.exAccumBeforePause + Math.round((Date.now() - this.exStartMs) / 1000);
    }
    this.stopTimers();
    this.exRunning.set(false);

    this.perExercise[ex.id] = duration;
    this.api.logExercise(ex.id, ex.sets ?? 1, undefined, duration).subscribe();
    this.session.update(s => s ? {
      ...s,
      exercises: s.exercises.map((e, i) => i === this.currentIndex() ? { ...e, completed: true } : e),
    } : s);
    this.persistDraft();

    const rest = ex.restSeconds ?? 0;
    if (rest > 0) this.enterRest(rest);
    else this.advance();
  }

  skipExercise(): void {
    this.stopTimers();
    this.skipModalOpen.set(true);
  }

  onSkipConfirmed(payload: { reason: SkipReason; decision: SkipDecision; note?: string }): void {
    this.skipModalOpen.set(false);
    const ex = this.currentExercise();
    if (!ex) return;
    this.api.skip({ exerciseId: ex.id }, payload.reason, payload.decision, payload.note).subscribe({
      next: () => this.advance(),
      error: () => {
        this.exRunning.set(false);
        this.exPaused.set(false);
        this.showSkipError();
      },
    });
  }

  onSkipCancelled(): void {
    this.skipModalOpen.set(false);
    this.exRunning.set(false);
    this.exPaused.set(false);
  }

  private showSkipError(): void {
    this.skipError.set('Não foi possível registrar o pulo. Tente novamente.');
    setTimeout(() => this.skipError.set(''), 3500);
  }

  // ── Fase descanso ──────────────────────────────────────────────────────────

  private enterRest(seconds: number): void {
    this.stopTimers();
    this.restTarget.set(seconds);
    this.restSecs.set(seconds);
    this.restPaused.set(false);
    this.phase.set('rest');

    interval(1000).pipe(takeUntil(this.timerStop$)).subscribe(() => {
      if (this.restPaused()) return;
      const cur = this.restSecs();
      if (cur <= 1) { this.restSecs.set(0); this.advance(); }
      else this.restSecs.set(cur - 1);
    });
  }

  toggleRestPause(): void { this.restPaused.update(v => !v); }
  skipRest(): void { this.stopTimers(); this.advance(); }

  // ── Avançar ────────────────────────────────────────────────────────────────

  private advance(): void {
    const s = this.session();
    if (!s) return;
    if (this.currentIndex() < s.exercises.length - 1) {
      this.currentIndex.update(i => i + 1);
      this.persistDraft();
      this.enterExercise();
    } else {
      this.stopTimers();
      this.phase.set('done');
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private stopTimers(): void { this.timerStop$.next(); }

  formatTime(s: number): string {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }

  parseDuration(d: string): number {
    if (!d) return 0;
    const s = d.toLowerCase().trim();
    let m: RegExpMatchArray | null;
    if ((m = s.match(/^(\d+):(\d+)$/))) return +m[1] * 60 + +m[2];
    if ((m = s.match(/^(\d+)\s*min$/)))  return +m[1] * 60;
    if ((m = s.match(/^(\d+)\s*s$/)))    return +m[1];
    if ((m = s.match(/^(\d+)$/)))         return +m[1];
    return 0;
  }

  repsFontSizeClass(reps: string | number): string {
    const len = String(reps).length;
    if (len <= 3)  return 'text-[64px]';
    if (len <= 7)  return 'text-[40px]';
    if (len <= 14) return 'text-2xl';
    return 'text-base';
  }
}
```

- [ ] **Step 2: Reescrever a fase EXERCÍCIO no HTML**

Em `active-workout.component.html`, substituir todo o bloco `} @else if (phase() === 'exercise' && currentExercise()) { ... }` (linhas ~86–236) por uma versão unificada: sempre mostra o cronômetro count-up + botões Iniciar / (Pausar · Concluir), o alvo de duração vira legenda, e o bloco de sets/reps/carga vira info secundária (não o controle principal). Adicionar também o botão fixo "Finalizar treino agora" (usado a qualquer momento):

```html
  } @else if (phase() === 'exercise' && currentExercise()) {
    <div class="flex-1 flex flex-col overflow-y-auto">

      <div class="px-5 pt-2 pb-1 flex-shrink-0">
        <h2 class="font-headline font-black text-[22px] text-on-surface uppercase leading-tight tracking-tighter">
          {{ currentExercise()!.name }}
        </h2>
      </div>

      <!-- Cronômetro count-up (todo exercício) -->
      <div class="flex-shrink-0 flex flex-col items-center justify-center px-5 py-5">
        <p class="font-headline font-black leading-none tracking-tighter italic timer-fluid"
          [class.text-primary-fixed]="exRunning() && !exPaused()"
          [class.opacity-40]="exPaused()">
          {{ formatTime(exElapsed()) }}
        </p>
        <p class="text-outline text-[10px] font-headline uppercase tracking-widest mt-1">
          @if (!exRunning()) {
            @if (durationTarget()) { Alvo: {{ formatTime(durationTarget()) }} } @else { Tempo de execução }
          } @else if (exPaused()) { Pausado } @else { Cronometrando... }
        </p>

        <div class="flex gap-3 mt-5 w-full">
          @if (!exRunning()) {
            <button type="button" (click)="startExercise()"
              class="flex-1 flex items-center justify-center gap-2 bg-primary-fixed hover:bg-primary-dim text-on-primary-fixed font-headline font-black py-5 rounded-sm active:scale-95 transition-all text-base uppercase tracking-tighter">
              <span class="material-symbols-outlined text-[24px]">play_arrow</span>
              Iniciar exercício
            </button>
          } @else {
            <button type="button" (click)="toggleExPause()"
              class="flex-1 flex items-center justify-center gap-2 border border-outline-variant/30 text-on-surface-variant font-headline py-4 rounded-sm active:scale-95 transition-all text-xs uppercase tracking-wider">
              <span class="material-symbols-outlined text-[20px]">{{ exPaused() ? 'play_arrow' : 'pause' }}</span>
              {{ exPaused() ? 'Retomar' : 'Pausar' }}
            </button>
            <button type="button" (click)="completeExercise()"
              class="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 text-white font-headline font-bold py-4 rounded-sm active:scale-95 transition-all text-xs uppercase tracking-wider">
              <span class="material-symbols-outlined text-[20px]">check</span>
              Concluir exercício
            </button>
          }
        </div>

        <button type="button" (click)="skipExercise()"
          class="mt-2 w-full flex items-center justify-center gap-1 text-outline hover:text-on-surface-variant font-headline py-3 text-xs uppercase tracking-wider transition-colors">
          <span class="material-symbols-outlined text-[16px]">skip_next</span>
          Pular exercício
        </button>
      </div>

      <!-- Prescrição (sets / reps / carga) como info -->
      <div class="px-5 flex-shrink-0">
        <div class="flex items-center justify-center gap-4 py-2 flex-wrap">
          @if (currentExercise()!.sets) {
            <div class="text-center flex-shrink-0">
              <p class="font-headline font-black text-2xl text-on-surface leading-none tracking-tighter">{{ currentExercise()!.sets }}</p>
              <p class="text-outline text-[9px] font-headline uppercase tracking-widest mt-0.5">Séries</p>
            </div>
          }
          @if (currentExercise()!.reps) {
            <div class="text-center max-w-[55vw] min-w-0">
              <p [class]="repsFontSizeClass(currentExercise()!.reps!)"
                class="font-headline font-black text-on-surface leading-tight tracking-tighter break-words">{{ currentExercise()!.reps }}</p>
              <p class="text-outline text-[9px] font-headline uppercase tracking-widest mt-0.5">Reps</p>
            </div>
          }
          @if (currentExercise()!.loadPercent) {
            <div class="text-center flex-shrink-0">
              <p class="font-headline font-black text-2xl text-primary-fixed leading-none tracking-tighter">{{ currentExercise()!.loadPercent }}%</p>
              <p class="text-outline text-[9px] font-headline uppercase tracking-widest mt-0.5">Carga</p>
            </div>
          }
        </div>
      </div>

      <!-- Info extra: dica do coach, vídeo, descanso -->
      <div class="px-5 flex-1 mt-2">
        @if (currentExercise()!.coachNotes) {
          <div class="bg-surface-container-low rounded-md p-4 mb-3 border-l-2 border-primary-fixed">
            <p class="text-outline text-[9px] font-headline uppercase tracking-wider mb-1">Dica do Coach</p>
            <p class="text-on-surface text-xs leading-relaxed">{{ currentExercise()!.coachNotes }}</p>
          </div>
        }
        @if (currentExercise()!.youtubeUrl) {
          <a [href]="currentExercise()!.youtubeUrl" target="_blank" rel="noopener"
            class="flex items-center gap-2 text-primary-fixed text-xs font-headline mb-3 transition-opacity active:opacity-60">
            <span class="material-symbols-outlined text-[16px]">play_circle</span>
            Ver demonstração
          </a>
        }
        @if (currentExercise()!.restSeconds) {
          <p class="text-outline text-[10px] font-headline flex items-center gap-1 mb-3">
            <span class="material-symbols-outlined text-[14px]">timer</span>
            Descanso após: {{ formatTime(currentExercise()!.restSeconds!) }}
          </p>
        }
      </div>

      <!-- Finalizar treino agora -->
      <div class="px-5 pb-6 flex-shrink-0">
        <button type="button" (click)="phase.set('done')"
          class="w-full flex items-center justify-center gap-2 border border-outline-variant/30 text-on-surface-variant font-headline py-3 rounded-sm active:scale-95 transition-all text-xs uppercase tracking-wider">
          <span class="material-symbols-outlined text-[18px]">flag</span>
          Finalizar treino agora
        </button>
      </div>

    </div>
```

Manter os blocos das fases DESCANSO e CONCLUÍDO como estão por enquanto (a Task 11 refaz o CONCLUÍDO). Manter o `<app-skip-reason-modal>` e o toast de erro. Adicionar, logo depois do toast de erro, o toast de "treino retomado":

```html
  @if (resumedToast()) {
    <div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] animate-slide-up px-5 w-full max-w-md">
      <div class="bg-surface-container-high border border-outline-variant/30 text-on-surface font-headline text-sm px-5 py-3 rounded-sm shadow-xl flex items-center gap-2">
        <span class="material-symbols-outlined text-[18px]">history</span>
        Treino retomado de onde você parou
      </div>
    </div>
  }
```

- [ ] **Step 3: Type-check / build**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use v20.20.0
npx ng build --configuration development
```
Expected: build OK. Corrigir qualquer referência remanescente aos símbolos removidos (`hasDuration`, `exSecs`, `exTarget`, `startTimer`, `checkin`, `exProgress`) — não devem mais existir no HTML.

- [ ] **Step 4: Commit**

```bash
git add src/app/features/athlete/active-workout
git commit -m "feat(athlete): cronômetro Iniciar/Concluir por exercício + rascunho de treino

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: `active-workout` — tela de resumo + checkout

**Files:**
- Modify: `src/app/features/athlete/active-workout/active-workout.component.ts`
- Modify: `src/app/features/athlete/active-workout/active-workout.component.html`

**Interfaces:**
- Consumes: `ApiService.checkoutWorkoutSession(sessionId, startedAt, finishedAt)` (Task 8); `clearDraft` (Task 9)
- Produces: fase `done` com resumo (tempo total, tempo por exercício, concluídos/pulados) + botão "Finalizar treino" que grava e navega

- [ ] **Step 1: Lógica do resumo no TS**

Adicionar ao componente:

```typescript
  saving      = signal(false);
  checkoutErr = signal('');

  summaryRows = computed(() => {
    const s = this.session();
    if (!s) return [];
    return s.exercises.map(e => ({
      name: e.name,
      durationSeconds: this.perExercise[e.id] ?? null,
      completed: e.completed,
      skipped: e.status === 'postponed' || e.status === 'abandoned',
    }));
  });

  summaryDoneCount   = computed(() => this.summaryRows().filter(r => r.completed).length);
  summarySkipCount   = computed(() => this.summaryRows().filter(r => r.skipped).length);
  summaryActiveSecs  = computed(() =>
    Object.values(this.perExercise).reduce((a, b) => a + b, 0));

  summaryElapsedSecs = computed(() => {
    const start = this.sessionStartedAt();
    if (!start) return this.summaryActiveSecs();
    return Math.max(0, Math.round((Date.now() - new Date(start).getTime()) / 1000));
  });

  finishWorkout(): void {
    const s = this.session();
    const startedAt = this.sessionStartedAt();
    if (!s) return;
    if (!startedAt) {
      // treino encerrado sem nunca iniciar um exercício — nada a gravar
      this.router.navigate(['/athlete/history']);
      return;
    }
    this.saving.set(true);
    this.checkoutErr.set('');
    this.api.checkoutWorkoutSession(s.id, startedAt, new Date().toISOString()).subscribe({
      next: () => {
        clearDraft(s.id);
        this.saving.set(false);
        this.router.navigate(['/athlete/history']);
      },
      error: () => {
        this.saving.set(false);
        this.checkoutErr.set('Não foi possível salvar o treino. Tente novamente.');
      },
    });
  }
```

- [ ] **Step 2: Reescrever a fase CONCLUÍDO no HTML**

Substituir o bloco `} @else if (phase() === 'done') { ... }`:

```html
  } @else if (phase() === 'done') {
    <div class="flex-1 flex flex-col overflow-y-auto px-5 py-6 animate-fade-in">

      <div class="text-center mb-6">
        <span class="material-symbols-outlined text-primary-fixed text-[56px]">emoji_events</span>
        <h2 class="font-headline font-black text-2xl text-on-surface tracking-tighter mt-1">Resumo do Treino</h2>
      </div>

      <!-- Totais -->
      <div class="grid grid-cols-3 gap-2 mb-5">
        <div class="bg-surface-container-low rounded-md p-3 text-center">
          <p class="font-headline font-black text-xl text-on-surface leading-none">{{ formatTime(summaryElapsedSecs()) }}</p>
          <p class="text-outline text-[9px] font-headline uppercase tracking-widest mt-1">Tempo total</p>
        </div>
        <div class="bg-surface-container-low rounded-md p-3 text-center">
          <p class="font-headline font-black text-xl text-green-500 leading-none">{{ summaryDoneCount() }}</p>
          <p class="text-outline text-[9px] font-headline uppercase tracking-widest mt-1">Concluídos</p>
        </div>
        <div class="bg-surface-container-low rounded-md p-3 text-center">
          <p class="font-headline font-black text-xl text-on-surface-variant leading-none">{{ summarySkipCount() }}</p>
          <p class="text-outline text-[9px] font-headline uppercase tracking-widest mt-1">Pulados</p>
        </div>
      </div>

      <!-- Por exercício -->
      <div class="space-y-1.5 mb-6">
        @for (row of summaryRows(); track row.name) {
          <div class="flex items-center justify-between bg-surface-container-low rounded-sm px-4 py-3">
            <div class="flex items-center gap-2 min-w-0">
              <span class="material-symbols-outlined text-[16px]"
                [class.text-green-500]="row.completed"
                [class.text-outline]="!row.completed">
                {{ row.completed ? 'check_circle' : (row.skipped ? 'skip_next' : 'radio_button_unchecked') }}
              </span>
              <span class="text-on-surface text-xs font-headline truncate">{{ row.name }}</span>
            </div>
            <span class="text-on-surface-variant text-xs font-headline font-bold flex-shrink-0">
              {{ row.durationSeconds != null ? formatTime(row.durationSeconds) : '—' }}
            </span>
          </div>
        }
      </div>

      @if (checkoutErr()) {
        <div class="bg-error/10 border border-error/30 text-error font-headline text-xs px-4 py-3 rounded-sm mb-3 flex items-center gap-2">
          <span class="material-symbols-outlined text-[16px]">error</span>
          {{ checkoutErr() }}
        </div>
      }

      <button type="button" (click)="finishWorkout()" [disabled]="saving()"
        class="w-full px-8 py-4 bg-primary-fixed hover:bg-primary-dim disabled:opacity-50 text-on-primary-fixed font-headline font-black rounded-sm uppercase tracking-tighter text-sm active:scale-95 transition-all">
        {{ saving() ? 'Salvando...' : 'Finalizar treino' }}
      </button>

    </div>
  }
```

- [ ] **Step 3: Build**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use v20.20.0
npx ng build --configuration development
```
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add src/app/features/athlete/active-workout
git commit -m "feat(athlete): tela de resumo do treino + checkout de sessão

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: Coach — card no dashboard + tempo médio na listagem de alunos

**Files:**
- Modify: `src/app/features/coach/dashboard/dashboard.component.ts`
- Modify: `src/app/features/coach/dashboard/dashboard.component.html`
- Modify: `src/app/features/coach/students/students.component.ts`
- Modify: `src/app/features/coach/students/students.component.html`

**Interfaces:**
- Consumes: `ApiService.getCoachAvgDuration()` (Task 8) → `CoachAvgDuration`

- [ ] **Step 1: Helper de formatação compartilhado**

Create `src/app/shared/utils/format-duration.ts`:

```typescript
/** segundos → "42 min" | "1h 05" | "—" (0/undefined) */
export function formatDurationShort(totalSeconds: number | null | undefined): string {
  if (!totalSeconds || totalSeconds <= 0) return '—';
  const min = Math.round(totalSeconds / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return `${h}h ${rem.toString().padStart(2, '0')}`;
}
```

- [ ] **Step 2: Dashboard — carregar e exibir**

Em `dashboard.component.ts`:

```typescript
import { formatDurationShort } from '../../../shared/utils/format-duration';
// ...
export class DashboardComponent implements OnInit {
  // ...
  avgDuration = signal<number>(0);
  fmtDuration = formatDurationShort;

  ngOnInit(): void {
    const coach = this.auth.currentUser();
    if (!coach) return;
    this.api.getStudents(coach.id).subscribe(s => this.students.set(s));
    this.api.getWeeklyCompletion().subscribe(days => {
      const byIndex = [0, 0, 0, 0, 0, 0, 0];
      for (const d of days) byIndex[d.dayIndex] = d.percent;
      this.weeklyCompletion.set(byIndex);
    });
    this.api.getCoachAvgDuration().subscribe(r => this.avgDuration.set(r.overallAvgSeconds));
  }
```

Em `dashboard.component.html`, logo depois do `<!-- Chart card -->` (o `div` que fecha na linha ~64), adicionar:

```html
      <!-- Tempo médio de treino -->
      <div class="bg-surface-container-low rounded-md p-5 mb-6 flex items-center justify-between">
        <div>
          <p class="text-on-surface-variant text-xs font-headline uppercase tracking-widest">Tempo médio de treino</p>
          <p class="text-outline text-[10px] font-headline mt-1">Últimos 30 dias · seus alunos</p>
        </div>
        <p class="font-headline font-black text-3xl text-primary-fixed tracking-tighter">{{ fmtDuration(avgDuration()) }}</p>
      </div>
```

- [ ] **Step 3: Listagem de alunos — tempo médio por linha**

Ler `src/app/features/coach/students/students.component.ts` e `.html` primeiro. Adicionar ao componente:

```typescript
import { formatDurationShort } from '../../../shared/utils/format-duration';
// ...
  avgByStudent = signal<Record<string, number>>({});
  fmtDuration = formatDurationShort;
```

No `ngOnInit` (ou onde a lista de alunos é carregada), adicionar:

```typescript
    this.api.getCoachAvgDuration().subscribe(r => {
      const map: Record<string, number> = {};
      for (const b of r.byStudent) map[b.studentId] = b.avgSeconds;
      this.avgByStudent.set(map);
    });
```

No `.html`, dentro do card/linha de cada aluno (onde já se mostra `completionPercent` ou o nome), adicionar um campo seguindo o estilo visual existente da linha:

```html
            <div class="text-right flex-shrink-0">
              <p class="text-on-surface text-sm font-headline font-bold">{{ fmtDuration(avgByStudent()[student.id]) }}</p>
              <p class="text-outline text-[9px] font-headline uppercase tracking-widest">Tempo médio</p>
            </div>
```

(Posicionar seguindo o layout já usado para outros números do card — inspecionar o `.html` e casar a estrutura flex existente.)

- [ ] **Step 4: Build**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use v20.20.0
npx ng build --configuration development
```

- [ ] **Step 5: Commit**

```bash
git add src/app/features/coach/dashboard src/app/features/coach/students src/app/shared/utils/format-duration.ts
git commit -m "feat(coach): tempo médio de treino no dashboard e na listagem de alunos

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 13: Plan-builder — seção recolhível "Tempo de execução"

**Files:**
- Modify: `src/app/features/coach/plan-builder/plan-builder.component.ts`
- Modify: `src/app/features/coach/plan-builder/plan-builder.component.html`

**Interfaces:**
- Consumes: `ApiService.getStudentSessionSummary(studentId)` (Task 8) → `SessionTimeSummary`

- [ ] **Step 1: Estado no componente**

Seguir o padrão EXATO da seção "Recordes de força" já existente neste componente (`prHistory`, `showPRSection`, etc.). Adicionar:

```typescript
import { SessionTimeSummary } from '../../../core/models';
import { formatDurationShort } from '../../../shared/utils/format-duration';
// ...
  // Tempo de execução do aluno — recolhido por padrão
  timeSummary = signal<SessionTimeSummary | null>(null);
  showTimeSection = signal(false);
  fmtDuration = formatDurationShort;

  maxPerExerciseSeconds = computed(() => {
    const s = this.timeSummary();
    return Math.max(1, ...(s?.perExercise ?? []).map(e => e.avgSeconds));
  });
```

No método que carrega os dados do aluno (o mesmo `ngOnInit`/`loadStudentExtras` que já dispara `getStudentIntakeHistory` e os PRs — inspecionar o arquivo), adicionar:

```typescript
    this.api.getStudentSessionSummary(this.studentId).subscribe(s => this.timeSummary.set(s));
```

Helper de rótulo da tendência:

```typescript
  trendLabel(dir: string): string {
    return dir === 'faster' ? 'Mais rápido' : dir === 'slower' ? 'Mais lento' : dir === 'equal' ? 'Estável' : 'Sem histórico';
  }
```

- [ ] **Step 2: Seção no HTML**

Localizar a seção "Recordes de força" no `.html` (o bloco com `showPRSection()`) e adicionar, logo depois dela, uma seção-irmã no mesmo padrão visual (cabeçalho clicável que alterna `showTimeSection`, corpo condicional):

```html
      <!-- Tempo de execução -->
      <div class="bg-surface-container-low rounded-md mb-3">
        <button type="button" (click)="showTimeSection.set(!showTimeSection())"
          class="w-full flex items-center justify-between px-5 py-4">
          <span class="text-on-surface font-headline font-black text-xs uppercase tracking-widest">Tempo de execução</span>
          <span class="material-symbols-outlined text-outline text-[20px]">{{ showTimeSection() ? 'expand_less' : 'expand_more' }}</span>
        </button>

        @if (showTimeSection()) {
          <div class="px-5 pb-5">
            @if (timeSummary(); as ts) {
              @if (ts.count === 0) {
                <p class="text-outline text-xs font-headline py-2">Nenhum treino cronometrado ainda.</p>
              } @else {
                <div class="flex items-end gap-6 mb-4">
                  <div>
                    <p class="font-headline font-black text-3xl text-primary-fixed tracking-tighter leading-none">{{ fmtDuration(ts.avgElapsedSeconds) }}</p>
                    <p class="text-outline text-[10px] font-headline uppercase tracking-widest mt-1">Média · {{ ts.count }} treinos</p>
                  </div>
                  <div class="text-xs font-headline"
                    [class.text-green-500]="ts.trend.direction === 'faster'"
                    [class.text-error]="ts.trend.direction === 'slower'"
                    [class.text-outline]="ts.trend.direction === 'equal' || ts.trend.direction === 'new'">
                    {{ trendLabel(ts.trend.direction) }}
                    @if (ts.trend.direction === 'faster' || ts.trend.direction === 'slower') {
                      ({{ fmtDuration(ts.trend.deltaSeconds < 0 ? -ts.trend.deltaSeconds : ts.trend.deltaSeconds) }})
                    }
                  </div>
                </div>

                <p class="text-outline text-[10px] font-headline uppercase tracking-widest mb-2">Tempo médio por exercício</p>
                <div class="space-y-2">
                  @for (ex of ts.perExercise; track ex.exerciseName) {
                    <div>
                      <div class="flex justify-between text-xs font-headline mb-1">
                        <span class="text-on-surface truncate">{{ ex.exerciseName }}</span>
                        <span class="text-on-surface-variant flex-shrink-0">{{ fmtDuration(ex.avgSeconds) }} · {{ ex.samples }}x</span>
                      </div>
                      <div class="bg-surface-container rounded-full h-1.5">
                        <div class="bg-primary-fixed rounded-full h-1.5" [style.width.%]="(ex.avgSeconds / maxPerExerciseSeconds()) * 100"></div>
                      </div>
                    </div>
                  }
                </div>
              }
            } @else {
              <p class="text-outline text-xs font-headline py-2">Carregando...</p>
            }
          </div>
        }
      </div>
```

- [ ] **Step 3: Build**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use v20.20.0
npx ng build --configuration development
```

- [ ] **Step 4: Commit**

```bash
git add src/app/features/coach/plan-builder
git commit -m "feat(coach): seção de tempo de execução no plan-builder

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 14: Plan-builder — tempo por sessão executada (detalhe) + histórico do atleta

**Files:**
- Modify: `src/app/features/coach/plan-builder/plan-builder.component.ts`
- Modify: `src/app/features/coach/plan-builder/plan-builder.component.html`
- Modify: `src/app/features/athlete/history/history.component.ts`
- Modify: `src/app/features/athlete/history/history.component.html`

**Interfaces:**
- Consumes: `ApiService.getStudentSessionDetail(studentId, sessionId)` (coach), `ApiService.getMyWorkoutSessions()` (atleta)

- [ ] **Step 1: Coach — carregar detalhe ao expandir uma sessão**

No `plan-builder.component.ts`, o método que alterna `expandedSessions` (`toggleSession`/`isExpanded` por volta da linha 299). Adicionar cache de detalhes:

```typescript
import { SessionTimeDetail } from '../../../core/models';
// ...
  sessionTimeDetails = signal<Record<string, SessionTimeDetail>>({});

  loadSessionTime(sessionId: string): void {
    if (this.sessionTimeDetails()[sessionId]) return;
    this.api.getStudentSessionDetail(this.studentId, sessionId).subscribe(d =>
      this.sessionTimeDetails.update(m => ({ ...m, [sessionId]: d })));
  }
```

No `toggleSession(id)` (onde adiciona ao Set), chamar `this.loadSessionTime(id)` quando estiver expandindo.

- [ ] **Step 2: Coach — exibir no bloco expandido da sessão**

No `.html`, dentro do bloco que renderiza quando `isExpanded(session.id)` (a timeline de exercícios da sessão), adicionar no topo:

```html
            @if (sessionTimeDetails()[session.id]; as td) {
              @if (td.lastExecution; as ex) {
                <div class="bg-surface-container rounded-sm px-4 py-3 mb-3 flex items-center justify-between">
                  <div>
                    <p class="text-outline text-[9px] font-headline uppercase tracking-widest">Última execução</p>
                    <p class="text-on-surface text-xs font-headline">{{ ex.startedAt | date:'dd/MM HH:mm' }} · {{ ex.status === 'Partial' ? 'Parcial' : 'Completa' }}</p>
                  </div>
                  <p class="font-headline font-black text-lg text-primary-fixed">{{ fmtDuration(ex.elapsedSeconds) }}</p>
                </div>
              }
            }
```

E, na linha de cada exercício da timeline, quando houver `durationSeconds` no detalhe, mostrar o tempo ao lado do nome:

```html
                @if (sessionTimeDetails()[session.id]?.exercises; as exList) {
                  @for (te of exList; track te.id) {
                    @if (te.id === exercise.id && te.durationSeconds != null) {
                      <span class="text-outline text-[10px] font-headline ml-2">{{ fmtDuration(te.durationSeconds) }}</span>
                    }
                  }
                }
```

(Ajustar ao markup real da timeline — inspecionar o arquivo. `DatePipe` já disponível via `CommonModule` importado no componente.)

- [ ] **Step 3: Atleta — stat "tempo médio de treino" no histórico**

Em `history.component.ts`:

```typescript
import { formatDurationShort } from '../../../shared/utils/format-duration';
import { WorkoutSessionRecord } from '../../../core/models';
// ...
  sessions = signal<WorkoutSessionRecord[]>([]);
  fmtDuration = formatDurationShort;
  avgSessionSeconds = computed(() => {
    const list = this.sessions();
    if (!list.length) return 0;
    return Math.round(list.reduce((a, s) => a + s.elapsedSeconds, 0) / list.length);
  });

  ngOnInit(): void {
    this.api.getWorkoutHistory().subscribe({
      next: logs => { this.logs.set(logs); this.loading.set(false); },
      error: ()  => this.loading.set(false),
    });
    this.api.getMyWorkoutSessions().subscribe(s => this.sessions.set(s));
  }
```

Em `history.component.html`, junto dos outros stats (streak / conclusão do mês), adicionar um card:

```html
      <div class="bg-surface-container-low rounded-md p-4 text-center">
        <p class="font-headline font-black text-2xl text-primary-fixed leading-none">{{ fmtDuration(avgSessionSeconds()) }}</p>
        <p class="text-outline text-[10px] font-headline uppercase tracking-widest mt-1">Tempo médio</p>
      </div>
```

(Casar com o grid de stats já existente na tela.)

- [ ] **Step 4: Build + commit**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use v20.20.0
npx ng build --configuration development
git add src/app/features/coach/plan-builder src/app/features/athlete/history
git commit -m "feat: tempo por sessão executada no plan-builder e tempo médio no histórico do atleta

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 15: Verificação E2E + `security-review` + fechamento de branch

**Files:** nenhum de produção (só verificação e possíveis correções pontuais).

- [ ] **Step 1: Subir o ambiente local**

```bash
docker ps   # confirmar aevonfit-db (5434) e aevonfit-redis (6380) de pé
cd <backend> && export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use v20.20.0
npx prisma generate && npm run start:dev   # porta 3000
cd <frontend> && npx ng serve               # porta 4200
```
Se a 3000 estiver ocupada por processo zumbi: `ss -ltnp | grep :3000` e matar o PID real (o filho compilado, não só o supervisor `nest --watch`).

- [ ] **Step 2: Verificação guiada por Chrome headless/CDP**

Rodar `google-chrome --headless=new --remote-debugging-port=9222` e, via CDP (com `Console.enable` ligado pra pegar `console.error` real), executar e conferir:

1. **Atleta** (`gustavo@aevonfit.com` / `athlete123`): abrir uma sessão de treino ativo → "Iniciar exercício" → aguardar ~3s → "Concluir exercício" → repetir em ≥2 exercícios → chegar no resumo → conferir que "Tempo total" e o tempo por exercício batem com o cronômetro → "Finalizar treino" → confirmar `POST /workout-sessions` 201 e navegação pro histórico.
2. **Rascunho**: iniciar outra sessão, concluir 1 exercício, **recarregar a página** no meio → confirmar toast "Treino retomado", `currentIndex` restaurado e o exercício concluído marcado.
3. **Coach** (`luan@aevonfit.com` / `coach123`): dashboard mostra "Tempo médio de treino" com valor real (não `—` se houver execução); listagem de Alunos mostra tempo médio na linha do Gustavo; plan-builder → seção "Tempo de execução" expande e mostra média + tendência + barras por exercício; expandir a sessão executada mostra "Última execução" + tempo por exercício.
4. **IDOR**: com token de um coach que não é dono, `GET /workout-sessions/student/<studentId do Gustavo>/summary` → **403**. `POST /workout-sessions` com `sessionId` de sessão de outro atleta usando token do Gustavo → **403**.

Registrar evidência (status HTTP + valores lidos do DOM) — não confiar em "pareceu ok".

- [ ] **Step 3: `security-review` no diff acumulado**

Rodar a skill `security-review` sobre o diff de `feat/metricas-tempo-execucao` nos dois repos. Foco: ownership em todas as rotas novas (`studentSummary`, `sessionDetail`, `coachAvgDuration`, `checkout`), nenhuma rota permitindo escolher `athleteId` arbitrário, `RolesGuard` presente. Corrigir o que aparecer numa rodada de fix por repo + re-review escopado.

- [ ] **Step 4: Suíte completa + build final nos dois repos**

```bash
# backend
npm run build && npm test
# frontend
npx ng build --configuration production
```
Expected: verde. (O teste boilerplate `app.spec.ts::should render title` que já falhava antes não conta — confirmar que é o mesmo e único.)

- [ ] **Step 5: Fechar a branch**

Usar `superpowers:finishing-a-development-branch`. PR em cada repo com o template `PR_TEMPLATE.md` preenchido de verdade (marcar risco: backend mexe em schema + autorização → Médio/Alto). Frontend push via `upstream`. Aguardar decisão do usuário sobre merge — **não mergear sem confirmação**.

- [ ] **Step 6: Registrar no log de skills**

Adicionar linha em `~/PROJETOS/LOG_SKILLS.md` e atualizar a memória `project_aevonfit.md` com o resultado da sessão.

---

## Self-Review

**1. Spec coverage:**

| Requisito da spec | Task |
|---|---|
| `WorkoutLog.durationSeconds` | 1, 2 |
| Model `WorkoutSession` + enum + migração aditiva | 1 |
| `POST /workout-sessions` (checkout, ownership, elapsed/active/status) | 3 |
| `GET /workout-sessions/me` | 4 |
| `GET /workout-sessions/student/:id/summary` (média, tendência 3v3, tempo/exercício) | 5 |
| `GET /workout-sessions/student/:id/session/:id` (detalhe) | 6 |
| `GET /workout-sessions/coach/avg-duration` | 7 |
| `durationSeconds` no `logExercise` (DTO + service) | 2 |
| Segurança: `StudentsService.findOne` em toda rota de coach | 3,5,6 (7 usa coachId direto do token, sem `:studentId`) |
| Models + métodos `ApiService` | 8 |
| `workout-draft.ts` (chave por sessionId, try/catch) | 9 |
| `active-workout`: Iniciar/Concluir count-up, `durationSeconds` no log, sessionStartedAt | 10 |
| `active-workout`: rascunho salvar/restaurar + toast | 10 |
| `active-workout`: tela de resumo + "Finalizar treino" + "Finalizar treino agora" + erro | 11 |
| Coach dashboard card | 12 |
| Coach listagem de alunos | 12 |
| Coach plan-builder seção de tempo | 13 |
| Coach detalhe da sessão (inline no plan-builder) | 14 |
| Atleta histórico mostra duração | 14 |
| Verificação manual Chrome headless + `security-review` | 15 |
| Tratamento de erro do checkout (não limpa rascunho, mensagem) | 11 |
| `localStorage` indisponível → segue sem rascunho | 9 |

Sem lacunas.

**2. Placeholder scan:** Tasks de UI 12–14 pedem "inspecionar o arquivo e casar o markup" para pontos de inserção em `students.component.html` e na timeline do `plan-builder` — isso é orientação de integração num arquivo grande existente (496 linhas), não um placeholder de lógica: todo o código novo (TS e o markup do bloco) está escrito por extenso. As demais tasks têm código completo.

**3. Type consistency:** `formatDurationShort` criado na Task 12 e reusado nas 13/14. `WorkoutSessionRecord`/`SessionTimeSummary`/`SessionTimeDetail`/`CoachAvgDuration` definidos na Task 8, consumidos depois com os mesmos nomes de campo dos DTOs de resposta do backend (Tasks 4–7). `trend.direction` usa o mesmo conjunto `'faster'|'slower'|'equal'|'new'` no backend (Task 5) e no frontend (Task 8, 13). `checkout` recebe `{ sessionId, startedAt, finishedAt }` em ambos os lados (Tasks 3 e 8). `this.mean` criado na Task 5, reusado na 7 — ordem respeitada.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-28-metricas-tempo-execucao.md`.**

Duas opções de execução:

1. **Subagent-Driven (recomendada)** — subagente fresco por task, revisão entre tasks, iteração rápida. Padrão usado em toda feature recente deste projeto.
2. **Inline** — executar as tasks nesta sessão com checkpoints de revisão.

Antes de executar: criar os worktrees isolados nos dois repos via `superpowers:using-git-worktrees` (branch `feat/metricas-tempo-execucao` já existe no backend; criar no frontend também).
