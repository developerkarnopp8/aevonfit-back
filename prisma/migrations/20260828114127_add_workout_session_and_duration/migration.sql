-- CreateEnum
CREATE TYPE "WorkoutSessionStatus" AS ENUM ('Completed', 'Partial');

-- AlterTable
ALTER TABLE "workout_logs" ADD COLUMN     "durationSeconds" INTEGER;

-- CreateTable
CREATE TABLE "workout_sessions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "elapsedSeconds" INTEGER NOT NULL,
    "activeSeconds" INTEGER NOT NULL,
    "status" "WorkoutSessionStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workout_sessions_athleteId_idx" ON "workout_sessions"("athleteId");

-- CreateIndex
CREATE INDEX "workout_sessions_sessionId_idx" ON "workout_sessions"("sessionId");

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

