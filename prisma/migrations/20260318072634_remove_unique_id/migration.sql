/*
  Warnings:

  - You are about to drop the column `uniqueId` on the `users` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "users_uniqueId_idx";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "uniqueId";
