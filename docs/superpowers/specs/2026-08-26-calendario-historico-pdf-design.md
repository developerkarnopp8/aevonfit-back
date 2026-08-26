# Calendário de histórico + exportação em PDF — design

**Data:** 2026-08-26
**Repos afetados:** `aevonfit-back` (migração + `CreatePlanDto`) e `aevonfit-front` (UI do atleta e do coach)
**Pedido original:** "temos que ficar com historicos para futuras consultas pois toda semana tem atualizacao de treinos acho que deveria ter um calendario para voltarmos e permitir ate exporta o treino da semana ou ate do mes em PDF se fosse o caso."

## Contexto atual

- `TrainingPlan` já é um log-por-mesociclo: nada é sobrescrito quando um novo plano é criado — cada mês vira uma linha nova, sempre consultável via `GET /training-plans/student/:studentId` (retorna a lista completa, já com `weeks → days → sessions → exercises` aninhados).
- O que falta não são os dados (já persistem), é **navegação** pra voltar a planos passados (hoje `plan-builder`/`weekly-view` só mostram um plano por vez, sem seletor entre meses) e **exportação em PDF**.
- Achado técnico que muda o desenho original: `TrainingPlan.month` é um inteiro ordinal solto (ex: "Mesociclo 6" tem `month: 2` — não corresponde a fevereiro), e `Week`/`TrainingDay` não guardam nenhuma data real, só `weekNumber` e `dayIndex`/`dayOfWeek`. Um calendário de verdade (grid de dias do mês) não é possível sem uma data de âncora. Decisão tomada com o usuário: adicionar `startDate` ao `TrainingPlan`.
- Decisões já tomadas com o usuário nesta sessão de brainstorming:
  1. Escopo é **navegação entre planos/meses que já existem**, não versionamento de edições dentro de uma semana (não vira audit-log).
  2. Calendário e exportação em PDF servem **coach e atleta**.
  3. O seletor vive **dentro do `plan-builder`/`weekly-view` existentes**, não numa tela nova dedicada.
  4. Visual: **calendário de verdade** (grid mensal com dias reais), aberto por um **botão/ícone que abre modal** — não fica sempre visível na tela (o app do atleta é mobile-first, espaço vertical é escasso).
  5. PDF inclui **grade de exercícios + progresso já registrado pelo atleta** (não só a grade).
  6. Botão de exportar aparece em **dois níveis**: semana e mês.
  7. O campo "Mês" do modal "Novo Treino" (corrigido nesta mesma sessão pra sugerir o próximo mês livre) vira **"Data de Início"** — o número ordinal de mês continua existindo internamente (mantém a lógica de duplicata/ordenação já testada), mas some da tela.

## Modelo de dados

```prisma
model TrainingPlan {
  id        String   @id @default(uuid())
  studentId String
  coachId   String
  month     Int
  startDate DateTime  // NOVO — data real de início do mesociclo
  title     String
  published Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  // ...relations inalteradas
}
```

Migração em duas etapas (mesmo cuidado de sempre — container-sombra descartável, zero `DROP`, revisão do SQL gerado antes de aplicar):

```sql
-- 1. Coluna nullable primeiro
ALTER TABLE "training_plans" ADD COLUMN "startDate" TIMESTAMP(3);

-- 2. Backfill dos planos existentes: única fonte de verdade disponível
--    pra dado histórico é a data em que o plano foi criado no sistema.
--    date_trunc('week', ...) no Postgres já normaliza pra Segunda-feira
--    da semana (ISO 8601) — mesma normalização aplicada em planos novos.
UPDATE "training_plans" SET "startDate" = date_trunc('week', "createdAt") WHERE "startDate" IS NULL;

-- 3. Torna obrigatório depois do backfill
ALTER TABLE "training_plans" ALTER COLUMN "startDate" SET NOT NULL;
```

A data real de cada dia é sempre **derivada**, nunca armazenada em `Week`/`TrainingDay` (evita duplicar fonte de verdade e mantém os dois modelos inalterados).

