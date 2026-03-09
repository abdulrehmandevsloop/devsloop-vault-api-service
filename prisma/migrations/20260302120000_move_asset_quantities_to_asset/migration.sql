-- Move inventory quantities from asset_types to assets
-- Step 1: Add totalQuantity and assignedQuantity columns to assets table
ALTER TABLE "assets" ADD COLUMN "totalQuantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "assets" ADD COLUMN "assignedQuantity" INTEGER NOT NULL DEFAULT 0;

-- Step 2: Backfill totalQuantity on each asset from its asset type.
-- Each individual asset row gets its own quantity of 1 (total), 
-- and assignedQuantity is set based on active assignments.
UPDATE "assets" a
SET
  "totalQuantity" = 1,
  "assignedQuantity" = (
    SELECT COUNT(*)::int
    FROM "asset_assignments" aa
    WHERE aa."assetId" = a.id
      AND aa."returnedAt" IS NULL
  );

-- Step 3: Drop totalQuantity and assignedQuantity from asset_types table
ALTER TABLE "asset_types" DROP COLUMN "totalQuantity";
ALTER TABLE "asset_types" DROP COLUMN "assignedQuantity";
