-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('CASUAL', 'SICK', 'HALF_DAY', 'WFH', 'MATERNITY', 'WEDDING', 'UMRAH_HAJJ', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'TEAM_LEAD_APPROVED', 'TEAM_LEAD_REJECTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HalfDayPeriod" AS ENUM ('FIRST_HALF', 'SECOND_HALF');

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reportingManagerId" TEXT NOT NULL,
    "leaveType" "LeaveType" NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "halfDayPeriod" "HalfDayPeriod",
    "daysConsumed" DECIMAL(4,1) NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "medicalCertificateUrl" VARCHAR(2048),
    "teamLeadId" TEXT,
    "teamLeadComment" VARCHAR(2000),
    "teamLeadReviewedAt" TIMESTAMP(3),
    "hrId" TEXT,
    "hrComment" VARCHAR(2000),
    "hrReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "casualBalance" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "sickBalance" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "casualUsed" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "sickUsed" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "wfhUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leave_requests_employeeId_idx" ON "leave_requests"("employeeId");

-- CreateIndex
CREATE INDEX "leave_requests_reportingManagerId_idx" ON "leave_requests"("reportingManagerId");

-- CreateIndex
CREATE INDEX "leave_requests_status_idx" ON "leave_requests"("status");

-- CreateIndex
CREATE INDEX "leave_requests_leaveType_idx" ON "leave_requests"("leaveType");

-- CreateIndex
CREATE INDEX "leave_requests_startDate_idx" ON "leave_requests"("startDate");

-- CreateIndex
CREATE INDEX "leave_requests_employeeId_status_idx" ON "leave_requests"("employeeId", "status");

-- CreateIndex
CREATE INDEX "leave_requests_status_leaveType_idx" ON "leave_requests"("status", "leaveType");

-- CreateIndex
CREATE INDEX "leave_balances_userId_idx" ON "leave_balances"("userId");

-- CreateIndex
CREATE INDEX "leave_balances_year_idx" ON "leave_balances"("year");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balances_userId_year_key" ON "leave_balances"("userId", "year");

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_reportingManagerId_fkey" FOREIGN KEY ("reportingManagerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_teamLeadId_fkey" FOREIGN KEY ("teamLeadId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_hrId_fkey" FOREIGN KEY ("hrId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
