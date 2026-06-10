-- Formalizes the `@@index([employeeStatus])` and `@@index([mustChangePassword])`
-- declarations on the `users` model that existed in schema.prisma but were never
-- backed by a migration (pre-existing drift). Adds the missing indexes so the
-- migration history reproduces schema.prisma exactly.

-- CreateIndex
CREATE INDEX "users_employeeStatus_idx" ON "users"("employeeStatus");

-- CreateIndex
CREATE INDEX "users_mustChangePassword_idx" ON "users"("mustChangePassword");
