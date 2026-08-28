-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'admin';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "aiImportEnabled" BOOLEAN NOT NULL DEFAULT true;

