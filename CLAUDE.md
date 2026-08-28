# CLAUDE.md — AEVONFIT Backend

> Arquivo mantido pelo Claude Code. Atualizar sempre que houver mudanças relevantes na arquitetura, dependências, comandos ou decisões de projeto.

## Visão Geral

**AEVONFIT** é uma plataforma SaaS para gestão de academias. O backend expõe uma API REST consumida pelo frontend Angular e (futuramente) por apps mobile.

## Tech Stack

| Camada | Tecnologia |
|--------|------------|
| Runtime | Node.js 20+ |
| Framework | NestJS (TypeScript) |
| ORM | Prisma |
| Banco de dados | PostgreSQL 16 |
| Cache / Filas | Redis 7 + BullMQ |
| Auth | JWT (access + refresh tokens) |
| Armazenamento | AWS S3 / Cloudflare R2 |
| Email | Resend |
| Pagamentos | Stripe / MercadoPago |
| Documentação | Swagger (OpenAPI) |
| Deploy | Docker Compose |

## Estrutura de Diretórios

```
backend/
├── src/
│   ├── app.module.ts
│   ├── main.ts
│   ├── prisma/                  # PrismaService + PrismaModule (global)
│   ├── auth/                    # JWT + Passport Local, login endpoint
│   │   ├── strategies/          # local.strategy.ts, jwt.strategy.ts
│   │   ├── guards/              # jwt-auth.guard.ts, roles.guard.ts
│   │   └── decorators/          # @Roles()
│   ├── users/                   # POST /users, GET /users/me
│   ├── students/                # CRUD alunos + GET /students/:id/plan
│   ├── training-plans/          # CRUD plano + weeks + days + sessions + exercises
│   ├── sessions/                # GET /sessions/:id (com logs do atleta)
│   ├── workout-logs/            # POST log, GET history, GET session logs, GET history por aluno (coach)
│   ├── workout-skips/           # Atleta pula exercício/sessão com justificativa
│   ├── daily-intake/            # Log de hidratação/calorias do atleta
│   ├── movements/               # Catálogo de movimentos (global + customizado por coach)
│   ├── personal-records/        # Registro de PR/1RM do atleta (log-por-evento)
│   ├── exercise-library/        # Biblioteca de exercícios reutilizáveis do coach
│   ├── payments/                # Cobranças do coach aos alunos
│   └── messages/                # Chat coach↔atleta (REST + WebSocket)
├── prisma/
│   ├── schema.prisma            # Modelos: User, Student, TrainingPlan, Week, TrainingDay, Session, Exercise, WorkoutLog
│   ├── migrations/
│   └── seed.ts                  # Seed: coach + atleta + plano semana 1
├── .env.example
├── nest-cli.json
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

## Comandos Principais

```bash
# Desenvolvimento
npm run start:dev

# Build
npm run build

# Banco de dados
npx prisma generate          # Gerar Prisma client
npx prisma migrate dev       # Aplicar migrations
npx prisma studio            # Interface visual do banco
npm run prisma:seed          # Popular banco com dados iniciais

# Docker (banco + redis localmente)
docker compose up db redis -d
docker compose up -d         # Tudo (API + DB + Redis)

# Testes
npm run test
npm run test:e2e

