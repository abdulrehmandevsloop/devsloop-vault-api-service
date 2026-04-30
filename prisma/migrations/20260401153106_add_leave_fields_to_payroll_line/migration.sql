-- AlterTable
ALTER TABLE "payroll_lines" ADD COLUMN     "paidLeaveDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
ADD COLUMN     "unpaidLeaveDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
ADD COLUMN     "unpaidLeaveDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0;
