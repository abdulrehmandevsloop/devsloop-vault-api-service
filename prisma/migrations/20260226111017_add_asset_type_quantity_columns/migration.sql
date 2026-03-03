-- AlterTable
ALTER TABLE "asset_types" ADD COLUMN     "assignedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalQuantity" INTEGER NOT NULL DEFAULT 0;
