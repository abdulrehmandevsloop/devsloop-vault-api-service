-- CreateEnum
CREATE TYPE "VisibilityMode" AS ENUM ('ALL', 'RESTRICTED');

-- AlterTable
ALTER TABLE "workflow_templates" ADD COLUMN     "visibilityEntities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "visibilityMode" "VisibilityMode" NOT NULL DEFAULT 'ALL',
ADD COLUMN     "visibilityRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "visibilityUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
