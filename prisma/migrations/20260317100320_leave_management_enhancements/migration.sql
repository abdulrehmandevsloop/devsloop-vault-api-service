-- CreateEnum
CREATE TYPE "LeaveCategory" AS ENUM ('PAID', 'UNPAID');

-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN     "category" "LeaveCategory",
ADD COLUMN     "requiresClientApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "projects" ALTER COLUMN "domain" DROP NOT NULL,
ALTER COLUMN "description" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "allowMaternityLeave" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "allowOtherLeave" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "allowUmrahHajjLeave" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "allowWeddingLeave" BOOLEAN NOT NULL DEFAULT false;
