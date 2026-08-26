# Calendário de Histórico + Exportação em PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o coach e o atleta navegarem por um calendário real (datas de verdade) entre os planos/meses já existentes, direto do `plan-builder`/`weekly-view`, e exportar a grade de treino (+ progresso registrado) em PDF, por semana ou por mês.

**Architecture:** `TrainingPlan` ganha um campo `startDate` (data real de início, normalizada pra Segunda-feira). Todas as datas de semana/dia são **derivadas** de `startDate` em tempo de exibição — nunca armazenadas em `Week`/`TrainingDay`. Um componente Angular novo e compartilhado (`PlanCalendarModalComponent`) computa a cobertura de datas a partir da lista de planos já carregada (`GET /training-plans/student/:studentId`, endpoint existente) e emite `{planId, weekNumber}` ao clicar num dia — o componente pai troca o plano/semana localmente, sem navegação de rota. PDF é gerado 100% no cliente (`jspdf`), sem endpoint novo.

**Tech Stack:** NestJS + Prisma (backend), Angular 21 standalone/signals + `jspdf`/`jspdf-autotable` (frontend, dependência nova).

**Spec:** `backend/docs/superpowers/specs/2026-08-26-calendario-historico-pdf-design.md`

## Global Constraints

- Todas as datas de calendário (`startDate` e as derivadas dele) são tratadas como **valores UTC "date-only"** em todo o código — construídas via `Date.UTC(...)`/`setUTCDate`/lidas via `.getUTC*()`, tanto no backend quanto no frontend. Nunca usar `new Date(y, m-1, d)` (local) nem getters locais (`.getDate()`, `.getMonth()`) sobre uma data vinda do backend — isso causa bug de dia errado perto da meia-noite dependendo do fuso do navegador/servidor. A única exceção é "hoje" (o dia local real do usuário, pro destaque `isToday` no calendário), que usa `new Date()` local e é convertido pra uma chave `YYYY-MM-DD` do mesmo jeito antes de comparar.
- `dayIndex` já segue a convenção `1=Segunda, 2=Terça, 3=Quarta, 4=Quinta, 5=Sexta, 6=Sábado` (0=Domingo existe no enum mas não é usado na prática — ver `training-plan.dto.ts`). `startDate` representa sempre a Segunda-feira (dia com `dayIndex=1`) da Semana 1 — normalizado (snap) no backend antes de gravar, nunca confiando que o cliente já mandou uma Segunda-feira.
- Nenhum endpoint novo no backend — reusa `GET /training-plans/student/:studentId`, `GET /workout-logs/history`, `GET /workout-logs/student/:studentId/history` (já existentes).
- Migração Prisma segura: container-sombra descartável, revisão do SQL gerado (zero `DROP`), backfill explícito pra linhas existentes antes de tornar a coluna `NOT NULL`.
- Frontend não tem convenção de testes unitários (só `app.spec.ts` boilerplate existe) — verificação das tasks de frontend é build limpo (`npx ng build --configuration=development`) + verificação manual via Chrome headless/CDP, mesmo padrão já usado nesta sessão. Backend segue TDD (Jest, mock do Prisma) — convenção já estabelecida, suíte atual em 55/55.

---

## Task 1: Backend — schema `startDate` + migração segura

**Files:**
- Modify: `backend/prisma/schema.prisma`

**Interfaces:**
- Produces: `TrainingPlan.startDate: DateTime` (campo novo, `NOT NULL` após backfill).

- [ ] **Step 1: Adicionar o campo ao model `TrainingPlan`**

Em `backend/prisma/schema.prisma`, o model `TrainingPlan` atual é:

```prisma
model TrainingPlan {
  id        String   @id @default(uuid())
  studentId String
  coachId   String
  month     Int
  title     String
  published Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Relations
  student Student @relation(fields: [studentId], references: [id], onDelete: Cascade)
  coach   User    @relation("CoachPlans", fields: [coachId], references: [id])
  weeks   Week[]

  @@map("training_plans")
}
```

Adicionar `startDate` logo depois de `month`:

```prisma
model TrainingPlan {
  id        String   @id @default(uuid())
  studentId String
  coachId   String
  month     Int
  startDate DateTime
  title     String
  published Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Relations
  student Student @relation(fields: [studentId], references: [id], onDelete: Cascade)
  coach   User    @relation("CoachPlans", fields: [coachId], references: [id])
  weeks   Week[]

  @@map("training_plans")
}
```

- [ ] **Step 2: Gerar a migração pelo procedimento seguro (container-sombra descartável)**

```bash
docker run -d --name aevonfit-shadow-migration --rm \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=shadow \
  -p 57715:5432 postgres:16-alpine
sleep 4
cd backend
TIMESTAMP=$(date +%Y%m%d%H%M%S)
mkdir -p "prisma/migrations/${TIMESTAMP}_add_training_plan_start_date"
source ~/.nvm/nvm.sh && nvm use 20
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url postgresql://postgres:password@localhost:57715/shadow \
  --script > "prisma/migrations/${TIMESTAMP}_add_training_plan_start_date/migration.sql"
docker stop aevonfit-shadow-migration
```

O SQL gerado vai ter algo como `ALTER TABLE "training_plans" ADD COLUMN "startDate" TIMESTAMP(3) NOT NULL;` — isso **vai falhar** se já existir alguma linha em `training_plans` (Postgres não aceita `NOT NULL` sem `DEFAULT` numa coluna nova de tabela com dados). Editar o arquivo de migração gerado pra ficar em 3 passos:

```sql
-- 1. Coluna nullable primeiro
ALTER TABLE "training_plans" ADD COLUMN "startDate" TIMESTAMP(3);

-- 2. Backfill dos planos existentes: única fonte de verdade disponível
--    pra dado histórico é a data em que o plano foi criado no sistema.
--    date_trunc('week', ...) no Postgres normaliza pra Segunda-feira da
--    semana (ISO 8601) — mesma normalização aplicada em planos novos
--    (ver Task 2).
UPDATE "training_plans" SET "startDate" = date_trunc('week', "createdAt") WHERE "startDate" IS NULL;

-- 3. Torna obrigatório depois do backfill
ALTER TABLE "training_plans" ALTER COLUMN "startDate" SET NOT NULL;
```

Revisar o SQL final: **zero `DROP`**, as 3 instruções acima e nada mais. Se `prisma migrate diff` tiver gerado algo diferente (ex: só a versão `NOT NULL` direta), substituir manualmente pelo bloco de 3 passos acima no arquivo `migration.sql`.

- [ ] **Step 3: Aplicar a migração no banco real**

```bash
npx prisma migrate deploy
npx prisma generate
```

- [ ] **Step 4: Confirmar o backfill**

```bash
npx prisma studio &
```

