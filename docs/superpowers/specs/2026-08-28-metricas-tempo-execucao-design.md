# Métricas reais de execução — checkout de sessão + tempo

**Data:** 2026-08-28
**Projeto:** AevonFit / PulseRx (backend `aevonfit-back`, frontend `aevonfit-front`)
**Bloco:** 1 de 4 do roadmap de gaps do checklist funcional
**Path:** arquitetural (mexe em schema + módulo novo + 5 telas)

## Problema

O sistema hoje não tem nenhuma noção de **tempo de execução**:

- `grep` amplo por `durationSeconds`/`elapsedTime`/`executionTime` não
  retorna nada — nem no schema, nem na UI.
- Não existe "checkout" de sessão: `session.status` é derivado no
  cliente (`api.service.ts`, `computeStatus`) apenas de "todo exercício
  concluído". Sem botão de finalizar, sem duração total, sem tela de
  resumo — `active-workout.component.ts` só navega embora no fim.
- O checklist funcional do coach pede "tempo de execução do exercício",
  "média de tempo executado" no card do dashboard e na listagem de
  alunos — tudo depende de uma métrica que não existe.

## Objetivo

Capturar e persistir o tempo real de execução, por exercício e por
sessão, e expor essas métricas nas telas do atleta (resumo pós-treino,
histórico) e do coach (dashboard, listagem de alunos, plan-builder,
detalhe da sessão).

## Decisões de design (confirmadas com o usuário)

| Tema | Decisão |
|---|---|
| Granularidade | Sessão inteira **e** por exercício |
| Medição do exercício | **Ativo**: botão "Iniciar exercício" / "Concluir exercício" (cronômetro count-up) |
| Checkout | **Botão explícito + tela de resumo**; atleta pode finalizar com exercícios pendentes (`status: Partial`) |
| Sessão interrompida | **Client-side + rascunho `localStorage`**; grava no backend só no checkout |
| Telas do coach | Dashboard, Listagem de alunos, Plan-builder, Detalhe da sessão (todas) |

## Abordagem escolhida (A)

`WorkoutSession` gravada no checkout + `durationSeconds` incremental no
`WorkoutLog`. Sem estado de "sessão em andamento" no backend — isso fica
como evolução futura (abordagem C, rejeitada por ora).

## Arquitetura

### 1. Modelo de dados

**Alteração em `WorkoutLog`:**

```prisma
model WorkoutLog {
  // ...campos existentes...
  durationSeconds Int?   // tempo de execução real do exercício (Iniciar→Concluir)
}
```

**Model novo `WorkoutSession`** (sessão executada — log por evento, várias
execuções da mesma sessão pelo mesmo atleta são permitidas):

```prisma
model WorkoutSession {
  id             String               @id @default(uuid())
  sessionId      String               // FK → Session (sessão do plano)
  athleteId      String               // FK → User
  startedAt      DateTime             // 1º "Iniciar exercício" do treino
  finishedAt     DateTime             // toque em "Finalizar treino"
  elapsedSeconds Int                  // finishedAt - startedAt (relógio de parede)
  activeSeconds  Int                  // soma dos durationSeconds dos exercícios
  status         WorkoutSessionStatus // Completed | Partial
  createdAt      DateTime             @default(now())

  session Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  athlete User    @relation(fields: [athleteId], references: [id], onDelete: Cascade)

  @@index([athleteId])
  @@index([sessionId])
  @@map("workout_sessions")
}

enum WorkoutSessionStatus {
  Completed
  Partial
}
```

- `status = Completed` quando todo exercício da sessão tem `WorkoutLog`
  do atleta; senão `Partial`.
- **Sem FK `WorkoutLog → WorkoutSession`**: a associação "logs desta
  execução" já é feita hoje por `Session.exercises → WorkoutLog{athleteId}`
  — reaproveitada.
- **Migração puramente aditiva** (campo opcional + tabela + enum novos).
  Aplicada via container-sombra descartável, nunca `migrate dev`
  não-interativo nem `migrate diff` apontando pro banco real.

### 2. API (backend NestJS)

Módulo novo `src/workout-sessions/` (controller + service + module +
DTOs), padrão idêntico aos módulos existentes.

