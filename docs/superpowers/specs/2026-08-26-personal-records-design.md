# Recordes pessoais (PR/1RM) — design

**Data:** 2026-08-26
**Repos afetados:** `aevonfit-back` (schema + API) e `aevonfit-front` (UI do atleta e do coach)
**Pedido original:** "a possibilidade de ter todos os movimentos do crossfit para o Atleta colocar seu PR ou RM, resumindo sua carga maxima para um rep. e o Coach deve poder ter analise de graficos sobre o aumento de forca no atleta alem de poder cadastrar algum exercicio que nao tiver olhando para reps ou carga"

## Contexto atual

- `ExerciseLibrary` já existe, mas é um catálogo **por coach** de exercícios pra reaproveitar ao montar planos (sets/reps/duração/descanso/carga% — parâmetros de programação, não recordes pessoais).
- Não existe hoje nenhum conceito de "recorde pessoal" ou "1RM" no app — nada rastreia a evolução de força do atleta ao longo do tempo.
- O padrão já estabelecido no projeto pra esse tipo de dado (ver `WorkoutLog`, `HydrationLog`, `CalorieLog`, `WorkoutSkip`) é **log por evento**: cada registro é uma linha imutável no tempo, nunca um valor único que se sobrescreve. Isso dá histórico/gráfico de graça, sem precisar de job de recálculo. Esta feature segue o mesmo padrão.
- Decisões já tomadas com o usuário nesta sessão de brainstorming:
  1. Catálogo de movimentos é **global** (compartilhado entre todos os coaches, pré-populado com os movimentos padrão de CrossFit) — coach pode adicionar um movimento customizado, que fica visível só pros próprios alunos.
  2. Um movimento pode ter PR em **carga (kg) e/ou repetições**, os dois opcionais por registro — cobre tanto levantamentos (Back Squat, Snatch) quanto movimentos de corpo livre (Pull-up, Muscle-up, medidos em reps máximas).
  3. Atleta registra na tela nova "Meus Recordes".

## Modelo de dados

