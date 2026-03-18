-- Drop stale wfhUsed column from leave_balances (was never written to after refactor)
ALTER TABLE "leave_balances" DROP COLUMN IF EXISTS "wfh_used";

-- CreateTable: monthly WFH usage tracker
CREATE TABLE "wfh_monthly_usage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "used" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "pending" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wfh_monthly_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wfh_monthly_usage_userId_idx" ON "wfh_monthly_usage"("userId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "wfh_monthly_usage_userId_year_month_key" ON "wfh_monthly_usage"("userId", "year", "month");

-- AddForeignKey
ALTER TABLE "wfh_monthly_usage" ADD CONSTRAINT "wfh_monthly_usage_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
