/*
  Warnings:

  - You are about to drop the column `teamLead` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "teamLead",
ADD COLUMN     "teamLeadId" TEXT;

-- CreateIndex
CREATE INDEX "users_teamLeadId_idx" ON "users"("teamLeadId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_teamLeadId_fkey" FOREIGN KEY ("teamLeadId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
