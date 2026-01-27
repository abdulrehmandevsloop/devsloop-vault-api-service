/*
  Warnings:

  - You are about to drop the column `role` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "role",
ADD COLUMN     "hasAccess" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "roleId" TEXT;

-- CreateTable
CREATE TABLE "acl_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,

    CONSTRAINT "acl_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "acl_entries_userId_idx" ON "acl_entries"("userId");

-- CreateIndex
CREATE INDEX "acl_entries_entityId_idx" ON "acl_entries"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "acl_entries_userId_entityId_key" ON "acl_entries"("userId", "entityId");

-- CreateIndex
CREATE INDEX "users_roleId_idx" ON "users"("roleId");

-- CreateIndex
CREATE INDEX "users_hasAccess_idx" ON "users"("hasAccess");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acl_entries" ADD CONSTRAINT "acl_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acl_entries" ADD CONSTRAINT "acl_entries_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
