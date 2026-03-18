-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN     "unpaidDays" DECIMAL(4,1) NOT NULL DEFAULT 0;
