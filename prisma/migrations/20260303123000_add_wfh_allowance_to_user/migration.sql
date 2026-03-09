-- Add per-employee WFH allowance (days per month) to users

ALTER TABLE "users"
ADD COLUMN "wfhAllowancePerMonth" INTEGER NOT NULL DEFAULT 1;

