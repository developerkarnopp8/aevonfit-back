# Painel de Administração (admin/root) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Papel novo `admin` com painel próprio pra criar/gerenciar contas de coach (criar, resetar senha, ligar/desligar a importação de PDF por coach), mais notificação pro admin quando o crédito da API da Anthropic esgota, e uma mensagem clara de "fale com o suporte" pro coach quando a IA falha por qualquer motivo de sistema (não por PDF ruim).

**Architecture:** Backend ganha módulo novo `src/admin/` (controller+service atrás de `@Roles('admin')`), migration aditiva no `User`/`Role`, e mudanças em `PdfImportService` pra checar a flag por coach e categorizar erro (PDF ruim vs sistema, com notificação condicional pro admin). Frontend ganha `AdminShellComponent` novo (mesmo padrão de `CoachShellComponent`), tela `/admin/coaches`, e um terceiro toggle "Admin" na tela de login (achado técnico: o login bloqueia no client se o papel devolvido pela API não bater com o toggle selecionado).

**Tech Stack:** NestJS + Prisma (backend), Angular 21 + Reactive Forms (frontend). Sem dependência nova.

**Spec:** `backend/docs/superpowers/specs/2026-08-27-painel-admin-root-design.md`

## Global Constraints

- Toda rota `/admin/*` atrás de `@Roles('admin')` + `JwtAuthGuard` + `RolesGuard`
- `PATCH /admin/coaches/:id` só aceita o campo `aiImportEnabled` — não vira update genérico de usuário
- Senha gerada com `crypto.randomBytes(18).toString('base64url')` (mesma função já usada em `scripts/seed-production.ts`, agora extraída pra um helper compartilhado), devolvida uma única vez na resposta HTTP, nunca logada nem persistida em texto puro
- `aiImportEnabled` no `User` — `Boolean @default(true)`, só relevante pra `role: 'coach'`
- `PdfImportService` categoriza erro em 3 grupos: PDF inválido (422, já existe, sem mudança), recurso desativado por coach (403, novo), qualquer outra falha de IA (503, novo — substitui o 502 genérico atual)
- Notificação pro admin (`ai_credit_exhausted`) só quando `err instanceof Anthropic.BadRequestError` **e** a mensagem contém `"credit balance"` (case-insensitive) — nenhum outro tipo de falha notifica
- Antes de criar notificação `ai_credit_exhausted`, checar se já existe uma não-lida do mesmo tipo pro mesmo admin — não duplicar
- Migration gerada via container-sombra descartável (nunca `migrate dev` não-interativo, nunca `shadow-database-url` apontando pro banco real)

---

## Backend (`aevonfit-back`)

### Task 1: Migration — `Role` ganha `admin`, `User` ganha `aiImportEnabled`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_admin_role_and_ai_flag/migration.sql` (gerado, não escrito à mão)

**Interfaces:**
- Produces: enum `Role` com `admin` além de `coach`/`athlete`; campo `User.aiImportEnabled: boolean`, usado pelas Tasks 3 e 5

- [ ] **Step 1: Editar o schema**

Em `prisma/schema.prisma`, localizar:

```prisma
enum Role {
  coach
  athlete
}
```

Substituir por:

```prisma
enum Role {
  coach
  athlete
  admin
}
```

Localizar o `model User` (por volta da linha 34) e adicionar o campo novo logo depois de `role`:

```prisma
model User {
  id           String   @id @default(uuid())
  name         String
  email        String   @unique
  passwordHash String
  role         Role     @default(athlete)
  aiImportEnabled Boolean @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
```

- [ ] **Step 2: Gerar o diff da migration via container-sombra descartável (nunca contra o banco real)**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use v20.20.0

# Sobe um Postgres descartável só pra gerar o diff
docker run -d --name aevonfit-shadow-tmp -e POSTGRES_PASSWORD=shadow -p 5439:5432 postgres:16-alpine
sleep 3

npx prisma migrate diff \
  --from-url "postgresql://postgres:password@localhost:5434/aevonfit" \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://postgres:shadow@localhost:5439/postgres" \
  --script > /tmp/admin-role-migration-diff.sql

cat /tmp/admin-role-migration-diff.sql

docker rm -f aevonfit-shadow-tmp
```

- [ ] **Step 3: Revisar o SQL gerado**

Ler `/tmp/admin-role-migration-diff.sql` — deve conter só `ALTER TYPE "Role" ADD VALUE 'admin'` e `ALTER TABLE "User" ADD COLUMN "aiImportEnabled" BOOLEAN NOT NULL DEFAULT true`. **Nenhum `DROP` deve aparecer.** Se aparecer qualquer coisa além desses dois comandos aditivos, parar e reportar — não prosseguir.

- [ ] **Step 4: Criar a pasta de migration e aplicar**

```bash
mkdir -p "prisma/migrations/$(date +%Y%m%d%H%M%S)_add_admin_role_and_ai_flag"
cp /tmp/admin-role-migration-diff.sql "prisma/migrations/$(date +%Y%m%d%H%M%S)_add_admin_role_and_ai_flag/migration.sql"
npx prisma migrate deploy
npx prisma generate
```

(O nome exato da pasta com timestamp pode variar entre os dois comandos `date +%Y%m%d%H%M%S` acima rodados em momentos diferentes — se isso acontecer, ajustar o `cp` pra usar a mesma pasta criada pelo `mkdir`, não rodar `date` duas vezes. Mais simples: guardar o timestamp numa variável antes.)

```bash
TS=$(date +%Y%m%d%H%M%S)
mkdir -p "prisma/migrations/${TS}_add_admin_role_and_ai_flag"
cp /tmp/admin-role-migration-diff.sql "prisma/migrations/${TS}_add_admin_role_and_ai_flag/migration.sql"
npx prisma migrate deploy
npx prisma generate
```

- [ ] **Step 5: Confirmar que o build e a suíte completa continuam passando**

```bash
npm run build
npm test
```

Expected: build limpo, suíte completa passando (o schema mudou mas nenhum teste existente depende do enum/campo novos ainda).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(admin): migration — Role ganha admin, User ganha aiImportEnabled"
```

---

### Task 2: Helper compartilhado de geração de senha forte

**Files:**
- Create: `src/common/generate-strong-password.ts`
- Modify: `scripts/seed-production.ts`

**Interfaces:**
- Produces: `generateStrongPassword(): string` — usado pela Task 3 (`AdminService`) e pela Task 7 (`create-first-admin.ts`)

- [ ] **Step 1: Criar o helper**

Criar `src/common/generate-strong-password.ts`:

```ts
import * as crypto from 'crypto';

/** Senha forte aleatória — mesmo padrão já usado em scripts/seed-production.ts. */
export function generateStrongPassword(): string {
  return crypto.randomBytes(18).toString('base64url');
}
```

- [ ] **Step 2: Atualizar `scripts/seed-production.ts` pra usar o helper**

Em `scripts/seed-production.ts`, substituir:

```ts
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

function generateStrongPassword(): string {
  return crypto.randomBytes(18).toString('base64url');
}
```

por:

```ts
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { generateStrongPassword } from '../src/common/generate-strong-password';

const prisma = new PrismaClient();
```

Nenhuma outra linha do arquivo muda — o resto do script já chama `generateStrongPassword()` normalmente.

- [ ] **Step 3: Confirmar que compila e a suíte passa**

