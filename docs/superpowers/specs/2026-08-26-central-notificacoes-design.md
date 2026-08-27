# Central de notificações — design

**Data:** 2026-08-26
**Repos afetados:** `aevonfit-back` (schema + API + gateway) e `aevonfit-front` (UI do atleta e do coach)
**Pedido original:** "Praque serve o icone do sininho?" → confirmado que o sino não fazia nada (placeholder decorativo) → "Pode implementar" → escolhido entre "badge de mensagem não lida" (pequeno) e "central de notificações de verdade" (esta feature).

## Contexto atual

- O sino existe hoje só no `athlete-shell` (`athlete-shell.component.html`), sem `(click)`, sem badge — puramente decorativo. Não existe no `coach-shell`.
- O único mecanismo de "aviso" que já existe é o chat (`Message`, com flag `isSystem` pra mensagens automáticas — ex: quando o atleta pula um treino, uma mensagem de sistema é enviada ao coach) + o badge de não lidas na aba Mensagens + push em tempo real via `MessagesGateway` (namespace WebSocket `/messages`, mapa `userId → socketId`).
- Decisões já tomadas com o usuário nesta sessão de brainstorming:
  1. O painel de notificações é pros dois papéis (atleta e coach), não só o atleta.
  2. Eventos que geram notificação: coach publicou plano novo (pro atleta), mensagem nova de verdade — não automática (pros dois lados), atleta pulou treino (pro coach), atleta bateu novo PR (pro coach).
  3. "Atleta pulou treino" vira notificação própria, **não** conta como "mensagem nova" — mesmo hoje esse evento já gerar uma mensagem de sistema no chat. Evita notificação duplicada pro mesmo evento.
  4. Tempo real via WebSocket, reusando o gateway `/messages` já existente (não cria namespace novo).

## Modelo de dados

Log-por-evento, mesmo padrão já estabelecido no projeto (nunca sobrescreve, cada notificação é uma linha própria):

```prisma
model Notification {
  id        String   @id @default(uuid())
  userId    String   // destinatário
  type      String   // 'plan_published' | 'new_message' | 'workout_skipped' | 'new_pr'
  title     String
  body      String?
  link      String?  // rota do frontend pra abrir ao clicar (ex: '/athlete/weekly')
  read      Boolean  @default(false)
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("notifications")
}
```

`User` ganha a relação reversa `notifications Notification[]`, mesmo padrão já usado pra `workoutSkips`/`hydrationLogs`/etc.

Migração puramente aditiva (1 `CREATE TABLE`, 1 `ADD CONSTRAINT`, zero `DROP`), gerada via container-sombra descartável.

## API (backend)

Todas as rotas atrás de `JwtAuthGuard`, sempre restritas ao próprio usuário logado (`req.user.id` — nunca um `:userId` de path param, pra não abrir IDOR de notificação de outro usuário):

- `GET /notifications` — lista as últimas 30 notificações do usuário logado, mais recente primeiro.
- `GET /notifications/unread-count` — `{ count: number }`, pro badge do sino.
- `PATCH /notifications/:id/read` — marca uma notificação como lida. Confere `notification.userId === req.user.id` antes de atualizar (senão `ForbiddenException`) — mesma cautela de ownership já padrão no projeto.
- `PATCH /notifications/read-all` — marca todas as notificações não lidas do usuário logado como lidas.

`NotificationsService.create(userId, type, title, body?, link?)` é o único ponto de escrita — chamado internamente por outros services (nunca exposto como endpoint público de criação; notificação é sempre efeito colateral de uma ação real do sistema, não algo que um cliente possa forjar diretamente).

## Tempo real (WebSocket)

Reusa `MessagesGateway` (`/messages`, já conectado por todo usuário logado, já mantém o mapa `userId → socketId`). Ganha um método novo:

```typescript
emitNotification(userId: string, notification: object): void {
  const socketId = this.userSockets.get(userId);
  if (socketId) {
    this.server.to(socketId).emit('new_notification', notification);
  }
}
```

`NotificationsService.create()` chama esse método logo depois de gravar no banco.

**Dependência circular módulo-a-módulo:** `NotificationsModule` precisa de `MessagesGateway` (de `MessagesModule`) pro push em tempo real; `MessagesModule` precisa de `NotificationsService` (de `NotificationsModule`) pra criar a notificação "mensagem nova" quando `POST /messages` recebe uma mensagem que não é de sistema. Resolvido com `forwardRef()` dos dois lados (`@Module({ imports: [forwardRef(() => OutroModule)] })` + `@Inject(forwardRef(() => Classe))` no construtor do lado que precisa) — mesma técnica que `MessagesService` já usa hoje pra `MessagesGateway` dentro do próprio módulo, só que agora entre dois módulos. `MessagesModule` passa a exportar `MessagesGateway` além de `MessagesService` (hoje só exporta o service).

## Triggers — onde cada evento dispara `NotificationsService.create`

