-- CreateEnum
CREATE TYPE "WarningType" AS ENUM ('INFO', 'MINOR', 'MAJOR', 'CRITICAL');

-- AlterTable
ALTER TABLE "user_warnings" ADD COLUMN     "warningType" "WarningType" NOT NULL DEFAULT 'MINOR';
