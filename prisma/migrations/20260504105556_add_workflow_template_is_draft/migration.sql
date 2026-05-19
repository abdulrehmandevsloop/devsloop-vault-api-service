-- AlterTable
ALTER TABLE "dynamic_requests" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "request_type_definitions" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "workflow_templates" ADD COLUMN     "isDraft" BOOLEAN NOT NULL DEFAULT true;
