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
│   ├── common/          # Guards, decorators, interceptors, pipes, filtros globais
│   ├── config/          # Configurações (env, database, redis, etc.)
│   ├── database/        # Módulo Prisma
│   ├── modules/         # Módulos de domínio (academias, alunos, treinos, etc.)
│   └── queues/          # Jobs BullMQ
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── scripts/             # Scripts utilitários (ex: create-admin)
├── docker-compose.yml
├── Dockerfile
└── CLAUDE.md            # Este arquivo
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

> Atualizar esta seção conforme novos módulos forem criados.

| Módulo | Descrição |
|--------|-----------|
| auth | Autenticação JWT (login, refresh, logout) |

## Decisões Arquiteturais

- **Multi-tenant**: cada academia é um tenant isolado por `gym_id`
- **Soft delete**: registros deletados mantêm `deleted_at` em vez de serem removidos
- **Auditoria**: tabelas sensíveis possuem `created_at` e `updated_at` automáticos via Prisma
- **Guards globais**: autenticação JWT aplicada globalmente, com decorator `@Public()` para rotas abertas

## Convenções de Código

- Um módulo NestJS por domínio em `src/modules/<nome>/`
- Cada módulo segue: `controller` → `service` → `repository` (via Prisma)
- DTOs com `class-validator` para validação de entrada
- Respostas padronizadas via interceptor global
- Erros tratados via `HttpException` com filtro global

## API

- Base URL local: `http://localhost:3000/api`
- Swagger UI: `http://localhost:3000/api/docs`

---

_Última atualização: 2026-04-14 — Inicialização do projeto_
