# Pular treino com justificativa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o atleta pular um exercício ou uma sessão inteira com justificativa (motivo + decisão postergar/abandonar), notificando o coach por mensagem automática e por um badge na tela de Alunos — e, no caminho, consertar o cálculo de "concluído" que hoje está quebrado/fake no dashboard e na visão semanal.

**Architecture:** Novo model `WorkoutSkip` (Prisma) separado de `WorkoutLog`. Novo módulo NestJS `workout-skips` reusando `StudentsService` (ownership) e `MessagesService` (notificação automática). No frontend (repo único, duas áreas — atleta e coach), um componente de modal compartilhado alimenta os dois pontos de entrada (pular exercício, pular sessão), e um `status` computado (`done | postponed | abandoned | none`) substitui o `completed: boolean` atual.

**Tech Stack:** NestJS + Prisma + PostgreSQL (backend), Angular 21 standalone + signals (frontend), Jest (testes backend, novos — projeto não tinha nenhum teste real até agora).

**Spec:** `docs/superpowers/specs/2026-08-25-skip-workout-with-justification-design.md`

## Global Constraints

- Migração de banco **só** pelo procedimento seguro do projeto: container-sombra descartável pra gerar o diff (`backend/scripts/generate-migration.sh <name>`), nunca `prisma migrate dev` não-interativo nem `migrate diff --shadow-database-url` apontando pro banco real.
- Toda rota nova precisa de checagem de dono (coach dono do aluno, ou o próprio atleta) — mesmo padrão já usado em `StudentsService.findOne`/`WorkoutLogsService.getStudentHistory`. Nenhuma rota nova pode reintroduzir IDOR.
- `WorkoutSkip` exige exatamente um entre `exerciseId`/`sessionId` — nunca os dois, nunca nenhum (checado no backend, não só no frontend).
- Cada task termina com branch própria + commit — seguir `~/PROJETOS/MANUAL_FLUXO_ROTINA.md` (branch por feature/fix, nunca commitar direto em `main`).
- Backend: `chore/import-mesociclo-6-gustavo`-style branches já mostraram que `npm run start:dev` reflete mudança de schema só depois de `npx prisma generate` — rodar isso após qualquer migração antes de testar manualmente.

---

## Task 1: Schema — `WorkoutSkip`, enums, `Message.isSystem`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: migration gerada por `backend/scripts/generate-migration.sh`

**Interfaces:**
- Produces: model `WorkoutSkip { id, exerciseId?, sessionId?, athleteId, reason: SkipReason, note?, decision: SkipDecision, createdAt }`; enums `SkipReason` (`NoTime`, `Injury`, `Later`, `Other`) e `SkipDecision` (`Postponed`, `Abandoned`); campo `Message.isSystem: Boolean @default(false)`.

- [ ] **Step 1: Adicionar os models/enums no schema**

Em `backend/prisma/schema.prisma`, adicionar (perto do model `WorkoutLog`, já que são conceitos irmãos):

```prisma
enum SkipReason {
  NoTime
  Injury
  Later
  Other
}

enum SkipDecision {
  Postponed
  Abandoned
}

model WorkoutSkip {
  id         String       @id @default(uuid())
  exerciseId String?
  sessionId  String?
  athleteId  String
  reason     SkipReason
  note       String?
  decision   SkipDecision
  createdAt  DateTime     @default(now())

  exercise Exercise? @relation(fields: [exerciseId], references: [id], onDelete: Cascade)
  session  Session?  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  athlete  User      @relation(fields: [athleteId], references: [id], onDelete: Cascade)

  @@map("workout_skips")
}
```

E no model `Message` existente, adicionar a linha (junto dos outros campos escalares, antes das relações):

```prisma
  isSystem   Boolean  @default(false)
```

E nos models `Exercise`, `Session` e `User`, adicionar as relações reversas (uma linha em cada, junto das outras relações já existentes):

- Em `Exercise`: `workoutSkips WorkoutSkip[]`
- Em `Session`: `workoutSkips WorkoutSkip[]`
- Em `User`: `workoutSkips  WorkoutSkip[]`

- [ ] **Step 2: Gerar a migration com o procedimento seguro**

```bash
cd backend
./scripts/generate-migration.sh add_workout_skip
```

Verificar o SQL gerado em `prisma/migrations/<timestamp>_add_workout_skip/migration.sql` antes de aplicar — deve conter só `CREATE TYPE`, `CREATE TABLE workout_skips`, `ALTER TABLE messages ADD COLUMN is_system`, e as `ALTER TABLE ... ADD CONSTRAINT` de foreign key. Nenhum `DROP`.

- [ ] **Step 3: Aplicar a migration e regenerar o client**

```bash
npx prisma migrate deploy
npx prisma generate
```

- [ ] **Step 4: Confirmar que o backend ainda sobe**

```bash
npm run start:dev
```

Esperado: log `Nest application successfully started`, sem erro de schema/Prisma.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): adiciona WorkoutSkip, SkipReason/SkipDecision, Message.isSystem"
```

---

## Task 2: `MessagesService.send` aceita `isSystem` + é exportado

**Files:**
- Modify: `backend/src/messages/messages.module.ts`
- Modify: `backend/src/messages/messages.service.ts`
- Test: `backend/src/messages/messages.service.spec.ts`

**Interfaces:**
- Consumes: nenhuma (mudança isolada num serviço existente).
- Produces: `MessagesService.send(fromId: string, toId: string, content: string, isSystem = false): Promise<Message>`; `MessagesModule` passa a `exports: [MessagesService]`.

- [ ] **Step 1: Escrever o teste (novo arquivo, projeto não tinha testes ainda)**

```typescript
// backend/src/messages/messages.service.spec.ts
import { Test } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { MessagesGateway } from './messages.gateway';
import { PrismaService } from '../prisma/prisma.service';

