-- AlterTable
ALTER TABLE "contributions" ALTER COLUMN "search_vector" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "annualLeaveBalance" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "baseSalaryMonthly" DECIMAL(12,2),
ADD COLUMN     "casualLeaveBalance" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "designation" VARCHAR(255),
ADD COLUMN     "joiningDate" TIMESTAMP(3),
ADD COLUMN     "personalEmail" VARCHAR(320),
ADD COLUMN     "sickLeaveBalance" INTEGER NOT NULL DEFAULT 0;
