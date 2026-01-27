-- Step 1: Create new enum type with LOW, MEDIUM, HIGH
CREATE TYPE "ConfidentialityLevel_new" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- Step 2: Drop the default constraint (must be done before type change)
ALTER TABLE "projects" ALTER COLUMN "confidentialityLevel" DROP DEFAULT;

-- Step 3: Convert column to text temporarily (using explicit cast)
ALTER TABLE "projects" ALTER COLUMN "confidentialityLevel" TYPE text USING ("confidentialityLevel"::text);

-- Step 4: Update existing data: PRIVATE -> HIGH, INTERNAL -> MEDIUM, PUBLIC -> LOW
UPDATE "projects" SET "confidentialityLevel" = CASE
  WHEN "confidentialityLevel" = 'PRIVATE' THEN 'HIGH'
  WHEN "confidentialityLevel" = 'INTERNAL' THEN 'MEDIUM'
  WHEN "confidentialityLevel" = 'PUBLIC' THEN 'LOW'
  ELSE 'MEDIUM'
END;

-- Step 5: Change column type to new enum (cast from text to new enum)
ALTER TABLE "projects" ALTER COLUMN "confidentialityLevel" TYPE "ConfidentialityLevel_new" USING ("confidentialityLevel"::"ConfidentialityLevel_new");

-- Step 6: Set new default value with explicit cast
ALTER TABLE "projects" ALTER COLUMN "confidentialityLevel" SET DEFAULT 'MEDIUM'::"ConfidentialityLevel_new";

-- Step 7: Drop old enum type (only after column is using new type)
DROP TYPE "ConfidentialityLevel";

-- Step 8: Rename new enum type to original name
ALTER TYPE "ConfidentialityLevel_new" RENAME TO "ConfidentialityLevel";
