import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PgBossService } from 'src/queue/pg-boss.service';
import { PrismaService } from 'src/prisma';
import {
  WorkflowCompletedEvent,
  WorkflowReturnedEvent,
  WorkflowStartedEvent,
  WorkflowStepCompletedEvent,
} from '../events';
import {
  RenderedEmail,
  WorkflowEmailMetadataView,
  workflowCompletedTemplate,
  workflowReturnedToRequesterTemplate,
  workflowStepPendingTemplate,
} from '../templates';

@Injectable()
export class WorkflowNotificationHandler {
  private readonly logger = new Logger(WorkflowNotificationHandler.name);

  constructor(
    private readonly pgBossService: PgBossService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Step-1 activation (fires once per workflow start) ───────────────────────

  @OnEvent('workflow.started', { async: true })
  async handleStarted(event: WorkflowStartedEvent): Promise<void> {
    await this.notifyActiveStepApprovers({
      instanceId: event.instanceId,
      requestType: event.requestType,
      requestId: event.requestId,
      requesterId: event.requesterId,
      reason: 'started',
    });
  }

  // ── Step resolved → notify the next step's approvers ───────────────────────

  @OnEvent('workflow.step.completed', { async: true })
  async handleStepCompleted(event: WorkflowStepCompletedEvent): Promise<void> {
    // RETURNED is handled by the workflow.returned listener; avoid duplicate notifies.
    // APPROVED advances the workflow normally. REJECTED with ADVANCE_TO_NEXT /
    // ADVANCE_TO_FINAL policy activates a downstream step whose approver still
    // needs the email; TERMINATE/exhausted ends the workflow and the active-step
    // lookup naturally finds nothing.
    if (event.resolution === 'RETURNED') return;

    await this.notifyActiveStepApprovers({
      instanceId: event.instanceId,
      requestType: event.requestType,
      requestId: event.requestId,
      requesterId: event.requesterId,
      reason: 'advanced',
    });
  }

  // ── Workflow returned → notify requester + freshly-active step approvers ───

  @OnEvent('workflow.returned', { async: true })
  async handleReturned(event: WorkflowReturnedEvent): Promise<void> {
    // 1. Email the requester
    try {
      const view = await this.loadInstanceView(event.instanceId);
      if (!view) return;

      const fromStep = view.allSteps.find((s) => s.stepOrder === event.returnedFromStep);
      const actor = event.actorId
        ? await this.prisma.user.findUnique({
            where: { id: event.actorId },
            select: { name: true },
          })
        : null;

      const email = workflowReturnedToRequesterTemplate({
        requesterName: view.requester.name ?? 'there',
        requesterEmail: view.requester.email,
        requestType: event.requestType,
        requestId: event.requestId,
        returnedFromStepName: fromStep?.stepName ?? `Step ${event.returnedFromStep}`,
        actorName: actor?.name ?? null,
        comment: event.comment ?? null,
        returnCount: event.returnCount,
        maxReturnCount: this.readMaxReturnCount(view.allSteps),
        metadata: view.metadataView,
      });
      await this.enqueue(email);
    } catch (err) {
      this.logger.error(
        `Failed to send workflow.returned email for instance ${event.instanceId}: ${String(err)}`,
      );
    }

    // 2. Notify approvers on the freshly-active step (return target).
    await this.notifyActiveStepApprovers({
      instanceId: event.instanceId,
      requestType: event.requestType,
      requestId: event.requestId,
      requesterId: event.requesterId,
      reason: 'returned',
    });
  }

  // ── Workflow finished (APPROVED/REJECTED/CANCELLED) → notify requester ─────

  @OnEvent('workflow.completed', { async: true })
  async handleCompleted(event: WorkflowCompletedEvent): Promise<void> {
    // Cancellation is initiated by the requester themselves — emailing them
    // "your request was cancelled" is noise.
    if (event.resolution === 'CANCELLED') return;

    try {
      const view = await this.loadInstanceView(event.instanceId);
      if (!view) return;

      // Locate the step that closed the workflow (highest stepOrder with an actor)
      const finalStep = [...view.allSteps]
        .filter((s) => s.actorId !== null && s.resolvedAt !== null)
        .sort((a, b) => (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0))[0];

      const finalActor =
        finalStep?.actorId !== undefined && finalStep?.actorId !== null
          ? await this.prisma.user.findUnique({
              where: { id: finalStep.actorId },
              select: { name: true },
            })
          : null;

      const email = workflowCompletedTemplate({
        requesterName: view.requester.name ?? 'there',
        requesterEmail: view.requester.email,
        requestType: event.requestType,
        requestId: event.requestId,
        resolution: event.resolution,
        reason: event.reason ?? null,
        finalActorName: finalActor?.name ?? null,
        finalComment: finalStep?.comment ?? null,
        metadata: view.metadataView,
      });
      await this.enqueue(email);
    } catch (err) {
      this.logger.error(
        `Failed to send workflow.completed email for instance ${event.instanceId}: ${String(err)}`,
      );
    }
  }

  // ── Core fan-out: read the active pending step and email its approvers ─────

  private async notifyActiveStepApprovers(input: {
    instanceId: string;
    requestType: string;
    requestId: string;
    requesterId: string;
    reason: 'started' | 'advanced' | 'returned';
  }): Promise<void> {
    try {
      const view = await this.loadInstanceView(input.instanceId);
      if (!view) return;

      const activeStep = view.allSteps.find(
        (s) => s.stepOrder === view.instance.currentStepOrder && s.resolution === 'PENDING',
      );
      if (!activeStep) return;

      // Include the parallel-next step when current is optional (same rule the
      // engine uses for two-track approvals).
      const isOptional =
        (activeStep.stepSnapshot as { isOptional?: boolean } | null)?.isOptional === true;
      const parallelStep = isOptional
        ? view.allSteps.find(
            (s) => s.stepOrder === view.instance.currentStepOrder + 1 && s.resolution === 'PENDING',
          )
        : null;

      const steps = [activeStep, ...(parallelStep ? [parallelStep] : [])];

      const approverIds = new Set<string>();
      for (const step of steps) {
        for (const id of step.eligibleApproverIds) approverIds.add(id);
      }
      // Never email the requester about their own request even if they're eligible.
      approverIds.delete(input.requesterId);

      if (approverIds.size === 0) {
        this.logger.warn(
          `No eligible approvers to notify for step ${activeStep.stepOrder} (instance ${input.instanceId}, reason ${input.reason})`,
        );
        return;
      }

      const approvers = await this.prisma.user.findMany({
        where: {
          id: { in: [...approverIds] },
          employeeStatus: 'ACTIVE',
          isSystem: false,
        },
        select: { id: true, email: true, name: true },
      });

      const totalSteps = view.allSteps.length;

      await Promise.all(
        approvers.flatMap((approver) =>
          steps
            .filter((step) => step.eligibleApproverIds.includes(approver.id))
            .map((step) => {
              const email = workflowStepPendingTemplate({
                approverName: approver.name ?? 'there',
                approverEmail: approver.email,
                requesterName: view.requester.name ?? 'A team member',
                requestType: input.requestType,
                requestId: input.requestId,
                stepOrder: step.stepOrder,
                totalSteps,
                stepName: step.stepName ?? `Step ${step.stepOrder}`,
                metadata: view.metadataView,
              });
              this.logger.log(
                `Notifying ${approver.email} for step ${step.stepOrder} (${input.requestType} ${input.requestId}, reason ${input.reason})`,
              );
              return this.enqueue(email);
            }),
        ),
      );
    } catch (err) {
      this.logger.error(
        `Failed to notify active-step approvers for instance ${input.instanceId}: ${String(err)}`,
      );
    }
  }

  // ── Shared loaders ─────────────────────────────────────────────────────────

  private async loadInstanceView(instanceId: string): Promise<InstanceView | null> {
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id: instanceId },
      select: {
        id: true,
        currentStepOrder: true,
        metadata: true,
        requesterId: true,
        stepInstances: {
          orderBy: { stepOrder: 'asc' },
          select: {
            id: true,
            stepOrder: true,
            stepName: true,
            resolution: true,
            eligibleApproverIds: true,
            stepSnapshot: true,
            actorId: true,
            comment: true,
            resolvedAt: true,
          },
        },
      },
    });

    if (!instance) {
      this.logger.warn(`WorkflowInstance ${instanceId} not found while preparing notification`);
      return null;
    }

    const requester = await this.prisma.user.findUnique({
      where: { id: instance.requesterId },
      select: { id: true, name: true, email: true },
    });
    if (!requester) {
      this.logger.warn(`Requester ${instance.requesterId} not found for instance ${instanceId}`);
      return null;
    }

    const metadataView = this.buildMetadataView(
      instance.metadata as Record<string, unknown> | null,
    );

    return {
      instance: { id: instance.id, currentStepOrder: instance.currentStepOrder },
      requester,
      allSteps: instance.stepInstances,
      metadataView,
    };
  }

  private buildMetadataView(raw: Record<string, unknown> | null): WorkflowEmailMetadataView {
    if (!raw) return {};
    const view: WorkflowEmailMetadataView = {};
    if (typeof raw.leaveType === 'string') view.leaveType = raw.leaveType;
    if (typeof raw.daysConsumed === 'number') view.daysConsumed = raw.daysConsumed;
    if (typeof raw.halfDayPeriod === 'string')
      view.halfDayPeriod = raw.halfDayPeriod as WorkflowEmailMetadataView['halfDayPeriod'];
    if (typeof raw.startDate === 'string' || raw.startDate instanceof Date)
      view.startDate = raw.startDate;
    if (typeof raw.endDate === 'string' || raw.endDate instanceof Date) view.endDate = raw.endDate;
    // Dynamic LEAVE submissions store dates as `dateRange.{from,to}` rather than
    // top-level `startDate`/`endDate` ([dynamic-requests.service.ts](src/request-types/dynamic-requests.service.ts)).
    if (!view.startDate || !view.endDate) {
      const dr = raw.dateRange as { from?: unknown; to?: unknown } | null | undefined;
      if (dr && typeof dr === 'object') {
        if (!view.startDate && typeof dr.from === 'string') view.startDate = dr.from;
        if (!view.endDate && typeof dr.to === 'string') view.endDate = dr.to;
      }
    }
    if (typeof raw.amount === 'number') view.amount = raw.amount;
    else if (
      typeof raw.amount === 'string' &&
      raw.amount.trim() &&
      !Number.isNaN(Number(raw.amount))
    )
      view.amount = Number(raw.amount);
    if (typeof raw.reason === 'string') view.reason = raw.reason;
    if (typeof raw.description === 'string') view.description = raw.description;
    if (typeof raw.reimbursementType === 'string') view.reimbursementType = raw.reimbursementType;
    if (typeof raw.customLabel === 'string') view.customLabel = raw.customLabel;
    if (typeof raw.customIcon === 'string') view.customIcon = raw.customIcon;
    if (typeof raw.customColor === 'string') view.customColor = raw.customColor;
    return view;
  }

  private readMaxReturnCount(steps: Array<{ stepSnapshot: unknown }>): number | null {
    for (const step of steps) {
      const snap = step.stepSnapshot as { maxReturnCount?: unknown } | null;
      if (snap && typeof snap.maxReturnCount === 'number') return snap.maxReturnCount;
    }
    return null;
  }

  private async enqueue(email: RenderedEmail): Promise<void> {
    await this.pgBossService.sendToQueue('email-notification', {
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  }
}

interface InstanceView {
  instance: { id: string; currentStepOrder: number };
  requester: { id: string; name: string | null; email: string };
  allSteps: Array<{
    id: string;
    stepOrder: number;
    stepName: string | null;
    resolution: string;
    eligibleApproverIds: string[];
    stepSnapshot: unknown;
    actorId: string | null;
    comment: string | null;
    resolvedAt: Date | null;
  }>;
  metadataView: WorkflowEmailMetadataView;
}
