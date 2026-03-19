/*
  Warnings:

  - You are about to drop the column `wfhUsed` on the `leave_balances` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "leave_balances" DROP COLUMN "wfhUsed";

-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN     "appliedByHrId" TEXT;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_appliedByHrId_fkey" FOREIGN KEY ("appliedByHrId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
