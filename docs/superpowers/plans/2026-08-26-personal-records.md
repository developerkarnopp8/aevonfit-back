# Recordes Pessoais (PR/1RM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catálogo global de movimentos de CrossFit onde o atleta registra PR/1RM (carga e/ou reps), o coach vê gráfico de evolução de força por aluno, e o coach pode cadastrar movimento customizado.

**Architecture:** Dois models novos (`Movement` catálogo, `PersonalRecord` log de tentativas por evento — nunca sobrescrito, PR atual sempre derivado do maior valor histórico). Backend: 2 módulos NestJS novos com ownership check via `StudentsService.findOne`. Frontend: tela nova pro atleta ("Meus Recordes") e seção recolhível nova no `plan-builder` do coach.

**Tech Stack:** NestJS + Prisma + PostgreSQL (backend), Angular 21 standalone/signals (frontend) — mesma stack e convenções já usadas em todo o resto do projeto.

**Spec:** `backend/docs/superpowers/specs/2026-08-26-personal-records-design.md`

## Global Constraints

- Migração de banco só pelo procedimento seguro: container-sombra descartável pra gerar o diff, nunca `prisma migrate dev` não-interativo nem `migrate diff --shadow-database-url` apontando pro banco real.
- Toda rota que acessa dado de um aluno específico precisa de ownership check via `StudentsService.findOne(studentId, user)` — mesmo padrão já usado em `WorkoutLogsService`, `WorkoutSkipsService`, `DailyIntakeService`, `SessionsService`.
- `PersonalRecord` exige pelo menos um entre `loadKg`/`reps` — checado no backend (service), não só no DTO/frontend (mesma lição já aprendida com `WorkoutSkip` nesta sessão: `ValidateIf` sozinho não é confiável pra "pelo menos um").
- `PersonalRecord` é log-por-evento, append-only — nunca há update/delete de um registro já criado. O "PR atual" de um movimento é sempre `Math.max(...)` sobre o histórico, nunca um campo armazenado separado.
- Toda rota nova protegida por `@Roles()` + `RolesGuard` na cadeia de guards (`@UseGuards(JwtAuthGuard, RolesGuard)`) — não só `JwtAuthGuard` sozinho (achado real da revisão final da feature de skip nesta sessão: sem `RolesGuard` na cadeia, o decorator `@Roles` não faz nada).
- Cada task termina com branch própria + commit, seguir `~/PROJETOS/MANUAL_FLUXO_ROTINA.md`.
- Categorias de movimento reaproveitam as mesmas já usadas em `ExerciseLibrary`/Biblioteca: `LPO`, `Força`, `Ginástica`, `Metcon`, `Resistência`, `Mobilidade`, `Core`, `Outro`.

---

## Task 1: Schema — Movement, PersonalRecord, migração segura

**Files:**
- Modify: `backend/prisma/schema.prisma`

**Interfaces:**
- Produces: models `Movement` (`id, name, category, coachId?, createdAt`) e `PersonalRecord` (`id, athleteId, movementId, loadKg?, reps?, achievedAt, note?, createdAt`), relações reversas em `User`.

- [ ] **Step 1: Adicionar os models no schema**

No fim de `backend/prisma/schema.prisma` (depois do model `WorkoutSkip`):

```prisma
model Movement {
  id        String   @id @default(uuid())
  name      String
  category  String
  coachId   String?
  createdAt DateTime @default(now())

  coach           User?            @relation(fields: [coachId], references: [id], onDelete: Cascade)
  personalRecords PersonalRecord[]

  @@map("movements")
}

model PersonalRecord {
  id         String   @id @default(uuid())
  athleteId  String
  movementId String
  loadKg     Float?
  reps       Int?
  achievedAt DateTime @default(now())
  note       String?
  createdAt  DateTime @default(now())

  athlete  User     @relation(fields: [athleteId], references: [id], onDelete: Cascade)
  movement Movement @relation(fields: [movementId], references: [id], onDelete: Cascade)

  @@map("personal_records")
}
```

- [ ] **Step 2: Adicionar as relações reversas no model `User`**

Achar o bloco `// Relations` dentro de `model User` (tem `workoutSkips`, `hydrationLogs`, `calorieLogs` como as últimas linhas) e adicionar duas linhas:

```prisma
  movements        Movement[]
  personalRecords  PersonalRecord[]
```

- [ ] **Step 3: Gerar a migração pelo procedimento seguro (container-sombra descartável)**

```bash
docker run -d --name aevonfit-shadow-migration --rm \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=shadow \
  -p 57714:5432 postgres:16-alpine
sleep 4
cd backend
TIMESTAMP=$(date +%Y%m%d%H%M%S)
mkdir -p "prisma/migrations/${TIMESTAMP}_add_personal_records"
source ~/.nvm/nvm.sh && nvm use 20
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url postgresql://postgres:password@localhost:57714/shadow \
  --script > "prisma/migrations/${TIMESTAMP}_add_personal_records/migration.sql"
docker stop aevonfit-shadow-migration
```

Revisar o SQL gerado: deve conter só `CREATE TABLE "movements"`, `CREATE TABLE "personal_records"` e `ADD CONSTRAINT` de foreign keys — **zero `DROP`**. Se aparecer qualquer `DROP`, pare e não aplique — algo está errado no schema.

- [ ] **Step 4: Aplicar a migração no banco real**

```bash
npx prisma migrate deploy
npx prisma generate
```

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): adiciona Movement e PersonalRecord"
```

---

## Task 2: MovementsService + Controller (catálogo)

**Files:**
- Create: `backend/src/movements/movements.service.ts`
- Create: `backend/src/movements/movements.service.spec.ts`
- Create: `backend/src/movements/movements.controller.ts`
- Create: `backend/src/movements/movements.module.ts`
- Create: `backend/src/movements/dto/create-movement.dto.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService` (padrão já existente), `Student` model (`coachId`, `userId` campos já existentes).
- Produces: `MovementsService.findAvailable(user)`, `MovementsService.create(coachId, dto)`. Rotas `GET /movements`, `POST /movements`.

- [ ] **Step 1: Escrever o DTO**

`backend/src/movements/dto/create-movement.dto.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

const CATEGORIES = ['LPO', 'Força', 'Ginástica', 'Metcon', 'Resistência', 'Mobilidade', 'Core', 'Outro'];