| Rota | Guard | Descrição |
|---|---|---|
| `POST /workout-sessions` | `JwtAuthGuard` (atleta) | Body `{ sessionId, startedAt, finishedAt }`. Valida ownership subindo `Session → day → week → plan → student` e chamando `StudentsService.findOne(studentId, user)`. Backend calcula `elapsedSeconds = finishedAt - startedAt`, `activeSeconds` = soma dos `WorkoutLog.durationSeconds` do atleta para os exercícios da sessão, deriva `status`. Cria o registro. |
| `GET /workout-sessions/me` | atleta | Histórico das sessões executadas do próprio atleta (`session.name`, plano, `startedAt`, `elapsedSeconds`, `activeSeconds`, `status`). |
| `GET /workout-sessions/student/:studentId/summary` | `@Roles('coach')` | nº de treinos, `elapsedSeconds` médio, tendência (média das últimas 3 execuções vs média das 3 anteriores → `up`/`down`/`equal`/`new`, mesmo vocabulário da seção "Recordes de Força"), média de `durationSeconds` por exercício. Ownership via `StudentsService.findOne`. |
| `GET /workout-sessions/student/:studentId/session/:sessionId` | `@Roles('coach')` | Detalhe: cada exercício da sessão + `durationSeconds` do último `WorkoutLog` do aluno + total. Ownership via `StudentsService.findOne`. |
| `GET /workout-sessions/coach/avg-duration` | `@Roles('coach')` | Dashboard: tempo médio de treino agregado dos alunos do coach (últimos 30 dias) + série por aluno (para a listagem de Alunos). |

**Alteração em `WorkoutLogsService.logExercise`**: `CreateWorkoutLogDto`
ganha `durationSeconds?: number` (`@IsInt() @Min(0) @IsOptional()`),
gravado no `WorkoutLog`. Nada mais muda nessa rota.

**Segurança**: toda rota de coach passa por
`StudentsService.findOne(studentId, user)` — mesmo padrão anti-IDOR já
consolidado no projeto (students, daily-intake, personal-records).
`security-review` no diff acumulado antes do merge (toca dado de aluno).

**TDD**: testes de service para cálculo de `status`/`activeSeconds`,
ownership (coach dono → ok, coach sem relação → 403), agregações
(`summary`, `avg-duration`). Suíte completa verde antes de qualquer
merge.

### 3. Frontend (Angular)

#### 3.1 Execução do atleta — `active-workout.component.ts`

Maior mudança. A fase `exercise` ganha sub-estados:

- `idle` → mostra **"Iniciar exercício"**.
- `running` → cronômetro count-up visível + **"Concluir exercício"**.
- Ao concluir → descanso (medido à parte, **não** entra em
  `activeSeconds`) → próximo exercício.

Regras:

- `startedAt` da sessão = primeiro "Iniciar exercício" do treino.
- `durationSeconds` do exercício = wall time entre Iniciar e Concluir,
  enviado no `logExercise` (`ApiService.logExercise` ganha o parâmetro).
- Exercícios com `duration` parseável (contagem regressiva atual)
  mantêm o alvo na tela **como guia visual**; o tempo gravado é sempre
  o real cronometrado.
- Fase `done` deixa de ser tela vazia → **tela de resumo**: tempo total,
  tempo por exercício, concluídos vs pulados, botão **"Finalizar treino"**
  → `POST /workout-sessions` → navega para o histórico.
- Botão **"Finalizar treino agora"** disponível a qualquer momento →
  gera `status: Partial`.

#### 3.2 Rascunho `localStorage` — `shared/utils/workout-draft.ts`

- Chave `workout-draft:<sessionId>`.
- Salva `{ startedAt, currentIndex, phase, exerciseStartedAt,
  elapsedAccumulated, perExercise: { [exerciseId]: durationSeconds } }`
  a cada tick do cronômetro.
- No `ngOnInit`, se existe rascunho da mesma sessão → restaura estado +
  toast "Treino retomado".
- Limpo no checkout (sucesso do `POST`) ou ao concluir todos os
  exercícios e finalizar.
- Todo acesso a `localStorage` em `try/catch` (aba anônima, storage
  desabilitado).

#### 3.3 Telas do coach

- **Dashboard** (`dashboard.component`): card novo "Tempo médio de
  treino" consumindo `GET /workout-sessions/coach/avg-duration`.
- **Alunos** (`students.component`): "tempo médio de treino" por linha
  (mesma resposta agregada).