```bash
npx tsc --noEmit -p tsconfig.json
npm test
```

Expected: sem erro de tipo, suíte passando (nenhum teste cobre `scripts/`, é script standalone).

- [ ] **Step 4: Commit**

```bash
git add src/common/generate-strong-password.ts scripts/seed-production.ts
git commit -m "refactor(admin): extrai generateStrongPassword pra helper compartilhado"
```

---

### Task 3: `AdminService` — CRUD de coach

**Files:**
- Create: `src/admin/admin.service.ts`
- Create: `src/admin/dto/admin.dto.ts`
- Test: `src/admin/admin.service.spec.ts`

**Interfaces:**
- Consumes: `generateStrongPassword()` (Task 2)
- Produces: `AdminService.listCoaches(): Promise<CoachListItem[]>`, `AdminService.createCoach(dto: CreateCoachDto): Promise<{ id: string; name: string; email: string; password: string }>`, `AdminService.resetCoachPassword(id: string): Promise<{ password: string }>`, `AdminService.toggleCoachAi(id: string, aiImportEnabled: boolean): Promise<{ id: string; aiImportEnabled: boolean }>` — usados pela Task 4 (controller)

- [ ] **Step 1: Escrever os DTOs**

Criar `src/admin/dto/admin.dto.ts`:

```ts
import { IsString, IsEmail, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCoachDto {
  @ApiProperty({ example: 'Luan Silveira' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'luan@aevonfit.com' })
  @IsEmail()
  email: string;
}

export class ToggleCoachAiDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  aiImportEnabled: boolean;
}
```

- [ ] **Step 2: Escrever o teste (TDD)**

Criar `src/admin/admin.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'coach-1', name: 'Luan Silveira', email: 'luan@aevonfit.com', aiImportEnabled: true, createdAt: new Date('2026-01-01') },
        ]),
        findUnique: jest.fn().mockResolvedValue({ id: 'coach-1', role: 'coach' }),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'coach-2', name: 'Nova Coach', email: 'nova@aevonfit.com' }),
        update: jest.fn().mockResolvedValue({ id: 'coach-1', passwordHash: 'hash' }),
      },
    };

    const module = await Test.createTestingModule({
      providers: [AdminService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(AdminService);
  });

  it('lista só usuários com role coach', async () => {
    const result = await service.listCoaches();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: 'coach' } }),
    );
    expect(result).toEqual([
      { id: 'coach-1', name: 'Luan Silveira', email: 'luan@aevonfit.com', aiImportEnabled: true, createdAt: new Date('2026-01-01') },
    ]);
  });

  it('cria coach novo com senha forte gerada, devolvida uma única vez', async () => {
    const result = await service.createCoach({ name: 'Nova Coach', email: 'nova@aevonfit.com' });

    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { email: 'nova@aevonfit.com' } });
    const createCall = prisma.user.create.mock.calls[0][0];
    expect(createCall.data.role).toBe('coach');
    expect(createCall.data.email).toBe('nova@aevonfit.com');
    expect(createCall.data.passwordHash).toBeDefined();
    expect(createCall.data.passwordHash).not.toBe(result.password); // hash, nunca a senha em texto puro
    expect(result.password.length).toBeGreaterThan(15);
    expect(result.id).toBe('coach-2');
  });

  it('lança ConflictException se o e-mail já existe, sem criar nada', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'existing' });

    await expect(service.createCoach({ name: 'X', email: 'ja-existe@aevonfit.com' })).rejects.toThrow(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('reseta a senha de um coach existente, devolvendo a senha nova uma única vez', async () => {
    const result = await service.resetCoachPassword('coach-1');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'coach-1' }, select: { role: true } });
    const updateCall = prisma.user.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: 'coach-1' });
    expect(updateCall.data.passwordHash).toBeDefined();
    expect(result.password.length).toBeGreaterThan(15);
  });

  it('lança NotFoundException ao resetar senha de coach que não existe', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.resetCoachPassword('inexistente')).rejects.toThrow(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('lança NotFoundException ao resetar senha de usuário que não é coach', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'athlete-1', role: 'athlete' });

    await expect(service.resetCoachPassword('athlete-1')).rejects.toThrow(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('liga/desliga aiImportEnabled de um coach', async () => {
    prisma.user.update.mockResolvedValue({ id: 'coach-1', aiImportEnabled: false });

    const result = await service.toggleCoachAi('coach-1', false);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'coach-1' },
      data: { aiImportEnabled: false },
      select: { id: true, aiImportEnabled: true },
    });
    expect(result).toEqual({ id: 'coach-1', aiImportEnabled: false });
  });
});
```

- [ ] **Step 3: Rodar o teste pra confirmar que falha**

```bash
npm test -- admin.service.spec.ts
```

Expected: FAIL com "Cannot find module './admin.service'"

- [ ] **Step 4: Implementar o service**

Criar `src/admin/admin.service.ts`:

```ts
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { generateStrongPassword } from '../common/generate-strong-password';
import { CreateCoachDto } from './dto/admin.dto';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async listCoaches() {
    return this.prisma.user.findMany({
      where: { role: 'coach' },
      select: { id: true, name: true, email: true, aiImportEnabled: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createCoach(dto: CreateCoachDto): Promise<{ id: string; name: string; email: string; password: string }> {
    const existing = await this.prisma.user.findFirst({ where: { email: dto.email } });
    if (existing) throw new ConflictException('E-mail já cadastrado');

    const password = generateStrongPassword();
    const coach = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'coach',
      },
    });

    return { id: coach.id, name: coach.name, email: coach.email, password };
  }

  async resetCoachPassword(id: string): Promise<{ password: string }> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!user || user.role !== 'coach') throw new NotFoundException('Coach não encontrado');

    const password = generateStrongPassword();
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(password, 10) },
    });

    return { password };
  }

  async toggleCoachAi(id: string, aiImportEnabled: boolean): Promise<{ id: string; aiImportEnabled: boolean }> {
    return this.prisma.user.update({
      where: { id },
      data: { aiImportEnabled },
      select: { id: true, aiImportEnabled: true },
    });
  }
}
```

- [ ] **Step 5: Rodar o teste pra confirmar que passa**

```bash
npm test -- admin.service.spec.ts
```

Expected: PASS (7 testes)

- [ ] **Step 6: Commit**

```bash
git add src/admin/admin.service.ts src/admin/dto/admin.dto.ts src/admin/admin.service.spec.ts
git commit -m "feat(admin): AdminService — listar, criar, resetar senha, ligar/desligar IA por coach"
```

---

### Task 4: `AdminController`, `AdminModule` e registro no `AppModule`

**Files:**
- Create: `src/admin/admin.controller.ts`
- Create: `src/admin/admin.module.ts`
- Test: `src/admin/admin.controller.spec.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `AdminService` (Task 3)
- Produces: rotas `GET/POST /admin/coaches`, `POST /admin/coaches/:id/reset-password`, `PATCH /admin/coaches/:id`

- [ ] **Step 1: Escrever o teste de guards/roles (mesmo padrão de `workout-skips.controller.spec.ts`)**

Criar `src/admin/admin.controller.spec.ts`:

```ts
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminController } from './admin.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

