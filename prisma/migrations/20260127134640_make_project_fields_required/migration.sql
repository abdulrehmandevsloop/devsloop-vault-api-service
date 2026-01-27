/*
  Warnings:

  - Made the column `clientName` on table `projects` required. This step will fail if there are existing NULL values in that column.
  - Made the column `domain` on table `projects` required. This step will fail if there are existing NULL values in that column.
  - Made the column `description` on table `projects` required. This step will fail if there are existing NULL values in that column.
  - Made the column `startDate` on table `projects` required. This step will fail if there are existing NULL values in that column.

*/

-- Step 1: Update existing NULL values with default values
UPDATE "projects" 
SET 
  "clientName" = COALESCE("clientName", 'Unknown Client'),
  "domain" = COALESCE("domain", 'General'),
  "description" = COALESCE("description", 'No description provided'),
  "startDate" = COALESCE("startDate", CURRENT_TIMESTAMP)
WHERE 
  "clientName" IS NULL 
  OR "domain" IS NULL 
  OR "description" IS NULL 
  OR "startDate" IS NULL;

-- Step 2: Make columns NOT NULL
ALTER TABLE "projects" 
  ALTER COLUMN "clientName" SET NOT NULL,
  ALTER COLUMN "domain" SET NOT NULL,
  ALTER COLUMN "description" SET NOT NULL,
  ALTER COLUMN "startDate" SET NOT NULL;