```prisma
model Movement {
  id        String   @id @default(uuid())
  name      String
  category  String   // mesmas categorias já usadas em ExerciseLibrary: LPO, Força, Ginástica, Metcon, Resistência, Mobilidade, Core, Outro
  coachId   String?  // null = movimento padrão global; preenchido = customizado por um coach, só pros alunos dele
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

Regra de aplicação (checada no backend, DTO): pelo menos um entre `loadKg`/`reps` deve estar presente em cada registro — nunca os dois ausentes ao mesmo tempo (um registro sem nenhum valor não significa nada).

O "PR atual" de um movimento nunca é um campo armazenado — é sempre derivado como o maior `loadKg` (ou maior `reps`, pro caso de movimento sem carga) dentre todos os registros daquele atleta pra aquele movimento. Isso mantém o histórico honesto (inclui tentativas que não bateram recorde) e o "recorde" sempre correto sem precisar de sincronização.

`Movement` não referencia `User` com nome de relação explícito porque é a única FK de `Movement` apontando pra `User` (sem ambiguidade, diferente do caso de `Student`, que tem duas FKs pra `User`). O model `User` ganha as duas relações reversas nos campos já existentes (mesmo padrão de `workoutSkips`, `hydrationLogs`, `calorieLogs` adicionados nesta sessão):

```prisma
model User {
  // ...campos existentes...
  movements       Movement[]
  personalRecords PersonalRecord[]
}
```

## API (backend)

Todas as rotas atrás de `JwtAuthGuard` + `RolesGuard`, seguindo o padrão de segurança já estabelecido no projeto (ownership check via `StudentsService.findOne` sempre que uma rota de coach acessa dado de um aluno específico).

- `GET /movements` — catálogo disponível pro usuário logado: todos os globais (`coachId: null`) + os customizados do próprio coach (se coach) ou do coach do próprio aluno (se atleta). Sem `@Roles`, os dois papéis usam.
- `POST /movements` (`@Roles('coach')`) — cria movimento customizado, `coachId = req.user.id`. Body: `{ name, category }`.
- `POST /personal-records` (`@Roles('athlete')`) — registra uma tentativa. Body: `{ movementId, loadKg?, reps?, note? }`. Validação: exatamente `loadKg` e/ou `reps` presente (pelo menos um). `athleteId = req.user.id`, `achievedAt = now()` (não vem do cliente — evita registro retroativo forjado, mesma cautela do resto do projeto).
- `GET /personal-records/me` (`@Roles('athlete')`) — meu histórico completo, agrupado por movimento no frontend (a API retorna a lista flat com `movement` incluído, o agrupamento é responsabilidade do cliente, igual ao padrão já usado em `groupedItems`/`groupedLibraryItems` no frontend).
- `GET /personal-records/student/:studentId/history` (`@Roles('coach')`) — histórico completo de um aluno específico, pro gráfico de evolução. Ownership check via `StudentsService.findOne(studentId, user)` antes de buscar qualquer dado — mesmo padrão de defesa em profundidade já usado em `SessionsService.findById` (checa posse com uma query mínima antes de trazer dado sensível).

## Seed inicial do catálogo global

Script one-off (`backend/scripts/seed-movements-catalog.ts`), mesmo padrão do `seed-exercise-library-from-plan.ts` já usado nesta sessão — roda uma vez, idempotente (pula nomes que já existem como `coachId: null`).

Lista inicial (~23 movimentos, cobrindo os três grupos que já aparecem nos planos reais importados nesta sessão):

**LPO:** Snatch, Power Snatch, Clean, Power Clean, Clean & Jerk, Jerk, Split Jerk, Push Jerk

**Força:** Back Squat, Front Squat, Overhead Squat, Deadlift, Sumo Deadlift, Bench Press, Strict Press, Push Press, Thruster

**Ginástica** (medidos em reps máximas, sem carga): Pull-up, Strict Pull-up, Muscle-up, Handstand Push-up, Ring Dip, Toes-to-Bar

## Frontend — Atleta

Tela nova `/athlete/records` ("Meus Recordes"), acessada por um link dentro da aba **Evolução** já existente na navegação (não adiciona ícone novo na nav inferior — mantém a nav limpa, mesma decisão já validada nesta sessão pra outras telas).

- Movimentos agrupados por categoria, mesmo padrão accordion já usado na Biblioteca do coach (primeira categoria aberta por padrão, categoria com resultado de busca sempre expandida).
- Cada movimento mostra: nome, PR atual (maior `loadKg` e/ou maior `reps` já registrado), data do último registro.
- Botão "Registrar tentativa" abre um formulário simples: campo carga (kg, opcional), campo reps (opcional), nota (opcional). Botão desabilitado até pelo menos um dos dois campos ser preenchido — mesmo padrão de validação já usado no modal de skip (`canConfirm`).
- Ao confirmar: se o valor bater ou superar o PR atual daquele campo, mostra um toast/destaque visual de "novo recorde!" — reforço positivo simples, sem lógica de negócio adicional (é só comparação no cliente contra o PR já carregado).

## Frontend — Coach

Nova seção colapsável "Recordes de Força" no `plan-builder`, mesmo padrão accordion recolhido por padrão já usado pra "Hidratação & Calorias" (adicionado nesta mesma sessão) — evita empilhar mais uma seção sempre expandida acima do plano de treino.

- Lista dos movimentos que o aluno já registrou pelo menos uma vez, cada um mostrando o PR atual e a variação desde o registro anterior (seta pra cima/baixo/igual).
- Clicar num movimento expande um gráfico de linha simples (mesmo estilo hand-rolled em divs já usado no gráfico de hidratação — sem biblioteca externa) mostrando a progressão de `loadKg` (ou `reps`, pro grupo de Ginástica) ao longo do tempo.

## Erros e validação

- `POST /personal-records` com `loadKg` e `reps` os dois ausentes → 400, mensagem clara ("Informe carga e/ou repetições").
- `POST /movements` (coach) duplicando um nome que já existe no catálogo global ou no próprio catálogo customizado → permitido no backend (sem `@@unique`, mesma decisão já tomada pra `TrainingPlan`/`Week` nesta sessão — simplicidade sobre restrição rígida), mas o frontend filtra/avisa se o nome já existe antes de submeter, pra reduzir o caso comum sem precisar de constraint no banco.
- Atleta tentando `POST /movements` ou `GET /personal-records/student/:id/history` → 403 via `RolesGuard`, mesmo padrão do resto do projeto.
- Coach tentando ver histórico de aluno que não é seu → 403 via `StudentsService.findOne`, mesmo padrão do resto do projeto.

## Testes

TDD nos services novos (`MovementsService`, `PersonalRecordsService`), seguindo o padrão já estabelecido nesta sessão: mock do Prisma, cobertura de agregação (PR = maior valor do histórico), ownership check (coach dono vs não-dono), e o caso de validação (nem carga nem reps).

## Fora de escopo (YAGNI, registrar como follow-up se pedido depois)

- Edição/exclusão de um registro de PR já lançado (por enquanto, log é append-only, igual a `WorkoutLog`/`HydrationLog` — se o atleta errar um valor, registra outro corrigindo, não edita o histórico).
- Metas de PR (ex: "quero chegar a 100kg no Back Squat") — feature separada, não pedida.
- Notificação automática pro coach quando o atleta bate um novo recorde (a feature de skip já tem esse padrão de mensagem automática — poderia reaproveitar depois, mas não foi pedido agora).