describe('AdminController — guards e roles', () => {
  it('aplica JwtAuthGuard e RolesGuard no controller inteiro', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AdminController);
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('exige role admin no controller inteiro', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, AdminController);
    expect(roles).toEqual(['admin']);
  });
});
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

```bash
npm test -- admin.controller.spec.ts
```

Expected: FAIL com "Cannot find module './admin.controller'"

- [ ] **Step 3: Implementar o controller**

Criar `src/admin/admin.controller.ts`:

```ts
import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { CreateCoachDto, ToggleCoachAiDto } from './dto/admin.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Get('coaches')
  @ApiOperation({ summary: 'Lista todos os coaches' })
  listCoaches() {
    return this.service.listCoaches();
  }

  @Post('coaches')
  @ApiOperation({ summary: 'Cria conta de coach nova, com senha forte gerada na hora' })
  createCoach(@Body() dto: CreateCoachDto) {
    return this.service.createCoach(dto);
  }

  @Post('coaches/:id/reset-password')
  @ApiOperation({ summary: 'Gera senha nova pro coach' })
  resetPassword(@Param('id') id: string) {
    return this.service.resetCoachPassword(id);
  }

  @Patch('coaches/:id')
  @ApiOperation({ summary: 'Liga/desliga a importação de PDF via IA pro coach' })
  toggleAi(@Param('id') id: string, @Body() dto: ToggleCoachAiDto) {
    return this.service.toggleCoachAi(id, dto.aiImportEnabled);
  }
}
```

Nota: `@Roles('admin')` no nível da classe (não repetido em cada método) — mesmo `RolesGuard` já existente lê metadata da classe quando o handler não tem a sua própria (`getAllAndOverride`).

- [ ] **Step 4: Implementar o módulo**

Criar `src/admin/admin.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
```

- [ ] **Step 5: Registrar em `app.module.ts`**

Adicionar o import:

```ts
import { AdminModule } from './admin/admin.module';
```

E adicionar `AdminModule` na lista de `imports`, logo após `PdfImportModule`:

```ts
    PdfImportModule,
    AdminModule,
```

- [ ] **Step 6: Rodar o teste do controller, o build e a suíte completa**

```bash
npm test -- admin.controller.spec.ts
npm run build
npm test
```

Expected: controller 2/2, build limpo, suíte completa passando.

- [ ] **Step 7: Commit**

```bash
git add src/admin/admin.controller.ts src/admin/admin.module.ts src/admin/admin.controller.spec.ts src/app.module.ts
git commit -m "feat(admin): controller, módulo e registro no AppModule"
```

---

### Task 5: `PdfImportService` — flag por coach, categorização de erro, notificação de crédito esgotado

**Files:**
- Modify: `src/pdf-import/pdf-import.service.ts`
- Modify: `src/pdf-import/pdf-import.service.spec.ts`
- Modify: `src/notifications/notifications.service.ts`
- Modify: `src/pdf-import/pdf-import.module.ts`

**Interfaces:**
- Consumes: `NotificationsService.create(userId, type, title, body?, link?)` (já existe)
- Produces: `PdfImportService.importFromPdf` passa a lançar `ForbiddenException` (flag desligada), `ServiceUnavailableException` (qualquer falha de IA que não seja PDF inválido) em vez de `BadGatewayException`

- [ ] **Step 1: Adicionar o tipo de notificação novo**

Em `src/notifications/notifications.service.ts`, localizar:

```ts
export type NotificationType = 'plan_published' | 'new_message' | 'workout_skipped' | 'new_pr';
```

Substituir por:

```ts
export type NotificationType = 'plan_published' | 'new_message' | 'workout_skipped' | 'new_pr' | 'ai_credit_exhausted';
```

- [ ] **Step 2: Atualizar o teste existente que hoje espera `BadGatewayException`**

Em `src/pdf-import/pdf-import.service.spec.ts`, no topo do arquivo, trocar o import:

```ts
import { BadGatewayException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
```

por:

```ts
import { ForbiddenException, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
```

No mock do `prisma` dentro do `beforeEach`, adicionar `user` e `notification` (o mock de `student`/`trainingPlan` já existentes continuam iguais):

```ts
  beforeEach(async () => {
    prisma = {
      student: { findUnique: jest.fn().mockResolvedValue({ userId: 'athlete-1', coachId }) },
      user: { findUnique: jest.fn().mockResolvedValue({ aiImportEnabled: true }) },
      notification: { findFirst: jest.fn().mockResolvedValue(null) },
      trainingPlan: {
        create: jest.fn().mockResolvedValue({ id: 'plan-1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    extraction = { extract: jest.fn().mockResolvedValue(validExtraction) };
    notifications = { create: jest.fn().mockResolvedValue({}) };

    const module = await Test.createTestingModule({
      providers: [
        PdfImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: AnthropicExtractionService, useValue: extraction },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(PdfImportService);
  });
```

Adicionar a declaração de `notifications` junto das outras variáveis do topo do `describe`:

```ts
describe('PdfImportService', () => {
  let service: PdfImportService;
  let prisma: any;
  let extraction: { extract: jest.Mock };
  let notifications: { create: jest.Mock };
```

E o import do `NotificationsService`, junto dos outros imports do topo do arquivo:

```ts
import { NotificationsService } from '../notifications/notifications.service';
```

Trocar o teste `'converte erro da chamada à IA em BadGatewayException (502), sem criar nada'` por:

