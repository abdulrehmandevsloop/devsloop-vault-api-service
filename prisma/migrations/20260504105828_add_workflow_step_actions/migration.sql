-- AlterTable
ALTER TABLE "workflow_steps" ADD COLUMN     "actions" TEXT[] DEFAULT ARRAY['APPROVE', 'REJECT', 'VIEW']::TEXT[];