- **`plan_published`** — `TrainingPlansService.publish()`, depois de marcar o plano como publicado. Resolve o `userId` do atleta a partir de `plan.studentId` (`Student.userId`). Link: pra tela semanal do atleta.
- **`new_message`** — `MessagesController.send()` (não `MessagesService.send()` — fica no controller de propósito, é o único ponto de entrada de mensagem que não é de sistema, mantém a checagem `isSystem` fora do service). Só dispara pra mensagens reais (não as de sistema geradas por skip). Link: tela de mensagens do destinatário.
- **`workout_skipped`** — `WorkoutSkipsService.create()`, logo depois de enviar a mensagem de sistema pro coach (que continua existindo, aparece no chat normalmente). Notificação separada, com o mesmo conteúdo resumido. Link: pro `plan-builder` do aluno que pulou.
- **`new_pr`** — `PersonalRecordsService.create()`, comparação feita **campo a campo**, independente:
  - Antes de criar, busca todos os registros existentes do atleta pra aquele `movementId`.
  - Se `dto.loadKg` foi informado: compara contra o maior `loadKg` já registrado (ignorando registros onde `loadKg` é `null`). Se não existe nenhum registro anterior com `loadKg`, ou se `dto.loadKg` é maior que esse máximo, é um novo PR de carga.
  - Se `dto.reps` foi informado: mesma lógica, comparando contra o maior `reps` já registrado.
  - Um registro pode disparar notificação por carga, por reps, pelos dois (se os dois campos vierem preenchidos e os dois baterem recorde), ou nenhuma (se nenhum dos dois superar o histórico) — nesse último caso, o registro é salvo normalmente, só não gera notificação.
  - Dispara no máximo **uma** notificação por chamada (mesmo se os dois campos baterem recorde), com o texto mencionando qual(is) métrica(s) bateu(ram).
  - Resolve o coach do atleta (mesmo padrão de `MovementsService.resolveCoachId`). Link: pro `plan-builder` do aluno.

## Frontend

Novo componente compartilhado `NotificationsPanelComponent` (`shared/components/notifications-panel/`, segundo componente compartilhado entre atleta e coach do projeto, depois do `PlanCalendarModalComponent`) — modal overlay (mesmo padrão visual já usado no calendário e no "Novo Treino"), auto-contido: busca as próprias notificações, se inscreve no `SocketService` pra tempo real, sem inputs do componente pai.

- Sino (nos dois shells) ganha `(click)` que abre o painel + badge de contagem (mesmo estilo visual já usado no badge de mensagens não lidas da nav do atleta — círculo vermelho, `9+` acima de 9).
- Contagem inicial vem de `GET /notifications/unread-count` no `ngOnInit` (diferente do badge de mensagens hoje, que só conta a partir de eventos recebidos na sessão atual e começa zerado a cada reload — esse é um comportamento pré-existente que não faz parte desta feature, não será tocado).
- Novo Angular `NotificationsService` (`core/services/`): `getNotifications()`, `getUnreadCount()`, `markAsRead(id)`, `markAllAsRead()`.
- `SocketService` ganha `readonly newNotification$ = new Subject<AppNotification>()`, escutando o evento `new_notification` do socket já conectado (mesma conexão usada pras mensagens, sem socket novo).
- Painel: lista de notificações (ícone por `type`, título, tempo relativo, estado lido/não-lido visualmente diferente), botão "Marcar todas como lidas". Clicar numa notificação: marca como lida (`PATCH /notifications/:id/read`) + navega pro `link` dela + fecha o painel. Abrir o painel **não** marca tudo como lido automaticamente (usuário escolheu esse comportamento).
- `coach-shell` ganha o sino pela primeira vez (hoje não tem nenhum) — posicionado na sidebar, perto do topo (mesma área onde ficaria naturalmente ao lado do nome do coach).

## Erros e validação

- `PATCH /notifications/:id/read` numa notificação de outro usuário → `ForbiddenException` (403), mesmo padrão de ownership já usado em todo o projeto.
- `PATCH /notifications/:id/read` num id inexistente → `NotFoundException` (404).
- Nenhum endpoint de criação exposto publicamente — notificação só nasce como efeito colateral de uma ação real (publicar plano, mandar mensagem, pular treino, bater PR), nunca de um payload arbitrário do cliente.
- Se o usuário não estiver conectado ao WebSocket no momento (offline), a notificação já foi gravada no banco — aparece normalmente na próxima vez que o `GET /notifications`/`unread-count` for chamado (login, abrir o painel). O tempo real é um extra, não a única forma de entrega.

## Testes

TDD no `NotificationsService` (mock do Prisma e do `MessagesGateway`, cobertura de: criação básica, ownership check no `markAsRead`, `markAllAsRead` só afeta o próprio usuário) e nos 4 pontos de trigger (cada service ganha um teste confirmando que `NotificationsService.create` é chamado com os parâmetros certos quando o evento acontece). Pra "new_pr" especificamente: teste do primeiro registro daquele movimento (sempre notifica), teste de carga batendo recorde mas reps não (notifica só por carga), teste de nenhum dos dois batendo recorde (não notifica, mas o registro é salvo normalmente).

## Fora de escopo (YAGNI, registrar como follow-up se pedido depois)

- Paginação de `GET /notifications` (30 mais recentes cobre o caso de uso real por enquanto).
- Preferências de notificação (desligar um tipo específico) — não pedido.
- Notificação por email/push do navegador pra esses 4 eventos — hoje só existe Web Notification pra mensagem de chat (`SocketService.showBrowserNotification`), que continua como está; não estender pros novos tipos por enquanto.
- Corrigir o comportamento pré-existente do badge de mensagens não lidas (zera a cada reload, não busca contagem real do servidor) — bug antigo, fora do escopo desta feature, mas registrado aqui como observação pra não confundir com o comportamento novo do sino de notificações (que busca a contagem real corretamente).
