-- CreateEnum
CREATE TYPE "WorklogStatus" AS ENUM ('VALID', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "worklogs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "content" TEXT NOT NULL,
    "aiScore" INTEGER,
    "aiFeedback" TEXT,
    "status" "WorklogStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "manDay" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worklogs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "worklogs_userId_idx" ON "worklogs"("userId");

-- CreateIndex
CREATE INDEX "worklogs_projectId_idx" ON "worklogs"("projectId");

-- CreateIndex
CREATE INDEX "worklogs_date_idx" ON "worklogs"("date");

-- CreateIndex
CREATE INDEX "worklogs_userId_date_idx" ON "worklogs"("userId", "date");

-- CreateIndex
CREATE INDEX "worklogs_projectId_date_idx" ON "worklogs"("projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "worklogs_userId_date_key" ON "worklogs"("userId", "date");

-- AddForeignKey
ALTER TABLE "worklogs" ADD CONSTRAINT "worklogs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worklogs" ADD CONSTRAINT "worklogs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
