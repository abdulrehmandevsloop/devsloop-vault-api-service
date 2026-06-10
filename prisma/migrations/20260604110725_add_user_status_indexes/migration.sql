-- Formalizes the `@@index([employeeStatus])` and `@@index([mustChangePassword])`
-- declarations on the `users` model that existed in schema.prisma but were never
-- backed by a migration (pre-existing drift). Adds the missing indexes so the
-- migration history reproduces schema.prisma exactly.
--
-- NOTE: the preceding 20260603142149_add_loan_ledger_entries migration already
-- creates both indexes, so on any DB that ran it these already exist. IF NOT
-- EXISTS makes this migration an idempotent no-op in that case (and during
-- shadow-DB replay) instead of failing with "relation already exists".

-- CreateIndex
CREATE INDEX IF NOT EXISTS "users_employeeStatus_idx" ON "users"("employeeStatus");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "users_mustChangePassword_idx" ON "users"("mustChangePassword");