describe('MessagesService.send', () => {
  let service: MessagesService;
  let prisma: { message: { create: jest.Mock } };
  let gateway: { emitToUser: jest.Mock };

  beforeEach(async () => {
    prisma = { message: { create: jest.fn() } };
    gateway = { emitToUser: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: MessagesGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get(MessagesService);
  });

  it('cria a mensagem com isSystem=false por padrao', async () => {
    prisma.message.create.mockResolvedValue({ id: '1', isSystem: false });

    await service.send('coach-1', 'athlete-1', 'oi');

    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { fromId: 'coach-1', toId: 'athlete-1', content: 'oi', isSystem: false } }),
    );
  });

  it('cria a mensagem com isSystem=true quando pedido', async () => {
    prisma.message.create.mockResolvedValue({ id: '2', isSystem: true });

    await service.send('athlete-1', 'coach-1', 'pulei o treino', true);

    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { fromId: 'athlete-1', toId: 'coach-1', content: 'pulei o treino', isSystem: true } }),
    );
  });

  it('emite a mensagem em tempo real pro destinatario', async () => {
    const created = { id: '3', toId: 'coach-1', isSystem: true };
    prisma.message.create.mockResolvedValue(created);

    await service.send('athlete-1', 'coach-1', 'pulei', true);

    expect(gateway.emitToUser).toHaveBeenCalledWith('coach-1', created);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
npx jest messages.service.spec.ts
```

Esperado: FALHA — `send` ainda não aceita 4º argumento, `data` não inclui `isSystem`.

- [ ] **Step 3: Implementar**

Em `backend/src/messages/messages.service.ts`, trocar o método `send`:

```typescript
  async send(fromId: string, toId: string, content: string, isSystem = false) {
    const message = await this.prisma.message.create({
      data: { fromId, toId, content, isSystem },
      include: {
        from: { select: userSelect },
        to:   { select: userSelect },
      },
    });
    // Emite em tempo real para o destinatário
    this.gateway.emitToUser(toId, message);
    return message;
  }
```

Em `backend/src/messages/messages.module.ts`, adicionar `exports: [MessagesService]` ao `@Module({...})`.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
npx jest messages.service.spec.ts
```

Esperado: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/messages/messages.service.ts src/messages/messages.module.ts src/messages/messages.service.spec.ts
git commit -m "feat(messages): send() aceita isSystem, MessagesService exportado"
```

---

## Task 3: `WorkoutSkipsModule` — `POST /workout-skips`

**Files:**
- Create: `backend/src/workout-skips/dto/create-workout-skip.dto.ts`
- Create: `backend/src/workout-skips/workout-skips.service.ts`
- Create: `backend/src/workout-skips/workout-skips.controller.ts`
- Create: `backend/src/workout-skips/workout-skips.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/src/workout-skips/workout-skips.service.spec.ts`

**Interfaces:**
- Consumes: `StudentsService.findOne(studentId, user): Promise<Student & { userId, coachId }>` (lança `NotFoundException`/`ForbiddenException`); `MessagesService.send(fromId, toId, content, isSystem)`.
- Produces: `WorkoutSkipsService.create(dto: CreateWorkoutSkipDto, user: AuthUser): Promise<WorkoutSkip>`; rota `POST /workout-skips`.

- [ ] **Step 1: DTO**

```typescript
// backend/src/workout-skips/dto/create-workout-skip.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';
import { SkipReason, SkipDecision } from '@prisma/client';

export class CreateWorkoutSkipDto {
  @ApiProperty({ required: false })
  @ValidateIf(o => !o.sessionId)
  @IsUUID()
  exerciseId?: string;

  @ApiProperty({ required: false })
  @ValidateIf(o => !o.exerciseId)
  @IsUUID()
  sessionId?: string;

  @ApiProperty({ enum: SkipReason })
  @IsEnum(SkipReason)
  reason!: SkipReason;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({ enum: SkipDecision })
  @IsEnum(SkipDecision)
  decision!: SkipDecision;
}
```

- [ ] **Step 2: Escrever o teste do service (falhando)**

```typescript
// backend/src/workout-skips/workout-skips.service.spec.ts
import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { WorkoutSkipsService } from './workout-skips.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { MessagesService } from '../messages/messages.service';

describe('WorkoutSkipsService.create', () => {
  let service: WorkoutSkipsService;
  let prisma: any;
  let studentsService: { findOne: jest.Mock };
  let messagesService: { send: jest.Mock };

  const athlete = { id: 'athlete-1', role: 'athlete' };
  const student = { id: 'student-1', userId: 'athlete-1', coachId: 'coach-1' };

  beforeEach(async () => {
    prisma = {
      exercise: { findUnique: jest.fn() },
      session: { findUnique: jest.fn() },
      workoutSkip: { create: jest.fn() },
    };
    studentsService = { findOne: jest.fn().mockResolvedValue(student) };
    messagesService = { send: jest.fn().mockResolvedValue({}) };

    const module = await Test.createTestingModule({
      providers: [
        WorkoutSkipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: studentsService },
        { provide: MessagesService, useValue: messagesService },
      ],
    }).compile();

    service = module.get(WorkoutSkipsService);
  });

  it('rejeita quando nem exerciseId nem sessionId sao passados', async () => {
    await expect(
      service.create({ reason: 'NoTime', decision: 'Postponed' } as any, athlete),
    ).rejects.toThrow('exerciseId ou sessionId');
  });

  it('rejeita quando os dois exerciseId e sessionId sao passados', async () => {
    await expect(
      service.create({ exerciseId: 'e1', sessionId: 's1', reason: 'NoTime', decision: 'Postponed' } as any, athlete),
    ).rejects.toThrow('exerciseId ou sessionId');
  });

  it('cria o skip de exercicio e envia mensagem automatica pro coach', async () => {
    prisma.exercise.findUnique.mockResolvedValue({
      id: 'ex-1', name: 'HSPU',
      session: { day: { week: { plan: { studentId: 'student-1' } } } },
    });
    prisma.workoutSkip.create.mockResolvedValue({ id: 'skip-1', exerciseId: 'ex-1', decision: 'Postponed' });

    const result = await service.create(
      { exerciseId: 'ex-1', reason: 'NoTime', decision: 'Postponed' } as any,
      athlete,
    );

    expect(studentsService.findOne).toHaveBeenCalledWith('student-1', athlete);
    expect(prisma.workoutSkip.create).toHaveBeenCalledWith({
      data: { exerciseId: 'ex-1', sessionId: undefined, athleteId: 'athlete-1', reason: 'NoTime', note: undefined, decision: 'Postponed' },
    });
    expect(messagesService.send).toHaveBeenCalledWith(
      'athlete-1', 'coach-1', expect.stringContaining('HSPU'), true,
    );
    expect(result).toEqual({ id: 'skip-1', exerciseId: 'ex-1', decision: 'Postponed' });
  });

  it('propaga ForbiddenException quando o atleta nao e dono do exercicio', async () => {
    prisma.exercise.findUnique.mockResolvedValue({
      id: 'ex-1', name: 'HSPU',
      session: { day: { week: { plan: { studentId: 'outro-student' } } } },
    });
    studentsService.findOne.mockRejectedValue(new ForbiddenException());

    await expect(
      service.create({ exerciseId: 'ex-1', reason: 'NoTime', decision: 'Postponed' } as any, athlete),
    ).rejects.toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 3: Rodar e confirmar falha**

```bash
npx jest workout-skips.service.spec.ts
```

Esperado: FALHA — `WorkoutSkipsService` ainda não existe.

- [ ] **Step 4: Implementar o service**

```typescript
// backend/src/workout-skips/workout-skips.service.ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { MessagesService } from '../messages/messages.service';
import { CreateWorkoutSkipDto } from './dto/create-workout-skip.dto';

type AuthUser = { id: string; role: string };

const REASON_LABEL: Record<string, string> = {
  NoTime: 'sem tempo',
  Injury: 'lesão/dor',
  Later: 'vai fazer depois',
  Other: 'outro motivo',
};

@Injectable()
export class WorkoutSkipsService {
  constructor(
    private prisma: PrismaService,
    private studentsService: StudentsService,
    private messagesService: MessagesService,
  ) {}

  async create(dto: CreateWorkoutSkipDto, user: AuthUser) {
    if ((!dto.exerciseId && !dto.sessionId) || (dto.exerciseId && dto.sessionId)) {
      throw new BadRequestException('Informe exatamente um entre exerciseId ou sessionId.');
    }

    const target = dto.exerciseId
      ? await this.loadExerciseContext(dto.exerciseId)
      : await this.loadSessionContext(dto.sessionId!);

    const student = await this.studentsService.findOne(target.studentId, user);

    const skip = await this.prisma.workoutSkip.create({
      data: {
        exerciseId: dto.exerciseId,
        sessionId: dto.sessionId,
        athleteId: user.id,
        reason: dto.reason,
        note: dto.note,
        decision: dto.decision,
      },
    });

    const reasonLabel = REASON_LABEL[dto.reason] ?? dto.reason;
    const decisionLabel = dto.decision === 'Postponed' ? 'vai fazer depois' : 'não vai fazer';
    const content = `Pulei "${target.name}" — motivo: ${reasonLabel}. ${decisionLabel}.${dto.note ? ` Nota: ${dto.note}` : ''}`;
    await this.messagesService.send(user.id, student.coachId, content, true);

    return skip;
  }

  private async loadExerciseContext(exerciseId: string) {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      include: { session: { include: { day: { include: { week: { include: { plan: true } } } } } } },
    });
    if (!exercise) throw new NotFoundException('Exercício não encontrado');
    return { name: exercise.name, studentId: exercise.session.day.week.plan.studentId };
  }

  private async loadSessionContext(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { day: { include: { week: { include: { plan: true } } } } },
    });
    if (!session) throw new NotFoundException('Sessão não encontrada');
    return { name: session.name, studentId: session.day.week.plan.studentId };
  }
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
npx jest workout-skips.service.spec.ts
```

Esperado: PASS (4 testes).

- [ ] **Step 6: Controller + módulo**

```typescript
// backend/src/workout-skips/workout-skips.controller.ts
import { Controller, Post, Body, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkoutSkipsService } from './workout-skips.service';
import { CreateWorkoutSkipDto } from './dto/create-workout-skip.dto';

@ApiTags('workout-skips')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workout-skips')
export class WorkoutSkipsController {
  constructor(private readonly workoutSkipsService: WorkoutSkipsService) {}

  @Post()
  @ApiOperation({ summary: 'Registra que o atleta pulou um exercício ou sessão, com justificativa' })
  create(@Body() dto: CreateWorkoutSkipDto, @Request() req: any) {
    return this.workoutSkipsService.create(dto, req.user);
  }
}
```

```typescript
// backend/src/workout-skips/workout-skips.module.ts
import { Module } from '@nestjs/common';
import { WorkoutSkipsService } from './workout-skips.service';
import { WorkoutSkipsController } from './workout-skips.controller';
import { StudentsModule } from '../students/students.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [StudentsModule, MessagesModule],
  controllers: [WorkoutSkipsController],
  providers: [WorkoutSkipsService],
  exports: [WorkoutSkipsService],
})
export class WorkoutSkipsModule {}
```

Em `backend/src/app.module.ts`: importar `WorkoutSkipsModule` e adicionar em `imports: [...]`.

- [ ] **Step 7: Testar manualmente**

```bash
npm run start:dev
```

Login como atleta, pegar token, depois:

```bash
curl -X POST http://localhost:3000/api/workout-skips \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"exerciseId":"<um id real de exercicio do proprio plano>","reason":"NoTime","decision":"Postponed"}'
```

Esperado: `201`, corpo com o `WorkoutSkip` criado. Conferir no chat do coach (via `GET /messages/inbox` ou UI) que a mensagem automática chegou.

- [ ] **Step 8: Commit**

```bash
git add src/workout-skips src/app.module.ts
git commit -m "feat(workout-skips): POST /workout-skips com ownership check e mensagem automatica"
```

---

## Task 4: `GET /workout-skips/pending-count` (coach)

**Files:**
- Modify: `backend/src/workout-skips/workout-skips.service.ts`
- Modify: `backend/src/workout-skips/workout-skips.controller.ts`
- Test: `backend/src/workout-skips/workout-skips.service.spec.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces: `WorkoutSkipsService.getPendingCountByStudent(coachId: string): Promise<{ studentId: string; count: number }[]>`; rota `GET /workout-skips/pending-count`.

- [ ] **Step 1: Escrever o teste (falhando)**

Adicionar ao `workout-skips.service.spec.ts`:

```typescript
describe('WorkoutSkipsService.getPendingCountByStudent', () => {
  let service: WorkoutSkipsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      workoutSkip: { findMany: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [
        WorkoutSkipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: { findOne: jest.fn() } },
        { provide: MessagesService, useValue: { send: jest.fn() } },
      ],
    }).compile();
    service = module.get(WorkoutSkipsService);
  });

  it('agrupa a contagem de skips pendentes por aluno do coach', async () => {
    prisma.workoutSkip.findMany.mockResolvedValue([
      { id: '1', exercise: { session: { day: { week: { plan: { studentId: 'student-1' } } } } }, exerciseId: 'ex-1', sessionId: null, session: null, workoutLogAfter: null },
      { id: '2', exercise: { session: { day: { week: { plan: { studentId: 'student-1' } } } } }, exerciseId: 'ex-2', sessionId: null, session: null, workoutLogAfter: null },
      { id: '3', exercise: null, session: { day: { week: { plan: { studentId: 'student-2' } } } }, exerciseId: null, sessionId: 's-1', workoutLogAfter: null },
    ]);

    const result = await service.getPendingCountByStudent('coach-1');

    expect(result).toEqual([
      { studentId: 'student-1', count: 2 },
      { studentId: 'student-2', count: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
npx jest workout-skips.service.spec.ts
```

Esperado: FALHA — `getPendingCountByStudent` não existe.

- [ ] **Step 3: Implementar**

Adicionar ao `WorkoutSkipsService`:

```typescript
  async getPendingCountByStudent(coachId: string) {
    const skips = await this.prisma.workoutSkip.findMany({
      where: {
        decision: 'Postponed',
        OR: [
          { exercise: { workoutLogs: { none: {} }, session: { day: { week: { plan: { coachId } } } } } },
          { session: { day: { week: { plan: { coachId } } } } },
        ],
      },
      include: {
        exercise: { include: { session: { include: { day: { include: { week: { include: { plan: true } } } } } } } },
        session:  { include: { day: { include: { week: { include: { plan: true } } } } } },
      },
    });

    const counts = new Map<string, number>();
    for (const skip of skips) {
      const studentId = skip.exercise?.session.day.week.plan.studentId
        ?? skip.session?.day.week.plan.studentId;
      if (!studentId) continue;
      counts.set(studentId, (counts.get(studentId) ?? 0) + 1);
    }

    return Array.from(counts, ([studentId, count]) => ({ studentId, count }));
  }
```

> Nota: `exercise: { workoutLogs: { none: {} } }` filtra exercícios que **nunca** foram logados — não distingue "logado antes ou depois do skip". É uma simplificação aceitável pro MVP (um exercício postergado e depois de fato feito não deveria ter sido re-logado sem consumir o skip primeiro no fluxo normal do app); documentar como possível refinamento futuro, não bloquear a task por isso.

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
npx jest workout-skips.service.spec.ts
```

Esperado: PASS (5 testes no total do arquivo).

- [ ] **Step 5: Controller**

Adicionar ao `WorkoutSkipsController`:

```typescript
  @Get('pending-count')
  @ApiOperation({ summary: 'Contagem de pulos pendentes por aluno (coach)' })
  getPendingCount(@Request() req: any) {
    return this.workoutSkipsService.getPendingCountByStudent(req.user.id);
  }
```

(Adicionar `Get` ao import de `@nestjs/common` no topo do controller.)

- [ ] **Step 6: Testar manualmente**

```bash
curl http://localhost:3000/api/workout-skips/pending-count -H "Authorization: Bearer $COACH_TOKEN"
```

Esperado: `200`, array com `{ studentId, count }` batendo com o skip criado na Task 3.

- [ ] **Step 7: Commit**

```bash
git add src/workout-skips
git commit -m "feat(workout-skips): GET /workout-skips/pending-count pro coach"
```

---

## Task 5: Corrigir `training-plans` pra incluir `workoutLogs` e `workoutSkips`

**Files:**
- Modify: `backend/src/training-plans/training-plans.service.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces: `fullPlanInclude` passa a trazer `exercises[].workoutLogs` e `exercises[].workoutSkips` (e `sessions[].workoutSkips` pro nível de sessão).

**Contexto:** hoje `fullPlanInclude` não inclui `workoutLogs` em `exercises`, então `Exercise.completed` no frontend é **sempre `false`** vindo dessa rota (achado durante o brainstorming desta feature — não é regressão desta task, é bug pré-existente que bloqueia a feature nova fazer sentido).

- [ ] **Step 1: Editar `fullPlanInclude`**

Em `backend/src/training-plans/training-plans.service.ts`, trocar:

```typescript
const fullPlanInclude = {
  weeks: {
    orderBy: { weekNumber: 'asc' as const },
    include: {
      days: {
        orderBy: { dayIndex: 'asc' as const },
        include: {
          sessions: {
            orderBy: { order: 'asc' as const },
            include: {
              exercises: { orderBy: { order: 'asc' as const } },
            },
          },
        },
      },
    },
  },
};
```

por:

```typescript
const fullPlanInclude = {
  weeks: {
    orderBy: { weekNumber: 'asc' as const },
    include: {
      days: {
        orderBy: { dayIndex: 'asc' as const },
        include: {
          sessions: {
            orderBy: { order: 'asc' as const },
            include: {
              workoutSkips: { orderBy: { createdAt: 'desc' as const }, take: 1 },
              exercises: {
                orderBy: { order: 'asc' as const },
                include: {
                  workoutLogs: { select: { id: true } },
                  workoutSkips: { orderBy: { createdAt: 'desc' as const }, take: 1 },
                },
              },
            },
          },
        },
      },
    },
  },
};
```

(`take: 1` + `orderBy: createdAt desc` porque só o skip mais recente importa pro status exibido.)

- [ ] **Step 2: Testar manualmente**

```bash
npm run start:dev
```

```bash
curl http://localhost:3000/api/training-plans/student/<studentId> -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | grep -A3 workoutLogs
```

Esperado: exercícios já concluídos (os do Mesociclo 6 importado, semana 1 inteira) mostram `workoutLogs: [{...}]` não-vazio.

- [ ] **Step 3: Commit**

```bash
git add src/training-plans/training-plans.service.ts
git commit -m "fix(training-plans): inclui workoutLogs e workoutSkips na query do plano completo"
```

---

## Task 6: Frontend — modelos e API client

**Files:**
- Modify: `frontend/src/app/core/models/training.model.ts`
- Modify: `frontend/src/app/core/services/api.service.ts`

**Interfaces:**
- Consumes: resposta de `GET /training-plans/student/:id` agora com `workoutLogs`/`workoutSkips` populados (Task 5); resposta de `POST /workout-skips` e `GET /workout-skips/pending-count` (Task 3/4).
- Produces: `Exercise.status: 'done' | 'postponed' | 'abandoned' | 'none'`; `Session.status` (mesmo tipo, calculado a partir do próprio `workoutSkips` da sessão quando existir); `ApiService.skipExercise(exerciseId, reason, decision, note?)`, `ApiService.skipSession(sessionId, reason, decision, note?)`, `ApiService.getPendingSkipCounts(): Observable<{studentId: string; count: number}[]>`.

- [ ] **Step 1: Atualizar os models**

Em `frontend/src/app/core/models/training.model.ts`, no `interface Exercise`, trocar:

```typescript
  completed: boolean;
```

por:

```typescript
  completed: boolean;
  status: 'done' | 'postponed' | 'abandoned' | 'none';
```

(mantém `completed` pra não quebrar código existente que já usa `e.completed` — `status` é o novo campo, `completed` continua equivalente a `status === 'done'`.)

No `interface Session`, adicionar:

```typescript
  status: 'done' | 'postponed' | 'abandoned' | 'none';
```

Criar dois tipos novos no mesmo arquivo:

```typescript
export type SkipReason = 'NoTime' | 'Injury' | 'Later' | 'Other';
export type SkipDecision = 'Postponed' | 'Abandoned';
```

- [ ] **Step 2: Atualizar `RawExercise`/`RawSession` e os mappers em `api.service.ts`**

Trocar a interface `RawExercise` (adicionar campo):

```typescript
interface RawExercise {
  id: string;
  sessionId: string;
  name: string;
  youtubeUrl?: string | null;
  sets?: number | null;
  reps?: string | null;
  duration?: string | null;
  restSeconds?: number | null;
  loadPercent?: number | null;
  coachNotes?: string | null;
  order: number;
  workoutLogs?: { id: string }[];
  workoutSkips?: { decision: 'Postponed' | 'Abandoned' }[];
}
```

E `RawSession` (adicionar campo):

```typescript
interface RawSession {
  id: string;
  dayId: string;
  name: string;
  type: string;
  order: number;
  exercises: RawExercise[];
  workoutSkips?: { decision: 'Postponed' | 'Abandoned' }[];
}
```

Trocar `mapSession`/`mapExercise`:

```typescript
  private mapSession(s: RawSession): Session {
    const exercises = (s.exercises ?? []).map(e => this.mapExercise(e));
    return {
      id:        s.id,
      name:      s.name,
      type:      s.type as Session['type'],
      order:     s.order,
      exercises,
      status:    this.computeStatus(false, s.workoutSkips),
    };
  }

  private mapExercise(e: RawExercise): Exercise {
    const done = !!e.workoutLogs && e.workoutLogs.length > 0;
    return {
      id:           e.id,
      name:         e.name,
      youtubeUrl:   e.youtubeUrl ?? undefined,
      sets:         e.sets ?? undefined,
      reps:         e.reps ?? undefined,
      duration:     e.duration ?? undefined,
      restSeconds:  e.restSeconds ?? undefined,
      loadPercent:  e.loadPercent ?? undefined,
      coachNotes:   e.coachNotes ?? undefined,
      completed:    done,
      status:       this.computeStatus(done, e.workoutSkips),
    };
  }

  private computeStatus(
    done: boolean,
    skips?: { decision: 'Postponed' | 'Abandoned' }[],
  ): 'done' | 'postponed' | 'abandoned' | 'none' {
    if (done) return 'done';
    const latest = skips?.[0];
    if (latest?.decision === 'Postponed') return 'postponed';
    if (latest?.decision === 'Abandoned') return 'abandoned';
    return 'none';
  }
```

- [ ] **Step 3: Novos métodos de API**

Adicionar em `ApiService` (perto de `getStudentWorkoutHistory`):

```typescript
  /** Atleta: pula um exercicio ou uma sessao, com justificativa */
  skip(target: { exerciseId?: string; sessionId?: string }, reason: SkipReason, decision: SkipDecision, note?: string): Observable<void> {
    return this.http.post<void>(`${this.base}/workout-skips`, { ...target, reason, decision, note });
  }

  /** Coach: contagem de skips pendentes por aluno */
  getPendingSkipCounts(): Observable<{ studentId: string; count: number }[]> {
    return this.http.get<{ studentId: string; count: number }[]>(`${this.base}/workout-skips/pending-count`);
  }
```

(Import `SkipReason, SkipDecision` de `'../models'` no topo do arquivo.)

- [ ] **Step 4: Build**

```bash
cd frontend
npx ng build --configuration=development
```

Esperado: build limpo (nenhum consumidor de `Exercise`/`Session` deveria quebrar, já que `completed` continua existindo).

- [ ] **Step 5: Commit**

```bash
git add src/app/core/models/training.model.ts src/app/core/services/api.service.ts
git commit -m "feat(models): status de exercicio/sessao (done/postponed/abandoned/none) + API de skip"
```

---

## Task 7: `SkipReasonModalComponent` (compartilhado)

**Files:**
- Create: `frontend/src/app/shared/components/skip-reason-modal/skip-reason-modal.component.ts`
- Create: `frontend/src/app/shared/components/skip-reason-modal/skip-reason-modal.component.html`

**Interfaces:**
- Consumes: nada (componente de apresentação puro).
- Produces: `@Input() open: boolean`; `@Output() confirmed: EventEmitter<{ reason: SkipReason; decision: SkipDecision; note?: string }>`; `@Output() cancelled: EventEmitter<void>`.

- [ ] **Step 1: Implementar o componente**

```typescript
// frontend/src/app/shared/components/skip-reason-modal/skip-reason-modal.component.ts
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SkipReason, SkipDecision } from '../../../core/models';

const REASONS: { value: SkipReason; label: string }[] = [
  { value: 'NoTime', label: 'Sem tempo' },
  { value: 'Injury', label: 'Lesão / dor' },
  { value: 'Later',  label: 'Vou fazer depois' },
  { value: 'Other',  label: 'Outro' },
];

@Component({
  selector: 'app-skip-reason-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './skip-reason-modal.component.html',
})
export class SkipReasonModalComponent {
  @Input() open = false;
  @Output() confirmed = new EventEmitter<{ reason: SkipReason; decision: SkipDecision; note?: string }>();
  @Output() cancelled = new EventEmitter<void>();

  reasons = REASONS;
  selectedReason = signal<SkipReason | null>(null);
  selectedDecision = signal<SkipDecision>('Postponed');
  note = signal('');

  get noteRequired(): boolean {
    return this.selectedReason() === 'Other';
  }

  get canConfirm(): boolean {
    return !!this.selectedReason() && (!this.noteRequired || this.note().trim().length > 0);
  }

  selectReason(r: SkipReason): void { this.selectedReason.set(r); }
  selectDecision(d: SkipDecision): void { this.selectedDecision.set(d); }

  confirm(): void {
    if (!this.canConfirm) return;
    this.confirmed.emit({
      reason: this.selectedReason()!,
      decision: this.selectedDecision(),
      note: this.note().trim() || undefined,
    });
    this.reset();
  }

  cancel(): void {
    this.cancelled.emit();
    this.reset();
  }

  private reset(): void {
    this.selectedReason.set(null);
    this.selectedDecision.set('Postponed');
    this.note.set('');
  }
}
```

- [ ] **Step 2: Template**

```html
<!-- frontend/src/app/shared/components/skip-reason-modal/skip-reason-modal.component.html -->
@if (open) {
  <div class="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-[70] animate-fade-in"
       (click)="cancel()">
    <div class="bg-surface-container-low rounded-t-md sm:rounded-md w-full sm:max-w-sm p-6 animate-slide-up"
         (click)="$event.stopPropagation()">

      <h3 class="font-headline font-black text-lg text-on-surface tracking-tighter mb-4">Por que vai pular?</h3>

      <div class="grid grid-cols-2 gap-2 mb-4">
        @for (r of reasons; track r.value) {
          <button type="button" (click)="selectReason(r.value)"
            class="px-3 py-2.5 rounded-sm text-xs font-headline font-bold uppercase tracking-wider transition-all"
            [class.bg-primary-fixed]="selectedReason() === r.value"
            [class.text-on-primary-fixed]="selectedReason() === r.value"
            [class.bg-surface-container]="selectedReason() !== r.value"
            [class.text-outline]="selectedReason() !== r.value">
            {{ r.label }}
          </button>
        }
      </div>

      @if (noteRequired) {
        <textarea [(ngModel)]="note" rows="2" placeholder="Descreva o motivo..."
          class="w-full bg-surface-container text-on-surface placeholder:text-outline rounded-sm px-3 py-2.5 text-sm resize-none mb-4"></textarea>
      }

      <div class="flex gap-2 mb-5">
        <button type="button" (click)="selectDecision('Postponed')"
          class="flex-1 py-2.5 rounded-sm text-xs font-headline font-bold uppercase tracking-wider transition-all"
          [class.bg-primary-fixed]="selectedDecision() === 'Postponed'"
          [class.text-on-primary-fixed]="selectedDecision() === 'Postponed'"
          [class.bg-surface-container]="selectedDecision() !== 'Postponed'"
          [class.text-outline]="selectedDecision() !== 'Postponed'">
          Vou fazer depois
        </button>
        <button type="button" (click)="selectDecision('Abandoned')"
          class="flex-1 py-2.5 rounded-sm text-xs font-headline font-bold uppercase tracking-wider transition-all"
          [class.bg-error]="selectedDecision() === 'Abandoned'"
          [class.text-on-error]="selectedDecision() === 'Abandoned'"
          [class.bg-surface-container]="selectedDecision() !== 'Abandoned'"
          [class.text-outline]="selectedDecision() !== 'Abandoned'">
          Finalizar
        </button>
      </div>

      <div class="flex gap-3">
        <button type="button" (click)="cancel()"
          class="flex-1 py-3 rounded-sm border border-outline-variant/30 text-on-surface-variant font-headline text-xs uppercase tracking-wider">
          Cancelar
        </button>
        <button type="button" (click)="confirm()" [disabled]="!canConfirm"
          class="flex-1 py-3 rounded-sm bg-primary-fixed disabled:opacity-40 text-on-primary-fixed font-headline font-black text-xs uppercase tracking-tighter">
          Confirmar
        </button>
      </div>
    </div>
  </div>
}
```

- [ ] **Step 3: Build**

```bash
cd frontend
npx ng build --configuration=development
```

Esperado: build limpo (componente ainda não usado em lugar nenhum, mas precisa compilar sozinho sem erro).

- [ ] **Step 4: Commit**

```bash
git add src/app/shared/components/skip-reason-modal
git commit -m "feat(shared): SkipReasonModalComponent (motivo + postergar/finalizar)"
```

---

## Task 8: Ligar o modal no treino ativo (pular exercício)

**Files:**
- Modify: `frontend/src/app/features/athlete/active-workout/active-workout.component.ts`
- Modify: `frontend/src/app/features/athlete/active-workout/active-workout.component.html`

**Interfaces:**
- Consumes: `SkipReasonModalComponent` (Task 7); `ApiService.skip()` (Task 6).
- Produces: nada consumido por outras tasks (ponta final da UI).

- [ ] **Step 1: Editar o componente**

Em `active-workout.component.ts`, trocar a linha de import existente (linha 5 hoje):

```typescript
import { Session, Exercise } from '../../../core/models';
```

por:

```typescript
import { Session, Exercise, SkipReason, SkipDecision } from '../../../core/models';
```

Adicionar mais um import, logo abaixo:

```typescript
import { SkipReasonModalComponent } from '../../../shared/components/skip-reason-modal/skip-reason-modal.component';
```

Trocar `imports: [CommonModule]` (linha 12) por `imports: [CommonModule, SkipReasonModalComponent]`.

Trocar o método `skipExercise()`:

```typescript
  skipModalOpen = signal(false);

  skipExercise(): void {
    this.stopTimers();
    this.skipModalOpen.set(true);
  }

  onSkipConfirmed(payload: { reason: SkipReason; decision: SkipDecision; note?: string }): void {
    this.skipModalOpen.set(false);
    const ex = this.currentExercise();
    if (ex) {
      this.api.skip({ exerciseId: ex.id }, payload.reason, payload.decision, payload.note).subscribe();
    }
    this.advance();
  }

  onSkipCancelled(): void {
    this.skipModalOpen.set(false);
  }
```

(Remover a chamada direta a `this.advance()` que estava dentro do `skipExercise()` antigo — agora só avança depois de confirmar no modal.)

- [ ] **Step 2: Template**

No fim de `active-workout.component.html`, antes do `</div>` que fecha o componente (linha 254 hoje), adicionar:

```html
<app-skip-reason-modal
  [open]="skipModalOpen()"
  (confirmed)="onSkipConfirmed($event)"
  (cancelled)="onSkipCancelled()" />
```

- [ ] **Step 3: Build e teste manual**

```bash
cd frontend
npx ng build --configuration=development
```

Manualmente: entrar num treino ativo, clicar "Pular", confirmar que o modal abre, escolher motivo + "Vou fazer depois", confirmar, checar que avança pro próximo exercício e que uma mensagem chegou pro coach (via `curl` no inbox ou UI).

- [ ] **Step 4: Commit**

```bash
git add src/app/features/athlete/active-workout
git commit -m "feat(active-workout): pular exercicio abre modal de motivo, registra skip"
```

---

## Task 9: "Pular sessão" na tela de detalhe da sessão

**Files:**
- Modify: `frontend/src/app/features/athlete/session-detail/session-detail.component.ts`
- Modify: `frontend/src/app/features/athlete/session-detail/session-detail.component.html`

**Interfaces:**
- Consumes: `SkipReasonModalComponent`, `ApiService.skip()`.

- [ ] **Step 1: Editar o componente**

Em `session-detail.component.ts`, o construtor hoje é (linha 24):

```typescript
  constructor(private route: ActivatedRoute, private api: ApiService) {}
```

Trocar por:

```typescript
  constructor(private route: ActivatedRoute, private api: ApiService, private router: Router) {}
```

Adicionar aos imports do topo do arquivo: `Router` de `'@angular/router'` (junto de `ActivatedRoute`), `SkipReasonModalComponent` de `'../../../shared/components/skip-reason-modal/skip-reason-modal.component'`, e `SkipReason, SkipDecision` de `'../../../core/models'`. Adicionar `SkipReasonModalComponent` ao array `imports` do `@Component`.

Adicionar ao corpo da classe:

```typescript
  skipModalOpen = signal(false);

  openSkipSession(): void {
    this.skipModalOpen.set(true);
  }

  onSkipConfirmed(payload: { reason: SkipReason; decision: SkipDecision; note?: string }): void {
    this.skipModalOpen.set(false);
    const s = this.session();
    if (s) {
      this.api.skip({ sessionId: s.id }, payload.reason, payload.decision, payload.note).subscribe(() => {
        this.router.navigate(['/athlete/home']);
      });
    }
  }

  onSkipCancelled(): void {
    this.skipModalOpen.set(false);
  }
```

- [ ] **Step 2: Template**

Em `session-detail.component.html`, trocar (linhas 38–43 hoje):

```html
  <!-- Start CTA -->
  <a [routerLink]="['/athlete/active', session()!.id]"
    class="flex items-center justify-center gap-2 w-full bg-primary-fixed hover:bg-primary-dim text-on-primary-fixed font-headline font-black py-4 rounded-sm uppercase tracking-tighter mb-6 transition-all text-sm">
    <span class="material-symbols-outlined text-[18px]">play_arrow</span>
    Iniciar Modo Treino
  </a>
```

por:

```html
  <!-- Start CTA -->
  <a [routerLink]="['/athlete/active', session()!.id]"
    class="flex items-center justify-center gap-2 w-full bg-primary-fixed hover:bg-primary-dim text-on-primary-fixed font-headline font-black py-4 rounded-sm uppercase tracking-tighter mb-3 transition-all text-sm">
    <span class="material-symbols-outlined text-[18px]">play_arrow</span>
    Iniciar Modo Treino
  </a>

  <button type="button" (click)="openSkipSession()"
    class="w-full py-3 rounded-sm border border-outline-variant/30 text-on-surface-variant font-headline text-xs uppercase tracking-wider transition-all mb-6">
    Pular sessão
  </button>

  <app-skip-reason-modal
    [open]="skipModalOpen()"
    (confirmed)="onSkipConfirmed($event)"
    (cancelled)="onSkipCancelled()" />
```

- [ ] **Step 3: Build e teste manual**

```bash
cd frontend
npx ng build --configuration=development
```

Manualmente: abrir uma sessão, clicar "Pular sessão", escolher "Lesão/dor" + "Finalizar", confirmar, checar que volta pro Dashboard e que a mensagem chegou pro coach.

- [ ] **Step 4: Commit**

```bash
git add src/app/features/athlete/session-detail
git commit -m "feat(session-detail): botao Pular sessao com modal de motivo"
```

---

## Task 10: Consertar status real no Dashboard e na Semana

**Files:**
- Modify: `frontend/src/app/features/athlete/home/home.component.html`
- Modify: `frontend/src/app/features/athlete/weekly-view/weekly-view.component.html`
- Modify: `frontend/src/app/features/athlete/weekly-view/weekly-view.component.ts`

**Interfaces:**
- Consumes: `Session.status`/`Exercise.status` (Task 6).

**Contexto:** `home.component.html` hoje marca "CONCLUÍDO" só no item de índice 0 (`@if (i === 0)`), sempre, independente do dado real — achado durante o brainstorming desta feature.

- [ ] **Step 1: Corrigir `home.component.html`**

Todo o bloco hoje decide aparência por **índice do array** (`i === 0` = sempre "concluído", `i === 1` = sempre "próximo/destacado", resto = "agendado"), não pelo dado real. Em `frontend/src/app/features/athlete/home/home.component.html`, trocar o bloco `@for` inteiro (linhas 70 a 104 hoje):

```html
    @for (session of todaySessions(); track session.id; let i = $index) {
      <a [routerLink]="['/athlete/session', session.id]"
        class="flex items-center gap-4 p-4 rounded-md mb-2 transition-all"
        [class.bg-primary-fixed]="i === 1"
        [class.bg-surface-container-low]="i !== 1">
        <!-- State indicator -->
        <div class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
          [class.bg-white/20]="i === 1"
          [class.bg-surface-container]="i !== 1">
          @if (i === 0) {
            <span class="material-symbols-outlined text-[18px] text-outline">check_circle</span>
          } @else if (i === 1) {
            <span class="material-symbols-outlined text-[18px] text-on-primary-fixed">play_arrow</span>
          } @else {
            <span class="material-symbols-outlined text-[18px] text-outline">schedule</span>
          }
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-headline font-bold text-sm truncate"
            [class.text-on-primary-fixed]="i === 1"
            [class.text-on-surface]="i !== 1">{{ session.name }}</p>
          <p class="text-xs mt-0.5"
            [class.text-on-primary-fixed]="i === 1"
            [class.text-outline]="i !== 1">
            @if (i === 0) { <span>07:00 · CONCLUÍDO</span> }
            @else if (i === 1) { <span>17:30 · PRÓXIMO</span> }
            @else { <span>Agendado</span> }
          </p>
        </div>
        @if (i !== 0) {
          <span class="material-symbols-outlined text-[18px]"
            [class.text-on-primary-fixed]="i === 1"
            [class.text-outline]="i !== 1">chevron_right</span>
        }
      </a>
    }
```

por:

```html
    @for (session of todaySessions(); track session.id) {
      <a [routerLink]="['/athlete/session', session.id]"
        class="flex items-center gap-4 p-4 rounded-md mb-2 transition-all"
        [class.bg-primary-fixed]="session.status === 'none' && isNextSession(session)"
        [class.bg-surface-container-low]="!(session.status === 'none' && isNextSession(session))">
        <!-- State indicator -->
        <div class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
          [class.bg-white/20]="session.status === 'none' && isNextSession(session)"
          [class.bg-surface-container]="!(session.status === 'none' && isNextSession(session))">
          @if (session.status === 'done') {
            <span class="material-symbols-outlined text-[18px] text-primary-fixed">check_circle</span>
          } @else if (session.status === 'postponed') {
            <span class="material-symbols-outlined text-[18px] text-outline">schedule</span>
          } @else if (session.status === 'abandoned') {
            <span class="material-symbols-outlined text-[18px] text-outline">block</span>
          } @else if (isNextSession(session)) {
            <span class="material-symbols-outlined text-[18px] text-on-primary-fixed">play_arrow</span>
          } @else {
            <span class="material-symbols-outlined text-[18px] text-outline">schedule</span>
          }
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-headline font-bold text-sm truncate"
            [class.text-on-primary-fixed]="session.status === 'none' && isNextSession(session)"
            [class.text-on-surface]="!(session.status === 'none' && isNextSession(session))">{{ session.name }}</p>
          <p class="text-xs mt-0.5"
            [class.text-on-primary-fixed]="session.status === 'none' && isNextSession(session)"
            [class.text-outline]="!(session.status === 'none' && isNextSession(session))">
            @if (session.status === 'done') { <span>Concluído</span> }
            @else if (session.status === 'postponed') { <span>Pulado — vai fazer depois</span> }
            @else if (session.status === 'abandoned') { <span>Pulado</span> }
            @else if (isNextSession(session)) { <span>Próximo</span> }
            @else { <span>Agendado</span> }
          </p>
        </div>
        @if (session.status !== 'done') {
          <span class="material-symbols-outlined text-[18px]"
            [class.text-on-primary-fixed]="session.status === 'none' && isNextSession(session)"
            [class.text-outline]="!(session.status === 'none' && isNextSession(session))">chevron_right</span>
        }
      </a>
    }
```

Em `home.component.ts`, adicionar o método usado pelo template:

```typescript
  isNextSession(session: Session): boolean {
    const pending = this.todaySessions().filter(s => s.status === 'none');
    return pending.length > 0 && pending[0].id === session.id;
  }
```

(Import `Session` já existe no arquivo.)

- [ ] **Step 2: Corrigir os pontinhos de progresso em `weekly-view.component.html`**

Trocar:

```html
@for (s of day.sessions; track s.id) {
  <div class="w-1.5 h-1.5 rounded-full transition-all"
    [class.bg-primary-fixed]="s.exercises.length > 0 && s.exercises.every(e => e.completed)"
    [class.bg-outline-variant]="!(s.exercises.length > 0 && s.exercises.every(e => e.completed))">
  </div>
}
```

por:

```html
@for (s of day.sessions; track s.id) {
  <div class="w-1.5 h-1.5 rounded-full transition-all"
    [class.bg-primary-fixed]="s.status === 'done'"
    [class.bg-error]="s.status === 'abandoned'"
    [class.bg-outline]="s.status === 'postponed'"
    [class.bg-outline-variant]="s.status === 'none'">
  </div>
}
```

- [ ] **Step 3: Build e teste manual**

```bash
cd frontend
npx ng build --configuration=development
```

Manualmente: no Dashboard, confirmar que só a sessão realmente feita mostra "Concluído" (não sempre a primeira da lista). Pular um exercício com "Vou fazer depois" e confirmar que ele aparece como "Pulado — vai fazer depois" em vez de sumir ou virar "Concluído".

- [ ] **Step 4: Commit**

```bash
git add src/app/features/athlete/home/home.component.html src/app/features/athlete/weekly-view/weekly-view.component.html
git commit -m "fix(athlete): status real (feito/postergado/abandonado) no Dashboard e na Semana, sem hardcode"
```

---

## Task 11: Estilo de mensagem de sistema no chat

**Files:**
- Modify: `frontend/src/app/core/services/api.service.ts`
- Modify: `frontend/src/app/features/coach/messages/messages.component.html`
- Modify: `frontend/src/app/features/athlete/messages/messages.component.html`

**Interfaces:**
- Consumes: `ChatMessage.isSystem` (novo campo, backend já retorna via `include` padrão do Prisma já que é coluna direta do model).

- [ ] **Step 1: Atualizar `ChatMessage`**

Em `api.service.ts`, no `interface ChatMessage`, adicionar:

```typescript
  isSystem: boolean;
```

- [ ] **Step 2: Estilizar no chat do coach**

Em `frontend/src/app/features/coach/messages/messages.component.html`, trocar (linhas 80–95 hoje):

```html
              @for (msg of group.messages; track msg.id) {
                <div class="flex"
                  [class.justify-end]="msg.fromId === myId()"
                  [class.justify-start]="msg.fromId !== myId()">
                  <div class="max-w-[70%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed"
                    [class.bg-primary-fixed]="msg.fromId === myId()"
                    [class.text-on-primary-fixed]="msg.fromId === myId()"
                    [class.rounded-br-sm]="msg.fromId === myId()"
                    [class.bg-surface-container-low]="msg.fromId !== myId()"
                    [class.text-on-surface]="msg.fromId !== myId()"
                    [class.rounded-bl-sm]="msg.fromId !== myId()">
                    <p>{{ msg.content }}</p>
                    <p class="text-[10px] mt-1 opacity-60 text-right">{{ formatTime(msg.createdAt) }}</p>
                  </div>
                </div>
              }
```

por:

```html
              @for (msg of group.messages; track msg.id) {
                @if (msg.isSystem) {
                  <div class="flex justify-center my-1">
                    <p class="text-outline text-[11px] italic bg-surface-container-low rounded-full px-3 py-1.5 text-center max-w-[85%]">
                      {{ msg.content }}
                    </p>
                  </div>
                } @else {
                  <div class="flex"
                    [class.justify-end]="msg.fromId === myId()"
                    [class.justify-start]="msg.fromId !== myId()">
                    <div class="max-w-[70%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed"
                      [class.bg-primary-fixed]="msg.fromId === myId()"
                      [class.text-on-primary-fixed]="msg.fromId === myId()"
                      [class.rounded-br-sm]="msg.fromId === myId()"
                      [class.bg-surface-container-low]="msg.fromId !== myId()"
                      [class.text-on-surface]="msg.fromId !== myId()"
                      [class.rounded-bl-sm]="msg.fromId !== myId()">
                      <p>{{ msg.content }}</p>
                      <p class="text-[10px] mt-1 opacity-60 text-right">{{ formatTime(msg.createdAt) }}</p>
                    </div>
                  </div>
                }
              }
```

- [ ] **Step 3: Estilizar no chat do atleta**

Em `frontend/src/app/features/athlete/messages/messages.component.html`, trocar (linhas 38–53 hoje):

```html
        @for (msg of group.messages; track msg.id) {
          <div class="flex"
            [class.justify-end]="msg.fromId === myId()"
            [class.justify-start]="msg.fromId !== myId()">
            <div class="max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed"
              [class.bg-primary-fixed]="msg.fromId === myId()"
              [class.text-on-primary-fixed]="msg.fromId === myId()"
              [class.rounded-br-sm]="msg.fromId === myId()"
              [class.bg-surface-container-low]="msg.fromId !== myId()"
              [class.text-on-surface]="msg.fromId !== myId()"
              [class.rounded-bl-sm]="msg.fromId !== myId()">
              <p>{{ msg.content }}</p>
              <p class="text-[10px] mt-1 opacity-60 text-right">{{ formatTime(msg.createdAt) }}</p>
            </div>
          </div>
        }
```

por:

```html
        @for (msg of group.messages; track msg.id) {
          @if (msg.isSystem) {
            <div class="flex justify-center my-1">
              <p class="text-outline text-[11px] italic bg-surface-container-low rounded-full px-3 py-1.5 text-center max-w-[85%]">
                {{ msg.content }}
              </p>
            </div>
          } @else {
            <div class="flex"
              [class.justify-end]="msg.fromId === myId()"
              [class.justify-start]="msg.fromId !== myId()">
              <div class="max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed"
                [class.bg-primary-fixed]="msg.fromId === myId()"
                [class.text-on-primary-fixed]="msg.fromId === myId()"
                [class.rounded-br-sm]="msg.fromId === myId()"
                [class.bg-surface-container-low]="msg.fromId !== myId()"
                [class.text-on-surface]="msg.fromId !== myId()"
                [class.rounded-bl-sm]="msg.fromId !== myId()">
                <p>{{ msg.content }}</p>
                <p class="text-[10px] mt-1 opacity-60 text-right">{{ formatTime(msg.createdAt) }}</p>
              </div>
            </div>
          }
        }
```

- [ ] **Step 4: Build e teste manual**

```bash
cd frontend
npx ng build --configuration=development
```

Manualmente: pular um exercício (Task 8), abrir o chat do coach com esse aluno, confirmar que a mensagem aparece centralizada/itálico, diferente das bolhas normais.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/services/api.service.ts src/app/features/coach/messages/messages.component.html src/app/features/athlete/messages/messages.component.html
git commit -m "feat(messages): estilo diferenciado pra mensagem automatica de sistema (isSystem)"
```

---

## Task 12: Badge de pulos pendentes na tela de Alunos

**Files:**
- Modify: `frontend/src/app/features/coach/students/students.component.ts`
- Modify: `frontend/src/app/features/coach/students/students.component.html`

**Interfaces:**
- Consumes: `ApiService.getPendingSkipCounts()` (Task 6).

- [ ] **Step 1: Editar o componente**

Adicionar ao `StudentsComponent`:

```typescript
  pendingSkips = signal<Record<string, number>>({});

  private loadPendingSkips(): void {
    this.api.getPendingSkipCounts().subscribe(counts => {
      const map: Record<string, number> = {};
      for (const c of counts) map[c.studentId] = c.count;
      this.pendingSkips.set(map);
    });
  }
```

Chamar `this.loadPendingSkips()` dentro do `ngOnInit()` existente, junto de onde `students` é carregado.

- [ ] **Step 2: Template**

Em `students.component.html`, trocar (linha 80 hoje):

```html
            <h3 class="text-on-surface font-headline font-bold text-sm truncate mb-0.5">{{ student.name }}</h3>
```

por:

```html
            <h3 class="text-on-surface font-headline font-bold text-sm truncate mb-0.5 flex items-center gap-1.5">
              {{ student.name }}
              @if (pendingSkips()[student.id]; as count) {
                <span class="min-w-[16px] h-4 px-1 rounded-full bg-error text-on-error text-[9px] font-bold flex items-center justify-center flex-shrink-0"
                  title="Pulos pendentes">
                  {{ count }}
                </span>
              }
            </h3>
```

- [ ] **Step 3: Build e teste manual**

```bash
cd frontend
npx ng build --configuration=development
```

Manualmente: com o skip "Postponed" criado nas tasks anteriores ainda pendente, abrir a tela de Alunos do coach e confirmar que o badge aparece com a contagem certa.

- [ ] **Step 4: Commit**

```bash
git add src/app/features/coach/students
git commit -m "feat(students): badge de pulos pendentes por aluno"
```

---

## Task 13: Revisão de segurança e merge

**Files:** nenhum arquivo novo — task de fechamento.

- [ ] **Step 1: Rodar a suíte de testes do backend inteira**

```bash
cd backend
npm run test
```

Esperado: todos os specs (Task 2, 3, 4) passando, nenhuma regressão.

- [ ] **Step 2: Rodar os dois builds de produção**

```bash
cd backend && npm run build
cd ../frontend && npx ng build --configuration=development
```

Esperado: ambos limpos.

- [ ] **Step 3: Rodar a skill `security-review` no diff acumulado de cada repo**

Invocar a skill `security-review` normalmente (não faz parte deste plano como código, é um passo de processo) em cada branch antes de abrir o PR — focar em: checagem de dono em `POST /workout-skips` e `GET /workout-skips/pending-count`, validação do DTO (`exerciseId` XOR `sessionId`).

- [ ] **Step 4: Abrir PRs (backend e frontend) e mergear**

Seguir o fluxo já estabelecido no projeto: push da branch, `gh pr create`, revisão, merge squash, `git pull` no `main` de cada repo, reiniciar os servidores locais com o código final.

- [ ] **Step 5: Atualizar a memória do projeto**

Registrar em `project_aevonfit.md`: feature de skip implementada e mergeada, mais os dois bugs de status "fake" corrigidos no caminho (Dashboard hardcoded, `workoutLogs` nunca incluído).