Abrir a tabela `training_plans` e confirmar que os planos existentes (ex: "Mesociclo 6", "Mês 1 — Programação Gustavo") têm `startDate` preenchido (não nulo). Fechar o Prisma Studio depois.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): adiciona TrainingPlan.startDate (calendario de historico)"
```

---

## Task 2: Backend — `CreatePlanDto.startDate` + snap-to-Monday em `TrainingPlansService.create`

**Files:**
- Modify: `backend/src/training-plans/dto/training-plan.dto.ts`
- Modify: `backend/src/training-plans/training-plans.service.ts`
- Test: `backend/src/training-plans/training-plans.service.spec.ts`

**Interfaces:**
- Consumes: `TrainingPlan.startDate` (Task 1).
- Produces: `CreatePlanDto.startDate: string` (ISO date, ex: `"2026-03-10"` — exatamente o valor cru de um `<input type="date">`, sem hora/timezone). `TrainingPlansService.create()` passa a normalizar e gravar `startDate`.

- [ ] **Step 1: Escrever o teste que falha**

Em `backend/src/training-plans/training-plans.service.spec.ts`, adicionar um novo `describe` no fim do arquivo (depois do último já existente):

```typescript
describe('TrainingPlansService.create — normalização de startDate', () => {
  let service: TrainingPlansService;
  let prisma: any;

  beforeEach(async () => {
    const txPlan = { id: 'plan-1' };
    const tx = {
      trainingPlan: {
        create: jest.fn().mockResolvedValue(txPlan),
        findUnique: jest.fn().mockResolvedValue({ id: 'plan-1', weeks: [] }),
      },
      week: { create: jest.fn().mockResolvedValue({ id: 'week-1' }) },
      trainingDay: { createMany: jest.fn() },
    };
    prisma = {
      student: { findUnique: jest.fn().mockResolvedValue({ userId: 'athlete-1' }) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      __tx: tx,
    };

    const module = await Test.createTestingModule({
      providers: [TrainingPlansService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(TrainingPlansService);
  });

  it('normaliza uma quarta-feira (2026-03-11) pra a segunda-feira da mesma semana (2026-03-09)', async () => {
    await service.create('coach-1', {
      studentId: 'student-1', month: 1, title: 'Mesociclo 1', startDate: '2026-03-11',
    } as any);

    const dataGravada = prisma.__tx.trainingPlan.create.mock.calls[0][0].data;
    expect(dataGravada.startDate.toISOString().slice(0, 10)).toBe('2026-03-09');
  });

  it('mantém uma segunda-feira (2026-03-09) igual', async () => {
    await service.create('coach-1', {
      studentId: 'student-1', month: 1, title: 'Mesociclo 1', startDate: '2026-03-09',
    } as any);

    const dataGravada = prisma.__tx.trainingPlan.create.mock.calls[0][0].data;
    expect(dataGravada.startDate.toISOString().slice(0, 10)).toBe('2026-03-09');
  });

  it('normaliza um domingo (2026-03-15) pra a segunda-feira ANTERIOR (2026-03-09), não a próxima', async () => {
    await service.create('coach-1', {
      studentId: 'student-1', month: 1, title: 'Mesociclo 1', startDate: '2026-03-15',
    } as any);

    const dataGravada = prisma.__tx.trainingPlan.create.mock.calls[0][0].data;
    expect(dataGravada.startDate.toISOString().slice(0, 10)).toBe('2026-03-09');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd backend
source ~/.nvm/nvm.sh && nvm use 20
npx jest training-plans.service.spec.ts -t "normalização de startDate"
```

Esperado: FALHA — `create()` ainda não aceita/normaliza `startDate` (o DTO nem tem o campo ainda), ou o `data` gravado não bate com a data normalizada.

- [ ] **Step 3: Adicionar `startDate` ao DTO**

Em `backend/src/training-plans/dto/training-plan.dto.ts`, o `CreatePlanDto` atual é:

```typescript
export class CreatePlanDto {
  @ApiProperty({ description: 'ID do aluno' })
  @IsString()
  studentId: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  month: number;

  @ApiProperty({ example: 'Mês 1 — Programação Gustavo' })
  @IsString()
  title: string;
}
```

Adicionar `startDate`, importando `IsDateString` de `class-validator` (adicionar ao import já existente no topo do arquivo):

```typescript
export class CreatePlanDto {
  @ApiProperty({ description: 'ID do aluno' })
  @IsString()
  studentId: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  month: number;

  @ApiProperty({ example: '2026-03-09', description: 'Data de início real (Segunda-feira da Semana 1) — string YYYY-MM-DD, normalizada no backend' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: 'Mês 1 — Programação Gustavo' })
  @IsString()
  title: string;
}
```

O import no topo do arquivo passa de:
```typescript
import {
  IsString, IsNumber, IsBoolean, IsOptional, IsEnum,
  IsUrl, IsArray, ValidateNested, Min, Max,
} from 'class-validator';
```
para:
```typescript
import {
  IsString, IsNumber, IsBoolean, IsOptional, IsEnum,
  IsUrl, IsArray, ValidateNested, Min, Max, IsDateString,
} from 'class-validator';
```

- [ ] **Step 4: Normalizar e gravar `startDate` em `TrainingPlansService.create`**

Em `backend/src/training-plans/training-plans.service.ts`, o método `create` atual começa assim:

```typescript
  async create(coachId: string, dto: CreatePlanDto) {
    const student = await this.prisma.student.findUnique({
      where: { id: dto.studentId },
      select: { userId: true },
    });
    if (!student) throw new NotFoundException('Aluno não encontrado');
    const athleteId = student.userId;

    const WEEKS = 4;
    const DAYS = [
      { dayOfWeek: 'Segunda', dayIndex: 1 },
      { dayOfWeek: 'Terça',   dayIndex: 2 },
      { dayOfWeek: 'Quarta',  dayIndex: 3 },
      { dayOfWeek: 'Quinta',  dayIndex: 4 },
      { dayOfWeek: 'Sexta',   dayIndex: 5 },
      { dayOfWeek: 'Sábado',  dayIndex: 6 },
    ];

    return this.prisma.$transaction(async tx => {
      const plan = await tx.trainingPlan.create({
        data: { ...dto, coachId },
      });
```

`data: { ...dto, coachId }` espalha `dto.startDate` como a string crua — precisa virar a `Date` normalizada antes. Trocar por:

```typescript
  async create(coachId: string, dto: CreatePlanDto) {
    const student = await this.prisma.student.findUnique({
      where: { id: dto.studentId },
      select: { userId: true },
    });
    if (!student) throw new NotFoundException('Aluno não encontrado');
    const athleteId = student.userId;

    const WEEKS = 4;
    const DAYS = [
      { dayOfWeek: 'Segunda', dayIndex: 1 },
      { dayOfWeek: 'Terça',   dayIndex: 2 },
      { dayOfWeek: 'Quarta',  dayIndex: 3 },
      { dayOfWeek: 'Quinta',  dayIndex: 4 },
      { dayOfWeek: 'Sexta',   dayIndex: 5 },
      { dayOfWeek: 'Sábado',  dayIndex: 6 },
    ];

    const startDate = normalizeToMonday(dto.startDate);

    return this.prisma.$transaction(async tx => {
      const plan = await tx.trainingPlan.create({
        data: { ...dto, coachId, startDate },
      });
```

E adicionar a função `normalizeToMonday` no topo do arquivo (fora da classe, perto de `fullPlanInclude`):

```typescript
/**
 * Normaliza uma data "YYYY-MM-DD" pra a Segunda-feira (dayIndex=1) da mesma
 * semana, em UTC — nunca em fuso local, pra não depender do fuso do
 * servidor. dayIndex já segue 1=Segunda...6=Sábado (0=Domingo, no enum mas
 * não usado na prática), então startDate SEMPRE representa uma Segunda.
 */
function normalizeToMonday(isoDateOnly: string): Date {
  const [y, m, d] = isoDateOnly.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = date.getUTCDay(); // 0=Dom, 1=Seg, ..., 6=Sáb
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  date.setUTCDate(date.getUTCDate() + diffToMonday);
  return date;
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

```bash
npx jest training-plans.service.spec.ts -t "normalização de startDate"
```

Esperado: PASS (3 testes).

- [ ] **Step 6: Rodar a suíte completa**

```bash
npm run test
```

Esperado: todos os specs passando, nenhuma regressão (suíte cresce de 55 pra 58).

- [ ] **Step 7: Build do backend**

```bash
npm run build
```

Esperado: limpo.

- [ ] **Step 8: Commit**

```bash
git add src/training-plans/dto/training-plan.dto.ts src/training-plans/training-plans.service.ts src/training-plans/training-plans.service.spec.ts
git commit -m "feat(training-plans): CreatePlanDto.startDate normalizado pra Segunda-feira"
```

---

## Task 3: Frontend — utilitário de datas compartilhado (`date-key.ts`)

**Files:**
- Create: `frontend/src/app/shared/utils/date-key.ts`

**Interfaces:**
- Produces: `utcDate(year, month, day): Date`, `addUtcDays(date, days): Date`, `toDateKey(date): string` (UTC — só pra datas sintéticas derivadas de `startDate`), `dateKeyFromIso(iso): string`, `utcDateFromIso(iso): Date`, `toLocalDateKey(date): string` (fuso local — pra timestamps reais como `WorkoutLog.completedAt`), `todayLocalKey(): string`. Usado pelo `PlanCalendarModalComponent` (Task 6), pelas Tasks 7/8 (workoutDates) e por `plan-pdf-export.ts` (Task 9).

- [ ] **Step 1: Criar o arquivo**

`frontend/src/app/shared/utils/date-key.ts`:

```typescript
/**
 * Utilitários de data "date-only" em UTC — evita bug de dia errado perto da
 * meia-noite causado por diferença de fuso entre o servidor (que grava
 * startDate normalizado em UTC) e o navegador do usuário. Nunca usar
 * `new Date(y, m-1, d)` (fuso local) nem getters locais (.getDate(),
 * .getMonth()) sobre uma data vinda do backend — só os métodos abaixo ou
 * os equivalentes `getUTC*`/`setUTC*` nativos.
 */

/** Constrói uma Date em UTC a partir de ano/mês(1-based)/dia. */
export function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** Soma (ou subtrai, com número negativo) dias a uma data UTC. */
export function addUtcDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Formata uma Date como "YYYY-MM-DD", lendo os componentes em UTC. */
export function toDateKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Extrai a chave "YYYY-MM-DD" de uma string ISO vinda do backend (ex: "2026-03-09T00:00:00.000Z" -> "2026-03-09"). */
export function dateKeyFromIso(iso: string): string {
  return iso.slice(0, 10);
}

/** Constrói uma Date UTC a partir da chave "YYYY-MM-DD" de uma string ISO do backend. */
export function utcDateFromIso(iso: string): Date {
  const [y, m, d] = dateKeyFromIso(iso).split('-').map(Number);
  return utcDate(y, m, d);
}

/**
 * Chave "YYYY-MM-DD" do dia LOCAL (fuso do navegador) de uma Date qualquer.
 * Usar pra timestamps REAIS (ex: WorkoutLog.completedAt — o momento em que
 * o atleta de fato registrou o treino) — diferente de `toDateKey`, que é
 * pra datas SINTÉTICAS derivadas de `startDate` (sempre UTC). Comparar uma
 * chave `toDateKey` com uma `toLocalDateKey` funciona: as duas produzem
 * "YYYY-MM-DD" representando o dia de calendário pretendido de cada lado,
 * só o método de extração muda conforme a natureza do dado.
 */
export function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Chave "YYYY-MM-DD" do dia local ATUAL do usuário — atalho pra `toLocalDateKey(new Date())`. */
export function todayLocalKey(): string {
  return toLocalDateKey(new Date());
}
```

- [ ] **Step 2: Build do frontend (confirma que o arquivo compila e não quebra nada)**

```bash
cd frontend
source ~/.nvm/nvm.sh && nvm use 20
npx ng build --configuration=development
```

Esperado: limpo (o arquivo ainda não é importado em nenhum lugar, mas precisa compilar sozinho sem erro de sintaxe/tipo).

- [ ] **Step 3: Commit**

```bash
git add src/app/shared/utils/date-key.ts
git commit -m "feat(shared): utilitario de datas UTC date-only (date-key.ts)"
```

---

## Task 4: Frontend — `TrainingPlan.startDate` no model + `ApiService` (createPlan, getStudentWorkoutHistory)

**Files:**
- Modify: `frontend/src/app/core/models/training.model.ts`
- Modify: `frontend/src/app/core/services/api.service.ts`

**Interfaces:**
- Consumes: `CreatePlanDto.startDate` (Task 2).
- Produces: `TrainingPlan.startDate: string`; `ApiService.createPlan(studentId, title, month, startDate)`; `ApiService.getStudentWorkoutHistory(studentId, limit)`.

- [ ] **Step 1: Adicionar `startDate` ao model `TrainingPlan`**

Em `frontend/src/app/core/models/training.model.ts`, o `TrainingPlan` atual é:

```typescript
export interface TrainingPlan {
  id: string;
  studentId: string;
  coachId: string;
  month: number;
  title: string;
  published: boolean;
  weeks: Week[];
}
```

Vira:

```typescript
export interface TrainingPlan {
  id: string;
  studentId: string;
  coachId: string;
  month: number;
  startDate: string;
  title: string;
  published: boolean;
  weeks: Week[];
}
```

- [ ] **Step 2: Atualizar `RawPlan`, `mapPlan` e `createPlan` em `api.service.ts`**

Em `frontend/src/app/core/services/api.service.ts`, `interface RawPlan` atual:

```typescript
interface RawPlan {
  id: string;
  studentId: string;
  coachId: string;
  month: number;
  title: string;
  published: boolean;
  weeks: RawWeek[];
}
```

Vira:

```typescript
interface RawPlan {
  id: string;
  studentId: string;
  coachId: string;
  month: number;
  startDate: string;
  title: string;
  published: boolean;
  weeks: RawWeek[];
}
```

`mapPlan` atual:

```typescript
  private mapPlan(p: RawPlan): TrainingPlan {
    return {
      id:        p.id,
      studentId: p.studentId,
      coachId:   p.coachId,
      month:     p.month,
      title:     p.title,
      published: p.published,
      weeks:     (p.weeks ?? []).map(w => ({
```

Vira (adiciona `startDate: p.startDate,` depois de `month`):

```typescript
  private mapPlan(p: RawPlan): TrainingPlan {
    return {
      id:        p.id,
      studentId: p.studentId,
      coachId:   p.coachId,
      month:     p.month,
      startDate: p.startDate,
      title:     p.title,
      published: p.published,
      weeks:     (p.weeks ?? []).map(w => ({
```

`createPlan` atual:

```typescript
  /** Cria novo plano de treino para um aluno */
  createPlan(studentId: string, title: string, month: number): Observable<TrainingPlan> {
    return this.http
      .post<RawPlan>(`${this.base}/training-plans`, { studentId, title, month })
      .pipe(map(p => this.mapPlan(p)));
  }
```

Vira:

```typescript
  /** Cria novo plano de treino para um aluno */
  createPlan(studentId: string, title: string, month: number, startDate: string): Observable<TrainingPlan> {
    return this.http
      .post<RawPlan>(`${this.base}/training-plans`, { studentId, title, month, startDate })
      .pipe(map(p => this.mapPlan(p)));
  }
```

- [ ] **Step 3: Extrair o mapper de `WorkoutLogEntry` e adicionar `getStudentWorkoutHistory`**

`getWorkoutHistory` atual:

```typescript
  /** Atleta: histórico completo de treinos */
  getWorkoutHistory(limit = 200): Observable<WorkoutLogEntry[]> {
    return this.http
      .get<RawWorkoutLog[]>(`${this.base}/workout-logs/history?limit=${limit}`)
      .pipe(map(list => list.map(l => ({
        id:           l.id,
        exerciseId:   l.exerciseId,
        exerciseName: l.exercise?.name ?? '',
        sessionName:  l.exercise?.session?.name ?? '',
        sessionType:  l.exercise?.session?.type ?? '',
        completedAt:  new Date(l.completedAt),
        setsCompleted: l.setsCompleted,
        notes:        l.notes ?? undefined,
      }))));
  }
```

Vira (extrai o mapeamento inline pra um método privado reusável, e adiciona `getStudentWorkoutHistory` logo abaixo, mesmo padrão de `getStudentIntakeHistory`/`getStudentPersonalRecordsHistory` já existentes):

```typescript
  /** Atleta: histórico completo de treinos */
  getWorkoutHistory(limit = 200): Observable<WorkoutLogEntry[]> {
    return this.http
      .get<RawWorkoutLog[]>(`${this.base}/workout-logs/history?limit=${limit}`)
      .pipe(map(list => list.map(l => this.mapWorkoutLogEntry(l))));
  }

  /** Coach: histórico completo de treinos de um aluno específico (dono via ownership check no backend) */
  getStudentWorkoutHistory(studentId: string, limit = 500): Observable<WorkoutLogEntry[]> {
    return this.http
      .get<RawWorkoutLog[]>(`${this.base}/workout-logs/student/${studentId}/history?limit=${limit}`)
      .pipe(map(list => list.map(l => this.mapWorkoutLogEntry(l))));
  }

  private mapWorkoutLogEntry(l: RawWorkoutLog): WorkoutLogEntry {
    return {
      id:           l.id,
      exerciseId:   l.exerciseId,
      exerciseName: l.exercise?.name ?? '',
      sessionName:  l.exercise?.session?.name ?? '',
      sessionType:  l.exercise?.session?.type ?? '',
      completedAt:  new Date(l.completedAt),
      setsCompleted: l.setsCompleted,
      notes:        l.notes ?? undefined,
    };
  }
```

- [ ] **Step 4: Build do frontend**

```bash
cd frontend
npx ng build --configuration=development
```

Esperado: **vai falhar** neste ponto — `coach-shell.component.ts` chama `this.api.createPlan(studentId, title, month)` com 3 argumentos, e a assinatura agora exige 4 (`startDate` obrigatório). Isso é esperado e corrigido na Task 5. Confirmar que o erro é exatamente esse (TS2554: Expected 4 arguments, but got 3) — se for outro erro, investigar antes de continuar.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/models/training.model.ts src/app/core/services/api.service.ts
git commit -m "feat(api): TrainingPlan.startDate + createPlan(startDate) + getStudentWorkoutHistory"
```

---

## Task 5: Frontend — modal "Novo Treino": campo "Mês" vira "Data de Início"

**Files:**
- Modify: `frontend/src/app/layout/coach-shell/coach-shell.component.ts`
- Modify: `frontend/src/app/layout/coach-shell/coach-shell.component.html`

**Interfaces:**
- Consumes: `ApiService.createPlan(studentId, title, month, startDate)` (Task 4), `date-key.ts` (Task 3).
- Produces: nada consumido por outra task.

- [ ] **Step 1: Trocar o `FormGroup` e a lógica de auto-sugestão**

Em `frontend/src/app/layout/coach-shell/coach-shell.component.ts`, adicionar o import do utilitário de datas no topo:

```typescript
import { addUtcDays, toDateKey, utcDateFromIso } from '../../shared/utils/date-key';
```

O construtor atual monta o form assim:

```typescript
    this.form = this.fb.group({
      studentId: ['', Validators.required],
      title:     ['Mês 1 — Treino', Validators.required],
      month:     [1,  [Validators.required, Validators.min(1), Validators.max(12)]],
    });

    // Atualiza o título automaticamente quando o mês muda (se ainda não foi editado pelo usuário).
    // Só dispara em edição manual do usuário — updates programáticos (auto-sugestão de mês) usam emitEvent: false.
    this.form.get('month')!.valueChanges.subscribe((m: number) => {
      this.monthTouchedByUser = true;
      this.applyDefaultTitle(m);
    });

    // Ao trocar o atleta, busca os planos já existentes dele — evita que o coach
    // tente criar um plano num mês que já tem um (o que hoje só redireciona pro
    // existente sem deixar claro que é um plano diferente do que ele estava vendo).
    this.form.get('studentId')!.valueChanges.subscribe((studentId: string) => {
      this.existingPlansForStudent.set([]);
      if (!studentId) return;
      this.loadingExistingPlans.set(true);
      this.api.getPlansByStudent(studentId).subscribe({
        next: plans => {
          this.existingPlansForStudent.set(plans);
          this.loadingExistingPlans.set(false);
          if (!this.monthTouchedByUser) {
            const nextMonth = plans.length ? Math.max(...plans.map(p => p.month)) + 1 : 1;
            this.form.get('month')!.setValue(nextMonth, { emitEvent: false });
            this.applyDefaultTitle(nextMonth);
          }
        },
        error: () => this.loadingExistingPlans.set(false),
      });
    });
  }

  private applyDefaultTitle(month: number): void {
    const titleCtrl = this.form.get('title')!;
    const current = titleCtrl.value as string;
    if (!current || /^Mês \d+ — Treino$/.test(current)) {
      titleCtrl.setValue(`Mês ${month || 1} — Treino`, { emitEvent: false });
    }
  }
```

Trocar por (o campo `month` sai do `FormGroup` reativo — vira um valor calculado internamente, `computedMonth`; `startDate` entra como novo `FormControl`; `applyDefaultTitle` passa a reagir a `startDate`):

```typescript
    this.form = this.fb.group({
      studentId: ['', Validators.required],
      title:     ['Mesociclo 1', Validators.required],
      startDate: ['', Validators.required],
    });

    // Atualiza o título automaticamente quando a data muda (se ainda não foi editado pelo usuário).
    // Só dispara em edição manual do usuário — updates programáticos (auto-sugestão) usam emitEvent: false.
    this.form.get('startDate')!.valueChanges.subscribe(() => {
      this.startDateTouchedByUser = true;
      this.applyDefaultTitle(this.computedMonth());
    });

    // Ao trocar o atleta, busca os planos já existentes dele — evita que o coach
    // tente criar um plano num mês que já tem um (o que hoje só redireciona pro
    // existente sem deixar claro que é um plano diferente do que ele estava vendo),
    // e auto-sugere a data de início como o dia seguinte ao fim do último plano.
    this.form.get('studentId')!.valueChanges.subscribe((studentId: string) => {
      this.existingPlansForStudent.set([]);
      if (!studentId) return;
      this.loadingExistingPlans.set(true);
      this.api.getPlansByStudent(studentId).subscribe({
        next: plans => {
          this.existingPlansForStudent.set(plans);
          this.loadingExistingPlans.set(false);
          const nextMonth = plans.length ? Math.max(...plans.map(p => p.month)) + 1 : 1;
          this.computedMonth.set(nextMonth);
          if (!this.startDateTouchedByUser) {
            const suggested = this.suggestNextStartDate(plans);
            this.form.get('startDate')!.setValue(suggested, { emitEvent: false });
            this.applyDefaultTitle(nextMonth);
          }
        },
        error: () => this.loadingExistingPlans.set(false),
      });
    });
  }

  /** Dia seguinte ao fim do último plano do aluno (startDate + semanas*7 dias), ou hoje se não há nenhum plano ainda. */
  private suggestNextStartDate(plans: TrainingPlan[]): string {
    if (!plans.length) return toDateKey(new Date());
    const last = plans.reduce((a, b) => (a.startDate > b.startDate ? a : b));
    const lastStart = utcDateFromIso(last.startDate);
    const end = addUtcDays(lastStart, last.weeks.length * 7);
    return toDateKey(end);
  }

  private applyDefaultTitle(month: number): void {
    const titleCtrl = this.form.get('title')!;
    const current = titleCtrl.value as string;
    if (!current || /^Mesociclo \d+$/.test(current)) {
      titleCtrl.setValue(`Mesociclo ${month || 1}`, { emitEvent: false });
    }
  }
```

- [ ] **Step 2: Adicionar os novos campos de estado**

Onde hoje está:

```typescript
  // Planos já existentes do aluno selecionado no modal — evita duplicata/redirecionamento surpresa
  existingPlansForStudent = signal<TrainingPlan[]>([]);
  loadingExistingPlans = signal(false);
  private monthTouchedByUser = false;
```

Trocar por:

```typescript
  // Planos já existentes do aluno selecionado no modal — evita duplicata/redirecionamento surpresa
  existingPlansForStudent = signal<TrainingPlan[]>([]);
  loadingExistingPlans = signal(false);
  computedMonth = signal(1); // número ordinal interno — não aparece mais no formulário
  private startDateTouchedByUser = false;
```

- [ ] **Step 3: Ajustar `openModal()`**

Atual:

```typescript
  openModal(): void {
    this.existingPlansForStudent.set([]);
    this.form.reset({ studentId: '', title: 'Mês 1 — Treino', month: 1 });
    // reset() acima dispara valueChanges do campo mês, que marcaria monthTouchedByUser
    // como true — por isso essa flag só é zerada DEPOIS do reset, não antes.
    this.monthTouchedByUser = false;
    this.showNewPlanModal.set(true);
  }
```

Vira:

```typescript
  openModal(): void {
    this.existingPlansForStudent.set([]);
    this.computedMonth.set(1);
    this.form.reset({ studentId: '', title: 'Mesociclo 1', startDate: '' });
    // reset() acima dispara valueChanges do campo startDate, que marcaria
    // startDateTouchedByUser como true — por isso essa flag só é zerada
    // DEPOIS do reset, não antes.
    this.startDateTouchedByUser = false;
    this.showNewPlanModal.set(true);
  }
```

- [ ] **Step 4: Ajustar `createPlan()`**

Atual:

```typescript
  createPlan(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.saving.set(true);
    const { studentId, title, month } = this.form.value as {
      studentId: string; title: string; month: number;
    };

    // Verifica se já existe plano para esse aluno/mês antes de criar duplicata
    this.api.getPlansByStudent(studentId).subscribe({
      next: existing => {
        const duplicate = existing.find(p => p.month === month);
        if (duplicate) {
          this.closeModal();
          this.showToast(`Já existe "${duplicate.title}" no Mês ${month} — nenhum plano novo foi criado. Abrindo esse plano existente.`, 5000);
          this.router.navigate(['/coach/plan-builder', studentId], {
            queryParams: { planId: duplicate.id },
          });
          return;
        }
        this.api.createPlan(studentId, title, month).subscribe({
          next: plan => {
            this.closeModal();
            this.showToast('Plano criado! Abrindo editor...');
            this.router.navigate(['/coach/plan-builder', studentId], {
              queryParams: { planId: plan.id },
            });
          },
          error: () => {
            this.saving.set(false);
            this.showToast('Erro ao criar plano. Tente novamente.');
          },
        });
      },
      error: () => {
        // Se não conseguir verificar, cria mesmo assim
        this.api.createPlan(studentId, title, month).subscribe({
          next: plan => {
            this.closeModal();
            this.showToast('Plano criado! Abrindo editor...');
            this.router.navigate(['/coach/plan-builder', studentId], {
              queryParams: { planId: plan.id },
            });
          },
          error: () => {
            this.saving.set(false);
            this.showToast('Erro ao criar plano. Tente novamente.');
          },
        });
      },
    });
  }
```

Vira (usa `this.computedMonth()` no lugar de `month` do form value, e passa `startDate` pro `createPlan` da API):

```typescript
  createPlan(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.saving.set(true);
    const { studentId, title, startDate } = this.form.value as {
      studentId: string; title: string; startDate: string;
    };
    const month = this.computedMonth();

    // Verifica se já existe plano para esse aluno/mês antes de criar duplicata
    this.api.getPlansByStudent(studentId).subscribe({
      next: existing => {
        const duplicate = existing.find(p => p.month === month);
        if (duplicate) {
          this.closeModal();
          this.showToast(`Já existe "${duplicate.title}" no Mês ${month} — nenhum plano novo foi criado. Abrindo esse plano existente.`, 5000);
          this.router.navigate(['/coach/plan-builder', studentId], {
            queryParams: { planId: duplicate.id },
          });
          return;
        }
        this.api.createPlan(studentId, title, month, startDate).subscribe({
          next: plan => {
            this.closeModal();
            this.showToast('Plano criado! Abrindo editor...');
            this.router.navigate(['/coach/plan-builder', studentId], {
              queryParams: { planId: plan.id },
            });
          },
          error: () => {
            this.saving.set(false);
            this.showToast('Erro ao criar plano. Tente novamente.');
          },
        });
      },
      error: () => {
        // Se não conseguir verificar, cria mesmo assim
        this.api.createPlan(studentId, title, month, startDate).subscribe({
          next: plan => {
            this.closeModal();
            this.showToast('Plano criado! Abrindo editor...');
            this.router.navigate(['/coach/plan-builder', studentId], {
              queryParams: { planId: plan.id },
            });
          },
          error: () => {
            this.saving.set(false);
            this.showToast('Erro ao criar plano. Tente novamente.');
          },
        });
      },
    });
  }
```

- [ ] **Step 5: Atualizar o template**

Em `frontend/src/app/layout/coach-shell/coach-shell.component.html`, o bloco "Mês + Título lado a lado" atual é:

```html
        <!-- Mês + Título lado a lado -->
        <div class="grid grid-cols-[80px_1fr] gap-3 mb-6">
          <div>
            <label class="block text-on-surface-variant text-[10px] font-headline uppercase tracking-widest mb-1.5">
              Mês *
            </label>
            <input formControlName="month" type="number" min="1" max="12"
              title="Número do mês"
              class="w-full bg-surface-container text-on-surface rounded-sm px-3 py-3 text-sm text-center"/>
            @if (form.get('month')?.invalid && form.get('month')?.touched) {
              <p class="text-error text-[10px] mt-1">1–12</p>
            }
          </div>
          <div>
            <label class="block text-on-surface-variant text-[10px] font-headline uppercase tracking-widest mb-1.5">
              Título do Plano *
            </label>
            <input formControlName="title" type="text"
              placeholder="Ex: Mês 1 — Base de Força"
              class="w-full bg-surface-container text-on-surface placeholder:text-outline rounded-sm px-3 py-3 text-sm"/>
            @if (form.get('title')?.invalid && form.get('title')?.touched) {
              <p class="text-error text-xs mt-1">Título obrigatório.</p>
            }
          </div>
        </div>
```

Vira:

```html
        <!-- Data de Início + Título lado a lado -->
        <div class="grid grid-cols-[140px_1fr] gap-3 mb-6">
          <div>
            <label class="block text-on-surface-variant text-[10px] font-headline uppercase tracking-widest mb-1.5">
              Data de Início *
            </label>
            <input formControlName="startDate" type="date"
              title="Data de início do mesociclo (ajustada pra Segunda-feira da semana)"
              class="w-full bg-surface-container text-on-surface rounded-sm px-3 py-3 text-sm"/>
            @if (form.get('startDate')?.invalid && form.get('startDate')?.touched) {
              <p class="text-error text-[10px] mt-1">Obrigatório.</p>
            }
          </div>
          <div>
            <label class="block text-on-surface-variant text-[10px] font-headline uppercase tracking-widest mb-1.5">
              Título do Plano *
            </label>
            <input formControlName="title" type="text"
              placeholder="Ex: Mesociclo 1 — Base de Força"
              class="w-full bg-surface-container text-on-surface placeholder:text-outline rounded-sm px-3 py-3 text-sm"/>
            @if (form.get('title')?.invalid && form.get('title')?.touched) {
              <p class="text-error text-xs mt-1">Título obrigatório.</p>
            }
          </div>
        </div>
```

E a lista de planos existentes já mostra `Mês {{ plan.month }} — {{ plan.title }}` — atualizar pra incluir a data:

```html
                @for (plan of existingPlansForStudent(); track plan.id) {
                  <p class="text-outline text-xs">Mês {{ plan.month }} — {{ plan.title }}</p>
                }
```

vira:

```html
                @for (plan of existingPlansForStudent(); track plan.id) {
                  <p class="text-outline text-xs">{{ plan.title }} — início {{ plan.startDate | slice:0:10 }}</p>
                }
```

- [ ] **Step 6: Build do frontend**

```bash
cd frontend
npx ng build --configuration=development
```

Esperado: limpo (o erro de `createPlan` com 3 argumentos da Task 4 já está corrigido aqui).

- [ ] **Step 7: Verificação manual via Chrome headless**

Reusar o padrão já estabelecido nesta sessão (login como coach via `POST /auth/login`, injetar token no `localStorage`, `Page.navigate` pro dashboard, clicar em "+ Novo Treino", selecionar um atleta, capturar screenshot). Confirmar: campo "Data de Início" aparece com uma data pré-preenchida (não mais o campo "Mês"), lista de planos existentes mostra a data de início de cada um.

- [ ] **Step 8: Commit**

```bash
git add src/app/layout/coach-shell/
git commit -m "feat(coach-shell): modal Novo Treino usa Data de Inicio em vez de Mes"
```

---

## Task 6: Frontend — `PlanCalendarModalComponent` (componente novo, compartilhado)

**Files:**
- Create: `frontend/src/app/shared/components/plan-calendar-modal/plan-calendar-modal.component.ts`
- Create: `frontend/src/app/shared/components/plan-calendar-modal/plan-calendar-modal.component.html`
- Create: `frontend/src/app/shared/components/plan-calendar-modal/plan-calendar-modal.component.scss`

**Interfaces:**
- Consumes: `date-key.ts` (Task 3), `TrainingPlan`/`Week`/`TrainingDay` models (`dayIndex` 1-6, `weekNumber`, `plan.startDate`).
- Produces: `PlanCalendarModalComponent` com `@Input() plans: TrainingPlan[]`, `@Input() workoutDates?: Set<string>`, `@Output() daySelected: EventEmitter<{planId: string; weekNumber: number}>`, `@Output() closed: EventEmitter<void>`. Consumido pelas Tasks 7 e 8.

- [ ] **Step 1: Componente TypeScript**

`frontend/src/app/shared/components/plan-calendar-modal/plan-calendar-modal.component.ts`:

```typescript
import { Component, EventEmitter, Input, Output, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TrainingPlan } from '../../../core/models';
import { utcDate, addUtcDays, toDateKey, utcDateFromIso, todayLocalKey } from '../../utils/date-key';

export interface CalendarDay {
  date: Date;
  dateKey: string;
  inCurrentMonth: boolean;
  planId: string | null;
  weekNumber: number | null;
  isToday: boolean;
  hasWorkoutLog: boolean;
}

@Component({
  selector: 'app-plan-calendar-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './plan-calendar-modal.component.html',
  styleUrl: './plan-calendar-modal.component.scss',
})
export class PlanCalendarModalComponent {
  @Input() plans: TrainingPlan[] = [];
  @Input() workoutDates?: Set<string>;
  @Output() daySelected = new EventEmitter<{ planId: string; weekNumber: number }>();
  @Output() closed = new EventEmitter<void>();

  viewedMonth = signal(utcDate(new Date().getFullYear(), new Date().getMonth() + 1, 1));

  /** Mapa "YYYY-MM-DD" -> {planId, weekNumber} pra todo dia (Segunda-Sábado) coberto por algum plano. */
  private coverage = computed(() => {
    const map = new Map<string, { planId: string; weekNumber: number }>();
    for (const plan of this.plans) {
      const monday1 = utcDateFromIso(plan.startDate);
      for (const week of plan.weeks) {
        for (let dayIndex = 1; dayIndex <= 6; dayIndex++) {
          const offset = (week.weekNumber - 1) * 7 + (dayIndex - 1);
          const d = addUtcDays(monday1, offset);
          map.set(toDateKey(d), { planId: plan.id, weekNumber: week.weekNumber });
        }
      }
    }
    return map;
  });

  /** Grid de 6 linhas x 7 colunas (Segunda a Domingo), sempre começando numa Segunda-feira. */
  weeks = computed<CalendarDay[][]>(() => {
    const month = this.viewedMonth();
    const year = month.getUTCFullYear();
    const monthIndex = month.getUTCMonth();
    const firstOfMonth = utcDate(year, monthIndex + 1, 1);
    const dow = firstOfMonth.getUTCDay(); // 0=Dom...6=Sáb
    const startOffset = dow === 0 ? 6 : dow - 1; // dias voltando até a Segunda que inicia a grade
    const gridStart = addUtcDays(firstOfMonth, -startOffset);

    const cov = this.coverage();
    const today = todayLocalKey();
    const wd = this.workoutDates;

    const days: CalendarDay[] = [];
    for (let i = 0; i < 42; i++) {
      const d = addUtcDays(gridStart, i);
      const key = toDateKey(d);
      const hit = cov.get(key) ?? null;
      days.push({
        date: d,
        dateKey: key,
        inCurrentMonth: d.getUTCMonth() === monthIndex,
        planId: hit?.planId ?? null,
        weekNumber: hit?.weekNumber ?? null,
        isToday: key === today,
        hasWorkoutLog: !!wd?.has(key),
      });
    }

    const rows: CalendarDay[][] = [];
    for (let i = 0; i < 42; i += 7) rows.push(days.slice(i, i + 7));
    return rows;
  });

  monthLabel = computed(() => {
    const m = this.viewedMonth();
    return new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), 1))
      .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  });

  prevMonth(): void {
    const m = this.viewedMonth();
    this.viewedMonth.set(utcDate(m.getUTCFullYear(), m.getUTCMonth(), 1));
  }

  nextMonth(): void {
    const m = this.viewedMonth();
    this.viewedMonth.set(utcDate(m.getUTCFullYear(), m.getUTCMonth() + 2, 1));
  }

  selectDay(day: CalendarDay): void {
    if (!day.planId || day.weekNumber == null) return;
    this.daySelected.emit({ planId: day.planId, weekNumber: day.weekNumber });
  }

  close(): void {
    this.closed.emit();
  }
}
```

- [ ] **Step 2: Template**

`frontend/src/app/shared/components/plan-calendar-modal/plan-calendar-modal.component.html`:

```html
<div class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 animate-fade-in" (click)="close()">
  <div class="bg-surface-container-low rounded-md w-full max-w-sm p-5 animate-slide-up mx-4" (click)="$event.stopPropagation()">

    <div class="flex items-center justify-between mb-4">
      <button type="button" (click)="prevMonth()"
        class="w-8 h-8 rounded-sm bg-surface-container flex items-center justify-center text-outline hover:text-on-surface transition-colors">
        <span class="material-symbols-outlined text-[18px]">chevron_left</span>
      </button>
      <p class="text-on-surface font-headline font-black text-sm uppercase tracking-wider capitalize">{{ monthLabel() }}</p>
      <button type="button" (click)="nextMonth()"
        class="w-8 h-8 rounded-sm bg-surface-container flex items-center justify-center text-outline hover:text-on-surface transition-colors">
        <span class="material-symbols-outlined text-[18px]">chevron_right</span>
      </button>
    </div>

    <div class="grid grid-cols-7 gap-1 mb-1">
      @for (label of ['S','T','Q','Q','S','S','D']; track $index) {
        <div class="text-center text-outline text-[10px] font-headline uppercase py-1">{{ label }}</div>
      }
    </div>

    <div class="flex flex-col gap-1">
      @for (row of weeks(); track $index) {
        <div class="grid grid-cols-7 gap-1">
          @for (day of row; track day.dateKey) {
            <button type="button"
              (click)="selectDay(day)"
              [disabled]="!day.planId"
              class="aspect-square flex items-center justify-center rounded-sm text-xs font-headline transition-all relative"
              [class.text-outline-variant]="!day.inCurrentMonth"
              [class.text-on-surface-variant]="day.inCurrentMonth && !day.planId"
              [class.text-on-surface]="day.planId"
              [class.cursor-default]="!day.planId"
              [class.bg-surface-container]="day.planId"
              [class.hover:bg-primary-fixed]="day.planId"
              [class.hover:text-on-primary-fixed]="day.planId"
              [class.ring-1]="day.isToday"
              [class.ring-primary-fixed]="day.isToday">
              {{ day.date.getUTCDate() }}
              @if (day.hasWorkoutLog) {
                <span class="absolute bottom-0.5 w-1 h-1 rounded-full bg-primary-fixed"></span>
              }
            </button>
          }
        </div>
      }
    </div>

    <button type="button" (click)="close()"
      class="w-full mt-4 py-2.5 rounded-sm border border-outline-variant/30 text-on-surface-variant hover:text-on-surface font-headline text-xs uppercase tracking-wider transition-all">
      Fechar
    </button>
  </div>
</div>
```

- [ ] **Step 3: Estilo**

`frontend/src/app/shared/components/plan-calendar-modal/plan-calendar-modal.component.scss`:

```scss
:host {
  display: contents;
}
```

- [ ] **Step 4: Build do frontend**

```bash
cd frontend
npx ng build --configuration=development
```

Esperado: limpo (componente ainda não é usado em nenhum lugar, mas precisa compilar).

- [ ] **Step 5: Commit**

```bash
git add src/app/shared/components/plan-calendar-modal/
git commit -m "feat(shared): PlanCalendarModalComponent - calendario mensal compartilhado"
```

---

## Task 7: Frontend — calendário no `plan-builder` (coach)

**Files:**
- Modify: `frontend/src/app/features/coach/plan-builder/plan-builder.component.ts`
- Modify: `frontend/src/app/features/coach/plan-builder/plan-builder.component.html`

**Interfaces:**
- Consumes: `PlanCalendarModalComponent` (Task 6), `ApiService.getPlansByStudent` (já existente).
- Produces: nada consumido por outra task.

- [ ] **Step 1: Importar o componente e adicionar estado**

Em `frontend/src/app/features/coach/plan-builder/plan-builder.component.ts`, o import de `@Component` atual é:

```typescript
import { Component, OnInit, OnChanges, signal, computed, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { TrainingPlan, Exercise, Session, SessionType, ExerciseLibraryItem, TrainingDay, PersonalRecord } from '../../../core/models';
```

Adicionar o import do modal de calendário:

```typescript
import { Component, OnInit, OnChanges, signal, computed, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { TrainingPlan, Exercise, Session, SessionType, ExerciseLibraryItem, TrainingDay, PersonalRecord } from '../../../core/models';
import { PlanCalendarModalComponent } from '../../../shared/components/plan-calendar-modal/plan-calendar-modal.component';
```

No decorator `@Component`, `imports: [CommonModule, ReactiveFormsModule]` vira `imports: [CommonModule, ReactiveFormsModule, PlanCalendarModalComponent]`.

Adicionar estado novo perto de `plan`/`selectedWeek` (linha `plan = signal<TrainingPlan | null>(null);`):

```typescript
  allPlans = signal<TrainingPlan[]>([]);
  showCalendarModal = signal(false);
```

- [ ] **Step 2: Carregar `allPlans` e implementar o handler de seleção**

Em `ngOnChanges`, onde hoje está:

```typescript
  ngOnChanges(): void {
    if (!this.studentId) return;
    this.plan.set(null);
    this.studentCurrentWeek.set(null);
    this.loading.set(true);
    this.loadPlan();
    this.api.getStudentIntakeHistory(this.studentId).subscribe(h => this.intakeHistory.set(h));
    this.api.getStudentPersonalRecordsHistory(this.studentId).subscribe(h => this.prHistory.set(h));
    this.api.getStudentWithPlan(this.studentId).subscribe(r => {
      this.studentCurrentWeek.set(r.student.currentWeek);
      this.applyDefaultWeek();
    });
  }
```

Adicionar a busca de `allPlans` (não interfere no fluxo existente, só popula o dado pro calendário):

```typescript
  ngOnChanges(): void {
    if (!this.studentId) return;
    this.plan.set(null);
    this.studentCurrentWeek.set(null);
    this.loading.set(true);
    this.loadPlan();
    this.api.getStudentIntakeHistory(this.studentId).subscribe(h => this.intakeHistory.set(h));
    this.api.getStudentPersonalRecordsHistory(this.studentId).subscribe(h => this.prHistory.set(h));
    this.api.getPlansByStudent(this.studentId).subscribe(plans => this.allPlans.set(plans));
    this.api.getStudentWithPlan(this.studentId).subscribe(r => {
      this.studentCurrentWeek.set(r.student.currentWeek);
      this.applyDefaultWeek();
    });
  }
```

Adicionar o handler do evento `daySelected`, perto de `applyDefaultWeek`:

```typescript
  onCalendarDaySelected(sel: { planId: string; weekNumber: number }): void {
    this.showCalendarModal.set(false);
    const target = this.allPlans().find(p => p.id === sel.planId);
    if (!target) return;
    this.plan.set(target);
    const idx = target.weeks.findIndex(w => w.weekNumber === sel.weekNumber);
    this.selectedWeek.set(idx >= 0 ? idx : 0);
  }
```

- [ ] **Step 3: Template — botão de calendário + modal**

Em `frontend/src/app/features/coach/plan-builder/plan-builder.component.html`, o header atual tem:

```html
      @if (plan()) {
        <div class="flex items-center gap-2 text-on-surface-variant">
          <span class="material-symbols-outlined text-[16px]">calendar_today</span>
          <span class="text-sm font-headline">Semana {{ (currentWeek()?.weekNumber ?? 1) }}</span>
        </div>
      }
```

Vira (o `<span>` de ícone estático vira um `<button>` clicável):

```html
      @if (plan()) {
        <button type="button" (click)="showCalendarModal.set(true)"
          class="flex items-center gap-2 text-on-surface-variant hover:text-on-surface transition-colors">
          <span class="material-symbols-outlined text-[16px]">calendar_month</span>
          <span class="text-sm font-headline">Semana {{ (currentWeek()?.weekNumber ?? 1) }}</span>
        </button>
      }
```

No fim do arquivo (antes do `</div>` que fecha a `<div class="flex flex-col h-full ...">` do início — ou seja, na última linha do arquivo), adicionar:

```html

@if (showCalendarModal()) {
  <app-plan-calendar-modal
    [plans]="allPlans()"
    (daySelected)="onCalendarDaySelected($event)"
    (closed)="showCalendarModal.set(false)" />
}
```

- [ ] **Step 4: Build do frontend**

```bash
cd frontend
npx ng build --configuration=development
```

Esperado: limpo.

- [ ] **Step 5: Verificação manual via Chrome headless**

Login como coach, abrir `plan-builder` de um aluno com 2+ planos (ex: Gustavo, "Mês 1" e "Mesociclo 6"), clicar no botão de calendário, confirmar que o modal abre com o grid do mês, navegar pro mês do outro plano, clicar num dia coberto, confirmar que a tela troca pro plano/semana corretos (título do plano no header muda).

- [ ] **Step 6: Commit**

```bash
git add src/app/features/coach/plan-builder/
git commit -m "feat(plan-builder): calendario de historico - navega entre planos existentes"
```

---

## Task 8: Frontend — calendário no `weekly-view` (atleta)

**Files:**
- Modify: `frontend/src/app/features/athlete/weekly-view/weekly-view.component.ts`
- Modify: `frontend/src/app/features/athlete/weekly-view/weekly-view.component.html`

**Interfaces:**
- Consumes: `PlanCalendarModalComponent` (Task 6), `ApiService.getWorkoutHistory` (já existente), `date-key.ts` (Task 3).
- Produces: nada consumido por outra task.

- [ ] **Step 1: Importar o componente e adicionar estado**

Em `frontend/src/app/features/athlete/weekly-view/weekly-view.component.ts`, o arquivo atual completo é:

```typescript
import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { TrainingPlan, TrainingDay } from '../../../core/models';

@Component({
  selector: 'app-weekly-view',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './weekly-view.component.html',
  styleUrl: './weekly-view.component.scss'
})
export class WeeklyViewComponent implements OnInit {
  plan = signal<TrainingPlan | null>(null);
  selectedWeek = signal(0);
  selectedDay = signal<TrainingDay | null>(null);

  constructor(private api: ApiService, private auth: AuthService) {}

  ngOnInit(): void {
    this.api.getMyStudentProfile().subscribe({
      next: student => {
        this.api.getPlansByStudent(student.id).subscribe({
          next: plans => {
            if (!plans.length) return;
            const plan = plans.find(p => p.month === student.currentMonth) ?? plans[0];
            this.plan.set(plan);

            const weekIndex = plan.weeks.findIndex(w => w.weekNumber === student.currentWeek);
            this.selectedWeek.set(weekIndex >= 0 ? weekIndex : 0);

            const week = plan.weeks.at(weekIndex >= 0 ? weekIndex : 0);
            const today = week?.days.find(d => d.dayIndex === new Date().getDay());
            this.selectedDay.set(today ?? week?.days[0] ?? null);
          },
        });
      },
    });
  }

  selectDay(day: TrainingDay): void { this.selectedDay.set(day); }

  getCompletionForDay(day: TrainingDay): number {
    const all = day.sessions.flatMap(s => s.exercises);
    if (!all.length) return 0;
    return Math.round((all.filter(e => e.completed).length / all.length) * 100);
  }

  isToday(day: TrainingDay): boolean {
    return day.dayIndex === new Date().getDay();
  }
}
```

Vira:

```typescript
import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { TrainingPlan, TrainingDay } from '../../../core/models';
import { PlanCalendarModalComponent } from '../../../shared/components/plan-calendar-modal/plan-calendar-modal.component';
import { toLocalDateKey } from '../../../shared/utils/date-key';

@Component({
  selector: 'app-weekly-view',
  standalone: true,
  imports: [CommonModule, RouterLink, PlanCalendarModalComponent],
  templateUrl: './weekly-view.component.html',
  styleUrl: './weekly-view.component.scss'
})
export class WeeklyViewComponent implements OnInit {
  plan = signal<TrainingPlan | null>(null);
  selectedWeek = signal(0);
  selectedDay = signal<TrainingDay | null>(null);
  allPlans = signal<TrainingPlan[]>([]);
  workoutDates = signal<Set<string>>(new Set());
  showCalendarModal = signal(false);

  constructor(private api: ApiService, private auth: AuthService) {}

  ngOnInit(): void {
    this.api.getMyStudentProfile().subscribe({
      next: student => {
        this.api.getPlansByStudent(student.id).subscribe({
          next: plans => {
            this.allPlans.set(plans);
            if (!plans.length) return;
            const plan = plans.find(p => p.month === student.currentMonth) ?? plans[0];
            this.plan.set(plan);

            const weekIndex = plan.weeks.findIndex(w => w.weekNumber === student.currentWeek);
            this.selectedWeek.set(weekIndex >= 0 ? weekIndex : 0);

            const week = plan.weeks.at(weekIndex >= 0 ? weekIndex : 0);
            const today = week?.days.find(d => d.dayIndex === new Date().getDay());
            this.selectedDay.set(today ?? week?.days[0] ?? null);
          },
        });
        this.api.getWorkoutHistory(500).subscribe(logs => {
          // toLocalDateKey (não toDateKey/UTC): completedAt é um timestamp
          // real de quando o atleta registrou o treino — o "dia" dele é o
          // dia local do atleta, não o dia UTC do instante.
          this.workoutDates.set(new Set(logs.map(l => toLocalDateKey(l.completedAt))));
        });
      },
    });
  }

  selectDay(day: TrainingDay): void { this.selectedDay.set(day); }

  onCalendarDaySelected(sel: { planId: string; weekNumber: number }): void {
    this.showCalendarModal.set(false);
    const target = this.allPlans().find(p => p.id === sel.planId);
    if (!target) return;
    this.plan.set(target);
    const idx = target.weeks.findIndex(w => w.weekNumber === sel.weekNumber);
    this.selectedWeek.set(idx >= 0 ? idx : 0);
    const week = target.weeks.at(idx >= 0 ? idx : 0);
    this.selectedDay.set(week?.days[0] ?? null);
  }

  getCompletionForDay(day: TrainingDay): number {
    const all = day.sessions.flatMap(s => s.exercises);
    if (!all.length) return 0;
    return Math.round((all.filter(e => e.completed).length / all.length) * 100);
  }

  isToday(day: TrainingDay): boolean {
    return day.dayIndex === new Date().getDay();
  }
}
```

- [ ] **Step 2: Template — botão de calendário + modal**

Em `frontend/src/app/features/athlete/weekly-view/weekly-view.component.html`, o header atual (linhas 4-10) é:

```html
  <div class="mb-5">
    <p class="text-on-surface-variant text-[10px] font-headline uppercase tracking-widest mb-1">Plano de Treino</p>
    <h2 class="font-headline font-black text-3xl text-on-surface tracking-tighter leading-none">
      Semana {{ plan()?.weeks?.at(selectedWeek())?.weekNumber ?? 1 }}
    </h2>
    <p class="text-outline text-xs mt-1">{{ plan()?.title }}</p>
  </div>
```

Vira (adiciona o botão de calendário ao lado do título):

```html
  <div class="mb-5 flex items-start justify-between">
    <div>
      <p class="text-on-surface-variant text-[10px] font-headline uppercase tracking-widest mb-1">Plano de Treino</p>
      <h2 class="font-headline font-black text-3xl text-on-surface tracking-tighter leading-none">
        Semana {{ plan()?.weeks?.at(selectedWeek())?.weekNumber ?? 1 }}
      </h2>
      <p class="text-outline text-xs mt-1">{{ plan()?.title }}</p>
    </div>
    @if (plan()) {
      <button type="button" (click)="showCalendarModal.set(true)"
        class="w-10 h-10 rounded-sm bg-surface-container-low flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors flex-shrink-0">
        <span class="material-symbols-outlined text-[20px]">calendar_month</span>
      </button>
    }
  </div>
```

No fim do arquivo, logo antes da tag `</div>` final (a que fecha `<div class="px-5 py-4 animate-fade-in">` do topo), adicionar:

```html

  @if (showCalendarModal()) {
    <app-plan-calendar-modal
      [plans]="allPlans()"
      [workoutDates]="workoutDates()"
      (daySelected)="onCalendarDaySelected($event)"
      (closed)="showCalendarModal.set(false)" />
  }
```

- [ ] **Step 3: Build do frontend**

```bash
cd frontend
npx ng build --configuration=development
```

Esperado: limpo.

- [ ] **Step 4: Verificação manual via Chrome headless**

Login como atleta, ir em "Evolução"/semanal, clicar no botão de calendário, confirmar que abre com o grid, dias com treino registrado mostram o indicador (pontinho), clicar num dia de outro mês/plano, confirmar troca.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/athlete/weekly-view/
git commit -m "feat(weekly-view): calendario de historico - navega entre planos existentes"
```

---

## Task 9: Frontend — dependência `jspdf` + utilitário `plan-pdf-export.ts`

**Files:**
- Modify: `frontend/package.json` (via `npm install`)
- Create: `frontend/src/app/shared/utils/plan-pdf-export.ts`

**Interfaces:**
- Consumes: `date-key.ts` (Task 3), `TrainingPlan`/`Week`/`WorkoutLogEntry` models.
- Produces: `exportWeekToPdf(plan, weekNumber, studentName, logs)`, `exportMonthToPdf(plan, studentName, logs)`. Consumido pelas Tasks 10 e 11.

- [ ] **Step 1: Instalar as dependências**

```bash
cd frontend
npm install jspdf jspdf-autotable
```

- [ ] **Step 2: Escrever o utilitário**

`frontend/src/app/shared/utils/plan-pdf-export.ts`:

```typescript
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { TrainingPlan, Week } from '../../core/models';
import { WorkoutLogEntry } from '../../core/services/api.service';
import { utcDateFromIso, addUtcDays, toDateKey, toLocalDateKey } from './date-key';

function formatDateBr(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${d}/${m}`;
}

function dateOfDay(planStartIso: string, weekNumber: number, dayIndex: number): Date {
  const monday1 = utcDateFromIso(planStartIso);
  return addUtcDays(monday1, (weekNumber - 1) * 7 + (dayIndex - 1));
}

/**
 * Monta as linhas da tabela pra uma semana: uma linha por exercício, com uma
 * linha extra "✓ feito..." logo abaixo quando há log do atleta casando por
 * exerciseId e caindo na data daquele dia.
 */
function buildWeekRows(plan: TrainingPlan, week: Week, logs: WorkoutLogEntry[]): (string | number)[][] {
  const rows: (string | number)[][] = [];
  for (const day of week.days) {
    const dayDate = dateOfDay(plan.startDate, week.weekNumber, day.dayIndex);
    const dayKey = toDateKey(dayDate);
    for (const session of day.sessions) {
      for (const exercise of session.exercises) {
        rows.push([
          `${day.dayOfWeek} (${formatDateBr(dayDate)})`,
          session.name,
          exercise.name,
          exercise.sets != null ? String(exercise.sets) : '-',
          exercise.reps ?? '-',
          exercise.loadPercent != null ? `${exercise.loadPercent}%` : '-',
          exercise.coachNotes ?? '',
        ]);
        // toLocalDateKey no log (timestamp real, dia local do atleta) vs.
        // dayKey em toDateKey (dia sintético UTC derivado de startDate) —
        // as duas produzem "YYYY-MM-DD" do dia de calendário pretendido,
        // só o método de extração muda conforme a natureza do dado.
        const log = logs.find(l => l.exerciseId === exercise.id && toLocalDateKey(l.completedAt) === dayKey);
        if (log) {
          rows.push(['', '', `✓ feito — ${log.setsCompleted} sets${log.notes ? ', ' + log.notes : ''}`, '', '', '', '']);
        }
      }
    }
  }
  return rows;
}

const COLUMNS = ['Dia', 'Sessão', 'Exercício', 'Sets', 'Reps', 'Carga', 'Notas'];

function baseDoc(studentName: string, planTitle: string, subtitle: string): jsPDF {
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text(studentName, 14, 18);
  doc.setFontSize(11);
  doc.text(`${planTitle} — ${subtitle}`, 14, 26);
  return doc;
}

export function exportWeekToPdf(plan: TrainingPlan, weekNumber: number, studentName: string, logs: WorkoutLogEntry[]): void {
  const week = plan.weeks.find(w => w.weekNumber === weekNumber);
  if (!week) return;
  const doc = baseDoc(studentName, plan.title, `Semana ${weekNumber}`);
  autoTable(doc, { startY: 32, head: [COLUMNS], body: buildWeekRows(plan, week, logs) });
  doc.save(`${plan.title} - Semana ${weekNumber}.pdf`);
}

export function exportMonthToPdf(plan: TrainingPlan, studentName: string, logs: WorkoutLogEntry[]): void {
  const doc = baseDoc(studentName, plan.title, 'Mês completo');
  let startY = 32;
  for (const week of plan.weeks) {
    autoTable(doc, {
      startY,
      head: [[`Semana ${week.weekNumber}`, '', '', '', '', '', '']],
      body: buildWeekRows(plan, week, logs),
      headStyles: { fillColor: [40, 40, 40] },
    });
    startY = (doc as any).lastAutoTable.finalY + 8;
  }
  doc.save(`${plan.title} - Completo.pdf`);
}
```

- [ ] **Step 3: Build do frontend**

```bash
cd frontend
npx ng build --configuration=development
```

Esperado: limpo (utilitário ainda não é chamado em nenhum lugar, mas precisa compilar — confirma que os tipos de `jspdf`/`jspdf-autotable` batem).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/app/shared/utils/plan-pdf-export.ts
git commit -m "feat(shared): utilitario de exportacao de plano em PDF (jspdf)"
```

---

## Task 10: Frontend — botões "Exportar Semana"/"Exportar Mês" no `plan-builder` (coach)

**Files:**
- Modify: `frontend/src/app/features/coach/plan-builder/plan-builder.component.ts`
- Modify: `frontend/src/app/features/coach/plan-builder/plan-builder.component.html`

**Interfaces:**
- Consumes: `exportWeekToPdf`, `exportMonthToPdf` (Task 9), `ApiService.getStudentWorkoutHistory` (Task 4).

- [ ] **Step 1: Importar o utilitário e adicionar os métodos**

Em `frontend/src/app/features/coach/plan-builder/plan-builder.component.ts`, adicionar ao topo:

```typescript
import { exportWeekToPdf, exportMonthToPdf } from '../../../shared/utils/plan-pdf-export';
```

Adicionar signal de estudante (nome, pro cabeçalho do PDF) perto de `studentCurrentWeek`:

```typescript
  studentName = signal('');
```

Em `ngOnChanges`, no bloco que já chama `this.api.getStudentWithPlan(this.studentId)`:

```typescript
    this.api.getStudentWithPlan(this.studentId).subscribe(r => {
      this.studentCurrentWeek.set(r.student.currentWeek);
      this.applyDefaultWeek();
    });
```

Vira (adiciona o nome do aluno, já vem na mesma resposta):

```typescript
    this.api.getStudentWithPlan(this.studentId).subscribe(r => {
      this.studentCurrentWeek.set(r.student.currentWeek);
      this.studentName.set(r.student.name);
      this.applyDefaultWeek();
    });
```

Adicionar os métodos de exportação, perto de `onCalendarDaySelected`:

```typescript
  exportCurrentWeekPdf(): void {
    const p = this.plan();
    const week = this.currentWeek();
    if (!p || !week) return;
    this.api.getStudentWorkoutHistory(this.studentId).subscribe(logs =>
      exportWeekToPdf(p, week.weekNumber, this.studentName(), logs));
  }

  exportCurrentMonthPdf(): void {
    const p = this.plan();
    if (!p) return;
    this.api.getStudentWorkoutHistory(this.studentId).subscribe(logs =>
      exportMonthToPdf(p, this.studentName(), logs));
  }
```

- [ ] **Step 2: Template — botões no header**

Em `frontend/src/app/features/coach/plan-builder/plan-builder.component.html`, o header atual (região dos botões, do lado direito) é:

```html
    <div class="flex items-center gap-2">
      @if (plan()?.published) {
        <span class="flex items-center gap-1.5 text-green-400 font-headline text-xs uppercase tracking-wider">
          <span class="material-symbols-outlined text-[14px]">check_circle</span>
          Publicado
        </span>
      }
      <button type="button" (click)="saveDraft()" [disabled]="!plan()"
        class="px-4 py-2 rounded-sm border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-outline font-headline text-xs uppercase tracking-wider transition-all disabled:opacity-40">
        Salvar Rascunho
      </button>
      <button type="button" (click)="publish()" [disabled]="!plan() || plan()!.published || publishing()"
        class="px-4 py-2 rounded-sm bg-primary-fixed hover:bg-primary-dim disabled:opacity-40 text-on-primary-fixed font-headline font-black text-xs uppercase tracking-tighter transition-all flex items-center gap-1.5">
        @if (publishing()) {
          <span class="material-symbols-outlined text-[14px]">progress_activity</span>
        }
        {{ plan()?.published ? 'Publicado' : (publishing() ? 'Publicando...' : 'Publicar Plano') }}
      </button>
    </div>
```

Adicionar o botão "Exportar Mês" antes de "Salvar Rascunho" (a exportação de semana fica perto do seletor de semana, ver abaixo):

```html
    <div class="flex items-center gap-2">
      @if (plan()?.published) {
        <span class="flex items-center gap-1.5 text-green-400 font-headline text-xs uppercase tracking-wider">
          <span class="material-symbols-outlined text-[14px]">check_circle</span>
          Publicado
        </span>
      }
      @if (plan()) {
        <button type="button" (click)="exportCurrentMonthPdf()"
          class="px-4 py-2 rounded-sm border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-outline font-headline text-xs uppercase tracking-wider transition-all flex items-center gap-1.5">
          <span class="material-symbols-outlined text-[14px]">picture_as_pdf</span>
          Exportar Mês
        </button>
      }
      <button type="button" (click)="saveDraft()" [disabled]="!plan()"
        class="px-4 py-2 rounded-sm border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-outline font-headline text-xs uppercase tracking-wider transition-all disabled:opacity-40">
        Salvar Rascunho
      </button>
      <button type="button" (click)="publish()" [disabled]="!plan() || plan()!.published || publishing()"
        class="px-4 py-2 rounded-sm bg-primary-fixed hover:bg-primary-dim disabled:opacity-40 text-on-primary-fixed font-headline font-black text-xs uppercase tracking-tighter transition-all flex items-center gap-1.5">
        @if (publishing()) {
          <span class="material-symbols-outlined text-[14px]">progress_activity</span>
        }
        {{ plan()?.published ? 'Publicado' : (publishing() ? 'Publicando...' : 'Publicar Plano') }}
      </button>
    </div>
```

O botão de "Exportar Semana" fica na sidebar de semanas, logo acima da lista (`<aside class="w-40 border-r ...">`):

```html
    <!-- Week Tabs sidebar -->
    <aside class="w-40 border-r border-outline-variant/10 flex-shrink-0 py-4 px-2 overflow-y-auto">
      @for (week of plan()!.weeks; track week.id; let i = $index) {
```

Vira:

```html
    <!-- Week Tabs sidebar -->
    <aside class="w-40 border-r border-outline-variant/10 flex-shrink-0 py-4 px-2 overflow-y-auto">
      <button type="button" (click)="exportCurrentWeekPdf()"
        class="w-full flex items-center gap-1.5 px-4 py-2 mb-2 text-outline hover:text-on-surface font-headline text-[10px] uppercase tracking-wider transition-colors">
        <span class="material-symbols-outlined text-[14px]">picture_as_pdf</span>
        Exportar Semana
      </button>
      @for (week of plan()!.weeks; track week.id; let i = $index) {
```

- [ ] **Step 3: Build do frontend**

```bash
cd frontend
npx ng build --configuration=development
```

Esperado: limpo.

- [ ] **Step 4: Verificação manual via Chrome headless**

Login como coach, abrir um plano, clicar "Exportar Semana" e "Exportar Mês" — como o download de arquivo não é capturável via screenshot, confirmar via `Network.enable`/console que não há erro JS lançado após o clique (o teste real de conteúdo do PDF fica pra verificação manual do usuário, fora do escopo de automação desta sessão).

- [ ] **Step 5: Commit**

```bash
git add src/app/features/coach/plan-builder/
git commit -m "feat(plan-builder): exportar semana/mes em PDF"
```

---

## Task 11: Frontend — botões "Exportar Semana"/"Exportar Mês" no `weekly-view` (atleta)

**Files:**
- Modify: `frontend/src/app/features/athlete/weekly-view/weekly-view.component.ts`
- Modify: `frontend/src/app/features/athlete/weekly-view/weekly-view.component.html`

**Interfaces:**
- Consumes: `exportWeekToPdf`, `exportMonthToPdf` (Task 9), `ApiService.getWorkoutHistory` (já existente, já usado na Task 8), `AuthService.currentUser()` (já injetado no componente).

- [ ] **Step 1: Importar o utilitário e adicionar os métodos**

Em `frontend/src/app/features/athlete/weekly-view/weekly-view.component.ts`, adicionar ao topo:

```typescript
import { exportWeekToPdf, exportMonthToPdf } from '../../../shared/utils/plan-pdf-export';
```

Adicionar os métodos, perto de `onCalendarDaySelected`:

```typescript
  exportCurrentWeekPdf(): void {
    const p = this.plan();
    const weekNumber = p?.weeks.at(this.selectedWeek())?.weekNumber;
    if (!p || weekNumber == null) return;
    this.api.getWorkoutHistory(500).subscribe(logs =>
      exportWeekToPdf(p, weekNumber, this.auth.currentUser()?.name ?? '', logs));
  }

  exportCurrentMonthPdf(): void {
    const p = this.plan();
    if (!p) return;
    this.api.getWorkoutHistory(500).subscribe(logs =>
      exportMonthToPdf(p, this.auth.currentUser()?.name ?? '', logs));
  }
```

- [ ] **Step 2: Template — botões**

No header já ajustado na Task 8:

```html
    @if (plan()) {
      <button type="button" (click)="showCalendarModal.set(true)"
        class="w-10 h-10 rounded-sm bg-surface-container-low flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors flex-shrink-0">
        <span class="material-symbols-outlined text-[20px]">calendar_month</span>
      </button>
    }
```

Vira (adiciona os dois botões de exportar ao lado do botão de calendário):

```html
    @if (plan()) {
      <div class="flex items-center gap-2 flex-shrink-0">
        <button type="button" (click)="exportCurrentWeekPdf()"
          class="w-10 h-10 rounded-sm bg-surface-container-low flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors"
          title="Exportar semana em PDF">
          <span class="material-symbols-outlined text-[20px]">picture_as_pdf</span>
        </button>
        <button type="button" (click)="showCalendarModal.set(true)"
          class="w-10 h-10 rounded-sm bg-surface-container-low flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors">
          <span class="material-symbols-outlined text-[20px]">calendar_month</span>
        </button>
      </div>
    }
```

"Exportar Mês" entra como um link de texto discreto logo abaixo do título do plano:

```html
    <p class="text-outline text-xs mt-1">{{ plan()?.title }}</p>
```

Vira:

```html
    <p class="text-outline text-xs mt-1">
      {{ plan()?.title }}
      @if (plan()) {
        <button type="button" (click)="exportCurrentMonthPdf()" class="text-primary-fixed underline ml-2">Exportar mês (PDF)</button>
      }
    </p>
```

- [ ] **Step 3: Build do frontend**

```bash
cd frontend
npx ng build --configuration=development
```

Esperado: limpo.

- [ ] **Step 4: Verificação manual via Chrome headless**

Login como atleta, ir na tela semanal, clicar nos dois botões de exportar, confirmar sem erro no console.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/athlete/weekly-view/
git commit -m "feat(weekly-view): exportar semana/mes em PDF"
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

Esperado: todos os specs passando (58/58 — os 55 já existentes + os 3 novos da Task 2), nenhuma regressão.

- [ ] **Step 2: Rodar os dois builds**

```bash
cd backend && npm run build
cd ../frontend && npx ng build --configuration=development
```

Esperado: ambos limpos.

- [ ] **Step 3: Rodar a skill `security-review` no diff acumulado de cada repo**

Backend: foco em `CreatePlanDto.startDate` (validação de formato, sem injeção) e `normalizeToMonday` (não introduz nenhuma checagem de autorização nova — `create()` já é `@Roles('coach')` de antes). Frontend: sem endpoint novo, `getStudentWorkoutHistory` reusa checagem de dono já existente no backend (`GET /workout-logs/student/:studentId/history`, coberto na revisão de segurança da feature de skip desta sessão).

- [ ] **Step 4: Abrir PRs (backend e frontend) e mergear**

Seguir o fluxo já estabelecido no projeto: push da branch, `gh pr create` com o template padrão, revisão, merge squash, `git pull` no `main` de cada repo, reiniciar os servidores locais com o código final.

- [ ] **Step 5: Atualizar a memória do projeto**

Registrar em `project_aevonfit.md`: feature de calendário de histórico + exportação em PDF implementada e mergeada, `TrainingPlan.startDate` adicionado (migração com backfill), `PlanCalendarModalComponent` (primeiro componente compartilhado entre telas de atleta e coach do projeto), `jspdf` como nova dependência do frontend.
