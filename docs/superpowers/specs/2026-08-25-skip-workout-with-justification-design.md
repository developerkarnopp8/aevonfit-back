# Pular treino com justificativa — design

**Data:** 2026-08-25
**Repos afetados:** `aevonfit-back` (schema + API) e `aevonfit-front` (UI do atleta e do coach)
**Pedido original:** atleta quer poder pular um exercício ou uma sessão inteira, escolhendo um motivo, decidindo se vai fazer depois (fica pendente) ou desistir de vez (some da lista de pendências) — e o coach precisa ficar sabendo, tanto por mensagem quanto por um indicador visual no painel de alunos.

## Contexto atual

- `Exercise` não tem campo de status próprio — "concluído" hoje é inferido pela existência de um `WorkoutLog` para aquele `exerciseId`/`athleteId`.
- O botão "Pular" já existe na tela de treino ativo (`active-workout.component.ts` → `skipExercise()`), mas hoje só avança pro próximo exercício sem registrar nada — não fica rastro de que foi pulado nem por quê.
- Não existe hoje nenhum conceito de "pular a sessão inteira" antes de começar.
- Mensagens entre coach e atleta já existem (`Message` model + `MessagesGateway` via WebSocket), mas toda mensagem hoje é escrita por uma pessoa — não existe conceito de mensagem gerada pelo sistema.
- A tela "Alunos" do coach (`students` feature) lista os alunos mas não tem nenhum indicador de pendência/alerta hoje.

## Modelo de dados

Novo model `WorkoutSkip`, separado de `WorkoutLog` (que representa treino **realmente feito** — sets, reps completados de verdade). Misturar os dois faria toda query que hoje assume "existe `WorkoutLog` ⇒ fez o treino" ficar ambígua.

```prisma
enum SkipReason {
  NoTime
  Injury
  Later
  Other
}

enum SkipDecision {
  Postponed   // "vou fazer depois" — continua pendente
  Abandoned   // "finalizar" — para de aparecer como pendência
}

model WorkoutSkip {
  id          String       @id @default(uuid())
  exerciseId  String?
  sessionId   String?
  athleteId   String
  reason      SkipReason
  note        String?      // obrigatório no frontend só quando reason = Other
  decision    SkipDecision
  createdAt   DateTime     @default(now())

  exercise Exercise? @relation(fields: [exerciseId], references: [id], onDelete: Cascade)
  session  Session?  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  athlete  User      @relation(fields: [athleteId], references: [id], onDelete: Cascade)

  @@map("workout_skips")
}
```

Regra de aplicação (checada no backend, não só no frontend): exatamente um entre `exerciseId`/`sessionId` deve estar presente — nunca os dois, nunca nenhum.

Acréscimo em `Message`:

```prisma
model Message {
  // ...campos existentes...
  isSystem Boolean @default(false)
}
```

Mensagens automáticas (skip) são criadas com `isSystem: true`, `fromId` = o próprio atleta (mantém a relação existente `SentMessages`/`ReceivedMessages` sem precisar de um "usuário sistema" fictício), `toId` = o coach dono do aluno. O frontend estiliza `isSystem: true` diferente (itálico/cinza, sem bolha colorida de "enviado por mim").

**Migração:** seguir o procedimento seguro já documentado no projeto (container-sombra descartável pra gerar o diff, nunca `migrate dev` não-interativo direto no banco real — ver `backend/scripts/generate-migration.sh`).

## Backend — API

Novo módulo `workout-skips` — próprio, não dentro de `workout-logs`, porque semanticamente é sobre "não fez" e não sobre "log de execução":

- `POST /workout-skips` — body: `{ exerciseId? , sessionId?, reason, note?, decision }`. Verifica que o exercício/sessão pertence a um `Student` cujo `userId` é o atleta autenticado (mesmo padrão de ownership já usado em `WorkoutLogsService`/`StudentsService.findOne`). Cria o `WorkoutSkip` e, na mesma operação, cria a `Message` automática (`isSystem: true`) pro coach dono do aluno — e emite o evento no `MessagesGateway` (mesmo mecanismo que já notifica mensagem nova em tempo real).
- `GET /workout-skips/pending-count` (coach, autenticado) — retorna, só para os alunos desse coach (`Student.coachId === req.user.id`), quantos `WorkoutSkip` com `decision: Postponed` existem sem nenhum `WorkoutLog` criado **depois** do `createdAt` desse skip pro mesmo `exerciseId` (ou seja, ainda não foi de fato feito depois de ter sido adiado). Usado pro badge na tela de Alunos.

Cálculo de status de um exercício/sessão pro frontend (dashboard, weekly-view) passa a considerar 3 estados em vez de 2:
1. **Feito**: existe `WorkoutLog`.
2. **Pulado, pendente**: existe `WorkoutSkip` com `decision: Postponed` e não existe `WorkoutLog` mais recente.
3. **Pulado, abandonado**: existe `WorkoutSkip` com `decision: Abandoned` (não conta como pendência, mas pode mostrar um selo "pulado" em vez de vazio).
4. **Não iniciado**: nenhum dos dois.

## Frontend — Atleta

- `active-workout.component.ts`: `skipExercise()` deixa de avançar direto — abre um modal (`SkipReasonModalComponent`, novo, compartilhado) com os chips de motivo + nota opcional (obrigatória se "Outro") + toggle Postergar/Finalizar. Só avança de fato depois de confirmar.
- Novo botão "Pular sessão" na tela `session-detail` (antes de "Iniciar Modo Treino") — mesmo modal, mas cria o skip com `sessionId` em vez de `exerciseId`.
- Dashboard (`home.component.ts`) e `weekly-view`: itens com skip "Postergado" continuam na lista de pendência (talvez com um pequeno ícone de "pulado antes"); "Abandonado" ganha um estado visual próprio (ex: ícone cinza riscado) em vez de simplesmente sumir ou ficar "Agendado" pra sempre.

## Frontend — Coach

- Chat (`messages` feature, coach e atleta): mensagens com `isSystem: true` renderizam num estilo distinto (itálico, sem bolha colorida, sem alinhamento esquerda/direita — centralizado como um "aviso do sistema", padrão comum em apps de chat).
- Tela "Alunos": badge pequeno (contagem) em cada card de aluno com pulos pendentes, vindo de `GET /workout-skips/pending-count`.

## Fora de escopo (não pedido, não fazer agora)

- Não vamos criar uma tela dedicada de "histórico de pulos" — por enquanto o rastro fica só no chat + no badge.
- Não vamos deixar o **coach** desfazer/aprovar um skip — é só informativo por agora.
- Financeiro e IA pós-treino continuam fora, como já combinado antes.
