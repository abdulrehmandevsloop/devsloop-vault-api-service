-- CreateEnum
CREATE TYPE "EventPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3) NOT NULL,
    "priority" "EventPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "EventStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_assignees" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_role_assignees" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_role_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_completions" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "event_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_attachments" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "fileName" VARCHAR(512) NOT NULL,
    "fileUrl" VARCHAR(2048) NOT NULL,
    "fileSize" INTEGER,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_completion_attachments" (
    "id" TEXT NOT NULL,
    "completionId" TEXT NOT NULL,
    "fileName" VARCHAR(512) NOT NULL,
    "fileUrl" VARCHAR(2048) NOT NULL,
    "fileSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_completion_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "events_createdById_idx" ON "events"("createdById");

-- CreateIndex
CREATE INDEX "events_status_idx" ON "events"("status");

-- CreateIndex
CREATE INDEX "events_dueDate_idx" ON "events"("dueDate");

-- CreateIndex
CREATE INDEX "events_priority_idx" ON "events"("priority");

-- CreateIndex
CREATE INDEX "event_assignees_eventId_idx" ON "event_assignees"("eventId");

-- CreateIndex
CREATE INDEX "event_assignees_userId_idx" ON "event_assignees"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "event_assignees_eventId_userId_key" ON "event_assignees"("eventId", "userId");

-- CreateIndex
CREATE INDEX "event_role_assignees_eventId_idx" ON "event_role_assignees"("eventId");

-- CreateIndex
CREATE INDEX "event_role_assignees_roleId_idx" ON "event_role_assignees"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "event_role_assignees_eventId_roleId_key" ON "event_role_assignees"("eventId", "roleId");

-- CreateIndex
CREATE INDEX "event_completions_eventId_idx" ON "event_completions"("eventId");

-- CreateIndex
CREATE INDEX "event_completions_userId_idx" ON "event_completions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "event_completions_eventId_userId_key" ON "event_completions"("eventId", "userId");

-- CreateIndex
CREATE INDEX "event_attachments_eventId_idx" ON "event_attachments"("eventId");

-- CreateIndex
CREATE INDEX "event_completion_attachments_completionId_idx" ON "event_completion_attachments"("completionId");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_assignees" ADD CONSTRAINT "event_assignees_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_assignees" ADD CONSTRAINT "event_assignees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_role_assignees" ADD CONSTRAINT "event_role_assignees_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_role_assignees" ADD CONSTRAINT "event_role_assignees_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_completions" ADD CONSTRAINT "event_completions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_completions" ADD CONSTRAINT "event_completions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attachments" ADD CONSTRAINT "event_attachments_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attachments" ADD CONSTRAINT "event_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_completion_attachments" ADD CONSTRAINT "event_completion_attachments_completionId_fkey" FOREIGN KEY ("completionId") REFERENCES "event_completions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
