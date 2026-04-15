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
│   └── workout-logs/            # POST log, GET history, GET session logs
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
| students | GET /students, GET /students/:id, GET /students/:id/plan, POST /students, PATCH /students/:id |
| training-plans | GET /training-plans/:id, GET /training-plans/student/:studentId, POST /training-plans, PATCH /training-plans/:id/publish, + weeks/days/sessions/exercises CRUD |
| sessions | GET /sessions/:id (inclui exercícios + último log do atleta) |
| workout-logs | POST /workout-logs, GET /workout-logs/history, GET /workout-logs/session/:id, GET /workout-logs/exercise/:id |

## Modelo de Dados

```
User (coach|athlete)
└── Student (vinculado a um User atleta + coachId)
    └── TrainingPlan (mês, publicado?)
        └── Week (semana 1..N)
            └── TrainingDay (Terça, Quarta... dayIndex 0-6)
                └── Session (Mobilidade, LPO, Força, Metcon... com type enum)
                    └── Exercise (sets, reps, duration, restSeconds, loadPercent, coachNotes)
                        └── WorkoutLog (quando o atleta executa — setsCompleted, notes, completedAt)
```

## Decisões Arquiteturais

- **JWT via Passport**: `LocalStrategy` valida email/senha; `JwtStrategy` valida Bearer token — payload: `{ id, email, role, name }`
- **`req.user.id`**: controllers usam `req.user.id` (não `.sub`) — o JwtStrategy faz o mapeamento de `payload.sub → id`
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

_Última atualização: 2026-04-14 — Bootstrap completo: auth, users, students, training-plans, sessions, workout-logs, Prisma schema, seed_
