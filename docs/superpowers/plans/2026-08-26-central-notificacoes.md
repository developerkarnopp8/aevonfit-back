# Central de Notificações Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar função real ao sino (hoje decorativo): um painel de notificações pros dois papéis (coach e atleta), disparado por 4 eventos do sistema (plano publicado, mensagem nova, treino pulado, novo PR), em tempo real via WebSocket.

**Architecture:** Novo model `Notification` (log-por-evento). Novo `NotificationsModule` no backend, cujo `NotificationsService.create()` grava no banco e empurra em tempo real reusando o `MessagesGateway` já existente (namespace `/messages`). Quatro pontos de trigger em services já existentes chamam `NotificationsService.create()` como efeito colateral de uma ação real (nunca exposto como endpoint de criação público). Frontend ganha um componente compartilhado `NotificationsBellComponent` (sino + badge + painel, auto-contido) embutido nos dois shells.

**Tech Stack:** NestJS + Prisma + `forwardRef()` (dependência circular módulo-a-módulo, mesma técnica já usada em `MessagesService`), Angular 21 standalone/signals + Socket.IO client (já usado).

**Spec:** `backend/docs/superpowers/specs/2026-08-26-central-notificacoes-design.md`

## Global Constraints

- Nenhum endpoint público de criação de notificação — `NotificationsService.create()` só é chamado internamente por outros services, nunca por um controller que aceite payload arbitrário do cliente.
- Toda rota de `GET`/`PATCH /notifications*` opera sempre sobre `req.user.id` — nunca um `:userId` de path param (evita IDOR de notificação de outro usuário).
- "Treino pulado" gera notificação própria (`workout_skipped`), **não** conta como `new_message` — mesmo a mensagem de sistema do skip continuando a existir no chat como já é hoje.
- Comparação de "novo PR" é campo a campo (`loadKg` e `reps` independentes) — ver Task 7 pra lógica exata.
- Migração Prisma segura: container-sombra descartável, revisão do SQL gerado (zero `DROP`).
- Backend segue TDD (Jest, mock do Prisma) — suíte atual em 63/63. Frontend não tem convenção de testes unitários — verificação via build limpo + Chrome headless/CDP (lembrar de `Console.enable` no script de verificação, ver `feedback_chrome_headless_cdp_console_enable` — sem isso um erro real de console passa despercebido).

---

## Task 1: Backend — schema `Notification` + migração segura

**Files:**
- Modify: `backend/prisma/schema.prisma`

**Interfaces:**
- Produces: model `Notification` (`id, userId, type, title, body?, link?, read, createdAt`), relação reversa em `User`.

- [ ] **Step 1: Adicionar o model**

No fim de `backend/prisma/schema.prisma` (depois do último model existente):

```prisma
model Notification {
  id        String   @id @default(uuid())
  userId    String
  type      String
  title     String
  body      String?
  link      String?
  read      Boolean  @default(false)
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("notifications")
}
```

- [ ] **Step 2: Adicionar a relação reversa no model `User`**

O bloco `// Relations` dentro de `model User` hoje termina assim:

```prisma
  movements        Movement[]
  personalRecords  PersonalRecord[]

  @@map("users")
```

Adicionar uma linha:

```prisma
  movements        Movement[]
  personalRecords  PersonalRecord[]
  notifications    Notification[]

  @@map("users")
```

- [ ] **Step 3: Gerar a migração pelo procedimento seguro**

```bash
docker run -d --name aevonfit-shadow-migration --rm \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=shadow \
  -p 57716:5432 postgres:16-alpine
sleep 4
cd backend
TIMESTAMP=$(date +%Y%m%d%H%M%S)
mkdir -p "prisma/migrations/${TIMESTAMP}_add_notifications"
source ~/.nvm/nvm.sh && nvm use 20
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url postgresql://postgres:password@localhost:57716/shadow \
  --script > "prisma/migrations/${TIMESTAMP}_add_notifications/migration.sql"
docker stop aevonfit-shadow-migration
```

Revisar o SQL gerado: deve conter só `CREATE TABLE "notifications"` e `ADD CONSTRAINT` da foreign key `userId` — **zero `DROP`**. Se aparecer qualquer `DROP`, pare e não aplique.

- [ ] **Step 4: Aplicar a migração no banco real**

```bash
npx prisma migrate deploy
npx prisma generate
```

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): adiciona model Notification"
```

---

## Task 2: Backend — `NotificationsService` + `NotificationsController` (CRUD básico, sem tempo real ainda)

**Files:**
- Create: `backend/src/notifications/notifications.service.ts`
- Create: `backend/src/notifications/notifications.service.spec.ts`
- Create: `backend/src/notifications/notifications.controller.ts`
- Create: `backend/src/notifications/notifications.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService` (padrão já existente).
- Produces: `NotificationsService.create(userId, type, title, body?, link?)`, `.findAllForUser(userId)`, `.unreadCount(userId)`, `.markAsRead(id, userId)`, `.markAllAsRead(userId)`. Rotas `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`. Consumido pela Task 3 (que adiciona o gateway) e pelas Tasks 4-7 (triggers).

- [ ] **Step 1: Escrever os testes que falham**

`backend/src/notifications/notifications.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

describe('NotificationsService.create', () => {
  let service: NotificationsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { notification: { create: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [NotificationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('grava a notificacao com os campos informados', async () => {
    prisma.notification.create.mockResolvedValue({ id: 'n1' });

    await service.create('user-1', 'plan_published', 'Novo plano publicado', 'Seu coach publicou "Mesociclo 1"', '/athlete/weekly');

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'plan_published',
        title: 'Novo plano publicado',
        body: 'Seu coach publicou "Mesociclo 1"',
        link: '/athlete/weekly',
      },
    });
  });
});