```ts
  it('converte erro genérico da IA em ServiceUnavailableException (503), sem notificar admin', async () => {
    extraction.extract.mockRejectedValue(new Error('network error'));

    await expect(service.importFromPdf(coachId, dto, pdfBuffer)).rejects.toThrow(ServiceUnavailableException);
    expect(prisma.trainingPlan.create).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Escrever os testes novos (flag desligada, crédito esgotado)**

Adicionar, no final do `describe`, antes do `});` de fechamento:

```ts
  it('lança ForbiddenException se aiImportEnabled do coach está desligado, sem chamar a IA', async () => {
    prisma.user.findUnique.mockResolvedValue({ aiImportEnabled: false });

    await expect(service.importFromPdf(coachId, dto, pdfBuffer)).rejects.toThrow(ForbiddenException);
    expect(extraction.extract).not.toHaveBeenCalled();
  });

  it('notifica todos os admins quando o erro é de crédito esgotado da Anthropic', async () => {
    const Anthropic = require('@anthropic-ai/sdk').default;
    const creditError = new Anthropic.BadRequestError(
      400,
      { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } },
      'Your credit balance is too low to access the Anthropic API.',
      new Headers(),
    );
    extraction.extract.mockRejectedValue(creditError);
    prisma.user.findMany = jest.fn().mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);

    await expect(service.importFromPdf(coachId, dto, pdfBuffer)).rejects.toThrow(ServiceUnavailableException);

    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { role: 'admin' }, select: { id: true } });
    expect(notifications.create).toHaveBeenCalledTimes(2);
    expect(notifications.create).toHaveBeenCalledWith(
      'admin-1', 'ai_credit_exhausted', expect.any(String), expect.any(String), expect.any(String),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      'admin-2', 'ai_credit_exhausted', expect.any(String), expect.any(String), expect.any(String),
    );
  });

  it('não duplica notificação de crédito esgotado se já existe uma não-lida pro mesmo admin', async () => {
    const Anthropic = require('@anthropic-ai/sdk').default;
    const creditError = new Anthropic.BadRequestError(
      400,
      { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low.' } },
      'Your credit balance is too low.',
      new Headers(),
    );
    extraction.extract.mockRejectedValue(creditError);
    prisma.user.findMany = jest.fn().mockResolvedValue([{ id: 'admin-1' }]);
    prisma.notification.findFirst.mockResolvedValue({ id: 'ja-existe' });

    await expect(service.importFromPdf(coachId, dto, pdfBuffer)).rejects.toThrow(ServiceUnavailableException);

    expect(notifications.create).not.toHaveBeenCalled();
  });
```

- [ ] **Step 4: Rodar os testes pra confirmar que falham**

```bash
npm test -- pdf-import.service.spec.ts
```

Expected: FAIL — os testes novos e o teste alterado não batem com a implementação atual ainda (`ServiceUnavailableException` não existe no service, `aiImportEnabled`/notificação não são checados).

- [ ] **Step 5: Implementar as mudanças no service**

Reescrever `src/pdf-import/pdf-import.service.ts` por completo:

```ts
import {
  Injectable, ForbiddenException, NotFoundException,
  ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AnthropicExtractionService } from './anthropic-extraction.service';
import { ImportPdfDto } from './dto/import-pdf.dto';
import { ExtractedPlanDto, ExtractedWeekDto } from './dto/extracted-plan.dto';
import { normalizeToMonday } from '../training-plans/training-plans.service';

const SISTEMA_INDISPONIVEL_MSG =
  'Erro no sistema de importação — nossa equipe já foi avisada. Tente novamente mais tarde ou entre em contato com o suporte.';

@Injectable()
export class PdfImportService {
  constructor(
    private prisma: PrismaService,
    private extraction: AnthropicExtractionService,
    private notifications: NotificationsService,
  ) {}

  async importFromPdf(coachId: string, dto: ImportPdfDto, pdfBuffer: Buffer): Promise<{ id: string }> {
    const student = await this.prisma.student.findUnique({
      where: { id: dto.studentId },
      select: { userId: true, coachId: true },
    });
    if (!student) throw new NotFoundException('Aluno não encontrado');
    if (student.coachId !== coachId) {
      throw new ForbiddenException('Você não tem acesso a este aluno.');
    }

    const coach = await this.prisma.user.findUnique({
      where: { id: coachId },
      select: { aiImportEnabled: true },
    });
    if (!coach?.aiImportEnabled) {
      throw new ForbiddenException('Recurso desativado pra sua conta — entre em contato com o suporte.');
    }

    const raw = await this.extractWithErrorHandling(pdfBuffer);
    const extracted = await this.validateExtraction(raw);

    const month = await this.nextMonthForStudent(dto.studentId);
    const startDate = normalizeToMonday(dto.startDate);

    const plan = await this.prisma.trainingPlan.create({
      data: {
        studentId: dto.studentId,
        coachId,
        month,
        startDate,
        title: extracted.planTitle,
        published: false,
        weeks: {
          create: extracted.weeks.map(week => ({
            weekNumber: week.weekNumber,
            days: {
              create: week.days.map(day => ({
                dayOfWeek: day.dayOfWeek,
                dayIndex: day.dayIndex,
                sessions: {
                  create: day.sessions.map(session => ({
                    name: session.name,
                    type: session.type,
                    order: session.order ?? 0,
                    exercises: {
                      create: session.exercises.map(exercise => ({
                        name: exercise.name,
                        youtubeUrl: exercise.youtubeUrl,
                        sets: exercise.sets,
                        reps: exercise.reps,
                        duration: exercise.duration,
                        restSeconds: exercise.restSeconds,
                        loadPercent: exercise.loadPercent,
                        coachNotes: exercise.coachNotes,
                        order: exercise.order,
                      })),
                    },
                  })),
                },
              })),
            },
          })),
        },
      },
      select: { id: true },
    });

    return plan;
  }

  private async extractWithErrorHandling(pdfBuffer: Buffer): Promise<unknown> {
    try {
      return await this.extraction.extract(pdfBuffer);
    } catch (err) {
      if (this.isCreditExhaustedError(err)) {
        await this.notifyAdminsOfCreditExhaustion();
      }
      throw new ServiceUnavailableException(SISTEMA_INDISPONIVEL_MSG);
    }
  }

  private isCreditExhaustedError(err: unknown): boolean {
    return err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message);
  }

  private async notifyAdminsOfCreditExhaustion(): Promise<void> {
    const admins = await this.prisma.user.findMany({ where: { role: 'admin' }, select: { id: true } });
    for (const admin of admins) {
      const alreadyNotified = await this.prisma.notification.findFirst({
        where: { userId: admin.id, type: 'ai_credit_exhausted', read: false },
      });
      if (alreadyNotified) continue;

      await this.notifications.create(
        admin.id,
        'ai_credit_exhausted',
        'Crédito da IA esgotado',
        'A conta da Anthropic ficou sem crédito — a importação de PDF está fora do ar até adicionar fundo em Plans & Billing.',
        '/admin/coaches',
      );
    }
  }

  private async validateExtraction(raw: unknown): Promise<ExtractedPlanDto> {
    const instance = plainToInstance(ExtractedPlanDto, raw);
    const errors = await validate(instance);
    if (errors.length > 0 || !this.hasAtLeastOneWeek(instance)) {
      throw new UnprocessableEntityException(
        'Não consegui extrair um treino válido desse PDF — tente outro arquivo ou crie o plano manualmente.',
      );
    }
    return instance;
  }

  private hasAtLeastOneWeek(instance: ExtractedPlanDto): boolean {
    return Array.isArray(instance.weeks) && instance.weeks.length > 0
      && instance.weeks.every((w: ExtractedWeekDto) => Array.isArray(w.days) && w.days.length > 0);
  }

  /** Mesma regra já usada no modal "Novo Treino" do frontend: próximo mês ordinal livre do aluno. */
  private async nextMonthForStudent(studentId: string): Promise<number> {
    const existing = await this.prisma.trainingPlan.findMany({
      where: { studentId },
      select: { month: true },
    });
    if (existing.length === 0) return 1;
    return Math.max(...existing.map(p => p.month)) + 1;
  }
}
```

- [ ] **Step 6: Atualizar o módulo pra importar `NotificationsModule`**

Em `src/pdf-import/pdf-import.module.ts`, substituir:

```ts
import { Module } from '@nestjs/common';
import { PdfImportController } from './pdf-import.controller';
import { PdfImportService } from './pdf-import.service';
import { AnthropicExtractionService } from './anthropic-extraction.service';

@Module({
  controllers: [PdfImportController],
  providers: [PdfImportService, AnthropicExtractionService],
})
export class PdfImportModule {}
```

por:

```ts
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PdfImportController } from './pdf-import.controller';
import { PdfImportService } from './pdf-import.service';
import { AnthropicExtractionService } from './anthropic-extraction.service';

