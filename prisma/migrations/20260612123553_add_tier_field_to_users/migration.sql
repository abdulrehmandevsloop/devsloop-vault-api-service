-- CreateEnum for UserTier with all 12 professional levels
CREATE TYPE "UserTier" AS ENUM (
  'L_9',
  'L_8',
  'L_7',
  'L_6',
  'L_5',
  'L_4_ADVANCED',
  'L_4_INTERMEDIATE',
  'L_3_ADVANCED',
  'L_3_INTERMEDIATE',
  'L_2',
  'L_1',
  'L_0'
);

-- Add tier column to users table (optional field)
ALTER TABLE "users" ADD COLUMN "tier" "UserTier";