# Lint
npm run lint
```

## Variáveis de Ambiente

Copie `.env.example` → `.env` antes de rodar localmente.

Variáveis obrigatórias:
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `JWT_SECRET` — Secret para tokens JWT
- `JWT_REFRESH_SECRET` — Secret para refresh tokens

## Módulos de Domínio

| Módulo | Endpoints principais |
|--------|----------------------|
| auth | POST /auth/login |
| users | POST /users, GET /users/me |
| students | GET /students, GET /students/me, GET /students/:id, GET /students/:id/plan, POST /students, PATCH /students/:id, DELETE /students/:id |
| training-plans | GET /training-plans/:id, GET /training-plans/student/:studentId, GET /training-plans/coach/weekly-completion (dashboard, % real de conclusão por dia da semana entre os alunos do coach), POST /training-plans (exige `startDate`, normalizado pro backend pra Segunda-feira da semana), PATCH /training-plans/:id/publish, POST /training-plans/:id/initialize, + weeks/days/sessions/exercises CRUD |
| sessions | GET /sessions/:id (inclui exercícios + último log do atleta, e workoutSkips filtrado por dono do plano) |
| workout-logs | POST /workout-logs, GET /workout-logs/history, GET /workout-logs/session/:id, GET /workout-logs/exercise/:id, GET /workout-logs/student/:studentId/history (coach dono, via `StudentsService.findOne`) |
| workout-skips | POST /workout-skips (atleta pula exercício/sessão com motivo, envia mensagem automática pro coach), GET /workout-skips/pending-count (coach, contagem de pulos pendentes por aluno) |
| daily-intake | POST /daily-intake/hydration, POST /daily-intake/calories, GET /daily-intake/today, GET /daily-intake/student/:studentId/history (coach dono) |
| movements | GET /movements (catálogo global + customizado do coach do usuário), POST /movements (`@Roles('coach')`) |
| personal-records | POST /personal-records (`@Roles('athlete')`, exige loadKg e/ou reps), GET /personal-records/me, GET /personal-records/student/:studentId/history (coach dono) |
| exercise-library | CRUD de exercícios reutilizáveis do coach (GET/POST/PATCH/DELETE) |
| payments | GET /payments, GET /payments/summary, GET /payments/student/:studentId, POST /payments, PATCH /payments/:id/pay, PATCH /payments/:id, DELETE /payments/:id |
| messages | GET /messages/inbox, GET /messages/unread, GET /messages/:otherId, POST /messages — WebSocket namespace `/messages` para real-time |
| admin | GET /admin/coaches, POST /admin/coaches, POST /admin/coaches/:id/reset-password (gera senha forte, mostrada uma vez), PATCH /admin/coaches/:id (só aiImportEnabled) — tudo atrás de @Roles('admin') |

## Modelo de Dados

```
User (coach|athlete|admin)
└── Student (vinculado a um User atleta + coachId)
    └── TrainingPlan (month ordinal + startDate real, normalizado pra Segunda-feira, publicado?)
        └── Week (semana 1..N — sem data própria, derivada de startDate + weekNumber)
            └── TrainingDay (Terça, Quarta... dayIndex 1-6, sem data própria)
                └── Session (Mobilidade, LPO, Força, Metcon... com type enum)
                    └── Exercise (sets, reps, duration, restSeconds, loadPercent, coachNotes)
                        └── WorkoutLog (quando o atleta executa — setsCompleted, notes, completedAt)

Movement (catálogo global ou customizado por coach — coachId opcional)
└── PersonalRecord (atleta registra PR/1RM — loadKg e/ou reps, log-por-evento)
```

`User.aiImportEnabled`: Boolean, default true — só relevante pra role coach, liga/desliga a importação de PDF via IA daquele coach (controlado pelo painel admin).

## Decisões Arquiteturais

- **JWT via Passport**: `LocalStrategy` valida email/senha; `JwtStrategy` valida Bearer token — payload: `{ sub: userId, email, role, name }`
- **`req.user.id`**: controllers usam `req.user.id` (não `.sub`) — o JwtStrategy faz o mapeamento de `payload.sub → id`
- **WebSocket (MessagesGateway)**: usa `payload.sub` diretamente (não `payload.id`) para identificar o usuário conectado
- **PrismaModule global**: `isGlobal: true` — qualquer módulo pode injetar `PrismaService` sem reimportar
- **Cascade deletes**: todas as relações têm `onDelete: Cascade` — deletar plano remove tudo abaixo
- **Estrutura flat de módulos**: todos em `src/<modulo>/` diretamente, sem pasta `modules/`

## Convenções de Código

- Cada módulo segue: `controller` → `service` → `PrismaService` (sem camada repository separada)
- DTOs com `class-validator` para validação de entrada
- `req.user` vem do `JwtStrategy.validate()` → `{ id, email, role, name }`

## API

- Base URL local: `http://localhost:3000/api`
- Swagger UI: `http://localhost:3000/api/docs`

---

_Última atualização: 2026-08-28 — adicionado o papel admin, módulo /admin, e o campo User.aiImportEnabled._
