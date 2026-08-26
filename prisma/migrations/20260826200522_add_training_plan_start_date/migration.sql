-- 1. Coluna nullable primeiro
ALTER TABLE "training_plans" ADD COLUMN "startDate" TIMESTAMP(3);

-- 2. Backfill dos planos existentes: única fonte de verdade disponível
--    pra dado histórico é a data em que o plano foi criado no sistema.
--    date_trunc('week', ...) no Postgres normaliza pra Segunda-feira da
--    semana (ISO 8601) — mesma normalização aplicada em planos novos.
UPDATE "training_plans" SET "startDate" = date_trunc('week', "createdAt") WHERE "startDate" IS NULL;

-- 3. Torna obrigatório depois do backfill
ALTER TABLE "training_plans" ALTER COLUMN "startDate" SET NOT NULL;