@Module({
  imports: [NotificationsModule],
  controllers: [PdfImportController],
  providers: [PdfImportService, AnthropicExtractionService],
})
export class PdfImportModule {}
```

- [ ] **Step 7: Rodar os testes pra confirmar que passam, depois a suíte completa**

```bash
npm test -- pdf-import.service.spec.ts
npm run build
npm test
```

Expected: 9/9 testes do arquivo passando, build limpo, suíte completa passando.

- [ ] **Step 8: Commit**

```bash
git add src/pdf-import/pdf-import.service.ts src/pdf-import/pdf-import.service.spec.ts src/pdf-import/pdf-import.module.ts src/notifications/notifications.service.ts
git commit -m "feat(admin): PdfImportService checa flag por coach, categoriza erro e notifica admin no crédito esgotado"
```

---

### Task 6: Script de bootstrap do primeiro admin

**Files:**
- Create: `scripts/create-first-admin.ts`

**Interfaces:**
- Consumes: `generateStrongPassword()` (Task 2)

- [ ] **Step 1: Criar o script**

Criar `scripts/create-first-admin.ts`:

```ts
/**
 * Cria a primeira conta admin do sistema — problema do ovo e da galinha
 * (o painel de admin só existe depois de logar como admin). Rodar uma
 * única vez, local ou em produção:
 *   npx ts-node scripts/create-first-admin.ts "Nome Completo" "email@exemplo.com"
 *
 * Idempotente por e-mail — se já existir conta com esse e-mail, não faz
 * nada (evita sobrescrever senha de uma conta admin já em uso).
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { generateStrongPassword } from '../src/common/generate-strong-password';

const prisma = new PrismaClient();

async function main() {
  const [name, email] = process.argv.slice(2);
  if (!name || !email) {
    console.error('Uso: npx ts-node scripts/create-first-admin.ts "Nome Completo" "email@exemplo.com"');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`⏭️  Já existe conta com o e-mail ${email} — nada foi criado.`);
    return;
  }

  const password = generateStrongPassword();
  const admin = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      role: 'admin',
    },
  });

  console.log('🎉 Conta admin criada.');
  console.log('');
  console.log(`   ${admin.email}  /  ${password}`);
  console.log('');
  console.log('Anote a senha agora — não fica salva em nenhum log nem arquivo.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add scripts/create-first-admin.ts
git commit -m "feat(admin): script de bootstrap da primeira conta admin"
```

---

## Frontend (`aevonfit-front`)

### Task 7: `UserRole` ganha `admin`, `AuthService.isAdmin()`, `adminGuard`, `ApiService` — métodos de admin

**Files:**
- Modify: `src/app/core/models/user.model.ts`
- Modify: `src/app/core/services/auth.service.ts`
- Modify: `src/app/core/guards/auth.guard.ts`
- Modify: `src/app/core/services/api.service.ts`

**Interfaces:**
- Produces: `AuthService.isAdmin(): boolean`, `adminGuard: CanActivateFn`, `ApiService.getCoaches()`, `ApiService.createCoach()`, `ApiService.resetCoachPassword()`, `ApiService.toggleCoachAi()` — usados pelas Tasks 8-10

- [ ] **Step 1: `UserRole` ganha `admin`**

Em `src/app/core/models/user.model.ts`, trocar:

```ts
export type UserRole = 'coach' | 'athlete';
```

por:

```ts
export type UserRole = 'coach' | 'athlete' | 'admin';
```

- [ ] **Step 2: `AuthService.isAdmin()`**

Em `src/app/core/services/auth.service.ts`, logo depois do método `isAthlete()` existente, adicionar:

```ts
  isAdmin(): boolean {
    return this.currentUser()?.role === 'admin';
  }
```

- [ ] **Step 3: `adminGuard`**

Em `src/app/core/guards/auth.guard.ts`, logo depois do `athleteGuard` existente, adicionar:

```ts
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAdmin()) return true;
  return router.createUrlTree([auth.isAuthenticated() ? '/login' : '/login']);
};
```

- [ ] **Step 4: Métodos novos no `ApiService`**

Em `src/app/core/services/api.service.ts`, adicionar ao final da classe (antes do fechamento `}`), as interfaces de tipo de retorno e os métodos:

```ts
  // ── Admin ────────────────────────────────────────────────────────────────

  getCoaches(): Observable<{ id: string; name: string; email: string; aiImportEnabled: boolean; createdAt: string }[]> {
    return this.http.get<{ id: string; name: string; email: string; aiImportEnabled: boolean; createdAt: string }[]>(
      `${this.base}/admin/coaches`,
    );
  }

  createCoach(name: string, email: string): Observable<{ id: string; name: string; email: string; password: string }> {
    return this.http.post<{ id: string; name: string; email: string; password: string }>(
      `${this.base}/admin/coaches`, { name, email },
    );
  }

  resetCoachPassword(id: string): Observable<{ password: string }> {
    return this.http.post<{ password: string }>(`${this.base}/admin/coaches/${id}/reset-password`, {});
  }

  toggleCoachAi(id: string, aiImportEnabled: boolean): Observable<{ id: string; aiImportEnabled: boolean }> {
    return this.http.patch<{ id: string; aiImportEnabled: boolean }>(
      `${this.base}/admin/coaches/${id}`, { aiImportEnabled },
    );
  }
```

- [ ] **Step 5: Type-check**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use v20.20.0
npx tsc --noEmit -p tsconfig.app.json
```

Expected: sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/app/core/models/user.model.ts src/app/core/services/auth.service.ts src/app/core/guards/auth.guard.ts src/app/core/services/api.service.ts
git commit -m "feat(admin): UserRole/isAdmin/adminGuard/ApiService — base pro painel de admin"
```

---

### Task 8: Login ganha o terceiro toggle "Admin"

**Files:**
- Modify: `src/app/features/auth/login/login.component.ts`
- Modify: `src/app/features/auth/login/login.component.html`

**Interfaces:**
- Consumes: `UserRole` (Task 7)

- [ ] **Step 1: Nenhuma mudança de lógica em `login.component.ts` é necessária**

`setRole(role: UserRole)` e `submit()` já são genéricos o bastante — `selectedRole` já é tipado como `signal<UserRole>`, que agora aceita `'admin'` automaticamente (Task 7 já mudou o tipo). Nenhum código novo aqui, só o template (Step 2) ganha o terceiro botão.

- [ ] **Step 2: Adicionar o terceiro botão no template**

Em `src/app/features/auth/login/login.component.html`, localizar o bloco do toggle:

```html
      <!-- Role Toggle -->
      <div class="flex bg-surface-container rounded-sm p-1 mb-6">
        <button type="button"
          (click)="setRole('coach')"
          class="flex-1 py-2 rounded-sm text-[11px] font-headline font-bold uppercase tracking-wider transition-all duration-200"
          [class.bg-primary-fixed]="selectedRole() === 'coach'"
          [class.text-on-primary-fixed]="selectedRole() === 'coach'"
          [class.text-outline]="selectedRole() !== 'coach'">
          Coach
        </button>
        <button type="button"
          (click)="setRole('athlete')"
          class="flex-1 py-2 rounded-sm text-[11px] font-headline font-bold uppercase tracking-wider transition-all duration-200"
          [class.bg-primary-fixed]="selectedRole() === 'athlete'"
          [class.text-on-primary-fixed]="selectedRole() === 'athlete'"
          [class.text-outline]="selectedRole() !== 'athlete'">
          Atleta
        </button>
      </div>
```

Substituir por (mesmo padrão, terceiro botão adicionado):

```html
      <!-- Role Toggle -->
      <div class="flex bg-surface-container rounded-sm p-1 mb-6">
        <button type="button"
          (click)="setRole('coach')"
          class="flex-1 py-2 rounded-sm text-[11px] font-headline font-bold uppercase tracking-wider transition-all duration-200"
          [class.bg-primary-fixed]="selectedRole() === 'coach'"
          [class.text-on-primary-fixed]="selectedRole() === 'coach'"
          [class.text-outline]="selectedRole() !== 'coach'">
          Coach
        </button>
        <button type="button"
          (click)="setRole('athlete')"
          class="flex-1 py-2 rounded-sm text-[11px] font-headline font-bold uppercase tracking-wider transition-all duration-200"
          [class.bg-primary-fixed]="selectedRole() === 'athlete'"
          [class.text-on-primary-fixed]="selectedRole() === 'athlete'"
          [class.text-outline]="selectedRole() !== 'athlete'">
          Atleta
        </button>
        <button type="button"
          (click)="setRole('admin')"
          class="flex-1 py-2 rounded-sm text-[11px] font-headline font-bold uppercase tracking-wider transition-all duration-200"
          [class.bg-primary-fixed]="selectedRole() === 'admin'"
          [class.text-on-primary-fixed]="selectedRole() === 'admin'"
          [class.text-outline]="selectedRole() !== 'admin'">
          Admin
        </button>
      </div>
```

- [ ] **Step 3: Atualizar a mensagem de erro de papel trocado em `AuthService.login()`**

Em `src/app/core/services/auth.service.ts` (já modificado na Task 7, arquivo já staged/commitado — esta é uma edição adicional no mesmo arquivo), localizar:

```ts
        map(res => {
          if (res.user.role !== expectedRole) {
            throw new Error(
              expectedRole === 'coach'
                ? 'Este e-mail pertence a um atleta. Use o acesso Atleta.'
                : 'Este e-mail pertence a um coach. Use o acesso Coach.',
            );
          }
```

Substituir por:

```ts
        map(res => {
          if (res.user.role !== expectedRole) {
            const labels: Record<string, string> = { coach: 'Coach', athlete: 'Atleta', admin: 'Admin' };
            throw new Error(
              `Este e-mail pertence a um perfil diferente. Use o acesso ${labels[res.user.role] ?? res.user.role}.`,
            );
          }
```

- [ ] **Step 4: Redirecionamento pós-login pro admin**

Em `src/app/features/auth/login/login.component.ts`, localizar `submit()`:

```ts
    this.auth.login(email, password, this.selectedRole()).subscribe({
      next: () => {
        this.loading.set(false);
        this.router.navigate([
          this.selectedRole() === 'coach' ? '/coach/dashboard' : '/athlete/home',
        ]);
      },
```

Substituir por:

```ts
    this.auth.login(email, password, this.selectedRole()).subscribe({
      next: () => {
        this.loading.set(false);
        const role = this.selectedRole();
        const destination = role === 'coach' ? '/coach/dashboard' : role === 'admin' ? '/admin/coaches' : '/athlete/home';
        this.router.navigate([destination]);
      },
```

- [ ] **Step 5: Type-check e build**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use v20.20.0
npx tsc --noEmit -p tsconfig.app.json
npm run build
```

Expected: sem erro de tipo, build limpo (`/admin/coaches` ainda não existe como rota — isso não quebra o build, só o link ficaria morto até a Task 10 registrar a rota).

- [ ] **Step 6: Commit**

```bash
git add src/app/features/auth/login/login.component.ts src/app/features/auth/login/login.component.html src/app/core/services/auth.service.ts
git commit -m "feat(admin): terceiro toggle Admin na tela de login"
```

---

### Task 9: `AdminShellComponent` e rota `/admin`

**Files:**
- Create: `src/app/layout/admin-shell/admin-shell.component.ts`
- Create: `src/app/layout/admin-shell/admin-shell.component.html`
- Create: `src/app/layout/admin-shell/admin-shell.component.scss`
- Modify: `src/app/app.routes.ts`

**Interfaces:**
- Consumes: `adminGuard` (Task 7)
- Produces: rota `/admin/coaches` (componente carregado pela Task 10)

- [ ] **Step 1: Criar o componente de shell (skeleton mínimo, mesmo padrão visual do `CoachShellComponent` simplificado — sem modal de plano, sem sino de PDF)**

Criar `src/app/layout/admin-shell/admin-shell.component.ts`:

```ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { NotificationsBellComponent } from '../../shared/components/notifications-bell/notifications-bell.component';

@Component({
  selector: 'app-admin-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, NotificationsBellComponent],
  templateUrl: './admin-shell.component.html',
  styleUrl: './admin-shell.component.scss',
})
export class AdminShellComponent {
  constructor(public auth: AuthService) {}

  logout(): void {
    this.auth.logout();
  }
}
```

- [ ] **Step 2: Template do shell**

Criar `src/app/layout/admin-shell/admin-shell.component.html`:

```html
<div class="flex min-h-screen bg-background">

  <!-- Sidebar -->
  <aside class="hidden md:flex w-64 h-screen flex-shrink-0 border-r border-outline-variant/10 bg-background flex-col py-8">
    <div class="px-6 mb-8 flex items-start justify-between">
      <div>
        <h1 class="text-xl font-bold text-on-surface font-headline">Admin</h1>
        <p class="text-[10px] text-primary-fixed tracking-widest uppercase font-headline mt-0.5">PulseRx</p>
      </div>
      <app-notifications-bell />
    </div>

    <nav class="flex-1 px-4 flex flex-col gap-1">
      <a routerLink="/admin/coaches"
        class="flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-headline text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors">
        <span class="material-symbols-outlined text-[20px]">group</span>
        Coaches
      </a>
    </nav>

    <div class="px-4 mt-auto">
      <button type="button" (click)="logout()"
        class="w-full flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-headline text-on-surface-variant hover:text-error transition-colors">
        <span class="material-symbols-outlined text-[20px]">logout</span>
        Sair
      </button>
    </div>
  </aside>

  <!-- Content -->
  <main class="flex-1 overflow-y-auto">
    <router-outlet />
  </main>

</div>
```

- [ ] **Step 3: SCSS do shell (mesmo padrão já documentado no CLAUDE.md — `:host` precisa de `display:block;height:100vh` pra participar do layout, achado repetido várias vezes neste projeto)**

Criar `src/app/layout/admin-shell/admin-shell.component.scss`:

```scss
:host {
  display: block;
  height: 100vh;
  overflow: hidden;
}
```

- [ ] **Step 4: Registrar a rota**

Em `src/app/app.routes.ts`, adicionar o import no topo:

```ts
import { authGuard, coachGuard, athleteGuard, adminGuard } from './core/guards/auth.guard';
```

E adicionar o bloco de rota novo, logo antes de `{ path: '**', redirectTo: 'login' }`:

```ts
  {
    path: 'admin',
    loadComponent: () =>
      import('./layout/admin-shell/admin-shell.component').then(m => m.AdminShellComponent),
    canActivate: [authGuard, adminGuard],
    children: [
      { path: '', redirectTo: 'coaches', pathMatch: 'full' },
      {
        path: 'coaches',
        loadComponent: () =>
          import('./features/admin/coaches/coaches.component').then(m => m.CoachesComponent)
      },
    ]
  },

  { path: '**', redirectTo: 'login' }
```

(O arquivo `coaches.component.ts` ainda não existe — é criado na Task 10. O build vai falhar até lá; é esperado, a Task 10 é a próxima e completa o par.)

- [ ] **Step 5: Commit**

```bash
git add src/app/layout/admin-shell/ src/app/app.routes.ts
git commit -m "feat(admin): AdminShellComponent e rota /admin"
```

(Sem verificação de build aqui — a rota referencia um componente que só existe depois da Task 10, próxima. Verificação de build acontece no fim da Task 10.)

---

### Task 10: Tela `/admin/coaches` — lista, criar, resetar senha, toggle de IA

**Files:**
- Create: `src/app/features/admin/coaches/coaches.component.ts`
- Create: `src/app/features/admin/coaches/coaches.component.html`
- Create: `src/app/features/admin/coaches/coaches.component.scss`

**Interfaces:**
- Consumes: `ApiService.getCoaches/createCoach/resetCoachPassword/toggleCoachAi` (Task 7)

- [ ] **Step 1: Implementar o componente (mesmo padrão de `students.component.ts` — signals, form no constructor, tratamento de erro via `err?.error?.message`)**

Criar `src/app/features/admin/coaches/coaches.component.ts`:

```ts
import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';

interface Coach {
  id: string;
  name: string;
  email: string;
  aiImportEnabled: boolean;
  createdAt: string;
}

@Component({
  selector: 'app-coaches',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './coaches.component.html',
  styleUrl: './coaches.component.scss',
})
export class CoachesComponent implements OnInit {
  coaches      = signal<Coach[]>([]);
  showModal    = signal(false);
  saving       = signal(false);
  errorMsg     = signal('');
  togglingId   = signal<string | null>(null);
  resettingId  = signal<string | null>(null);
  revealedPassword = signal<{ email: string; password: string } | null>(null);

  form!: FormGroup;

  constructor(
    private api: ApiService,
    private fb: FormBuilder,
  ) {
    this.form = this.fb.group({
      name:  ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
    });
  }

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.api.getCoaches().subscribe(list => this.coaches.set(list));
  }

  openModal(): void {
    this.form.reset();
    this.errorMsg.set('');
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
    this.saving.set(false);
    this.errorMsg.set('');
  }

  createCoach(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.saving.set(true);
    this.errorMsg.set('');
    const { name, email } = this.form.value as { name: string; email: string };

    this.api.createCoach(name, email).subscribe({
      next: coach => {
        this.closeModal();
        this.revealedPassword.set({ email: coach.email, password: coach.password });
        this.load();
      },
      error: err => {
        const msg = err?.error?.message;
        this.errorMsg.set(Array.isArray(msg) ? msg[0] : (msg ?? 'Erro ao criar coach.'));
        this.saving.set(false);
      },
    });
  }

  resetPassword(coach: Coach): void {
    if (!confirm(`Resetar a senha de ${coach.name}? A senha atual deixa de funcionar imediatamente.`)) return;
    this.resettingId.set(coach.id);
    this.api.resetCoachPassword(coach.id).subscribe({
      next: res => {
        this.resettingId.set(null);
        this.revealedPassword.set({ email: coach.email, password: res.password });
      },
      error: () => this.resettingId.set(null),
    });
  }

  toggleAi(coach: Coach): void {
    this.togglingId.set(coach.id);
    const next = !coach.aiImportEnabled;
    this.api.toggleCoachAi(coach.id, next).subscribe({
      next: () => {
        this.togglingId.set(null);
        this.coaches.update(list => list.map(c => c.id === coach.id ? { ...c, aiImportEnabled: next } : c));
      },
      error: () => this.togglingId.set(null),
    });
  }

  dismissRevealedPassword(): void {
    this.revealedPassword.set(null);
  }

  getInitials(name: string): string {
    return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
  }
}
```

- [ ] **Step 2: Template**

Criar `src/app/features/admin/coaches/coaches.component.html`:

```html
<div class="px-8 py-6 animate-fade-in">

  <!-- Header -->
  <div class="flex items-center justify-between mb-6">
    <div>
      <p class="text-outline text-[10px] font-headline uppercase tracking-widest mb-1">Admin</p>
      <h2 class="font-headline font-black text-3xl text-on-surface tracking-tighter leading-none">Coaches</h2>
    </div>
    <button type="button" (click)="openModal()"
      class="bg-primary-fixed hover:bg-primary-dim text-on-primary-fixed font-headline font-black text-xs uppercase tracking-tighter px-5 py-3 rounded-sm flex items-center gap-2 transition-all">
      <span class="material-symbols-outlined text-[18px]">add</span>
      Novo Coach
    </button>
  </div>

  <!-- Senha revelada (única vez) -->
  @if (revealedPassword(); as revealed) {
    <div class="bg-primary-fixed/10 border border-primary-fixed/30 rounded-md p-5 mb-6 flex items-start justify-between gap-4">
      <div>
        <p class="text-primary-fixed text-xs font-headline font-bold uppercase tracking-widest mb-2">Anote agora — não aparece de novo</p>
        <p class="text-on-surface text-sm">{{ revealed.email }}</p>
        <p class="text-on-surface font-headline font-black text-lg tracking-wider">{{ revealed.password }}</p>
      </div>
      <button type="button" (click)="dismissRevealedPassword()"
        class="text-outline hover:text-on-surface transition-colors">
        <span class="material-symbols-outlined text-[20px]">close</span>
      </button>
    </div>
  }

  <!-- Lista -->
  <div class="bg-surface-container-low rounded-md overflow-hidden">
    @if (coaches().length === 0) {
      <p class="text-outline text-sm px-5 py-8 text-center">Nenhum coach cadastrado ainda.</p>
    } @else {
      @for (coach of coaches(); track coach.id) {
        <div class="flex items-center gap-4 px-5 py-4 border-b border-outline-variant/10 last:border-0">
          <div class="w-9 h-9 rounded-full bg-primary-fixed/20 flex items-center justify-center text-xs font-headline font-black text-primary-fixed flex-shrink-0">
            {{ getInitials(coach.name) }}
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-on-surface font-headline font-bold text-sm truncate">{{ coach.name }}</p>
            <p class="text-outline text-xs truncate">{{ coach.email }}</p>
          </div>

          <div class="flex items-center gap-2 flex-shrink-0">
            <span class="text-outline text-[10px] font-headline uppercase tracking-widest">Importação de PDF</span>
            <button type="button"
              [disabled]="togglingId() === coach.id"
              (click)="toggleAi(coach)"
              class="w-11 h-6 rounded-full relative transition-colors disabled:opacity-50"
              [class.bg-primary-fixed]="coach.aiImportEnabled"
              [class.bg-surface-container]="!coach.aiImportEnabled">
              <span class="absolute top-0.5 w-5 h-5 rounded-full bg-on-primary-fixed transition-all"
                [class.left-[22px]]="coach.aiImportEnabled"
                [class.left-0.5]="!coach.aiImportEnabled"></span>
            </button>
          </div>

          <button type="button"
            [disabled]="resettingId() === coach.id"
            (click)="resetPassword(coach)"
            class="text-[11px] font-headline font-bold uppercase tracking-wider text-outline hover:text-on-surface disabled:opacity-50 transition-colors px-3 py-1.5 flex-shrink-0">
            Resetar senha
          </button>
        </div>
      }
    }
  </div>

  <!-- Modal: Novo Coach -->
  @if (showModal()) {
    <div class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 animate-fade-in"
         (click)="closeModal()">
      <div class="bg-surface-container-low rounded-md w-full max-w-md p-6 animate-slide-up mx-4"
           (click)="$event.stopPropagation()">

        <div class="flex items-center justify-between mb-5">
          <h3 class="font-headline font-black text-xl text-on-surface tracking-tighter">Novo Coach</h3>
          <button type="button" (click)="closeModal()"
            class="w-8 h-8 rounded-sm bg-surface-container flex items-center justify-center text-outline hover:text-on-surface transition-colors">
            <span class="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <form [formGroup]="form" (ngSubmit)="createCoach()" novalidate>
          <div class="mb-4">
            <label class="block text-on-surface-variant text-[10px] font-headline uppercase tracking-widest mb-1.5">Nome *</label>
            <input formControlName="name" type="text"
              class="w-full bg-surface-container text-on-surface rounded-sm px-4 py-3 text-sm"/>
            @if (form.get('name')?.invalid && form.get('name')?.touched) {
              <p class="text-error text-xs mt-1">Nome obrigatório.</p>
            }
          </div>

          <div class="mb-6">
            <label class="block text-on-surface-variant text-[10px] font-headline uppercase tracking-widest mb-1.5">E-mail *</label>
            <input formControlName="email" type="email"
              class="w-full bg-surface-container text-on-surface rounded-sm px-4 py-3 text-sm"/>
            @if (form.get('email')?.invalid && form.get('email')?.touched) {
              <p class="text-error text-xs mt-1">E-mail válido obrigatório.</p>
            }
          </div>

          @if (errorMsg()) {
            <div class="bg-error/10 border border-error/30 rounded-sm px-4 py-2 text-error text-xs mb-4">
              {{ errorMsg() }}
            </div>
          }

          <div class="flex gap-3">
            <button type="button" (click)="closeModal()"
              class="flex-1 py-3 rounded-sm border border-outline-variant/30 text-on-surface-variant hover:text-on-surface font-headline text-xs uppercase tracking-wider transition-all">
              Cancelar
            </button>
            <button type="submit" [disabled]="saving()"
              class="flex-1 py-3 rounded-sm bg-primary-fixed hover:bg-primary-dim disabled:opacity-60 text-on-primary-fixed font-headline font-black text-xs uppercase tracking-tighter transition-all">
              {{ saving() ? 'Criando...' : 'Criar Coach' }}
            </button>
          </div>
        </form>

      </div>
    </div>
  }

</div>
```

- [ ] **Step 3: SCSS (mesmo padrão já estabelecido — `:host` precisa de `flex:1; min-height:0` pra participar do layout flex do `<main>` do shell, mesmo bug já corrigido em todas as outras páginas do coach)**

Criar `src/app/features/admin/coaches/coaches.component.scss`:

```scss
:host {
  display: block;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
```

- [ ] **Step 4: Build completo**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use v20.20.0
npx tsc --noEmit -p tsconfig.app.json
npm run build
```

Expected: sem erro de tipo, build limpo — a rota `/admin/coaches` da Task 9 agora resolve pro componente real.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/admin/coaches/
git commit -m "feat(admin): tela /admin/coaches — lista, criar, resetar senha, toggle de IA"
```

---

### Task 11: Ícone da notificação de crédito esgotado no sino

**Files:**
- Modify: `src/app/shared/components/notifications-bell/notifications-bell.component.ts`
- Modify: `src/app/core/models/notification.model.ts`

**Interfaces:**
- Consumes: `NotificationType` (modelo já existente)

- [ ] **Step 1: Adicionar o tipo novo ao modelo**

Em `src/app/core/models/notification.model.ts`, trocar:

```ts
export type NotificationType = 'plan_published' | 'new_message' | 'workout_skipped' | 'new_pr';
```

por:

```ts
export type NotificationType = 'plan_published' | 'new_message' | 'workout_skipped' | 'new_pr' | 'ai_credit_exhausted';
```

O resto do arquivo (`AppNotification` interface) não muda.

- [ ] **Step 2: Adicionar o ícone no mapeamento `TYPE_ICON`**

Em `src/app/shared/components/notifications-bell/notifications-bell.component.ts`, trocar:

```ts
const TYPE_ICON: Record<NotificationType, string> = {
  plan_published: 'calendar_month',
  new_message: 'chat',
  workout_skipped: 'skip_next',
  new_pr: 'military_tech',
};
```

por:

```ts
const TYPE_ICON: Record<NotificationType, string> = {
  plan_published: 'calendar_month',
  new_message: 'chat',
  workout_skipped: 'skip_next',
  new_pr: 'military_tech',
  ai_credit_exhausted: 'credit_card_off',
};
```

(`Record<NotificationType, string>` é totalmente tipado — se a entrada nova não for adicionada aqui, o `tsc` do Step 3 já falha sozinho.)

- [ ] **Step 3: Type-check e build**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use v20.20.0
npx tsc --noEmit -p tsconfig.app.json
npm run build
```

Expected: sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/app/core/models/notification.model.ts src/app/shared/components/notifications-bell/notifications-bell.component.ts
git commit -m "feat(admin): ícone da notificação de crédito esgotado no sino"
```

---

### Task 12: Verificação manual end-to-end

**Files:** nenhum arquivo novo — task de verificação, não de código.

- [ ] **Step 1: Bootstrap do primeiro admin local**

```bash
cd backend
npx ts-node scripts/create-first-admin.ts "Seu Nome" "seu-email-admin@aevonfit.com"
```

Anotar a senha impressa.

- [ ] **Step 2: Rodar os dois servidores locais**

Backend (`npm run start:dev`) e frontend (`npx ng serve`), containers `aevonfit-db`/`aevonfit-redis` de pé.

- [ ] **Step 3: Fluxo completo via navegador (ou Chrome headless/CDP)**

1. Logar em `/login` com o toggle "Admin" e a conta criada no Step 1 → deve cair em `/admin/coaches`.
2. Criar um coach de teste → confirmar que a senha aparece uma única vez na tela, e que `GET /admin/coaches` no Swagger (`/api/docs`) mostra o coach novo.
3. Resetar a senha desse coach → confirmar nova senha revelada, logar com ela como coach (toggle "Coach") pra confirmar que funciona.
4. Desligar `aiImportEnabled` desse coach → tentar importar um PDF logado como esse coach → confirmar `403` com a mensagem "Recurso desativado... entre em contato com o suporte".
5. Ligar de novo → confirmar que a importação volta a funcionar (não precisa rodar até o fim, só confirmar que não cai mais em 403 antes de chamar a IA).

- [ ] **Step 4: Verificação da notificação de crédito esgotado (via teste unitário, não ao vivo)**

Não drenar o crédito de propósito de novo só pra testar isso — os testes automatizados da Task 5 (`notifica todos os admins quando o erro é de crédito esgotado`) já cobrem esse caminho com o erro real do SDK mockado. Confirmar que esses testes específicos passam:

```bash
npm test -- pdf-import.service.spec.ts
```

- [ ] **Step 5: Limpar dado de teste**

Deletar o coach de teste criado no Step 3 (via Prisma Studio ou script) — não é dado real, é só verificação.

- [ ] **Step 6: Reportar o resultado**

Documentar na memória do projeto se o fluxo funcionou ponta a ponta sem ajuste, ou o que precisou de correção.