**Atenção — achado do self-review do spec:** `dayIndex` já segue a convenção `1=Segunda, 2=Terça, ..., 6=Sábado` (confirmado em `TrainingPlansService`, método de inicialização de estrutura padrão — `0=Domingo` existe na enum mas não é usado na prática). Isso significa que `startDate` não pode ser somado direto com `dayIndex`; ele precisa representar **a Segunda-feira que começa a Semana 1**. Pra não depender do coach acertar isso manualmente, `startDate` é sempre normalizado (snap) pra a Segunda-feira da semana em que a data escolhida cai, no momento da criação do plano (tanto se o coach digitar quanto no auto-preenchimento). Fórmula final:

```
segunda_semana_1 = startDate  // já normalizado pra Segunda-feira na criação
data(semana N, dia com dayIndex D) = segunda_semana_1 + (N-1)*7 dias + (D-1) dias
```

`month` continua existindo e com a mesma função de hoje (ordinal interno pra ordenação/checagem de duplicata no modal "Novo Treino" — lógica já implementada e testada, não é tocada por esta feature). `startDate` é o único campo novo consumido pelo calendário e pelo PDF.

## API (backend)

Nenhum endpoint novo. Único ajuste:

- `CreatePlanDto` ganha `startDate: string` (ISO date, `@IsDateString()`), obrigatório.
- `TrainingPlansService.create` normaliza a data recebida pra Segunda-feira da mesma semana (snap-to-Monday, ver seção de modelo de dados acima) antes de gravar — nunca confia que o cliente já mandou uma Segunda-feira.
- `GET /training-plans/student/:studentId` (já existe) passa a retornar `startDate` em cada plano — nenhuma mudança de autorização ou de shape além do campo novo.
- Pro conteúdo "progresso já registrado" do PDF: reusa `GET /workout-logs/history` (atleta) e `GET /workout-logs/student/:studentId/history` (coach), ambos já existentes, chamados com um `limit` maior (ex: 500) no momento do export — cobre um mês inteiro de registros sem precisar de endpoint novo ou paginação.

## Frontend — Modal "Novo Treino" (ajuste)

- Campo "Mês" (input numérico) sai da tela. Entra "Data de Início" (`<input type="date">`), auto-sugerida como o dia seguinte ao fim do último plano do atleta (`último.startDate + último.weeks.length*7 dias`), ou hoje se o atleta não tem nenhum plano ainda — mesmo padrão de auto-sugestão (respeita edição manual do usuário) já implementado pro mês nesta mesma sessão.
- `month` continua sendo calculado automaticamente nos bastidores exatamente como já está hoje (`max(meses existentes) + 1`) — só não aparece mais no formulário.
- A lista "Planos já existentes deste atleta" (adicionada nesta sessão) passa a mostrar a data de início de cada um, não só "Mês N".
- A checagem de duplicata continua baseada em `month` (não em sobreposição de datas) — mudar pra checagem por intervalo de datas foi avaliado e descartado por ora (YAGNI: a quantidade de semanas de um plano pode mudar depois de criado, o que tornaria uma checagem de sobreposição instável; o aviso por mês ordinal já resolve o caso real que motivou o fix anterior).

## Frontend — Calendário (componente novo, compartilhado)

Novo componente standalone `PlanCalendarModalComponent`, em `frontend/src/app/shared/components/plan-calendar-modal/` (primeiro componente compartilhado entre telas de atleta e coach neste projeto — justificado porque a lógica de grid/navegação de mês é idêntica nos dois lugares, diferente do padrão de duplicação usado até aqui pra UI menor).

- **Input:** `plans: TrainingPlan[]` (lista completa do aluno, já têm `startDate`); `workoutDates?: Set<string>` (opcional — só o atleta passa isso, pro indicador de dia concluído; cada string é a data no formato `YYYY-MM-DD`, derivada de `WorkoutLog.completedAt` truncado pra data, sem hora — mesmo formato usado na comparação de células do grid).
- **Output:** `daySelected: EventEmitter<{ planId: string; weekNumber: number }>`.
- **Trigger:** botão de ícone `calendar_month` ao lado do título "Semana N" — em `plan-builder.component.html` (coach) e `weekly-view.component.html` (atleta).
- **Grid:** mês corrente por padrão (mês do dia de hoje, ou do plano atualmente selecionado), navegação `‹ Mês Ano ›`. Cada célula de dia:
  - Fora de qualquer plano (nenhum `startDate`+offset cai nele): desabilitado, cor apagada.
  - Dentro do intervalo de algum plano: clicável, com borda.
  - É hoje: contorno de destaque (reusa o mesmo conceito de `isToday` já usado no `weekly-view`).
  - (só quando `workoutDates` informado) Tem treino já registrado nessa data: preenchido com a cor primária, mesmo padrão de cor já usado nos pontinhos de progresso do dia.