- **Plan-builder** (`plan-builder.component`): seção recolhível "Tempo
  de execução" — lista de sessões executadas (duração + tendência),
  gráfico de barras de duração ao longo do tempo, tempo médio por
  exercício. Consome `GET /workout-sessions/student/:id/summary`. Mesmo
  padrão visual da seção "Recordes de Força" já existente.
- **Detalhe da sessão** (tela do plano): tempo do aluno por exercício +
  total, via `GET /workout-sessions/student/:id/session/:sessionId`.

#### 3.4 Atleta — histórico

`weekly-view` / `history` passam a exibir a duração da sessão executada
junto do que já mostram (dado disponível via `GET /workout-sessions/me`).

#### 3.5 Models — `core/models.ts`

Novos: `WorkoutSession`, `WorkoutSessionStatus`, `WorkoutSessionSummary`,
`CoachAvgDuration`. `WorkoutLog` ganha `durationSeconds?: number`.

## Fluxo de dados (execução → checkout)

```
Atleta abre sessão
  └─ ngOnInit: existe workout-draft:<sessionId>? → restaura + toast
Exercício N: "Iniciar" → cronômetro count-up (tick salva rascunho)
             "Concluir" → POST /workout-logs { exerciseId, setsCompleted, durationSeconds }
             (descanso, se houver — não conta em activeSeconds)
... repete ...
Último exercício concluído (ou "Finalizar treino agora")
  └─ Tela de resumo (tudo do rascunho/estado local)
       └─ "Finalizar treino" → POST /workout-sessions { sessionId, startedAt, finishedAt }
            ├─ backend calcula elapsedSeconds, activeSeconds, status
            └─ sucesso → limpa rascunho → navega pro histórico
```

## Tratamento de erros

- `POST /workout-sessions` falha → resumo permanece na tela, rascunho
  **não** é limpo, botão volta ao estado clicável com mensagem "Não foi
  possível salvar o treino. Tente novamente." (mesmo padrão do
  `skip`).
- `POST /workout-logs` com `durationSeconds` falha → comportamento atual
  mantido (exercício segue como concluído localmente; log perdido é
  aceito hoje). `durationSeconds` do exercício fica no rascunho e entra
  no `activeSeconds` calculado no resumo, mas o backend recalcula
  `activeSeconds` só a partir dos logs que gravou — divergência possível
  e aceitável (raro; a fonte de verdade do coach é o backend).
- `localStorage` indisponível → app funciona sem rascunho (perde
  retomada, nada mais).
- Rascunho de sessão diferente da atual → ignorado (chave por
  `sessionId`).

## Testing

- **Backend**: TDD nos services novos (cálculo de `status`,
  `activeSeconds`, agregações), testes de ownership (403 para coach sem
  relação), suíte completa verde antes do merge.
- **Frontend**: type-check + build limpos.
- **Verificação manual** (Chrome headless/CDP, padrão do projeto):
  treino real com Iniciar/Concluir em todos os exercícios; recarregar
  no meio → rascunho restaura; checkout → resumo → `POST` →
  histórico; as 4 telas do coach refletindo o dado real; `security-review`
  no diff acumulado antes do merge (toca dado de aluno).

## Fora de escopo

- Estado de "sessão em andamento" no backend / retomada cross-device
  (abordagem C — evolução futura).
- Tempo entre séries (só exercício e sessão inteira).
- Métricas de carga/volume (já cobertas por `PersonalRecord` e
  `WorkoutLog.setsCompleted`).
- Notificação ao coach quando um treino é concluído (não pedido).

## Arquivos-chave

**Backend:**
- `prisma/schema.prisma` — `WorkoutLog.durationSeconds`, `WorkoutSession`, enum
- `src/workout-sessions/` — módulo novo
- `src/workout-logs/workout-logs.service.ts` + `dto/create-workout-log.dto.ts` — `durationSeconds`
- `src/training-plans/training-plans.service.ts` — `getWeeklyCompletionByDayIndex` como referência de agregação
- `src/students/students.service.ts` — `findOne` para ownership

**Frontend:**
- `src/app/features/athlete/active-workout/active-workout.component.{ts,html,scss}`
- `src/app/shared/utils/workout-draft.ts` — novo
- `src/app/core/services/api.service.ts` — `logExercise` + métodos novos
- `src/app/core/models.ts` — tipos novos
- `src/app/features/coach/dashboard/`, `students/`, `plan-builder/`
- `src/app/features/athlete/weekly-view/`, `history/`
