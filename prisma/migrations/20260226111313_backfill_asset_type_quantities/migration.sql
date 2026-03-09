-- Backfill totalQuantity and assignedQuantity from actual asset counts
UPDATE asset_types at
SET
  "totalQuantity" = COALESCE(
    (SELECT COUNT(*)::integer FROM assets a WHERE a."assetTypeId" = at.id),
    0
  ),
  "assignedQuantity" = COALESCE(
    (SELECT COUNT(*)::integer FROM assets a WHERE a."assetTypeId" = at.id AND a.status = 'ASSIGNED'),
    0
  );