-- CreateEnum
CREATE TYPE "SkipReason" AS ENUM ('NoTime', 'Injury', 'Later', 'Other');

-- CreateEnum
CREATE TYPE "SkipDecision" AS ENUM ('Postponed', 'Abandoned');

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "workout_skips" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT,
    "sessionId" TEXT,
    "athleteId" TEXT NOT NULL,
    "reason" "SkipReason" NOT NULL,
    "note" TEXT,
    "decision" "SkipDecision" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_skips_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "workout_skips" ADD CONSTRAINT "workout_skips_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_skips" ADD CONSTRAINT "workout_skips_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_skips" ADD CONSTRAINT "workout_skips_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

