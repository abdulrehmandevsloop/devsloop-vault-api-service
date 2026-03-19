-- AlterEnum
ALTER TYPE "LeaveStatus" ADD VALUE 'MODIFIED';

-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN     "modificationReason" VARCHAR(2000),
ADD COLUMN     "modifiedAt" TIMESTAMP(3),
ADD COLUMN     "modifiedByHrId" TEXT;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_modifiedByHrId_fkey" FOREIGN KEY ("modifiedByHrId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
