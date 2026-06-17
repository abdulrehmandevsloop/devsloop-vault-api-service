-- Snapshot the employee's monthly salary on each salary hold so that a later
-- increment/decrement never retroactively changes the held (or released) amount.
ALTER TABLE "salary_holds" ADD COLUMN "monthlySalary" DECIMAL(12,2);

-- Backfill existing holds with the employee's current salary (best available
-- value at migration time).
UPDATE "salary_holds" sh
SET "monthlySalary" = u."baseSalaryMonthly"
FROM "users" u
WHERE u."id" = sh."userId" AND sh."monthlySalary" IS NULL;
