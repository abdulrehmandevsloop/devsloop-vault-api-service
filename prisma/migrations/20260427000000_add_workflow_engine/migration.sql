-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('LEAVE', 'LOAN', 'REIMBURSEMENT', 'ADVANCE_SALARY');

-- CreateEnum
CREATE TYPE "WorkflowInstanceStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED', 'RETURNED');

-- CreateEnum
CREATE TYPE "StepResolution" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED', 'RETURNED');

-- CreateEnum
CREATE TYPE "ApproverType" AS ENUM ('ROLE', 'ENTITY', 'SPECIFIC_USER');

-- CreateEnum
CREATE TYPE "RejectionPolicy" AS ENUM ('TERMINATE', 'RETURN_TO_STEP', 'RETURN_TO_START');

-- CreateTable
CREATE TABLE "workflow_templates" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" VARCHAR(1000),
    "requestType" "RequestType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "departments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "employeeTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowEditAfterSubmit" BOOLEAN NOT NULL DEFAULT false,
    "preventConsecutiveApproval" BOOLEAN NOT NULL DEFAULT true,
    "maxReturnCount" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_steps" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" VARCHAR(1000),
    "order" INTEGER NOT NULL,
    "approverType" "ApproverType" NOT NULL,
    "approverValue" VARCHAR(255),
    "fallbackApproverType" "ApproverType",
    "fallbackApproverValue" VARCHAR(255),
    "rejectionPolicy" "RejectionPolicy" NOT NULL DEFAULT 'TERMINATE',
    "returnToStepOrder" INTEGER,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "autoApproveAfterHours" INTEGER,
    "conditionField" VARCHAR(100),
    "conditionOperator" VARCHAR(20),
    "conditionValue" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_instances" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "requestType" "RequestType" NOT NULL,
    "requestId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "status" "WorkflowInstanceStatus" NOT NULL DEFAULT 'PENDING',
    "currentStepOrder" INTEGER NOT NULL DEFAULT 1,
    "returnCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_step_instances" (
    "id" TEXT NOT NULL,
    "workflowInstanceId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "stepName" VARCHAR(255) NOT NULL,
    "stepSnapshot" JSONB NOT NULL,
    "eligibleApproverIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resolution" "StepResolution" NOT NULL DEFAULT 'PENDING',
    "actorId" TEXT,
    "comment" VARCHAR(2000),
    "resolvedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "autoApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_step_instances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_templates_requestType_isActive_idx" ON "workflow_templates"("requestType", "isActive");

-- CreateIndex
CREATE INDEX "workflow_templates_isActive_idx" ON "workflow_templates"("isActive");

-- CreateIndex
CREATE INDEX "workflow_steps_templateId_idx" ON "workflow_steps"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_steps_templateId_order_key" ON "workflow_steps"("templateId", "order");

-- CreateIndex
CREATE INDEX "workflow_instances_requesterId_idx" ON "workflow_instances"("requesterId");

-- CreateIndex
CREATE INDEX "workflow_instances_requestType_status_idx" ON "workflow_instances"("requestType", "status");

-- CreateIndex
CREATE INDEX "workflow_instances_status_idx" ON "workflow_instances"("status");

-- CreateIndex
CREATE INDEX "workflow_instances_templateId_idx" ON "workflow_instances"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_instances_requestType_requestId_key" ON "workflow_instances"("requestType", "requestId");

-- CreateIndex
CREATE INDEX "workflow_step_instances_workflowInstanceId_idx" ON "workflow_step_instances"("workflowInstanceId");

-- CreateIndex
CREATE INDEX "workflow_step_instances_stepId_idx" ON "workflow_step_instances"("stepId");

-- CreateIndex
CREATE INDEX "workflow_step_instances_actorId_idx" ON "workflow_step_instances"("actorId");

-- CreateIndex
CREATE INDEX "workflow_step_instances_resolution_idx" ON "workflow_step_instances"("resolution");

-- CreateIndex
CREATE INDEX "workflow_step_instances_eligibleApproverIds_idx" ON "workflow_step_instances"("eligibleApproverIds");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_step_instances_workflowInstanceId_stepOrder_key" ON "workflow_step_instances"("workflowInstanceId", "stepOrder");

-- AddForeignKey
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "workflow_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "workflow_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_step_instances" ADD CONSTRAINT "workflow_step_instances_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_step_instances" ADD CONSTRAINT "workflow_step_instances_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "workflow_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_step_instances" ADD CONSTRAINT "workflow_step_instances_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique index: only one isDefault=true per requestType (cannot be expressed in Prisma schema)
CREATE UNIQUE INDEX "workflow_templates_default_per_type"
  ON "workflow_templates" ("requestType") WHERE "isDefault" = true;
