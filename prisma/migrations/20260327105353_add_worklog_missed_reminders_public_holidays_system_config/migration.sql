-- AlterTable
ALTER TABLE "reimbursement_requests" ALTER COLUMN "receiptUrl" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "googleEmail" VARCHAR(320);

-- CreateTable
CREATE TABLE "public_holidays" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "key" VARCHAR(100) NOT NULL,
    "value" VARCHAR(1000) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "worklog_missed_reminders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 1,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worklog_missed_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_holidays_date_key" ON "public_holidays"("date");

-- CreateIndex
CREATE INDEX "worklog_missed_reminders_resolved_date_idx" ON "worklog_missed_reminders"("resolved", "date");

-- CreateIndex
CREATE INDEX "worklog_missed_reminders_userId_idx" ON "worklog_missed_reminders"("userId");

-- CreateIndex
CREATE INDEX "worklog_missed_reminders_projectId_idx" ON "worklog_missed_reminders"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "worklog_missed_reminders_userId_projectId_date_key" ON "worklog_missed_reminders"("userId", "projectId", "date");

-- AddForeignKey
ALTER TABLE "worklog_missed_reminders" ADD CONSTRAINT "worklog_missed_reminders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worklog_missed_reminders" ADD CONSTRAINT "worklog_missed_reminders_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