export class CreateMovementDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiProperty({ enum: CATEGORIES })
  @IsIn(CATEGORIES)
  category!: string;
}
```

- [ ] **Step 2: Escrever o teste falho (TDD)**

`backend/src/movements/movements.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { MovementsService } from './movements.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MovementsService.findAvailable', () => {
  let service: MovementsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      movement: { findMany: jest.fn().mockResolvedValue([]) },
      student: { findFirst: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [MovementsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(MovementsService);
  });

  it('coach: busca globais + customizados do proprio coachId', async () => {
    await service.findAvailable({ id: 'coach-1', role: 'coach' });

    expect(prisma.movement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ coachId: null }, { coachId: 'coach-1' }] },
      }),
    );
    expect(prisma.student.findFirst).not.toHaveBeenCalled();
  });

  it('atleta: resolve o coachId do proprio coach antes de buscar', async () => {
    prisma.student.findFirst.mockResolvedValue({ coachId: 'coach-9' });

    await service.findAvailable({ id: 'athlete-1', role: 'athlete' });

    expect(prisma.student.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'athlete-1' } }),
    );
    expect(prisma.movement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ coachId: null }, { coachId: 'coach-9' }] },
      }),
    );
  });
});

describe('MovementsService.create', () => {
  let service: MovementsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { movement: { create: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [MovementsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(MovementsService);
  });

  it('cria movimento customizado com o coachId de quem esta logado', async () => {
    prisma.movement.create.mockResolvedValue({ id: 'm1', name: 'Zercher Squat', category: 'Força', coachId: 'coach-1' });

    await service.create('coach-1', { name: 'Zercher Squat', category: 'Força' });

    expect(prisma.movement.create).toHaveBeenCalledWith({
      data: { name: 'Zercher Squat', category: 'Força', coachId: 'coach-1' },
    });
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

```bash
source ~/.nvm/nvm.sh && nvm use 20
cd backend
npx jest movements.service.spec.ts
```

Esperado: FAIL, `Cannot find module './movements.service'`.

- [ ] **Step 4: Implementar o service**

`backend/src/movements/movements.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMovementDto } from './dto/create-movement.dto';

type AuthUser = { id: string; role: string };

@Injectable()
export class MovementsService {
  constructor(private prisma: PrismaService) {}

  /** Catálogo disponível: movimentos globais (coachId null) + customizados do coach do usuário. */
  async findAvailable(user: AuthUser) {
    let coachId: string | null = null;
    if (user.role === 'coach') {
      coachId = user.id;
    } else {
      const student = await this.prisma.student.findFirst({
        where: { userId: user.id },
        select: { coachId: true },
      });
      coachId = student?.coachId ?? null;
    }

    return this.prisma.movement.findMany({
      where: { OR: [{ coachId: null }, { coachId }] },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async create(coachId: string, dto: CreateMovementDto) {
    return this.prisma.movement.create({
      data: { name: dto.name, category: dto.category, coachId },
    });
  }
}
```

- [ ] **Step 5: Rodar o teste de novo, confirmar que passa**

```bash
npx jest movements.service.spec.ts
```

Esperado: PASS, 3/3.

- [ ] **Step 6: Controller**

`backend/src/movements/movements.controller.ts`:

```typescript
import { Controller, Get, Post, Body, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MovementsService } from './movements.service';
import { CreateMovementDto } from './dto/create-movement.dto';

@ApiTags('movements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('movements')
export class MovementsController {
  constructor(private readonly service: MovementsService) {}

  @Get()
  @ApiOperation({ summary: 'Catálogo de movimentos disponível (globais + customizados do coach)' })
  findAvailable(@Request() req: any) {
    return this.service.findAvailable(req.user);
  }

  @Roles('coach')
  @Post()
  @ApiOperation({ summary: 'Cadastra movimento customizado, visível só pros próprios alunos' })
  create(@Body() dto: CreateMovementDto, @Request() req: any) {
    return this.service.create(req.user.id, dto);
  }
}
```

Note que `GET /movements` não tem `@Roles(...)` — tanto coach quanto atleta usam essa rota (`@Roles` fica só no `POST`, restrito a coach).

- [ ] **Step 7: Module**

`backend/src/movements/movements.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MovementsService } from './movements.service';
import { MovementsController } from './movements.controller';

@Module({
  controllers: [MovementsController],
  providers: [MovementsService],
  exports: [MovementsService],
})
export class MovementsModule {}
```

- [ ] **Step 8: Registrar no `app.module.ts`**

Seguir o padrão exato já usado pra `WorkoutSkipsModule`/`DailyIntakeModule`: adicionar `import { MovementsModule } from './movements/movements.module';` no topo, e `MovementsModule,` no array `imports`.

- [ ] **Step 9: Build e commit**

```bash
npm run build
git add src/movements/ src/app.module.ts
git commit -m "feat(movements): catalogo de movimentos (GET/POST /movements)"
```

---

## Task 3: PersonalRecordsService.create + POST /personal-records

**Files:**
- Create: `backend/src/personal-records/personal-records.service.ts`
- Create: `backend/src/personal-records/personal-records.service.spec.ts`
- Create: `backend/src/personal-records/personal-records.controller.ts`
- Create: `backend/src/personal-records/personal-records.module.ts`
- Create: `backend/src/personal-records/dto/create-personal-record.dto.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: nenhuma interface de outra task além do padrão `PrismaService`.
- Produces: `PersonalRecordsService.create(athleteId, dto)`. Rota `POST /personal-records`. Usado pela Task 4 (mesmo service, método novo) e pela Task 9 (frontend).

- [ ] **Step 1: DTO**

`backend/src/personal-records/dto/create-personal-record.dto.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreatePersonalRecordDto {
  @ApiProperty()
  @IsUUID()
  movementId!: string;

  @ApiProperty({ required: false, description: 'Carga em kg' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  loadKg?: number;

  @ApiProperty({ required: false, description: 'Repetições máximas' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  reps?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
```

- [ ] **Step 2: Teste falho (TDD)**

`backend/src/personal-records/personal-records.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PersonalRecordsService } from './personal-records.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';

describe('PersonalRecordsService.create', () => {
  let service: PersonalRecordsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { personalRecord: { create: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [
        PersonalRecordsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: { findOne: jest.fn() } },
      ],
    }).compile();
    service = module.get(PersonalRecordsService);
  });

  it('cria o registro com loadKg', async () => {
    prisma.personalRecord.create.mockResolvedValue({ id: 'pr1' });

    await service.create('athlete-1', { movementId: 'mov-1', loadKg: 120 } as any);

    expect(prisma.personalRecord.create).toHaveBeenCalledWith({
      data: { athleteId: 'athlete-1', movementId: 'mov-1', loadKg: 120, reps: undefined, note: undefined },
    });
  });

  it('cria o registro so com reps (movimento de corpo livre)', async () => {
    prisma.personalRecord.create.mockResolvedValue({ id: 'pr2' });

    await service.create('athlete-1', { movementId: 'mov-2', reps: 15 } as any);

    expect(prisma.personalRecord.create).toHaveBeenCalledWith({
      data: { athleteId: 'athlete-1', movementId: 'mov-2', loadKg: undefined, reps: 15, note: undefined },
    });
  });

  it('rejeita quando nem loadKg nem reps sao informados', async () => {
    await expect(
      service.create('athlete-1', { movementId: 'mov-1' } as any),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.personalRecord.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Rodar e confirmar falha**

```bash
npx jest personal-records.service.spec.ts
```

Esperado: FAIL, `Cannot find module './personal-records.service'`.

- [ ] **Step 4: Implementar o service**

`backend/src/personal-records/personal-records.service.ts`:

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { CreatePersonalRecordDto } from './dto/create-personal-record.dto';

type AuthUser = { id: string; role: string };

@Injectable()
export class PersonalRecordsService {
  constructor(
    private prisma: PrismaService,
    private studentsService: StudentsService,
  ) {}

  async create(athleteId: string, dto: CreatePersonalRecordDto) {
    if (dto.loadKg == null && dto.reps == null) {
      throw new BadRequestException('Informe carga (kg) e/ou repetições.');
    }
    return this.prisma.personalRecord.create({
      data: {
        athleteId,
        movementId: dto.movementId,
        loadKg: dto.loadKg,
        reps: dto.reps,
        note: dto.note,
      },
    });
  }
}
```

`StudentsService` já é injetado aqui mesmo não sendo usado neste método — vai ser usado no método da Task 5 (mesmo service, mesmo arquivo). Confirme que `StudentsModule` está importado no `personal-records.module.ts` (Step 7 abaixo).

- [ ] **Step 5: Rodar de novo, confirmar que passa**

```bash
npx jest personal-records.service.spec.ts
```

Esperado: PASS, 3/3.

- [ ] **Step 6: Controller**

`backend/src/personal-records/personal-records.controller.ts`:

```typescript
import { Controller, Post, Body, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PersonalRecordsService } from './personal-records.service';
import { CreatePersonalRecordDto } from './dto/create-personal-record.dto';

@ApiTags('personal-records')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('personal-records')
export class PersonalRecordsController {
  constructor(private readonly service: PersonalRecordsService) {}

  @Roles('athlete')
  @Post()
  @ApiOperation({ summary: 'Registra uma tentativa de PR (carga e/ou reps)' })
  create(@Body() dto: CreatePersonalRecordDto, @Request() req: any) {
    return this.service.create(req.user.id, dto);
  }
}
```

- [ ] **Step 7: Module**

`backend/src/personal-records/personal-records.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PersonalRecordsService } from './personal-records.service';
import { PersonalRecordsController } from './personal-records.controller';
import { StudentsModule } from '../students/students.module';

@Module({
  imports: [StudentsModule],
  controllers: [PersonalRecordsController],
  providers: [PersonalRecordsService],
  exports: [PersonalRecordsService],
})
export class PersonalRecordsModule {}
```

- [ ] **Step 8: Registrar no `app.module.ts`**

Mesmo padrão: `import { PersonalRecordsModule } from './personal-records/personal-records.module';` + `PersonalRecordsModule,` no array `imports`.

- [ ] **Step 9: Build e commit**

```bash
npm run build
git add src/personal-records/ src/app.module.ts
git commit -m "feat(personal-records): POST /personal-records com validacao carga/reps"
```

---

## Task 4: GET /personal-records/me

**Files:**
- Modify: `backend/src/personal-records/personal-records.service.ts`
- Modify: `backend/src/personal-records/personal-records.service.spec.ts`
- Modify: `backend/src/personal-records/personal-records.controller.ts`

**Interfaces:**
- Consumes: `PersonalRecordsService` já existente (Task 3, mesma classe).
- Produces: `PersonalRecordsService.getMyHistory(athleteId)`. Rota `GET /personal-records/me`.

- [ ] **Step 1: Adicionar o teste falho**

No fim de `backend/src/personal-records/personal-records.service.spec.ts`, adicionar um novo `describe`:

```typescript
describe('PersonalRecordsService.getMyHistory', () => {
  let service: PersonalRecordsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { personalRecord: { findMany: jest.fn().mockResolvedValue([]) } };
    const module = await Test.createTestingModule({
      providers: [
        PersonalRecordsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: { findOne: jest.fn() } },
      ],
    }).compile();
    service = module.get(PersonalRecordsService);
  });

  it('busca o historico do proprio atleta, mais recente primeiro, com o movimento incluido', async () => {
    await service.getMyHistory('athlete-1');

    expect(prisma.personalRecord.findMany).toHaveBeenCalledWith({
      where: { athleteId: 'athlete-1' },
      include: { movement: true },
      orderBy: { achievedAt: 'desc' },
    });
  });
});
```

Adicionar os imports necessários no topo do arquivo se ainda não estiverem lá: `StudentsService` já deve estar importado da Task 3.

- [ ] **Step 2: Rodar e confirmar falha**

```bash
npx jest personal-records.service.spec.ts
```

Esperado: FAIL, `service.getMyHistory is not a function`.

- [ ] **Step 3: Implementar**

Em `backend/src/personal-records/personal-records.service.ts`, adicionar o método na classe (depois de `create`):

```typescript
  async getMyHistory(athleteId: string) {
    return this.prisma.personalRecord.findMany({
      where: { athleteId },
      include: { movement: true },
      orderBy: { achievedAt: 'desc' },
    });
  }
```

- [ ] **Step 4: Rodar de novo, confirmar que passa**

```bash
npx jest personal-records.service.spec.ts
```

Esperado: PASS, 4/4.

- [ ] **Step 5: Adicionar a rota no controller**

Em `backend/src/personal-records/personal-records.controller.ts`, adicionar (precisa importar `Get` de `@nestjs/common`):

```typescript
  @Roles('athlete')
  @Get('me')
  @ApiOperation({ summary: 'Meu histórico completo de PRs, mais recente primeiro' })
  getMine(@Request() req: any) {
    return this.service.getMyHistory(req.user.id);
  }
```

- [ ] **Step 6: Build e commit**

```bash
npm run build
git add src/personal-records/
git commit -m "feat(personal-records): GET /personal-records/me"
```

---

## Task 5: GET /personal-records/student/:studentId/history (coach)

**Files:**
- Modify: `backend/src/personal-records/personal-records.service.ts`
- Modify: `backend/src/personal-records/personal-records.service.spec.ts`
- Modify: `backend/src/personal-records/personal-records.controller.ts`

**Interfaces:**
- Consumes: `StudentsService.findOne(studentId, user)` — já injetado desde a Task 3, retorna `{ id, userId, coachId, ... }`, lança `ForbiddenException`/`NotFoundException`.
- Produces: `PersonalRecordsService.getHistoryForStudent(studentId, user)`. Rota `GET /personal-records/student/:studentId/history`. Consumida pelo frontend na Task 10.

- [ ] **Step 1: Adicionar o teste falho**

No fim de `backend/src/personal-records/personal-records.service.spec.ts`:

```typescript
describe('PersonalRecordsService.getHistoryForStudent', () => {
  let service: PersonalRecordsService;
  let prisma: any;
  let studentsService: { findOne: jest.Mock };

  const coachUser = { id: 'coach-1', role: 'coach' };
  const student = { id: 'student-1', userId: 'athlete-1', coachId: 'coach-1' };

  beforeEach(async () => {
    prisma = { personalRecord: { findMany: jest.fn().mockResolvedValue([]) } };
    studentsService = { findOne: jest.fn().mockResolvedValue(student) };
    const module = await Test.createTestingModule({
      providers: [
        PersonalRecordsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: studentsService },
      ],
    }).compile();
    service = module.get(PersonalRecordsService);
  });

  it('checa dono do aluno antes de retornar o historico', async () => {
    await service.getHistoryForStudent('student-1', coachUser);

    expect(studentsService.findOne).toHaveBeenCalledWith('student-1', coachUser);
    expect(prisma.personalRecord.findMany).toHaveBeenCalledWith({
      where: { athleteId: 'athlete-1' },
      include: { movement: true },
      orderBy: { achievedAt: 'desc' },
    });
  });

  it('propaga ForbiddenException quando o coach nao e dono do aluno, sem buscar nada', async () => {
    const { ForbiddenException } = await import('@nestjs/common');
    studentsService.findOne.mockRejectedValue(new ForbiddenException());

    await expect(
      service.getHistoryForStudent('student-1', coachUser),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.personalRecord.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
npx jest personal-records.service.spec.ts
```

Esperado: FAIL, `service.getHistoryForStudent is not a function`.

- [ ] **Step 3: Implementar**

Em `backend/src/personal-records/personal-records.service.ts`, adicionar (depois de `getMyHistory`):

```typescript
  /** Histórico completo de um aluno, pro gráfico do coach — só o coach dono. */
  async getHistoryForStudent(studentId: string, user: AuthUser) {
    const student = await this.studentsService.findOne(studentId, user);
    return this.prisma.personalRecord.findMany({
      where: { athleteId: student.userId },
      include: { movement: true },
      orderBy: { achievedAt: 'desc' },
    });
  }
```

- [ ] **Step 4: Rodar de novo, confirmar que passa**

```bash
npx jest personal-records.service.spec.ts
```

Esperado: PASS, 6/6.

- [ ] **Step 5: Adicionar a rota no controller**

Em `backend/src/personal-records/personal-records.controller.ts` (precisa importar `Param` de `@nestjs/common`):

```typescript
  @Roles('coach')
  @Get('student/:studentId/history')
  @ApiOperation({ summary: 'Histórico completo de PRs de um aluno — coach dono' })
  getStudentHistory(@Param('studentId') studentId: string, @Request() req: any) {
    return this.service.getHistoryForStudent(studentId, req.user);
  }
```

- [ ] **Step 6: Build, suíte completa e commit**

```bash
npm run build
npm run test
git add src/personal-records/
git commit -m "feat(personal-records): GET /personal-records/student/:studentId/history"
```

---

## Task 6: Seed do catálogo global de movimentos

**Files:**
- Create: `backend/scripts/seed-movements-catalog.ts`

**Interfaces:**
- Consumes: model `Movement` (Task 1).
- Produces: nenhuma interface — script one-off, roda direto no banco via Prisma Client.

- [ ] **Step 1: Escrever o script**

`backend/scripts/seed-movements-catalog.ts`:

```typescript
/**
 * Popula o catálogo global de movimentos (Movement.coachId = null) com os
 * movimentos padrão de CrossFit. Rodar uma única vez:
 * `npx ts-node scripts/seed-movements-catalog.ts` — idempotente, pula
 * nomes que já existem no catálogo global.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface MovementSeed {
  name: string;
  category: string;
}

const MOVEMENTS: MovementSeed[] = [
  { name: 'Snatch', category: 'LPO' },
  { name: 'Power Snatch', category: 'LPO' },
  { name: 'Clean', category: 'LPO' },
  { name: 'Power Clean', category: 'LPO' },
  { name: 'Clean & Jerk', category: 'LPO' },
  { name: 'Jerk', category: 'LPO' },
  { name: 'Split Jerk', category: 'LPO' },
  { name: 'Push Jerk', category: 'LPO' },
  { name: 'Back Squat', category: 'Força' },
  { name: 'Front Squat', category: 'Força' },
  { name: 'Overhead Squat', category: 'Força' },
  { name: 'Deadlift', category: 'Força' },
  { name: 'Sumo Deadlift', category: 'Força' },
  { name: 'Bench Press', category: 'Força' },
  { name: 'Strict Press', category: 'Força' },
  { name: 'Push Press', category: 'Força' },
  { name: 'Thruster', category: 'Força' },
  { name: 'Pull-up', category: 'Ginástica' },
  { name: 'Strict Pull-up', category: 'Ginástica' },
  { name: 'Muscle-up', category: 'Ginástica' },
  { name: 'Handstand Push-up', category: 'Ginástica' },
  { name: 'Ring Dip', category: 'Ginástica' },
  { name: 'Toes-to-Bar', category: 'Ginástica' },
];

async function main() {
  const existing = await prisma.movement.findMany({
    where: { coachId: null },
    select: { name: true },
  });
  const existingNames = new Set(existing.map(m => m.name));

  const toCreate = MOVEMENTS.filter(m => !existingNames.has(m.name));

  if (!toCreate.length) {
    console.log('Nada a inserir — todos os movimentos já existem no catálogo global.');
    return;
  }

  await prisma.movement.createMany({
    data: toCreate.map(m => ({ name: m.name, category: m.category, coachId: null })),
  });

  console.log(`Inseridos ${toCreate.length} movimentos no catálogo global.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Rodar o script**

```bash
source ~/.nvm/nvm.sh && nvm use 20
cd backend
npx ts-node scripts/seed-movements-catalog.ts
```

Esperado: `Inseridos 23 movimentos no catálogo global.`

- [ ] **Step 3: Confirmar via API**

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"luan@aevonfit.com","password":"coach123"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")
curl -s http://localhost:3000/api/movements -H "Authorization: Bearer $TOKEN" | python3 -c "import json,sys; print(len(json.load(sys.stdin)), 'movimentos')"
```

Esperado: `23 movimentos`.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-movements-catalog.ts
git commit -m "chore(scripts): seed do catalogo global de movimentos"
```

---

## Task 7: Frontend — models + ApiService

**Files:**
- Create: `frontend/src/app/core/models/movement.model.ts`
- Modify: `frontend/src/app/core/models/index.ts`
- Modify: `frontend/src/app/core/services/api.service.ts`

**Interfaces:**
- Produces: interfaces `Movement`, `PersonalRecord`; métodos `ApiService.getMovements()`, `createMovement()`, `logPersonalRecord()`, `getMyPersonalRecords()`, `getStudentPersonalRecordsHistory()`. Usado pelas Tasks 8, 9, 10, 11.

- [ ] **Step 1: Criar o model**

`frontend/src/app/core/models/movement.model.ts`:

```typescript
export interface Movement {
  id: string;
  name: string;
  category: string;
  coachId?: string;
}

export interface PersonalRecord {
  id: string;
  athleteId: string;
  movementId: string;
  loadKg?: number;
  reps?: number;
  achievedAt: string;
  note?: string;
  movement: Movement;
}
```

- [ ] **Step 2: Exportar no barrel**

Em `frontend/src/app/core/models/index.ts`, adicionar:

```typescript
export * from './movement.model';
```

- [ ] **Step 3: Adicionar os métodos no `ApiService`**

Em `frontend/src/app/core/services/api.service.ts`, depois do bloco `// ── Daily intake (hidratação / calorias) ────────────────────────────────` (ou equivalente, ao final dos métodos de intake), adicionar o import no topo:

```typescript
import { Movement, PersonalRecord } from '../models';
```

(Se `api.service.ts` já importa de `'../models'` numa linha só, adicionar `Movement, PersonalRecord` nessa mesma linha em vez de criar um import novo.)

E os métodos:

```typescript
  // ── Recordes pessoais (PR/1RM) ──────────────────────────────────────────

  getMovements(): Observable<Movement[]> {
    return this.http.get<Movement[]>(`${this.base}/movements`);
  }

  createMovement(name: string, category: string): Observable<Movement> {
    return this.http.post<Movement>(`${this.base}/movements`, { name, category });
  }

  logPersonalRecord(movementId: string, loadKg?: number, reps?: number, note?: string): Observable<PersonalRecord> {
    return this.http.post<PersonalRecord>(`${this.base}/personal-records`, { movementId, loadKg, reps, note });
  }

  getMyPersonalRecords(): Observable<PersonalRecord[]> {
    return this.http.get<PersonalRecord[]>(`${this.base}/personal-records/me`);
  }

  getStudentPersonalRecordsHistory(studentId: string): Observable<PersonalRecord[]> {
    return this.http.get<PersonalRecord[]>(`${this.base}/personal-records/student/${studentId}/history`);
  }
```

- [ ] **Step 4: Build**

```bash
cd frontend
source ~/.nvm/nvm.sh && nvm use 20
npx ng build --configuration=development
```

Esperado: build limpo.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/models/movement.model.ts src/app/core/models/index.ts src/app/core/services/api.service.ts
git commit -m "feat(models): Movement/PersonalRecord + metodos de API"
```

---

## Task 8: Frontend — tela "Meus Recordes" do atleta (listagem + accordion)

**Files:**
- Create: `frontend/src/app/features/athlete/records/records.component.ts`
- Create: `frontend/src/app/features/athlete/records/records.component.html`
- Create: `frontend/src/app/features/athlete/records/records.component.scss`
- Modify: `frontend/src/app/app.routes.ts`

**Interfaces:**
- Consumes: `ApiService.getMovements()`, `ApiService.getMyPersonalRecords()` (Task 7).
- Produces: rota `/athlete/records`. O botão "Registrar tentativa" é ligado na Task 9 (este task só lista, sem form ainda).

- [ ] **Step 1: Componente**

`frontend/src/app/features/athlete/records/records.component.ts`:

```typescript
import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../../core/services/api.service';
import { Movement, PersonalRecord } from '../../../core/models';

interface MovementWithPR {
  movement: Movement;
  bestLoadKg?: number;
  bestReps?: number;
  lastAchievedAt?: string;
}

@Component({
  selector: 'app-records',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './records.component.html',
  styleUrl: './records.component.scss',
})
export class RecordsComponent implements OnInit {
  movements = signal<Movement[]>([]);
  records   = signal<PersonalRecord[]>([]);
  loading   = signal(true);
  expandedCategories = signal<Set<string>>(new Set());

  movementsWithPR = computed<MovementWithPR[]>(() => {
    const recordsByMovement = new Map<string, PersonalRecord[]>();
    for (const r of this.records()) {
      const list = recordsByMovement.get(r.movementId) ?? [];
      list.push(r);
      recordsByMovement.set(r.movementId, list);
    }

    return this.movements().map(movement => {
      const recs = recordsByMovement.get(movement.id) ?? [];
      const bestLoadKg = recs.length ? Math.max(...recs.map(r => r.loadKg ?? 0).filter(v => v > 0)) || undefined : undefined;
      const bestReps   = recs.length ? Math.max(...recs.map(r => r.reps ?? 0).filter(v => v > 0)) || undefined : undefined;
      const lastAchievedAt = recs.length
        ? recs.reduce((latest, r) => (r.achievedAt > latest ? r.achievedAt : latest), recs[0].achievedAt)
        : undefined;
      return { movement, bestLoadKg, bestReps, lastAchievedAt };
    });
  });

  groupedMovements = computed(() => {
    const grouped: Record<string, MovementWithPR[]> = {};
    for (const item of this.movementsWithPR()) {
      const cat = item.movement.category;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    }
    return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
  });

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.getMovements().subscribe(movements => {
      this.movements.set(movements);
      this.loading.set(false);
      const firstCategory = this.groupedMovements()[0]?.[0];
      if (firstCategory) this.expandedCategories.set(new Set([firstCategory]));
    });
    this.api.getMyPersonalRecords().subscribe(records => this.records.set(records));
  }

  toggleCategory(cat: string): void {
    this.expandedCategories.update(set => {
      const next = new Set(set);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  }

  isCategoryExpanded(cat: string): boolean {
    return this.expandedCategories().has(cat);
  }
}
```

- [ ] **Step 2: Template**

`frontend/src/app/features/athlete/records/records.component.html`:

```html
<div class="px-5 py-4 animate-fade-in">

  <div class="mb-6">
    <h2 class="font-headline font-black text-3xl text-on-surface leading-tight tracking-tighter">Meus Recordes</h2>
    <p class="text-on-surface-variant text-sm mt-1">Seu histórico de PR/1RM por movimento.</p>
  </div>

  @if (loading()) {
    <div class="flex items-center justify-center h-40">
      <span class="material-symbols-outlined text-outline text-[40px] animate-pulse-subtle">military_tech</span>
    </div>
  } @else {
    @for (group of groupedMovements(); track group[0]) {
      <div class="mb-3">
        <button type="button" (click)="toggleCategory(group[0])"
          class="w-full flex items-center gap-3 py-2 group">
          <span class="material-symbols-outlined text-outline text-[18px] transition-transform"
            [class.rotate-90]="isCategoryExpanded(group[0])">chevron_right</span>
          <span class="text-[10px] font-headline font-black uppercase tracking-widest text-outline group-hover:text-on-surface transition-colors">{{ group[0] }}</span>
          <div class="flex-1 h-px bg-outline-variant/10"></div>
          <span class="text-outline text-[10px]">{{ group[1].length }}</span>
        </button>

        @if (isCategoryExpanded(group[0])) {
          <div class="grid grid-cols-1 gap-2 mt-2 animate-fade-in">
            @for (item of group[1]; track item.movement.id) {
              <div class="bg-surface-container-low rounded-md p-4 flex items-center justify-between gap-3">
                <div class="flex-1 min-w-0">
                  <p class="text-on-surface font-headline font-bold text-sm truncate">{{ item.movement.name }}</p>
                  @if (item.bestLoadKg || item.bestReps) {
                    <p class="text-on-surface-variant text-xs mt-0.5">
                      @if (item.bestLoadKg) { <span class="text-primary-fixed font-bold">{{ item.bestLoadKg }}kg</span> }
                      @if (item.bestLoadKg && item.bestReps) { <span> · </span> }
                      @if (item.bestReps) { <span class="text-primary-fixed font-bold">{{ item.bestReps }} reps</span> }
                    </p>
                  } @else {
                    <p class="text-outline text-xs mt-0.5">Nenhum registro ainda</p>
                  }
                </div>
                <button type="button"
                  class="flex items-center gap-1 text-[10px] font-headline font-bold text-primary-fixed hover:bg-primary-fixed/10 px-3 py-2 rounded-sm uppercase tracking-wider transition-colors">
                  <span class="material-symbols-outlined text-[14px]">add</span>
                  Registrar
                </button>
              </div>
            }
          </div>
        }
      </div>
    }
  }
</div>
```

O botão "Registrar" ainda não tem `(click)` — vem na Task 9.

- [ ] **Step 3: SCSS (mesmo padrão de `:host` já usado em outras páginas)**

`frontend/src/app/features/athlete/records/records.component.scss`:

```scss
:host {
  display: block;
  height: 100%;
  overflow-y: auto;
}
```

- [ ] **Step 4: Rota**

Em `frontend/src/app/app.routes.ts`, achar o bloco de rotas do atleta (`path: 'athlete'`, children com `home`, `weekly`, `session`, `active`, `history`, `messages`) e adicionar:

```typescript
{
  path: 'records',
  loadComponent: () =>
    import('./features/athlete/records/records.component').then(m => m.RecordsComponent),
},
```

- [ ] **Step 5: Link a partir da aba Evolução**

A aba "Evolução" da nav inferior (`athlete-shell.component.html`) aponta pra rota `/athlete/weekly`, servida por `frontend/src/app/features/athlete/weekly-view/weekly-view.component.html` (111 linhas hoje). No fim do arquivo, antes da última `</div>` que fecha o componente (depois do bloco `@if (selectedDay()!.sessions.length > 0) { ... }`), adicionar:

```html
  <a routerLink="/athlete/records"
    class="mt-4 mx-4 flex items-center justify-between bg-surface-container-low rounded-md p-4 hover:bg-surface-container transition-colors">
    <div class="flex items-center gap-3">
      <span class="material-symbols-outlined text-primary-fixed text-[20px]">military_tech</span>
      <span class="text-on-surface font-headline font-bold text-sm">Meus Recordes</span>
    </div>
    <span class="material-symbols-outlined text-outline text-[18px]">chevron_right</span>
  </a>
```

(`RouterLink` já precisa estar nos `imports` do `WeeklyViewComponent` — confirmar se já está, e adicionar se não estiver.)

- [ ] **Step 6: Build**

```bash
cd frontend
npx ng build --configuration=development
```

Esperado: build limpo.

- [ ] **Step 7: Commit**

```bash
git add src/app/features/athlete/records/ src/app/app.routes.ts src/app/features/athlete/
git commit -m "feat(records): tela Meus Recordes do atleta (listagem + accordion)"
```

---

## Task 9: Frontend — registrar tentativa de PR

**Files:**
- Modify: `frontend/src/app/features/athlete/records/records.component.ts`
- Modify: `frontend/src/app/features/athlete/records/records.component.html`

**Interfaces:**
- Consumes: `ApiService.logPersonalRecord()` (Task 7), `RecordsComponent` já existente (Task 8).
- Produces: nada consumido por outra task — ponta final da UI do atleta.

- [ ] **Step 1: Estado do formulário no componente**

Em `frontend/src/app/features/athlete/records/records.component.ts`, adicionar ao topo dos imports:

```typescript
import { FormsModule } from '@angular/forms';
```

E em `imports: [CommonModule]`, trocar por `imports: [CommonModule, FormsModule]`.

Adicionar à classe (depois de `expandedCategories`):

```typescript
  showForm = signal<Movement | null>(null);
  formLoadKg = signal<number | null>(null);
  formReps = signal<number | null>(null);
  formNote = signal('');
  saving = signal(false);
  justRecordedId = signal<string | null>(null);
```

E os métodos (depois de `isCategoryExpanded`):

```typescript
  openForm(movement: Movement): void {
    this.showForm.set(movement);
    this.formLoadKg.set(null);
    this.formReps.set(null);
    this.formNote.set('');
  }

  closeForm(): void {
    this.showForm.set(null);
  }

  get canSubmitForm(): boolean {
    return !!(this.formLoadKg() || this.formReps());
  }

  submitForm(): void {
    const movement = this.showForm();
    if (!movement || !this.canSubmitForm || this.saving()) return;
    this.saving.set(true);
    this.api.logPersonalRecord(
      movement.id,
      this.formLoadKg() ?? undefined,
      this.formReps() ?? undefined,
      this.formNote().trim() || undefined,
    ).subscribe({
      next: newRecord => {
        this.records.update(list => [newRecord, ...list]);
        this.justRecordedId.set(movement.id);
        setTimeout(() => this.justRecordedId.set(null), 3000);
        this.saving.set(false);
        this.closeForm();
      },
      error: () => this.saving.set(false),
    });
  }
```

- [ ] **Step 2: Ligar o botão "Registrar" e adicionar o formulário no template**

Em `frontend/src/app/features/athlete/records/records.component.html`, trocar o botão sem `(click)`:

```html
                <button type="button"
                  class="flex items-center gap-1 text-[10px] font-headline font-bold text-primary-fixed hover:bg-primary-fixed/10 px-3 py-2 rounded-sm uppercase tracking-wider transition-colors">
                  <span class="material-symbols-outlined text-[14px]">add</span>
                  Registrar
                </button>
```

por:

```html
                <button type="button" (click)="openForm(item.movement)"
                  class="flex items-center gap-1 text-[10px] font-headline font-bold text-primary-fixed hover:bg-primary-fixed/10 px-3 py-2 rounded-sm uppercase tracking-wider transition-colors">
                  <span class="material-symbols-outlined text-[14px]">add</span>
                  Registrar
                </button>
```

E, se `item.movement.id === justRecordedId()`, mostrar um selo "Novo recorde!" — trocar o bloco do PR atual:

```html
                  @if (item.bestLoadKg || item.bestReps) {
                    <p class="text-on-surface-variant text-xs mt-0.5">
                      @if (item.bestLoadKg) { <span class="text-primary-fixed font-bold">{{ item.bestLoadKg }}kg</span> }
                      @if (item.bestLoadKg && item.bestReps) { <span> · </span> }
                      @if (item.bestReps) { <span class="text-primary-fixed font-bold">{{ item.bestReps }} reps</span> }
                      @if (item.movement.id === justRecordedId()) {
                        <span class="ml-2 text-[10px] bg-primary-fixed text-on-primary-fixed px-1.5 py-0.5 rounded-sm uppercase font-headline">Novo!</span>
                      }
                    </p>
                  } @else {
                    <p class="text-outline text-xs mt-0.5">Nenhum registro ainda</p>
                  }
```

Adicionar o drawer do formulário no fim do arquivo (antes do `</div>` final do componente):

```html
  @if (showForm(); as movement) {
    <div class="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 animate-fade-in"
      (click)="closeForm()">
      <div class="bg-surface-container-low rounded-t-md sm:rounded-md w-full sm:max-w-sm p-6 animate-slide-up"
        (click)="$event.stopPropagation()">

        <h3 class="font-headline font-black text-lg text-on-surface tracking-tighter mb-1">{{ movement.name }}</h3>
        <p class="text-on-surface-variant text-xs mb-4">Registrar nova tentativa</p>

        <div class="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label class="text-on-surface-variant text-[10px] font-headline uppercase tracking-widest block mb-1.5">Carga (kg)</label>
            <input type="number" inputmode="decimal" placeholder="Ex: 100"
              [ngModel]="formLoadKg()" (ngModelChange)="formLoadKg.set($event)"
              class="w-full bg-surface-container text-on-surface placeholder:text-outline rounded-sm px-3 py-2.5 text-sm"/>
          </div>
          <div>
            <label class="text-on-surface-variant text-[10px] font-headline uppercase tracking-widest block mb-1.5">Repetições</label>
            <input type="number" inputmode="numeric" placeholder="Ex: 5"
              [ngModel]="formReps()" (ngModelChange)="formReps.set($event)"
              class="w-full bg-surface-container text-on-surface placeholder:text-outline rounded-sm px-3 py-2.5 text-sm"/>
          </div>
        </div>

        <label class="text-on-surface-variant text-[10px] font-headline uppercase tracking-widest block mb-1.5">Nota (opcional)</label>
        <textarea rows="2" placeholder="Ex: com cinto, sem cinto..."
          [ngModel]="formNote()" (ngModelChange)="formNote.set($event)"
          class="w-full bg-surface-container text-on-surface placeholder:text-outline rounded-sm px-3 py-2.5 text-sm resize-none mb-4"></textarea>

        <div class="flex gap-3">
          <button type="button" (click)="closeForm()"
            class="flex-1 py-3 rounded-sm border border-outline-variant/30 text-on-surface-variant font-headline text-xs uppercase tracking-wider">
            Cancelar
          </button>
          <button type="button" (click)="submitForm()" [disabled]="!canSubmitForm || saving()"
            class="flex-1 py-3 rounded-sm bg-primary-fixed disabled:opacity-40 text-on-primary-fixed font-headline font-black text-xs uppercase tracking-tighter">
            {{ saving() ? 'Salvando...' : 'Registrar' }}
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

Esperado: build limpo.

- [ ] **Step 4: Teste manual**

Login como atleta, ir em `/athlete/records`, escolher um movimento, registrar carga ou reps, confirmar que o card atualiza com o novo PR e o selo "Novo!" aparece por 3 segundos.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/athlete/records/
git commit -m "feat(records): formulario de registro de tentativa de PR"
```

---

## Task 10: Frontend — seção "Recordes de Força" no plan-builder do coach

**Files:**
- Modify: `frontend/src/app/features/coach/plan-builder/plan-builder.component.ts`
- Modify: `frontend/src/app/features/coach/plan-builder/plan-builder.component.html`

**Interfaces:**
- Consumes: `ApiService.getStudentPersonalRecordsHistory(studentId)` (Task 7).
- Produces: `selectedPRMovementId` signal, usado pela Task 11 (gráfico expandido).

- [ ] **Step 1: Estado no componente**

Em `frontend/src/app/features/coach/plan-builder/plan-builder.component.ts`, adicionar ao import de models (mesma linha de `TrainingDay` já adicionada hoje, ou linha própria):

```typescript
import { PersonalRecord } from '../../../core/models';
```

Adicionar à classe, perto de `intakeHistory`:

```typescript
  // Recordes de força do aluno
  prHistory = signal<PersonalRecord[]>([]);
  showPRSection = signal(false);
  selectedPRMovementId = signal<string | null>(null);

  prByMovement = computed(() => {
    const grouped = new Map<string, PersonalRecord[]>();
    for (const r of this.prHistory()) {
      const list = grouped.get(r.movementId) ?? [];
      list.push(r);
      grouped.set(r.movementId, list);
    }
    return Array.from(grouped.entries()).map(([movementId, records]) => {
      const sorted = [...records].sort((a, b) => a.achievedAt.localeCompare(b.achievedAt));
      const best = sorted.reduce((max, r) => Math.max(max, r.loadKg ?? r.reps ?? 0), 0);
      const previous = sorted.length > 1 ? Math.max(...sorted.slice(0, -1).map(r => r.loadKg ?? r.reps ?? 0)) : null;
      return {
        movementId,
        movementName: records[0].movement.name,
        unit: records[0].loadKg != null ? 'kg' : 'reps',
        best,
        trend: previous == null ? 'new' : best > previous ? 'up' : best === previous ? 'same' : 'down',
        history: sorted,
      };
    }).sort((a, b) => a.movementName.localeCompare(b.movementName));
  });
```

- [ ] **Step 2: Carregar o histórico junto com o resto**

Em `ngOnChanges` (já existe, foi modificado nesta sessão pra carregar `intakeHistory`), adicionar mais uma linha:

```typescript
    this.api.getStudentPersonalRecordsHistory(this.studentId).subscribe(h => this.prHistory.set(h));
```

- [ ] **Step 3: Template — seção recolhível**

Em `frontend/src/app/features/coach/plan-builder/plan-builder.component.html`, adicionar logo depois do bloco `<!-- Hidratação / Calorias (14 dias) -->` (mesmo padrão accordion, mesmo `flex-shrink-0`):

```html
  <!-- Recordes de Força -->
  @if (prByMovement().length > 0) {
    <div class="px-8 pb-4 flex-shrink-0">
      <div class="bg-surface-container-low rounded-md">
        <button type="button" (click)="showPRSection.set(!showPRSection())"
          class="w-full flex items-center justify-between px-4 py-3 group">
          <span class="flex items-center gap-2 text-on-surface-variant text-[10px] font-headline uppercase tracking-widest group-hover:text-on-surface transition-colors">
            <span class="material-symbols-outlined text-[16px]">military_tech</span>
            Recordes de Força
          </span>
          <span class="material-symbols-outlined text-outline text-[18px] transition-transform" [class.rotate-180]="showPRSection()">expand_more</span>
        </button>
        @if (showPRSection()) {
          <div class="px-4 pb-4 animate-fade-in grid grid-cols-1 md:grid-cols-2 gap-2">
            @for (item of prByMovement(); track item.movementId) {
              <button type="button"
                (click)="selectedPRMovementId.set(selectedPRMovementId() === item.movementId ? null : item.movementId)"
                class="bg-surface-container rounded-sm px-3 py-2.5 flex items-center justify-between text-left">
                <div class="min-w-0">
                  <p class="text-on-surface text-xs font-headline font-bold truncate">{{ item.movementName }}</p>
                  <p class="text-on-surface-variant text-[10px] mt-0.5">{{ item.best }}{{ item.unit === 'kg' ? 'kg' : ' reps' }}</p>
                </div>
                <span class="material-symbols-outlined text-[16px] flex-shrink-0"
                  [class.text-primary-fixed]="item.trend === 'up'"
                  [class.text-error]="item.trend === 'down'"
                  [class.text-outline]="item.trend === 'same' || item.trend === 'new'">
                  {{ item.trend === 'up' ? 'trending_up' : item.trend === 'down' ? 'trending_down' : item.trend === 'same' ? 'trending_flat' : 'fiber_new' }}
                </span>
              </button>
            }
          </div>
        }
      </div>
    </div>
  }
```

- [ ] **Step 4: Build**

```bash
cd frontend
npx ng build --configuration=development
```

Esperado: build limpo.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/coach/plan-builder/
git commit -m "feat(plan-builder): secao Recordes de Forca (lista + tendencia)"
```

---

## Task 11: Frontend — gráfico de evolução por movimento (coach)

**Files:**
- Modify: `frontend/src/app/features/coach/plan-builder/plan-builder.component.html`
- Modify: `frontend/src/app/features/coach/plan-builder/plan-builder.component.ts`

**Interfaces:**
- Consumes: `prByMovement()`, `selectedPRMovementId` (Task 10).
- Produces: nada consumido por outra task — ponta final da UI do coach.

- [ ] **Step 1: Helper de altura das barras**

Em `frontend/src/app/features/coach/plan-builder/plan-builder.component.ts`, adicionar (perto de `prByMovement`):

```typescript
  selectedPRHistory = computed(() => {
    const id = this.selectedPRMovementId();
    if (!id) return null;
    return this.prByMovement().find(m => m.movementId === id) ?? null;
  });

  prBarHeight(record: PersonalRecord, maxValue: number): number {
    const value = record.loadKg ?? record.reps ?? 0;
    return maxValue > 0 ? (value / maxValue) * 100 : 0;
  }

  formatPRDate(iso: string): string {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }
```

- [ ] **Step 2: Template — gráfico expandido abaixo da lista**

Em `frontend/src/app/features/coach/plan-builder/plan-builder.component.html`, dentro do bloco da Task 10, logo depois do `@for (item of prByMovement()...)` que fecha o grid (depois do `</div>` do `grid grid-cols-1 md:grid-cols-2`), adicionar:

```html
            @if (selectedPRHistory(); as selected) {
              <div class="mt-3 bg-surface-container rounded-sm p-4 animate-fade-in">
                <p class="text-on-surface-variant text-[10px] font-headline uppercase tracking-widest mb-3">
                  {{ selected.movementName }} — evolução
                </p>
                <div class="flex items-end gap-2 h-24 mb-1">
                  @for (record of selected.history; track record.id) {
                    <div class="flex-1 flex flex-col items-center justify-end gap-1 h-full" [title]="formatPRDate(record.achievedAt) + ': ' + (record.loadKg ?? record.reps) + (record.loadKg ? 'kg' : ' reps')">
                      <div class="w-full bg-primary-fixed rounded-t-sm transition-all" [style.height.%]="prBarHeight(record, selected.best)"></div>
                    </div>
                  }
                </div>
                <div class="flex gap-2">
                  @for (record of selected.history; track record.id) {
                    <span class="flex-1 text-center text-outline text-[9px] font-headline">{{ formatPRDate(record.achievedAt) }}</span>
                  }
                </div>
              </div>
            }
```

- [ ] **Step 3: Build**

```bash
cd frontend
npx ng build --configuration=development
```

Esperado: build limpo.

- [ ] **Step 4: Teste manual**

Login como coach, abrir Planos de um aluno com PRs registrados, expandir "Recordes de Força", clicar num movimento, confirmar que o gráfico de barras aparece com a evolução real.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/coach/plan-builder/
git commit -m "feat(plan-builder): grafico de evolucao por movimento (Recordes de Forca)"
```

---

## Task 12: Revisão final e merge

**Files:** nenhum arquivo novo — task de fechamento.

- [ ] **Step 1: Rodar a suíte de testes do backend inteira**

```bash
cd backend
source ~/.nvm/nvm.sh && nvm use 20
npm run test
```

Esperado: todos os specs (incluindo os novos de `movements`/`personal-records`) passando, nenhuma regressão.

- [ ] **Step 2: Rodar os dois builds**

```bash
cd backend && npm run build
cd ../frontend && npx ng build --configuration=development
```

Esperado: ambos limpos.

- [ ] **Step 3: Rodar a skill `security-review` no diff acumulado de cada repo**

Focar em: checagem de dono em `GET /personal-records/student/:studentId/history` (coach só vê aluno próprio), `POST /movements` restrito a coach, `POST /personal-records` restrito a atleta, validação de "pelo menos um entre loadKg/reps" checada no backend.

- [ ] **Step 4: Abrir PRs (backend e frontend) e mergear**

Seguir o fluxo já estabelecido no projeto: push da branch, `gh pr create` com o template padrão, revisão, merge squash, `git pull` no `main` de cada repo, reiniciar os servidores locais com o código final.

- [ ] **Step 5: Rodar o seed do catálogo global (Task 6) no ambiente que for usado pra testar/demonstrar**, se ainda não tiver sido rodado nesse banco.

- [ ] **Step 6: Atualizar a memória do projeto**

Registrar em `project_aevonfit.md`: feature de Recordes Pessoais implementada e mergeada, catálogo global com 23 movimentos seedados, telas novas (`/athlete/records` e seção no `plan-builder`).