- **Clique num dia coberto:** emite `{planId, weekNumber}` calculado a partir de qual plano/semana contém aquela data, fecha o modal. O componente pai (plan-builder ou weekly-view) troca `plan()` pro plano correspondente (se for diferente do atual) e seleciona a semana/dia.
- Dias fora de qualquer plano não emitem nada (clique é no-op).

## Frontend — Exportação em PDF

- Nova dependência: `jspdf` + `jspdf-autotable` (só cliente — sem geração no backend, sem Puppeteer).
- Novo utilitário compartilhado `frontend/src/app/shared/utils/plan-pdf-export.ts`, duas funções:
  - `exportWeekToPdf(plan, week, studentName, logs)` — uma semana.
  - `exportMonthToPdf(plan, studentName, logs)` — todas as semanas do plano.
- **Conteúdo do PDF:** cabeçalho com nome do atleta + título do plano + intervalo de datas; por dia, tabela de sessões/exercícios (nome, sets, reps, carga%, notas do coach); pra cada exercício que tem log do atleta casando por `exerciseId` e `completedAt` dentro do intervalo do dia, uma linha extra "✓ feito em DD/MM — N sets, nota".
- **Botões:**
  - "Exportar Semana" — perto do cabeçalho da semana selecionada (coach: `plan-builder`; atleta: `weekly-view`).
  - "Exportar Mês" — perto do título do plano, no topo de cada tela.
- **Busca de logs:** só no momento do clique em exportar (não pré-carregado) — chama `getWorkoutHistory(500)` (atleta) ou `getStudentHistory(studentId, 500)` (coach), filtra client-side pelas datas do período exportado.

## Erros e validação

- `POST /training-plans` sem `startDate` → 400 (`class-validator` já cobre, mesmo padrão do resto dos DTOs do projeto).
- Migração: se por algum motivo o backfill não rodar antes do `ALTER COLUMN ... SET NOT NULL`, a migração falha alto e visível (não passa silenciosamente) — checar isso no ambiente de destino antes de aplicar em produção.
- Calendário: dia clicado que não corresponde a nenhum plano é simplesmente não-clicável (sem toast/erro — estado visual já deixa claro que não tem nada ali).
- PDF: se o período exportado não tiver nenhum log do atleta, a tabela só mostra a grade planejada, sem a coluna de progresso vazia poluindo o layout.

## Testes

- Backend: teste de `TrainingPlansService.create` cobrindo que `startDate` é persistido corretamente (TDD, mock do Prisma — mesmo padrão já usado nos services desta sessão).
- Frontend: verificação manual via Chrome headless (mesmo padrão já usado nesta sessão) — abrir o calendário, navegar de mês, clicar num dia com plano, confirmar que troca de semana/plano corretamente; gerar um PDF de semana e de mês e confirmar que baixa sem erro no console.
- Migração: aplicada e revisada via container-sombra descartável antes de rodar no banco real, confirmando que os 2 planos existentes do Gustavo (Mês 1 e Mesociclo 6) recebem `startDate` a partir de `createdAt` sem erro.

## Fora de escopo (YAGNI, registrar como follow-up se pedido depois)

- Checagem de duplicata por sobreposição de intervalo de datas (mantém a checagem por `month` ordinal já existente — ver justificativa na seção do modal acima).
- Editar a `startDate` de um plano já criado (por enquanto é fixada na criação; se o coach errar, cria de novo — mesmo espírito append-only já usado no resto do projeto).
- Exportar o histórico de **múltiplos** meses num PDF só (ex: "trimestre inteiro") — só semana e mês individuais, como pedido.
- Enviar o PDF automaticamente por mensagem/e-mail — só download local, como os outros exports do tipo no mercado costumam começar.