describe('NotificationsService.findAllForUser', () => {
  let service: NotificationsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { notification: { findMany: jest.fn().mockResolvedValue([]) } };
    const module = await Test.createTestingModule({
      providers: [NotificationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('busca as notificacoes do proprio usuario, mais recentes primeiro, limitado a 30', async () => {
    await service.findAllForUser('user-1');

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  });
});

describe('NotificationsService.unreadCount', () => {
  let service: NotificationsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { notification: { count: jest.fn().mockResolvedValue(3) } };
    const module = await Test.createTestingModule({
      providers: [NotificationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('conta so as notificacoes nao lidas do usuario', async () => {
    const result = await service.unreadCount('user-1');

    expect(prisma.notification.count).toHaveBeenCalledWith({ where: { userId: 'user-1', read: false } });
    expect(result).toBe(3);
  });
});

describe('NotificationsService.markAsRead', () => {
  let service: NotificationsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      notification: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [NotificationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('marca como lida quando o usuario e o dono da notificacao', async () => {
    prisma.notification.findUnique.mockResolvedValue({ id: 'n1', userId: 'user-1' });
    prisma.notification.update.mockResolvedValue({ id: 'n1', read: true });

    await service.markAsRead('n1', 'user-1');

    expect(prisma.notification.update).toHaveBeenCalledWith({ where: { id: 'n1' }, data: { read: true } });
  });

  it('rejeita com ForbiddenException quando a notificacao e de outro usuario', async () => {
    prisma.notification.findUnique.mockResolvedValue({ id: 'n1', userId: 'user-9' });

    await expect(service.markAsRead('n1', 'user-1')).rejects.toThrow(ForbiddenException);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('lanca NotFoundException quando a notificacao nao existe', async () => {
    prisma.notification.findUnique.mockResolvedValue(null);

    await expect(service.markAsRead('n1', 'user-1')).rejects.toThrow(NotFoundException);
  });
});

describe('NotificationsService.markAllAsRead', () => {
  let service: NotificationsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { notification: { updateMany: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [NotificationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('marca todas as nao lidas do usuario como lidas', async () => {
    await service.markAllAsRead('user-1');

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', read: false },
      data: { read: true },
    });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

```bash
cd backend
source ~/.nvm/nvm.sh && nvm use 20
npx jest notifications.service.spec.ts
```

Esperado: FALHA — `NotificationsService` ainda não existe.

- [ ] **Step 3: Implementar o service**

`backend/src/notifications/notifications.service.ts`:

```typescript
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type NotificationType = 'plan_published' | 'new_message' | 'workout_skipped' | 'new_pr';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, type: NotificationType, title: string, body?: string, link?: string) {
    return this.prisma.notification.create({
      data: { userId, type, title, body, link },
    });
  }

  async findAllForUser(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, read: false } });
  }

  async markAsRead(id: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification) throw new NotFoundException('Notificação não encontrada');
    if (notification.userId !== userId) {
      throw new ForbiddenException('Você não tem acesso a esta notificação.');
    }
    return this.prisma.notification.update({ where: { id }, data: { read: true } });
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

```bash
npx jest notifications.service.spec.ts
```

Esperado: PASS (7 testes).

- [ ] **Step 5: Controller**

`backend/src/notifications/notifications.controller.ts`:

```typescript
import { Controller, Get, Patch, Param, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista as últimas 30 notificações do usuário autenticado' })
  findAll(@Request() req: any) {
    return this.service.findAllForUser(req.user.id);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Conta notificações não lidas' })
  async unreadCount(@Request() req: any) {
    const count = await this.service.unreadCount(req.user.id);
    return { count };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Marca uma notificação como lida' })
  markAsRead(@Param('id') id: string, @Request() req: any) {
    return this.service.markAsRead(id, req.user.id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Marca todas as notificações do usuário como lidas' })
  markAllAsRead(@Request() req: any) {
    return this.service.markAllAsRead(req.user.id);
  }
}
```

- [ ] **Step 6: Module**

`backend/src/notifications/notifications.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

- [ ] **Step 7: Registrar em `app.module.ts`**

Adicionar o import e a entrada no array `imports`, mesmo padrão dos módulos já existentes:

```typescript
import { NotificationsModule } from './notifications/notifications.module';
```

```typescript
    PersonalRecordsModule,
    NotificationsModule,
  ],
```

- [ ] **Step 8: Build e commit**

```bash
npm run build
git add src/notifications/ src/app.module.ts
git commit -m "feat(notifications): CRUD basico (create, list, unread-count, read, read-all)"
```

---

## Task 3: Backend — tempo real via WebSocket (reusa `MessagesGateway`)

**Files:**
- Modify: `backend/src/messages/messages.gateway.ts`
- Modify: `backend/src/messages/messages.module.ts`
- Modify: `backend/src/notifications/notifications.module.ts`
- Modify: `backend/src/notifications/notifications.service.ts`
- Modify: `backend/src/notifications/notifications.service.spec.ts`

**Interfaces:**
- Consumes: `MessagesGateway` (já existente).
- Produces: `MessagesGateway.emitNotification(userId, notification)`; `NotificationsService.create()` passa a emitir em tempo real além de gravar.

- [ ] **Step 1: Adicionar o método no gateway**

Em `backend/src/messages/messages.gateway.ts`, o método `emitToUser` atual é:

```typescript
  /** Emite a mensagem em tempo real para o destinatário */
  emitToUser(userId: string, message: object): void {
    const socketId = this.userSockets.get(userId);
    if (socketId) {
      this.server.to(socketId).emit('new_message', message);
    }
  }
```

Adicionar logo abaixo:

```typescript
  /** Emite uma notificação em tempo real para o destinatário — mesmo canal usado pras mensagens. */
  emitNotification(userId: string, notification: object): void {
    const socketId = this.userSockets.get(userId);
    if (socketId) {
      this.server.to(socketId).emit('new_notification', notification);
    }
  }
```

- [ ] **Step 2: `MessagesModule` passa a exportar o gateway**

Em `backend/src/messages/messages.module.ts`, atual:

```typescript
  controllers: [MessagesController],
  providers: [MessagesService, MessagesGateway],
  exports: [MessagesService],
})
export class MessagesModule {}
```

Vira:

```typescript
  controllers: [MessagesController],
  providers: [MessagesService, MessagesGateway],
  exports: [MessagesService, MessagesGateway],
})
export class MessagesModule {}
```

- [ ] **Step 3: `NotificationsModule` importa `MessagesModule`**

Em `backend/src/notifications/notifications.module.ts`, atual:

```typescript
import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

Vira (importa `MessagesModule` com `forwardRef` — vai virar uma dependência circular entre os dois módulos assim que a Task 5 fizer `MessagesModule` importar `NotificationsModule` de volta):

```typescript
import { Module, forwardRef } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [forwardRef(() => MessagesModule)],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

- [ ] **Step 4: Atualizar o teste de `create` pra mockar o gateway**

Em `backend/src/notifications/notifications.service.spec.ts`, o `describe('NotificationsService.create', ...)` atual é:

```typescript
describe('NotificationsService.create', () => {
  let service: NotificationsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { notification: { create: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [NotificationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('grava a notificacao com os campos informados', async () => {
    prisma.notification.create.mockResolvedValue({ id: 'n1' });

    await service.create('user-1', 'plan_published', 'Novo plano publicado', 'Seu coach publicou "Mesociclo 1"', '/athlete/weekly');

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'plan_published',
        title: 'Novo plano publicado',
        body: 'Seu coach publicou "Mesociclo 1"',
        link: '/athlete/weekly',
      },
    });
  });
});
```

Vira (adiciona o import de `MessagesGateway`, mocka como provider, adiciona um teste novo confirmando a emissão):

```typescript
import { MessagesGateway } from '../messages/messages.gateway';

describe('NotificationsService.create', () => {
  let service: NotificationsService;
  let prisma: any;
  let gateway: { emitNotification: jest.Mock };

  beforeEach(async () => {
    prisma = { notification: { create: jest.fn() } };
    gateway = { emitNotification: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: MessagesGateway, useValue: gateway },
      ],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('grava a notificacao com os campos informados', async () => {
    prisma.notification.create.mockResolvedValue({ id: 'n1' });

    await service.create('user-1', 'plan_published', 'Novo plano publicado', 'Seu coach publicou "Mesociclo 1"', '/athlete/weekly');

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'plan_published',
        title: 'Novo plano publicado',
        body: 'Seu coach publicou "Mesociclo 1"',
        link: '/athlete/weekly',
      },
    });
  });

  it('emite em tempo real pro destinatario depois de gravar', async () => {
    prisma.notification.create.mockResolvedValue({ id: 'n1', userId: 'user-1', type: 'plan_published' });

    await service.create('user-1', 'plan_published', 'Novo plano publicado');

    expect(gateway.emitNotification).toHaveBeenCalledWith('user-1', { id: 'n1', userId: 'user-1', type: 'plan_published' });
  });
});
```

O `import { MessagesGateway } from '../messages/messages.gateway';` novo entra junto dos imports já existentes no topo do arquivo (`Test`, `ForbiddenException`/`NotFoundException`, `NotificationsService`, `PrismaService`).

- [ ] **Step 5: Rodar os testes e confirmar que falham**

```bash
npx jest notifications.service.spec.ts -t "emite em tempo real"
```

Esperado: FALHA — `create()` ainda não injeta nem chama o gateway.

- [ ] **Step 6: Implementar a emissão no service**

Em `backend/src/notifications/notifications.service.ts`, atual:

```typescript
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type NotificationType = 'plan_published' | 'new_message' | 'workout_skipped' | 'new_pr';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, type: NotificationType, title: string, body?: string, link?: string) {
    return this.prisma.notification.create({
      data: { userId, type, title, body, link },
    });
  }
```

Vira:

```typescript
import { Injectable, ForbiddenException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesGateway } from '../messages/messages.gateway';

export type NotificationType = 'plan_published' | 'new_message' | 'workout_skipped' | 'new_pr';

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => MessagesGateway))
    private gateway: MessagesGateway,
  ) {}

  async create(userId: string, type: NotificationType, title: string, body?: string, link?: string) {
    const notification = await this.prisma.notification.create({
      data: { userId, type, title, body, link },
    });
    this.gateway.emitNotification(userId, notification);
    return notification;
  }
```

- [ ] **Step 7: Rodar os testes**

```bash
npx jest notifications.service.spec.ts
```

Esperado: PASS (8 testes).

- [ ] **Step 8: Build e confirmar que o backend sobe sem erro de dependência circular**

```bash
npm run build
source ~/.nvm/nvm.sh && nvm use 20
timeout 15 npm run start:dev 2>&1 | tee /tmp/notifications-di-check.log &
sleep 12
grep -i "circular\|cannot resolve" /tmp/notifications-di-check.log || echo "sem erro de dependencia circular"
```

Esperado: "sem erro de dependencia circular", e o log mostra `Nest application successfully started`. Se aparecer erro de dependência circular, adicionar `forwardRef()` também na declaração `@Module` de `MessagesModule` (`imports: [..., forwardRef(() => NotificationsModule)]` — mesmo sem `NotificationsModule` ainda estar de fato na lista de imports do `MessagesModule` até a Task 5, esse ajuste só seria necessário se o erro aparecer aqui; documentar no commit se precisar).

- [ ] **Step 9: Commit**

```bash
git add src/messages/messages.gateway.ts src/messages/messages.module.ts src/notifications/
git commit -m "feat(notifications): tempo real via WebSocket, reusa MessagesGateway"
```

---

## Task 4: Backend — trigger `plan_published`

**Files:**
- Modify: `backend/src/training-plans/training-plans.service.ts`
- Modify: `backend/src/training-plans/training-plans.module.ts`
- Test: `backend/src/training-plans/training-plans.service.spec.ts`

**Interfaces:**
- Consumes: `NotificationsService.create(userId, type, title, body?, link?)` (Task 2).

- [ ] **Step 1: Escrever o teste que falha**

Em `backend/src/training-plans/training-plans.service.spec.ts`, adicionar um novo `describe` no fim do arquivo:

```typescript
describe('TrainingPlansService.publish — notifica o atleta', () => {
  let service: TrainingPlansService;
  let prisma: any;
  let notificationsService: { create: jest.Mock };

  beforeEach(async () => {
    prisma = {
      trainingPlan: {
        findUnique: jest.fn().mockResolvedValue({ coachId: 'coach-1' }),
        update: jest.fn().mockResolvedValue({
          id: 'plan-1',
          title: 'Mesociclo 1',
          student: { userId: 'athlete-1' },
        }),
      },
    };
    notificationsService = { create: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        TrainingPlansService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(TrainingPlansService);
  });

  it('notifica o atleta dono do plano quando o coach publica', async () => {
    await service.publish('plan-1', 'coach-1');

    expect(notificationsService.create).toHaveBeenCalledWith(
      'athlete-1',
      'plan_published',
      'Novo plano publicado',
      'Seu coach publicou "Mesociclo 1"',
      '/athlete/weekly',
    );
  });
});
```

Adicionar o import de `NotificationsService` no topo do arquivo, junto dos outros imports já existentes:

```typescript
import { NotificationsService } from '../notifications/notifications.service';
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd backend
source ~/.nvm/nvm.sh && nvm use 20
npx jest training-plans.service.spec.ts -t "notifica o atleta"
```

Esperado: FALHA — `TrainingPlansService` ainda não injeta `NotificationsService` nem chama `.create()`.

- [ ] **Step 3: Implementar**

Em `backend/src/training-plans/training-plans.service.ts`, o construtor atual e o método `publish` são:

```typescript
export class TrainingPlansService {
  constructor(private prisma: PrismaService) {}
```

```typescript
  async publish(id: string, coachId: string) {
    await this.assertCoachOwnsPlan(id, coachId);
    return this.prisma.trainingPlan.update({
      where: { id },
      data: { published: true },
    });
  }
```

Viram:

```typescript
export class TrainingPlansService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}
```

```typescript
  async publish(id: string, coachId: string) {
    await this.assertCoachOwnsPlan(id, coachId);
    const plan = await this.prisma.trainingPlan.update({
      where: { id },
      data: { published: true },
      include: { student: { select: { userId: true } } },
    });
    await this.notificationsService.create(
      plan.student.userId,
      'plan_published',
      'Novo plano publicado',
      `Seu coach publicou "${plan.title}"`,
      '/athlete/weekly',
    );
    return plan;
  }
```

Adicionar o import no topo do arquivo, junto de `import { PrismaService } from '../prisma/prisma.service';`:

```typescript
import { NotificationsService } from '../notifications/notifications.service';
```

- [ ] **Step 4: `TrainingPlansModule` importa `NotificationsModule`**

Em `backend/src/training-plans/training-plans.module.ts`, atual:

```typescript
import { Module } from '@nestjs/common';
import { TrainingPlansService } from './training-plans.service';
import { TrainingPlansController } from './training-plans.controller';

@Module({
  controllers: [TrainingPlansController],
  providers: [TrainingPlansService],
  exports: [TrainingPlansService],
})
export class TrainingPlansModule {}
```

Vira:

```typescript
import { Module } from '@nestjs/common';
import { TrainingPlansService } from './training-plans.service';
import { TrainingPlansController } from './training-plans.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [TrainingPlansController],
  providers: [TrainingPlansService],
  exports: [TrainingPlansService],
})
export class TrainingPlansModule {}
```

- [ ] **Step 5: Rodar o teste, a suíte completa e o build**

```bash
npx jest training-plans.service.spec.ts
npm run test
npm run build
```

Esperado: tudo passando/limpo.

- [ ] **Step 6: Commit**

```bash
git add src/training-plans/ 
git commit -m "feat(training-plans): notifica o atleta quando o coach publica o plano"
```

---

## Task 5: Backend — trigger `new_message`

**Files:**
- Modify: `backend/src/messages/messages.controller.ts`
- Modify: `backend/src/messages/messages.module.ts`
- Test: Criar `backend/src/messages/messages.controller.spec.ts` (não existe ainda)

**Interfaces:**
- Consumes: `NotificationsService.create` (Task 2).

- [ ] **Step 1: Escrever o teste que falha**

`backend/src/messages/messages.controller.spec.ts` (arquivo novo):

```typescript
import { Test } from '@nestjs/testing';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('MessagesController.send — notifica o destinatario', () => {
  let controller: MessagesController;
  let messagesService: { send: jest.Mock };
  let notificationsService: { create: jest.Mock };

  beforeEach(async () => {
    messagesService = { send: jest.fn().mockResolvedValue({ id: 'msg-1' }) };
    notificationsService = { create: jest.fn() };

    const module = await Test.createTestingModule({
      controllers: [MessagesController],
      providers: [
        { provide: MessagesService, useValue: messagesService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    controller = module.get(MessagesController);
  });

  it('coach manda mensagem pro atleta -> notificacao com link pro athlete/messages', async () => {
    const req = { user: { id: 'coach-1', role: 'coach', name: 'Luan' } };

    await controller.send(req, { toId: 'athlete-1', content: 'Bom treino hoje!' });

    expect(notificationsService.create).toHaveBeenCalledWith(
      'athlete-1',
      'new_message',
      'Nova mensagem de Luan',
      'Bom treino hoje!',
      '/athlete/messages',
    );
  });

  it('atleta manda mensagem pro coach -> notificacao com link pro coach/messages', async () => {
    const req = { user: { id: 'athlete-1', role: 'athlete', name: 'Gustavo' } };

    await controller.send(req, { toId: 'coach-1', content: 'Pode ser amanha?' });

    expect(notificationsService.create).toHaveBeenCalledWith(
      'coach-1',
      'new_message',
      'Nova mensagem de Gustavo',
      'Pode ser amanha?',
      '/coach/messages',
    );
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd backend
source ~/.nvm/nvm.sh && nvm use 20
npx jest messages.controller.spec.ts
```

Esperado: FALHA — `MessagesController` não injeta `NotificationsService`, `send()` ainda é síncrono/sem chamada extra.

- [ ] **Step 3: Implementar**

Em `backend/src/messages/messages.controller.ts`, atual:

```typescript
import { Controller, Get, Post, Body, Param, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

class SendMessageDto {
  @IsString() toId: string;
  @IsString() @MinLength(1) content: string;
}

@ApiTags('messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('messages')
export class MessagesController {
  constructor(private readonly service: MessagesService) {}
```

```typescript
  @Post()
  @ApiOperation({ summary: 'Envia mensagem para um usuário' })
  send(@Request() req: any, @Body() dto: SendMessageDto) {
    return this.service.send(req.user.id, dto.toId, dto.content);
  }
}
```

Viram:

```typescript
import { Controller, Get, Post, Body, Param, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { MessagesService } from './messages.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

class SendMessageDto {
  @IsString() toId: string;
  @IsString() @MinLength(1) content: string;
}

@ApiTags('messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('messages')
export class MessagesController {
  constructor(
    private readonly service: MessagesService,
    private readonly notificationsService: NotificationsService,
  ) {}
```

```typescript
  @Post()
  @ApiOperation({ summary: 'Envia mensagem para um usuário' })
  async send(@Request() req: any, @Body() dto: SendMessageDto) {
    const message = await this.service.send(req.user.id, dto.toId, dto.content);
    const recipientLink = req.user.role === 'coach' ? '/athlete/messages' : '/coach/messages';
    await this.notificationsService.create(
      dto.toId,
      'new_message',
      `Nova mensagem de ${req.user.name}`,
      dto.content,
      recipientLink,
    );
    return message;
  }
}
```

- [ ] **Step 4: `MessagesModule` importa `NotificationsModule`**

Em `backend/src/messages/messages.module.ts`, atual (depois da Task 3):

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { MessagesGateway } from './messages.gateway';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [MessagesController],
  providers: [MessagesService, MessagesGateway],
  exports: [MessagesService, MessagesGateway],
})
export class MessagesModule {}
```

Vira (adiciona o import de `forwardRef`/`Module` já existente e de `NotificationsModule`, e a entrada em `imports`):

```typescript
import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { MessagesGateway } from './messages.gateway';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_SECRET'),
      }),
    }),
    forwardRef(() => NotificationsModule),
  ],
  controllers: [MessagesController],
  providers: [MessagesService, MessagesGateway],
  exports: [MessagesService, MessagesGateway],
})
export class MessagesModule {}
```

- [ ] **Step 5: Rodar o teste, a suíte completa e o build**

```bash
npx jest messages.controller.spec.ts
npm run test
npm run build
```

Esperado: tudo passando/limpo.

- [ ] **Step 6: Confirmar de novo que o backend sobe sem erro de dependência circular**

```bash
source ~/.nvm/nvm.sh && nvm use 20
timeout 15 npm run start:dev 2>&1 | tee /tmp/notifications-di-check-2.log &
sleep 12
grep -i "circular\|cannot resolve" /tmp/notifications-di-check-2.log || echo "sem erro de dependencia circular"
```

Esperado: "sem erro de dependencia circular". Agora o ciclo `MessagesModule ↔ NotificationsModule` está completo dos dois lados — se der erro aqui, adicionar `@Inject(forwardRef(() => NotificationsService))` no construtor de `MessagesController` (mesma técnica já usada em `NotificationsService` pro `MessagesGateway` na Task 3).

- [ ] **Step 7: Commit**

```bash
git add src/messages/
git commit -m "feat(messages): notifica o destinatario quando chega mensagem nova (nao-sistema)"
```

---

## Task 6: Backend — trigger `workout_skipped`

**Files:**
- Modify: `backend/src/workout-skips/workout-skips.service.ts`
- Modify: `backend/src/workout-skips/workout-skips.module.ts`
- Test: `backend/src/workout-skips/workout-skips.service.spec.ts`

**Interfaces:**
- Consumes: `NotificationsService.create` (Task 2).

- [ ] **Step 1: Escrever o teste que falha**

Em `backend/src/workout-skips/workout-skips.service.spec.ts`, o topo do arquivo e o `beforeEach` do `describe('WorkoutSkipsService.create', ...)` atuais são:

```typescript
import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
```

Viram (adiciona o import e o mock de `NotificationsService`):

```typescript
import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkoutSkipsService } from './workout-skips.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { MessagesService } from '../messages/messages.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('WorkoutSkipsService.create', () => {
  let service: WorkoutSkipsService;
  let prisma: any;
  let studentsService: { findOne: jest.Mock };
  let messagesService: { send: jest.Mock };
  let notificationsService: { create: jest.Mock };

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
    notificationsService = { create: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        WorkoutSkipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: studentsService },
        { provide: MessagesService, useValue: messagesService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(WorkoutSkipsService);
  });
```

O teste `'cria o skip de exercicio e envia mensagem automatica pro coach'` já existente é:

```typescript
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
```

Adicionar um novo teste logo depois desse, no mesmo `describe`:

```typescript
  it('notifica o coach quando o atleta pula um treino', async () => {
    prisma.exercise.findUnique.mockResolvedValue({
      id: 'ex-1', name: 'HSPU',
      session: { day: { week: { plan: { studentId: 'student-1' } } } },
    });
    prisma.workoutSkip.create.mockResolvedValue({ id: 'skip-1', exerciseId: 'ex-1', decision: 'Postponed' });

    await service.create(
      { exerciseId: 'ex-1', reason: 'NoTime', decision: 'Postponed' } as any,
      athlete,
    );

    expect(notificationsService.create).toHaveBeenCalledWith(
      'coach-1',
      'workout_skipped',
      'Aluno pulou um treino',
      expect.stringContaining('Pulei "HSPU"'),
      '/coach/plan-builder/student-1',
    );
  });
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd backend
source ~/.nvm/nvm.sh && nvm use 20
npx jest workout-skips.service.spec.ts -t "notifica o coach"
```

Esperado: FALHA.

- [ ] **Step 3: Implementar**

Em `backend/src/workout-skips/workout-skips.service.ts`, o construtor e o fim do método `create` atuais são:

```typescript
export class WorkoutSkipsService {
  constructor(
    private prisma: PrismaService,
    private studentsService: StudentsService,
    private messagesService: MessagesService,
  ) {}
```

```typescript
    const reasonLabel = REASON_LABEL[dto.reason] ?? dto.reason;
    const decisionLabel = dto.decision === 'Postponed' ? 'vai fazer depois' : 'não vai fazer';
    const content = `Pulei "${target.name}" — motivo: ${reasonLabel}. ${decisionLabel}.${dto.note ? ` Nota: ${dto.note}` : ''}`;
    await this.messagesService.send(user.id, student.coachId, content, true);

    return skip;
  }
```

Viram:

```typescript
export class WorkoutSkipsService {
  constructor(
    private prisma: PrismaService,
    private studentsService: StudentsService,
    private messagesService: MessagesService,
    private notificationsService: NotificationsService,
  ) {}
```

```typescript
    const reasonLabel = REASON_LABEL[dto.reason] ?? dto.reason;
    const decisionLabel = dto.decision === 'Postponed' ? 'vai fazer depois' : 'não vai fazer';
    const content = `Pulei "${target.name}" — motivo: ${reasonLabel}. ${decisionLabel}.${dto.note ? ` Nota: ${dto.note}` : ''}`;
    await this.messagesService.send(user.id, student.coachId, content, true);
    await this.notificationsService.create(
      student.coachId,
      'workout_skipped',
      'Aluno pulou um treino',
      content,
      `/coach/plan-builder/${target.studentId}`,
    );

    return skip;
  }
```

Adicionar o import no topo do arquivo, junto de `import { MessagesService } from '../messages/messages.service';`:

```typescript
import { NotificationsService } from '../notifications/notifications.service';
```

- [ ] **Step 4: `WorkoutSkipsModule` importa `NotificationsModule`**

Em `backend/src/workout-skips/workout-skips.module.ts`, atual:

```typescript
@Module({
  imports: [StudentsModule, MessagesModule],
  controllers: [WorkoutSkipsController],
  providers: [WorkoutSkipsService],
  exports: [WorkoutSkipsService],
})
export class WorkoutSkipsModule {}
```

Vira (adicionar o import de `NotificationsModule` no topo do arquivo também):

```typescript
@Module({
  imports: [StudentsModule, MessagesModule, NotificationsModule],
  controllers: [WorkoutSkipsController],
  providers: [WorkoutSkipsService],
  exports: [WorkoutSkipsService],
})
export class WorkoutSkipsModule {}
```

- [ ] **Step 5: Rodar o teste, a suíte completa e o build**

```bash
npx jest workout-skips.service.spec.ts
npm run test
npm run build
```

Esperado: tudo passando/limpo.

- [ ] **Step 6: Commit**

```bash
git add src/workout-skips/
git commit -m "feat(workout-skips): notifica o coach quando o atleta pula um treino"
```

---

## Task 7: Backend — trigger `new_pr`

**Files:**
- Modify: `backend/src/personal-records/personal-records.service.ts`
- Modify: `backend/src/personal-records/personal-records.module.ts`
- Test: `backend/src/personal-records/personal-records.service.spec.ts`

**Interfaces:**
- Consumes: `NotificationsService.create` (Task 2).

- [ ] **Step 1: Escrever os testes que falham**

Em `backend/src/personal-records/personal-records.service.spec.ts`, o topo do arquivo e o `describe('PersonalRecordsService.create', ...)` atuais são:

```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PersonalRecordsService } from './personal-records.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { MovementsService } from '../movements/movements.service';

describe('PersonalRecordsService.create', () => {
  let service: PersonalRecordsService;
  let prisma: any;
  let movementsService: { isAvailableForUser: jest.Mock };

  beforeEach(async () => {
    prisma = { personalRecord: { create: jest.fn() } };
    movementsService = { isAvailableForUser: jest.fn().mockResolvedValue(true) };
    const module = await Test.createTestingModule({
      providers: [
        PersonalRecordsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: { findOne: jest.fn() } },
        { provide: MovementsService, useValue: movementsService },
      ],
    }).compile();
    service = module.get(PersonalRecordsService);
  });

  it('cria o registro com loadKg', async () => {
    prisma.personalRecord.create.mockResolvedValue({ id: 'pr1' });

    await service.create('athlete-1', { movementId: 'mov-1', loadKg: 120 } as any);

    expect(movementsService.isAvailableForUser).toHaveBeenCalledWith({ id: 'athlete-1', role: 'athlete' }, 'mov-1');
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

  it('rejeita quando o movimento nao esta no catalogo disponivel pro atleta', async () => {
    movementsService.isAvailableForUser.mockResolvedValue(false);

    await expect(
      service.create('athlete-1', { movementId: 'mov-de-outro-coach', loadKg: 100 } as any),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.personalRecord.create).not.toHaveBeenCalled();
  });
});
```

Viram (adiciona o import de `NotificationsService`; `prisma` ganha `personalRecord.findMany` — o service novo busca o histórico antes de criar — e `student.findFirst`; `notificationsService` entra como novo mock/provider; os dois primeiros testes ganham `include: { movement: true }` na asserção, já que o `create()` novo passa a incluir o movimento na resposta; e 3 testes novos são adicionados no fim do describe):

```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PersonalRecordsService } from './personal-records.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { MovementsService } from '../movements/movements.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('PersonalRecordsService.create', () => {
  let service: PersonalRecordsService;
  let prisma: any;
  let movementsService: { isAvailableForUser: jest.Mock };
  let notificationsService: { create: jest.Mock };

  beforeEach(async () => {
    prisma = {
      personalRecord: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      student: { findFirst: jest.fn() },
    };
    movementsService = { isAvailableForUser: jest.fn().mockResolvedValue(true) };
    notificationsService = { create: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        PersonalRecordsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: { findOne: jest.fn() } },
        { provide: MovementsService, useValue: movementsService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();
    service = module.get(PersonalRecordsService);
  });

  it('cria o registro com loadKg', async () => {
    prisma.personalRecord.create.mockResolvedValue({ id: 'pr1', movement: { name: 'Back Squat' } });

    await service.create('athlete-1', { movementId: 'mov-1', loadKg: 120 } as any);

    expect(movementsService.isAvailableForUser).toHaveBeenCalledWith({ id: 'athlete-1', role: 'athlete' }, 'mov-1');
    expect(prisma.personalRecord.create).toHaveBeenCalledWith({
      data: { athleteId: 'athlete-1', movementId: 'mov-1', loadKg: 120, reps: undefined, note: undefined },
      include: { movement: true },
    });
  });

  it('cria o registro so com reps (movimento de corpo livre)', async () => {
    prisma.personalRecord.create.mockResolvedValue({ id: 'pr2', movement: { name: 'Pull-up' } });

    await service.create('athlete-1', { movementId: 'mov-2', reps: 15 } as any);

    expect(prisma.personalRecord.create).toHaveBeenCalledWith({
      data: { athleteId: 'athlete-1', movementId: 'mov-2', loadKg: undefined, reps: 15, note: undefined },
      include: { movement: true },
    });
  });

  it('rejeita quando nem loadKg nem reps sao informados', async () => {
    await expect(
      service.create('athlete-1', { movementId: 'mov-1' } as any),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.personalRecord.create).not.toHaveBeenCalled();
  });

  it('rejeita quando o movimento nao esta no catalogo disponivel pro atleta', async () => {
    movementsService.isAvailableForUser.mockResolvedValue(false);

    await expect(
      service.create('athlete-1', { movementId: 'mov-de-outro-coach', loadKg: 100 } as any),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.personalRecord.create).not.toHaveBeenCalled();
  });

  it('notifica o coach no primeiro registro daquele movimento (sempre é recorde)', async () => {
    prisma.personalRecord.findMany.mockResolvedValue([]);
    prisma.personalRecord.create.mockResolvedValue({ id: 'pr1', movement: { name: 'Back Squat' } });
    prisma.student.findFirst.mockResolvedValue({ id: 'student-1', coachId: 'coach-1' });

    await service.create('athlete-1', { movementId: 'mov-1', loadKg: 100 } as any);

    expect(notificationsService.create).toHaveBeenCalledWith(
      'coach-1',
      'new_pr',
      'Novo recorde pessoal!',
      expect.stringContaining('Back Squat'),
      '/coach/plan-builder/student-1',
    );
  });

  it('nao notifica quando o novo valor NAO supera o recorde ja existente', async () => {
    prisma.personalRecord.findMany.mockResolvedValue([{ loadKg: 120, reps: null }]);
    prisma.personalRecord.create.mockResolvedValue({ id: 'pr2', movement: { name: 'Back Squat' } });

    await service.create('athlete-1', { movementId: 'mov-1', loadKg: 100 } as any);

    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('notifica so por carga quando so a carga bate recorde (reps nao informado)', async () => {
    prisma.personalRecord.findMany.mockResolvedValue([{ loadKg: 90, reps: null }]);
    prisma.personalRecord.create.mockResolvedValue({ id: 'pr3', movement: { name: 'Back Squat' } });
    prisma.student.findFirst.mockResolvedValue({ id: 'student-1', coachId: 'coach-1' });

    await service.create('athlete-1', { movementId: 'mov-1', loadKg: 100 } as any);

    expect(notificationsService.create).toHaveBeenCalledWith(
      'coach-1',
      'new_pr',
      'Novo recorde pessoal!',
      expect.stringContaining('carga'),
      '/coach/plan-builder/student-1',
    );
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

```bash
cd backend
source ~/.nvm/nvm.sh && nvm use 20
npx jest personal-records.service.spec.ts -t "notifica"
```

Esperado: FALHA.

- [ ] **Step 3: Implementar**

Em `backend/src/personal-records/personal-records.service.ts`, o arquivo atual completo é:

```typescript
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { MovementsService } from '../movements/movements.service';
import { CreatePersonalRecordDto } from './dto/create-personal-record.dto';

type AuthUser = { id: string; role: string };

@Injectable()
export class PersonalRecordsService {
  constructor(
    private prisma: PrismaService,
    private studentsService: StudentsService,
    private movementsService: MovementsService,
  ) {}

  async create(athleteId: string, dto: CreatePersonalRecordDto) {
    if (dto.loadKg == null && dto.reps == null) {
      throw new BadRequestException('Informe carga (kg) e/ou repetições.');
    }
    const isAvailable = await this.movementsService.isAvailableForUser({ id: athleteId, role: 'athlete' }, dto.movementId);
    if (!isAvailable) {
      throw new NotFoundException('Movimento não encontrado no seu catálogo.');
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
```

Vira (o resto do arquivo — `getMyHistory`, `getHistoryForStudent` — fica igual):

```typescript
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { MovementsService } from '../movements/movements.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePersonalRecordDto } from './dto/create-personal-record.dto';

type AuthUser = { id: string; role: string };

@Injectable()
export class PersonalRecordsService {
  constructor(
    private prisma: PrismaService,
    private studentsService: StudentsService,
    private movementsService: MovementsService,
    private notificationsService: NotificationsService,
  ) {}

  async create(athleteId: string, dto: CreatePersonalRecordDto) {
    if (dto.loadKg == null && dto.reps == null) {
      throw new BadRequestException('Informe carga (kg) e/ou repetições.');
    }
    const isAvailable = await this.movementsService.isAvailableForUser({ id: athleteId, role: 'athlete' }, dto.movementId);
    if (!isAvailable) {
      throw new NotFoundException('Movimento não encontrado no seu catálogo.');
    }

    const existing = await this.prisma.personalRecord.findMany({
      where: { athleteId, movementId: dto.movementId },
    });
    const isNewLoadPr = dto.loadKg != null
      && !existing.some(r => r.loadKg != null && r.loadKg >= dto.loadKg!);
    const isNewRepsPr = dto.reps != null
      && !existing.some(r => r.reps != null && r.reps >= dto.reps!);

    const record = await this.prisma.personalRecord.create({
      data: {
        athleteId,
        movementId: dto.movementId,
        loadKg: dto.loadKg,
        reps: dto.reps,
        note: dto.note,
      },
      include: { movement: true },
    });

    if (isNewLoadPr || isNewRepsPr) {
      const student = await this.prisma.student.findFirst({
        where: { userId: athleteId },
        select: { id: true, coachId: true },
      });
      if (student) {
        const metric = isNewLoadPr && isNewRepsPr ? 'carga e repetições' : isNewLoadPr ? 'carga' : 'repetições';
        await this.notificationsService.create(
          student.coachId,
          'new_pr',
          'Novo recorde pessoal!',
          `Novo recorde de ${metric} em ${record.movement.name}.`,
          `/coach/plan-builder/${student.id}`,
        );
      }
    }

    return record;
  }
```

`include: { movement: true }` foi adicionado ao `create()` — corrige de quebra uma inconsistência pré-existente (o model `PersonalRecord` do frontend já declarava `movement: Movement` como campo obrigatório, mas o `create()` nunca retornava esse campo até agora).

- [ ] **Step 4: `PersonalRecordsModule` importa `NotificationsModule`**

Em `backend/src/personal-records/personal-records.module.ts`, atual:

```typescript
@Module({
  imports: [StudentsModule, MovementsModule],
  controllers: [PersonalRecordsController],
  providers: [PersonalRecordsService],
  exports: [PersonalRecordsService],
})
export class PersonalRecordsModule {}
```

Vira (adicionar o import de `NotificationsModule` no topo também):

```typescript
@Module({
  imports: [StudentsModule, MovementsModule, NotificationsModule],
  controllers: [PersonalRecordsController],
  providers: [PersonalRecordsService],
  exports: [PersonalRecordsService],
})
export class PersonalRecordsModule {}
```

- [ ] **Step 5: Rodar os testes, a suíte completa e o build**

```bash
npx jest personal-records.service.spec.ts
npm run test
npm run build
```

Esperado: tudo passando/limpo.

- [ ] **Step 6: Commit**

```bash
git add src/personal-records/
git commit -m "feat(personal-records): notifica o coach quando o atleta bate um novo PR"
```

---

## Task 8: Frontend — model `AppNotification` + métodos no `ApiService`

**Files:**
- Create: `frontend/src/app/core/models/notification.model.ts`
- Modify: `frontend/src/app/core/models/index.ts`
- Modify: `frontend/src/app/core/services/api.service.ts`

**Interfaces:**
- Produces: `AppNotification`, `NotificationType`; `ApiService.getNotifications()`, `.getNotificationsUnreadCount()`, `.markNotificationRead(id)`, `.markAllNotificationsRead()`. Consumido pelas Tasks 9 e 10.

- [ ] **Step 1: Model**

`frontend/src/app/core/models/notification.model.ts`:

```typescript
export type NotificationType = 'plan_published' | 'new_message' | 'workout_skipped' | 'new_pr';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  read: boolean;
  createdAt: string;
}
```

- [ ] **Step 2: Barrel**

Em `frontend/src/app/core/models/index.ts`, atual:

```typescript
export * from './user.model';
export * from './student.model';
export * from './training.model';
export * from './library.model';
export * from './movement.model';
```

Vira:

```typescript
export * from './user.model';
export * from './student.model';
export * from './training.model';
export * from './library.model';
export * from './movement.model';
export * from './notification.model';
```

- [ ] **Step 3: Métodos no `ApiService`**

Em `frontend/src/app/core/services/api.service.ts`, adicionar o import de `AppNotification` na linha de import de models já existente (a que já importa `Movement, PersonalRecord`, etc — adicionar `AppNotification` a essa mesma linha `import { ... } from '../models';`).

Adicionar os métodos novos, perto de `getUnreadCount()` (mensagens) já existente:

```typescript
  getNotifications(): Observable<AppNotification[]> {
    return this.http.get<AppNotification[]>(`${this.base}/notifications`);
  }

  getNotificationsUnreadCount(): Observable<{ count: number }> {
    return this.http.get<{ count: number }>(`${this.base}/notifications/unread-count`);
  }

  markNotificationRead(id: string): Observable<AppNotification> {
    return this.http.patch<AppNotification>(`${this.base}/notifications/${id}/read`, {});
  }

  markAllNotificationsRead(): Observable<void> {
    return this.http.patch<void>(`${this.base}/notifications/read-all`, {});
  }
```

- [ ] **Step 4: Build**

```bash
cd frontend
source ~/.nvm/nvm.sh && nvm use 20
npx ng build --configuration=development
```

Esperado: limpo.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/models/notification.model.ts src/app/core/models/index.ts src/app/core/services/api.service.ts
git commit -m "feat(api): AppNotification model + metodos de notificacoes no ApiService"
```

---

## Task 9: Frontend — `SocketService` recebe notificações em tempo real

**Files:**
- Modify: `frontend/src/app/core/services/socket.service.ts`

**Interfaces:**
- Consumes: `AppNotification` (Task 8).
- Produces: `SocketService.newNotification$: Subject<AppNotification>`. Consumido pela Task 10.

- [ ] **Step 1: Adicionar o subject e o listener**

Em `frontend/src/app/core/services/socket.service.ts`, atual:

```typescript
import { Injectable, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { ChatMessage } from './api.service';

@Injectable({ providedIn: 'root' })
export class SocketService implements OnDestroy {
  private socket: Socket | null = null;
  readonly newMessage$ = new Subject<ChatMessage>();

  connect(token: string): void {
    if (this.socket?.connected) return;

    const wsUrl = environment.apiUrl.replace('/api', '');
    this.socket = io(`${wsUrl}/messages`, {
      auth: { token },
      transports: ['websocket'],
    });

    this.socket.on('new_message', (msg: ChatMessage) => {
      this.newMessage$.next(msg);
      this.showBrowserNotification(msg);
    });
  }
```

Vira:

```typescript
import { Injectable, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { ChatMessage } from './api.service';
import { AppNotification } from '../models';

@Injectable({ providedIn: 'root' })
export class SocketService implements OnDestroy {
  private socket: Socket | null = null;
  readonly newMessage$ = new Subject<ChatMessage>();
  readonly newNotification$ = new Subject<AppNotification>();

  connect(token: string): void {
    if (this.socket?.connected) return;

    const wsUrl = environment.apiUrl.replace('/api', '');
    this.socket = io(`${wsUrl}/messages`, {
      auth: { token },
      transports: ['websocket'],
    });

    this.socket.on('new_message', (msg: ChatMessage) => {
      this.newMessage$.next(msg);
      this.showBrowserNotification(msg);
    });

    this.socket.on('new_notification', (notification: AppNotification) => {
      this.newNotification$.next(notification);
    });
  }
```

- [ ] **Step 2: Build**

```bash
cd frontend
npx ng build --configuration=development
```

Esperado: limpo.

- [ ] **Step 3: Commit**

```bash
git add src/app/core/services/socket.service.ts
git commit -m "feat(socket): recebe notificacoes em tempo real (new_notification)"
```

---

## Task 10: Frontend — `NotificationsBellComponent` (componente novo, compartilhado)

**Files:**
- Create: `frontend/src/app/shared/components/notifications-bell/notifications-bell.component.ts`
- Create: `frontend/src/app/shared/components/notifications-bell/notifications-bell.component.html`
- Create: `frontend/src/app/shared/components/notifications-bell/notifications-bell.component.scss`

**Interfaces:**
- Consumes: `ApiService` (Task 8), `SocketService.newNotification$` (Task 9), `AppNotification`/`NotificationType` (Task 8).
- Produces: `NotificationsBellComponent`, auto-contido (sem `@Input`/`@Output`). Consumido pelas Tasks 11 e 12.

- [ ] **Step 1: Componente TypeScript**

`frontend/src/app/shared/components/notifications-bell/notifications-bell.component.ts`:

```typescript
import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService } from '../../../core/services/api.service';
import { SocketService } from '../../../core/services/socket.service';
import { AppNotification, NotificationType } from '../../../core/models';

const TYPE_ICON: Record<NotificationType, string> = {
  plan_published: 'calendar_month',
  new_message: 'chat',
  workout_skipped: 'skip_next',
  new_pr: 'military_tech',
};

@Component({
  selector: 'app-notifications-bell',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notifications-bell.component.html',
  styleUrl: './notifications-bell.component.scss',
})
export class NotificationsBellComponent implements OnInit, OnDestroy {
  notifications = signal<AppNotification[]>([]);
  unreadCount = signal(0);
  showPanel = signal(false);

  private destroy$ = new Subject<void>();

  constructor(private api: ApiService, private socket: SocketService, private router: Router) {}

  ngOnInit(): void {
    this.api.getNotificationsUnreadCount().subscribe(r => this.unreadCount.set(r.count));

    this.socket.newNotification$
      .pipe(takeUntil(this.destroy$))
      .subscribe(n => {
        this.notifications.update(list => [n, ...list]);
        this.unreadCount.update(c => c + 1);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  togglePanel(): void {
    const opening = !this.showPanel();
    this.showPanel.set(opening);
    if (opening && this.notifications().length === 0) {
      this.api.getNotifications().subscribe(list => this.notifications.set(list));
    }
  }

  iconFor(type: NotificationType): string {
    return TYPE_ICON[type] ?? 'notifications';
  }

  selectNotification(n: AppNotification): void {
    this.showPanel.set(false);
    if (!n.read) {
      this.api.markNotificationRead(n.id).subscribe();
      this.notifications.update(list => list.map(x => x.id === n.id ? { ...x, read: true } : x));
      this.unreadCount.update(c => Math.max(0, c - 1));
    }
    if (n.link) {
      this.router.navigateByUrl(n.link);
    }
  }

  markAllRead(): void {
    this.api.markAllNotificationsRead().subscribe(() => {
      this.notifications.update(list => list.map(x => ({ ...x, read: true })));
      this.unreadCount.set(0);
    });
  }
}
```

- [ ] **Step 2: Template**

`frontend/src/app/shared/components/notifications-bell/notifications-bell.component.html`:

```html
<div class="relative inline-block">
  <button type="button" (click)="togglePanel()"
    class="relative text-on-surface-variant hover:text-primary-fixed transition-colors">
    <span class="material-symbols-outlined text-[22px]">notifications</span>
    @if (unreadCount() > 0) {
      <span class="absolute -top-1 -right-1 min-w-[16px] h-4 bg-error text-on-error text-[9px] font-bold rounded-full flex items-center justify-center px-1">
        {{ unreadCount() > 9 ? '9+' : unreadCount() }}
      </span>
    }
  </button>

  @if (showPanel()) {
    <div class="fixed inset-0 z-[55]" (click)="showPanel.set(false)"></div>
    <div class="absolute top-11 right-0 w-80 max-w-[90vw] bg-surface-container-low border border-outline-variant/20 rounded-md shadow-xl z-[60] animate-fade-in max-h-96 overflow-y-auto">
      <div class="flex items-center justify-between px-4 py-3 border-b border-outline-variant/10">
        <p class="text-on-surface text-xs font-headline font-bold uppercase tracking-widest">Notificações</p>
        <button type="button" (click)="markAllRead()" class="text-primary-fixed text-[10px] font-headline uppercase">Marcar todas como lidas</button>
      </div>
      @if (notifications().length === 0) {
        <p class="text-outline text-xs px-4 py-6 text-center">Nenhuma notificação ainda.</p>
      } @else {
        @for (n of notifications(); track n.id) {
          <button type="button" (click)="selectNotification(n)"
            class="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-surface-container transition-colors border-b border-outline-variant/10 last:border-0"
            [class.bg-surface-container]="!n.read">
            <span class="material-symbols-outlined text-[18px] text-primary-fixed flex-shrink-0 mt-0.5">{{ iconFor(n.type) }}</span>
            <div class="min-w-0 flex-1">
              <p class="text-on-surface text-xs font-headline font-bold truncate">{{ n.title }}</p>
              @if (n.body) {
                <p class="text-on-surface-variant text-[11px] mt-0.5 line-clamp-2">{{ n.body }}</p>
              }
            </div>
            @if (!n.read) {
              <span class="w-2 h-2 rounded-full bg-primary-fixed flex-shrink-0 mt-1"></span>
            }
          </button>
        }
      }
    </div>
  }
</div>
```

- [ ] **Step 3: Estilo**

`frontend/src/app/shared/components/notifications-bell/notifications-bell.component.scss`:

```scss
:host {
  display: contents;
}
```

- [ ] **Step 4: Build**

```bash
cd frontend
npx ng build --configuration=development
```

Esperado: limpo (componente ainda não é usado em nenhum lugar, mas precisa compilar).

- [ ] **Step 5: Commit**

```bash
git add src/app/shared/components/notifications-bell/
git commit -m "feat(shared): NotificationsBellComponent - sino + badge + painel compartilhado"
```

---

## Task 11: Frontend — sino no `athlete-shell`

**Files:**
- Modify: `frontend/src/app/layout/athlete-shell/athlete-shell.component.ts`
- Modify: `frontend/src/app/layout/athlete-shell/athlete-shell.component.html`

- [ ] **Step 1: Importar o componente**

Em `frontend/src/app/layout/athlete-shell/athlete-shell.component.ts`, o import/decorator atuais são:

```typescript
import { NotificationPermissionBannerComponent } from '../../shared/components/notification-permission-banner/notification-permission-banner.component';

@Component({
  selector: 'app-athlete-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, NotificationPermissionBannerComponent],
```

Viram:

```typescript
import { NotificationPermissionBannerComponent } from '../../shared/components/notification-permission-banner/notification-permission-banner.component';
import { NotificationsBellComponent } from '../../shared/components/notifications-bell/notifications-bell.component';

@Component({
  selector: 'app-athlete-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, NotificationPermissionBannerComponent, NotificationsBellComponent],
```

- [ ] **Step 2: Substituir o botão decorativo**

Em `frontend/src/app/layout/athlete-shell/athlete-shell.component.html`, atual:

```html
      <button type="button" class="text-on-surface-variant hover:text-primary-fixed transition-colors">
        <span class="material-symbols-outlined text-[22px]">notifications</span>
      </button>
```

Vira:

```html
      <app-notifications-bell />
```

- [ ] **Step 3: Build**

```bash
cd frontend
npx ng build --configuration=development
```

Esperado: limpo.

- [ ] **Step 4: Verificação manual via Chrome headless**

Login como atleta, confirmar que o sino aparece no topo com o mesmo visual de antes (ícone), clicar nele, confirmar que abre o painel (mesmo vazio, sem notificação nenhuma ainda nesse ponto do plano — as Tasks 4-7 já estão em produção, então pode já ter alguma). Lembrar de `Console.enable` no script de verificação.

- [ ] **Step 5: Commit**

```bash
git add src/app/layout/athlete-shell/
git commit -m "feat(athlete-shell): sino de notificacoes funcional (era decorativo)"
```

---

## Task 12: Frontend — sino no `coach-shell`

**Files:**
- Modify: `frontend/src/app/layout/coach-shell/coach-shell.component.ts`
- Modify: `frontend/src/app/layout/coach-shell/coach-shell.component.html`

- [ ] **Step 1: Importar o componente**

Em `frontend/src/app/layout/coach-shell/coach-shell.component.ts`, o import/decorator atuais são:

```typescript
import { NotificationPermissionBannerComponent } from '../../shared/components/notification-permission-banner/notification-permission-banner.component';
import { addUtcDays, toDateKey, utcDateFromIso } from '../../shared/utils/date-key';

@Component({
  selector: 'app-coach-shell',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterOutlet, RouterLink, NotificationPermissionBannerComponent],
```

Viram:

```typescript
import { NotificationPermissionBannerComponent } from '../../shared/components/notification-permission-banner/notification-permission-banner.component';
import { NotificationsBellComponent } from '../../shared/components/notifications-bell/notifications-bell.component';
import { addUtcDays, toDateKey, utcDateFromIso } from '../../shared/utils/date-key';

@Component({
  selector: 'app-coach-shell',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterOutlet, RouterLink, NotificationPermissionBannerComponent, NotificationsBellComponent],
```

- [ ] **Step 2: Adicionar o sino na sidebar**

Em `frontend/src/app/layout/coach-shell/coach-shell.component.html`, o bloco "Brand" atual é:

```html
    <!-- Brand -->
    <div class="px-6 mb-8">
      <h1 class="text-xl font-bold text-on-surface font-headline">Coach Premium</h1>
      <p class="text-[10px] text-primary-fixed tracking-widest uppercase font-headline mt-0.5">Nível Elite</p>
    </div>
```

Vira:

```html
    <!-- Brand -->
    <div class="px-6 mb-8 flex items-start justify-between">
      <div>
        <h1 class="text-xl font-bold text-on-surface font-headline">Coach Premium</h1>
        <p class="text-[10px] text-primary-fixed tracking-widest uppercase font-headline mt-0.5">Nível Elite</p>
      </div>
      <app-notifications-bell />
    </div>
```

- [ ] **Step 3: Build**

```bash
cd frontend
npx ng build --configuration=development
```

Esperado: limpo.

- [ ] **Step 4: Verificação manual via Chrome headless — ponta a ponta dos 4 triggers**

Login como coach, confirmar o sino visível na sidebar. Depois, testar cada trigger de verdade (reusa contas/dados já existentes no ambiente local):

1. `plan_published`: publicar um plano existente (ou criar um novo e publicar) → login como atleta, confirmar que a notificação aparece no sino do atleta.
2. `new_message`: mandar uma mensagem do coach pro atleta → confirmar notificação no sino do atleta.
3. `workout_skipped`: como atleta, pular um exercício/sessão → confirmar notificação no sino do coach.
4. `new_pr`: como atleta, registrar um PR que bate o recorde anterior de um movimento → confirmar notificação no sino do coach.

Em cada caso, confirmar (via `Network.enable` no script CDP) que a chamada `POST` relevante retorna 2xx, e (via `Console.enable`) que não há erro no console. Clicar na notificação recebida e confirmar que navega pro link certo e marca como lida (badge diminui).

- [ ] **Step 5: Commit**

```bash
git add src/app/layout/coach-shell/
git commit -m "feat(coach-shell): sino de notificacoes (novo - nao existia antes)"
```

---

## Task 13: Revisão final e merge

**Files:** nenhum arquivo novo — task de fechamento.

- [ ] **Step 1: Rodar a suíte de testes do backend inteira**

```bash
cd backend
source ~/.nvm/nvm.sh && nvm use 20
npm run test
```

Esperado: todos os specs passando (63 já existentes + os novos desta feature), nenhuma regressão.

- [ ] **Step 2: Rodar os dois builds**

```bash
cd backend && npm run build
cd ../frontend && npx ng build --configuration=development
```

Esperado: ambos limpos.

- [ ] **Step 3: Rodar a skill `security-review` no diff acumulado de cada repo**

Backend: foco em (a) todas as rotas `GET`/`PATCH /notifications*` operam sempre sobre `req.user.id`, nunca um `:userId` de path controlável pelo cliente; (b) `markAsRead` rejeita corretamente notificação de outro usuário (já coberto por TDD, mas vale a checagem visual do fluxo completo); (c) nenhum dos 4 pontos de trigger permite ao cliente forjar o `userId` destinatário da notificação (sempre resolvido a partir de dado já validado no servidor — `plan.student.userId`, `dto.toId` já é o destinatário real da mensagem que o remetente já tinha permissão de mandar, `student.coachId`, `student.coachId` de novo). Frontend: sem endpoint novo exposto, reusa autenticação já existente do `SocketService`.

- [ ] **Step 4: Abrir PRs (backend e frontend) e mergear**

Seguir o fluxo já estabelecido no projeto: push da branch, `gh pr create` com o template padrão, revisão, merge squash, `git pull` no `main` de cada repo, reiniciar os servidores locais com o código final.

- [ ] **Step 5: Atualizar a memória do projeto**

Registrar em `project_aevonfit.md`: central de notificações implementada e mergeada (sino que era decorativo agora funcional nos dois shells), model `Notification` novo, 4 triggers (`plan_published`, `new_message`, `workout_skipped`, `new_pr`), tempo real via WebSocket reusando `MessagesGateway`, `NotificationsBellComponent` (terceiro componente compartilhado do projeto), dependência circular `Notifications ↔ Messages` resolvida com `forwardRef()`.
