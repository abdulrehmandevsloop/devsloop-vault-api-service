-- Step 1 of 2: Add new enum values to DynamicRequestStatus.
-- These ALTER TYPE statements must commit before any DML that uses them (PostgreSQL restriction).
-- The actual data migration is in 20260514000002_migrate_loans_data.

ALTER TYPE "DynamicRequestStatus" ADD VALUE IF NOT EXISTS 'DISBURSED';
ALTER TYPE "DynamicRequestStatus" ADD VALUE IF NOT EXISTS 'REPAYING';
ALTER TYPE "DynamicRequestStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
