import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LeaveType, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma';
import { WorkflowEngineService } from 'src/workflows/workflow-engine.service';
import { HrModifyDynamicLeaveDto, SubmitDynamicRequestDto } from './dto';
import { OnEvent } from '@nestjs/event-emitter';
import { WorkflowCompletedEvent } from 'src/workflows/events';
import { calculateLeaveDays } from 'src/leaves/utils/leave-days.calculator';
import { HrSplitLeaveRequestDto, SplitPartDto } from 'src/leaves/dto';

const BUILT_IN_KEYS = new Set(['LEAVE', 'LOAN', 'REIMBURSEMENT', 'ADVANCE_SALARY']);

/**
 * Detect whether a resolved step represents a Disburse action.
 *
 * Reviewers click either "Approve" or "Disburse" but both hit the same workflow
 * resolve endpoint, so we encode the chosen action in the step's JSON comment as
 * `{ action: "APPROVE" | "DISBURSE", ... }`. For legacy steps without this
 * marker, fall back to treating the step as DISBURSE only when `DISBURSE` is the
 * sole allowed action (so a step that exposed both APPROVE+DISBURSE doesn't get
 * mis-labelled when the reviewer actually picked Approve).
 */
function stepResolvedAsDisburse(
  resolution: string | null,
  comment: string | null,
  stepSnapshot: unknown,
): boolean {
  if (resolution !== 'APPROVED') return false;
  const raw = (comment ?? '').trim();
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const meta = JSON.parse(raw) as { action?: string };
      if (meta.action === 'DISBURSE') return true;
      if (meta.action === 'APPROVE') return false;
    } catch {
      // fall through
    }
  }
  const snap = stepSnapshot as Record<string, unknown> | null;
  const actions = Array.isArray(snap?.actions) ? (snap?.actions as string[]) : [];
  return actions.includes('DISBURSE') && !actions.includes('APPROVE');
}

@Injectable()
export class DynamicRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowEngine: WorkflowEngineService,
  ) {}

  async submit(requesterId: string, dto: SubmitDynamicRequestDto) {
    const typeDef = await this.prisma.requestTypeDefinition.findUnique({
      where: { key: dto.typeKey },
    });

    if (!typeDef || !typeDef.isActive) {
      throw new BadRequestException(`Request type "${dto.typeKey}" is not available`);
    }

    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: { teamLeadId: true },
    });

    const request = await this.prisma.dynamicRequest.create({
      data: {
        typeKey: dto.typeKey,
        requesterId,
        formData: dto.formData as Prisma.InputJsonValue,
        status: 'PENDING',
      },
      include: { typeDef: true },
    });

    const metadata: Record<string, unknown> = { ...dto.formData };
    if (requester?.teamLeadId) {
      metadata.reportingManagerId = requester.teamLeadId;
    }

    await this.workflowEngine.startWorkflow(dto.typeKey, request.id, requesterId, metadata);

    // Track WFH pending slot when a WFH leave is submitted
    if (dto.typeKey === 'LEAVE') {
      await this.trackLeaveSubmission(requesterId, dto.formData);
    }

    return request;
  }

  private async trackLeaveSubmission(userId: string, formData: Record<string, unknown>) {
    const leaveType = formData.leaveType as string;
    if (leaveType !== LeaveType.WFH) return;

    const dateRange = formData.dateRange as { from?: string; to?: string } | undefined;
    if (!dateRange?.from || !dateRange?.to) return;

    const startDate = new Date(dateRange.from);
    const year = startDate.getFullYear();
    const month = startDate.getMonth() + 1;

    const leaveInfo = calculateLeaveDays(LeaveType.WFH, startDate, new Date(dateRange.to));
    const days = leaveInfo.daysConsumed;

    await this.prisma.wfhMonthlyUsage.upsert({
      where: { userId_year_month: { userId, year, month } },
      create: { userId, year, month, used: 0, pending: days },
      update: { pending: { increment: days } },
    });
  }

  async findMyRequests(
    requesterId: string,
    page = 1,
    limit = 20,
    typeKey?: string,
    status?: string,
  ) {
    const skip = (page - 1) * limit;

    // Exclude original requests that were split by HR (they carry splitInto in formData).
    // The split parts (which have splitFrom) are shown instead.
    const splitCancelledRows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "dynamic_requests"
      WHERE "requesterId" = ${requesterId}
        AND status = 'CANCELLED'
        AND "formData"::jsonb ? 'splitInto'
    `;
    const splitCancelledIds = splitCancelledRows.map((r) => r.id);

    const where = {
      requesterId,
      ...(typeKey && { typeKey }),
      ...(status && { status: status as any }),
      ...(splitCancelledIds.length > 0 && { id: { notIn: splitCancelledIds } }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.dynamicRequest.findMany({
        where,
        include: { typeDef: true },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.dynamicRequest.count({ where }),
    ]);

    const requestIds = data.map((r) => r.id);
    const instances = await this.prisma.workflowInstance.findMany({
      where: { requestId: { in: requestIds } },
      select: {
        requestId: true,
        currentStepOrder: true,
        status: true,
        stepInstances: {
          select: {
            stepOrder: true,
            stepName: true,
            resolution: true,
            stepSnapshot: true,
            actorId: true,
            resolvedAt: true,
            comment: true,
          },
        },
      },
    });

    const instanceMap = new Map(instances.map((i) => [i.requestId, i]));

    const enriched = data.map((r) => {
      const inst = instanceMap.get(r.id);
      if (!inst) return { ...r, stepActivity: [], isDisbursed: false };
      const currentStep = inst.stepInstances.find(
        (s) => s.stepOrder === inst.currentStepOrder && s.resolution === 'PENDING',
      );
      const stepActivity = inst.stepInstances
        .slice()
        .sort((a, b) => a.stepOrder - b.stepOrder)
        .filter((s) => s.resolution !== 'PENDING')
        .map((s) => {
          const snap = s.stepSnapshot as Record<string, any> | null;
          const isUserEntityStep =
            snap?.approverType === 'ENTITY' && snap?.approverValue === 'user';
          return {
            stepOrder: s.stepOrder,
            stepName: s.stepName ?? snap?.name ?? `Step ${s.stepOrder}`,
            resolution: isUserEntityStep ? (s.resolution as string) : 'PROCESSED',
            resolvedAt: s.resolvedAt ?? null,
            comment: isUserEntityStep ? (s.comment ?? null) : null,
            isUserEntityStep,
          };
        });
      const fd = (r.formData as Record<string, unknown> | null) ?? {};
      const hasDisbursedAt = typeof fd.disbursedAt === 'string' && fd.disbursedAt.length > 0;
      const hasDisburseStep = inst.stepInstances.some((s) =>
        stepResolvedAsDisburse(s.resolution, s.comment, s.stepSnapshot),
      );
      const isDisbursed = hasDisbursedAt || hasDisburseStep;
      return {
        ...r,
        currentStage: currentStep
          ? {
              stepOrder: currentStep.stepOrder,
              stepName: currentStep.stepName,
              totalSteps: inst.stepInstances.length,
            }
          : undefined,
        stepActivity,
        isDisbursed,
      };
    });

    return { data: enriched, total, page, limit };
  }

  async findOne(id: string, requesterId: string) {
    return this.prisma.dynamicRequest.findFirst({
      where: { id, requesterId },
      include: { typeDef: true },
    });
  }

  async findOneForReview(id: string) {
    const request = await this.prisma.dynamicRequest.findUnique({
      where: { id },
      include: {
        typeDef: true,
        requester: { select: { id: true, name: true, email: true, employeeId: true } },
      },
    });
    if (!request) throw new NotFoundException(`Dynamic request ${id} not found`);
    return request;
  }

  async findForReview(
    actorId: string,
    page = 1,
    limit = 20,
    typeKey?: string,
    status?: string,
    reviewerStatus?: string,
  ) {
    const skip = (page - 1) * limit;

    const instanceWhere = {
      requestType: typeKey ? typeKey : { notIn: [...BUILT_IN_KEYS] as string[] },
      requesterId: { not: actorId },
    };

    // System users bypass all access filtering — they see every request.
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { isSystem: true },
    });

    // Load the actor's CURRENT roles and entities so access is always
    // evaluated against present permissions, not the static snapshot at
    // workflow-creation time. This means a user who receives entity access
    // after a request was submitted will immediately see that request.
    const userRoleData = actor?.isSystem
      ? []
      : await this.prisma.userRoleAssignment.findMany({
          where: { userId: actorId, role: { isActive: true } },
          select: {
            role: {
              select: {
                name: true,
                roleEntities: { select: { entity: { select: { name: true } } } },
              },
            },
          },
        });

    const roleNames = new Set(userRoleData.map((a) => a.role.name));
    const entityNames = new Set(
      userRoleData.flatMap((a) => a.role.roleEntities.map((re) => re.entity.name)),
    );

    const allInstances = await this.prisma.workflowInstance.findMany({
      where: instanceWhere,
      take: 5000, // safety cap — in-memory filtering cannot be pushed to SQL without major restructuring
      select: {
        requestId: true,
        requesterId: true,
        currentStepOrder: true,
        status: true,
        metadata: true,
        requester: { select: { teamLeadId: true } },
        stepInstances: {
          select: {
            stepOrder: true,
            stepName: true,
            resolution: true,
            stepSnapshot: true,
            actorId: true,
            eligibleApproverIds: true,
            resolvedAt: true,
            comment: true,
          },
        },
      },
    });

    // Build effective metadata per instance: stored metadata is authoritative,
    // but if reportingManagerId is missing or stale, fall back to the requester's
    // CURRENT teamLeadId so reporting-manager approver steps always resolve.
    const getEffectiveMetadata = (
      instance: (typeof allInstances)[number],
    ): Record<string, unknown> => {
      const stored = (instance.metadata as Record<string, unknown>) ?? {};
      const currentTeamLeadId = instance.requester?.teamLeadId;
      if (!stored.reportingManagerId && currentTeamLeadId) {
        return { ...stored, reportingManagerId: currentTeamLeadId };
      }
      return stored;
    };

    // Resolves which step instances are currently actionable for a given workflow instance.
    // "Active" means the step is at currentStepOrder (or the parallel next step when the
    // current step is optional). All other PENDING steps are future steps not yet reached.
    // This is purely order-based — eligibleApproverIds is NOT used as a gate here so that
    // workflows where no one had the required role/entity at creation time still resolve
    // correctly when permissions are granted later.
    const getActiveSteps = (instance: (typeof allInstances)[number]) => {
      const currentPending = instance.stepInstances.find(
        (s) => s.stepOrder === instance.currentStepOrder && s.resolution === 'PENDING',
      );
      const isCurrentOptional =
        (currentPending?.stepSnapshot as { isOptional?: boolean } | null)?.isOptional === true;
      return instance.stepInstances.filter((s) => {
        if (s.resolution !== 'PENDING') return false;
        if (s.stepOrder === instance.currentStepOrder) return true;
        if (isCurrentOptional && s.stepOrder === instance.currentStepOrder + 1) return true;
        return false;
      });
    };

    // Filter to instances the actor is allowed to see.
    //
    // For active requests (IN_PROGRESS / PENDING / RETURNED):
    //   → show if the actor's CURRENT roles/entities match the active step's snapshot,
    //     OR the actor has already acted on any prior step (so reviewers retain visibility
    //     into requests they've already touched, even after the flow moves past them).
    //
    // For completed requests (APPROVED / REJECTED / CANCELLED):
    //   → show if the actor matched any step (history view) or was the actual resolver.
    //
    // System users match any ENTITY-typed step but are excluded from ROLE/SPECIFIC_USER steps.
    const relevantInstances = allInstances.filter((i) => {
      const activeSteps = getActiveSteps(i);
      const instanceMetadata = getEffectiveMetadata(i);
      const isActiveWorkflow = ['PENDING', 'IN_PROGRESS', 'RETURNED'].includes(i.status);

      // Past actor on any step → always relevant.
      if (i.stepInstances.some((s) => s.actorId === actorId)) return true;

      if (isActiveWorkflow) {
        return activeSteps.some((s) =>
          this.snapshotMatchesUser(
            s.stepSnapshot,
            actorId,
            roleNames,
            entityNames,
            instanceMetadata,
          ),
        );
      }

      // Completed request — history view.
      return i.stepInstances.some((s) =>
        this.snapshotMatchesUser(s.stepSnapshot, actorId, roleNames, entityNames, instanceMetadata),
      );
    });

    const allRequestIds = relevantInstances.map((i) => i.requestId);

    // HR users (user entity) also see split-created and HR-applied special leave
    // records, which have no workflow instance.
    if (entityNames.has('user') && (!typeKey || typeKey === 'LEAVE')) {
      const extraRows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "dynamic_requests"
        WHERE "typeKey" = 'LEAVE'
          AND status = 'APPROVED'
          AND "requesterId" != ${actorId}
          AND (
            "formData"::jsonb ? 'splitFrom'
            OR "formData"::jsonb ? 'appliedByHrId'
          )
      `;
      for (const row of extraRows) {
        if (!allRequestIds.includes(row.id)) {
          allRequestIds.push(row.id);
        }
      }
    }

    // canAct: actor matches at least one currently-active step.
    const eligibleRequestIds = new Set(
      relevantInstances
        .filter((i) => {
          const activeSteps = getActiveSteps(i);
          const instanceMetadata = getEffectiveMetadata(i);
          return activeSteps.some((s) =>
            this.snapshotMatchesUser(
              s.stepSnapshot,
              actorId,
              roleNames,
              entityNames,
              instanceMetadata,
            ),
          );
        })
        .map((i) => i.requestId),
    );

    // Map requestId → union of available actions across all active steps the actor can act on.
    const actionsMap = new Map<string, string[]>();
    for (const instance of relevantInstances) {
      const activeSteps = getActiveSteps(instance);
      const instanceMetadata = getEffectiveMetadata(instance);
      const allActions = new Set<string>();
      for (const step of activeSteps) {
        if (
          this.snapshotMatchesUser(
            step.stepSnapshot,
            actorId,
            roleNames,
            entityNames,
            instanceMetadata,
          )
        ) {
          const snap = step.stepSnapshot as Record<string, any> | null;
          const actions: string[] = Array.isArray(snap?.actions)
            ? snap.actions
            : ['APPROVE', 'REJECT', 'VIEW'];
          actions.forEach((a) => allActions.add(a));
        }
      }
      if (allActions.size === 0) allActions.add('VIEW');
      actionsMap.set(instance.requestId, [...allActions]);
    }

    // Per-request log of MY actions across this request's workflow (any step where
    // I was the actor, regardless of resolution). Drives the reviewer-action chip on
    // the frontend AND the reviewer-relative APPROVED / REJECTED filters & counts.
    const myActionsMap = new Map<
      string,
      {
        stepOrder: number;
        stepName: string;
        resolution: string;
        resolvedAt: Date | null;
        comment: string | null;
      }[]
    >();
    for (const i of relevantInstances) {
      const mine = i.stepInstances
        .filter((s) => s.actorId === actorId)
        .map((s) => {
          const snap = s.stepSnapshot as Record<string, any> | null;
          return {
            stepOrder: s.stepOrder,
            stepName: s.stepName ?? snap?.name ?? `Step ${s.stepOrder}`,
            resolution: s.resolution as string,
            resolvedAt: s.resolvedAt ?? null,
            comment: s.comment ?? null,
          };
        });
      if (mine.length > 0) myActionsMap.set(i.requestId, mine);
    }

    const myApprovedRequestIds = new Set(
      [...myActionsMap.entries()]
        .filter(([, actions]) => actions.some((a) => a.resolution === 'APPROVED'))
        .map(([id]) => id),
    );

    const myRejectedRequestIds = new Set(
      [...myActionsMap.entries()]
        .filter(([, actions]) => actions.some((a) => a.resolution === 'REJECTED'))
        .map(([id]) => id),
    );

    // CANCELLED: any request I'm connected to (via eligibility or past action) that
    // was withdrawn. allRequestIds already captures this via the broadened visibility
    // filter — we just need the global status constraint.
    const myCancelledRequestIds = allRequestIds;

    // reviewerStatus drives reviewer-relative filtering: visibility is no longer
    // tied to the global DynamicRequest.status. Each branch selects a different
    // candidate set.
    const isReviewerPending = reviewerStatus === 'PENDING';
    const isReviewerApproved = reviewerStatus === 'APPROVED';
    const isReviewerRejected = reviewerStatus === 'REJECTED';
    const isReviewerCancelled = reviewerStatus === 'CANCELLED';

    const reviewerFilteredIds: string[] | null = isReviewerPending
      ? [...eligibleRequestIds]
      : isReviewerApproved
        ? [...myApprovedRequestIds]
        : isReviewerRejected
          ? [...myRejectedRequestIds]
          : isReviewerCancelled
            ? myCancelledRequestIds
            : null;

    const where = {
      ...(reviewerFilteredIds
        ? { id: { in: reviewerFilteredIds } }
        : { id: { in: allRequestIds } }),
      ...(typeKey && { typeKey }),
      // CANCELLED tab applies an additional global-status constraint since
      // myCancelledRequestIds contains all connected requests regardless of status.
      ...(isReviewerCancelled && { status: 'CANCELLED' as const }),
      ...(!reviewerFilteredIds &&
        status && {
          status: status as 'PENDING' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED' | 'CANCELLED',
        }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.dynamicRequest.findMany({
        where,
        include: {
          typeDef: true,
          requester: { select: { id: true, name: true, email: true, employeeId: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.dynamicRequest.count({ where }),
    ]);

    // All stats are reviewer-relative.
    const pending = eligibleRequestIds.size;
    const approved = myApprovedRequestIds.size;
    const rejected = myRejectedRequestIds.size;

    // Build per-request step info for steps the current user can act on right now.
    // The portal uses this to highlight the correct step and explain why the request
    // is visible to the user, without relying on stale eligibleApproverIds.
    const activeStepInfoMap = new Map<
      string,
      { stepOrder: number; stepName: string; approverType: string; approverValue: string | null }[]
    >();
    for (const i of relevantInstances) {
      const activeSteps = getActiveSteps(i);
      const instanceMetadata = getEffectiveMetadata(i);
      const info = activeSteps
        .filter((s) =>
          this.snapshotMatchesUser(
            s.stepSnapshot,
            actorId,
            roleNames,
            entityNames,
            instanceMetadata,
          ),
        )
        .map((s) => {
          const snap = s.stepSnapshot as Record<string, any> | null;
          return {
            stepOrder: s.stepOrder,
            stepName: s.stepName ?? snap?.name ?? `Step ${s.stepOrder}`,
            approverType: (snap?.approverType as string) ?? '',
            approverValue: (snap?.approverValue as string | null) ?? null,
          };
        });
      activeStepInfoMap.set(i.requestId, info);
    }

    // Per-request step progress for the review stage indicator.
    const stepProgressMap = new Map<
      string,
      { stepOrder: number; stepName: string; resolution: string }[]
    >();
    for (const i of relevantInstances) {
      const steps = i.stepInstances
        .slice()
        .sort((a, b) => a.stepOrder - b.stepOrder)
        .map((s) => {
          const snap = s.stepSnapshot as Record<string, any> | null;
          return {
            stepOrder: s.stepOrder,
            stepName: s.stepName ?? snap?.name ?? `Step ${s.stepOrder}`,
            resolution: s.resolution as string,
          };
        });
      stepProgressMap.set(i.requestId, steps);
    }

    // Full activity log for reviewers — all resolved steps with their actual
    // comments and resolutions, same shape as the requestor stepActivity but unfiltered.
    const stepActivityMap = new Map<
      string,
      {
        stepOrder: number;
        stepName: string;
        resolution: string;
        resolvedAt: Date | null;
        comment: string | null;
        isUserEntityStep: boolean;
      }[]
    >();
    for (const i of relevantInstances) {
      const steps = i.stepInstances
        .slice()
        .sort((a, b) => a.stepOrder - b.stepOrder)
        .filter((s) => s.resolution !== 'PENDING')
        .map((s) => {
          const snap = s.stepSnapshot as Record<string, any> | null;
          const isUserEntityStep =
            snap?.approverType === 'ENTITY' && snap?.approverValue === 'user';
          return {
            stepOrder: s.stepOrder,
            stepName: s.stepName ?? snap?.name ?? `Step ${s.stepOrder}`,
            resolution: s.resolution as string,
            resolvedAt: s.resolvedAt ?? null,
            comment: s.comment ?? null,
            isUserEntityStep,
          };
        });
      stepActivityMap.set(i.requestId, steps);
    }

    // Current-stage indicator for the Review Stage column. Prefer the actor's
    // actionable step (so "Step N — <name>" reflects what *I* can act on) and
    // fall back to the workflow's currentStepOrder pending step for visibility
    // on requests where the actor cannot act but is still connected.
    const currentStageMap = new Map<
      string,
      { stepOrder: number; stepName: string; totalSteps: number } | null
    >();
    for (const i of relevantInstances) {
      const totalSteps = i.stepInstances.length;
      const actorActive = (activeStepInfoMap.get(i.requestId) ?? [])
        .slice()
        .sort((a, b) => a.stepOrder - b.stepOrder)[0];
      if (actorActive) {
        currentStageMap.set(i.requestId, {
          stepOrder: actorActive.stepOrder,
          stepName: actorActive.stepName,
          totalSteps,
        });
        continue;
      }
      const currentPending = i.stepInstances.find(
        (s) => s.stepOrder === i.currentStepOrder && s.resolution === 'PENDING',
      );
      if (currentPending) {
        const snap = currentPending.stepSnapshot as Record<string, any> | null;
        currentStageMap.set(i.requestId, {
          stepOrder: currentPending.stepOrder,
          stepName: currentPending.stepName ?? snap?.name ?? `Step ${currentPending.stepOrder}`,
          totalSteps,
        });
      } else {
        currentStageMap.set(i.requestId, null);
      }
    }

    const disbursedMap = new Map<string, boolean>();
    for (const i of relevantInstances) {
      const hasDisburseStep = i.stepInstances.some((s) =>
        stepResolvedAsDisburse(s.resolution, s.comment, s.stepSnapshot),
      );
      disbursedMap.set(i.requestId, hasDisburseStep);
    }

    const enriched = data.map((r) => {
      const fd = (r.formData as Record<string, unknown> | null) ?? {};
      const hasDisbursedAt = typeof fd.disbursedAt === 'string' && fd.disbursedAt.length > 0;
      const isDisbursed = hasDisbursedAt || (disbursedMap.get(r.id) ?? false);
      return {
        ...r,
        canAct: eligibleRequestIds.has(r.id),
        availableActions: actionsMap.get(r.id) ?? [],
        activeStepOrders: (activeStepInfoMap.get(r.id) ?? []).map((s) => s.stepOrder),
        activeStepInfo: activeStepInfoMap.get(r.id) ?? [],
        currentStage: currentStageMap.get(r.id) ?? null,
        stepProgress: stepProgressMap.get(r.id) ?? [],
        reviewerActions: myActionsMap.get(r.id) ?? [],
        stepActivity: stepActivityMap.get(r.id) ?? [],
        isDisbursed,
      };
    });

    return { data: enriched, total, page, limit, pending, approved, rejected };
  }

  private snapshotMatchesUser(
    stepSnapshot: unknown,
    userId: string,
    roleNames: Set<string>,
    entityNames: Set<string>,
    metadata: Record<string, unknown> = {},
  ): boolean {
    const snapshot = stepSnapshot as Record<string, any> | null;
    if (!snapshot) return false;

    const matches = (type: string, value: string | null | undefined): boolean => {
      if (!value) return false;
      switch (type) {
        case 'ENTITY':
          return entityNames.has(value);
        case 'ROLE':
          return roleNames.has(value);
        case 'SPECIFIC_USER':
          if (value.startsWith('metadata:')) {
            const field = value.slice('metadata:'.length);
            return metadata[field] === userId;
          }
          return value === userId;
        default:
          return false;
      }
    };

    if (matches(snapshot.approverType, snapshot.approverValue)) return true;
    if (
      snapshot.fallbackApproverType &&
      matches(snapshot.fallbackApproverType, snapshot.fallbackApproverValue)
    )
      return true;
    return false;
  }

  async hrModifyDynamicLeave(id: string, hrId: string, dto: HrModifyDynamicLeaveDto) {
    const request = await this.prisma.dynamicRequest.findUnique({
      where: { id },
      select: { id: true, typeKey: true, formData: true, requesterId: true, status: true },
    });
    if (!request) throw new NotFoundException(`Dynamic request ${id} not found`);
    if (request.typeKey !== 'LEAVE')
      throw new BadRequestException('Only LEAVE requests can be modified');
    if (request.status === 'CANCELLED')
      throw new BadRequestException('Cannot modify a cancelled request');

    const formData = request.formData as Record<string, unknown>;
    const currentLeaveType = formData.leaveType as string;
    const currentDateRange = formData.dateRange as { from: string; to: string };
    const currentHalfDayPeriod = formData.halfDayPeriod as string | undefined;

    const newLeaveType = (dto.leaveType ?? currentLeaveType) as LeaveType;
    const newStartDate = dto.startDate ? new Date(dto.startDate) : new Date(currentDateRange.from);
    const newEndDate = dto.endDate ? new Date(dto.endDate) : new Date(currentDateRange.to);
    const newHalfDayPeriod =
      dto.halfDayPeriod !== undefined ? dto.halfDayPeriod : currentHalfDayPeriod;

    if (newEndDate < newStartDate) {
      throw new BadRequestException('endDate must be >= startDate');
    }

    const wasApproved = request.status === 'APPROVED';

    // Preserve the very first original values so repeat modifications don't erase the baseline.
    const originalLeaveType =
      (formData.originalLeaveType as string | undefined) ?? currentLeaveType;
    const originalDateRange =
      (formData.originalDateRange as { from: string; to: string } | undefined) ?? currentDateRange;
    const originalHalfDayPeriod =
      (formData.originalHalfDayPeriod as string | undefined) ?? currentHalfDayPeriod;
    const originalReason =
      (formData.originalReason as string | undefined) ?? (formData.reason as string | undefined);

    const newFormData: Record<string, unknown> = {
      ...formData,
      leaveType: newLeaveType,
      dateRange: {
        from: newStartDate.toISOString().split('T')[0],
        to: newEndDate.toISOString().split('T')[0],
      },
      originalLeaveType,
      originalDateRange,
      originalHalfDayPeriod,
      originalReason,
      modifiedByHrId: hrId,
      modifiedAt: new Date().toISOString(),
      modifyComment: dto.comment,
      ...(newHalfDayPeriod !== undefined ? { halfDayPeriod: newHalfDayPeriod } : {}),
      ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
    };

    if (wasApproved) {
      const oldLeaveInfo = calculateLeaveDays(
        currentLeaveType as LeaveType,
        new Date(currentDateRange.from),
        new Date(currentDateRange.to),
        currentHalfDayPeriod as any,
      );
      const newLeaveInfo = calculateLeaveDays(
        newLeaveType,
        newStartDate,
        newEndDate,
        newHalfDayPeriod as any,
      );
      const oldYear = new Date(currentDateRange.from).getFullYear();
      const newYear = newStartDate.getFullYear();

      await this.prisma.$transaction(async (tx) => {
        // Reverse old balance
        if (oldLeaveInfo.deductedFromCasual) {
          await tx.leaveBalance.updateMany({
            where: { userId: request.requesterId, year: oldYear },
            data: { casualUsed: { decrement: oldLeaveInfo.daysConsumed } },
          });
        } else if (oldLeaveInfo.deductedFromSick) {
          await tx.leaveBalance.updateMany({
            where: { userId: request.requesterId, year: oldYear },
            data: { sickUsed: { decrement: oldLeaveInfo.daysConsumed } },
          });
        }

        // Apply new balance
        if (newLeaveInfo.deductedFromCasual) {
          await this.upsertAndIncrementBalance(
            request.requesterId,
            newYear,
            'casualUsed',
            newLeaveInfo.daysConsumed,
            tx,
          );
        } else if (newLeaveInfo.deductedFromSick) {
          await this.upsertAndIncrementBalance(
            request.requesterId,
            newYear,
            'sickUsed',
            newLeaveInfo.daysConsumed,
            tx,
          );
        }

        await tx.dynamicRequest.update({
          where: { id },
          data: { formData: newFormData as Prisma.InputJsonValue },
        });
      });
    } else {
      await this.prisma.dynamicRequest.update({
        where: { id },
        data: { formData: newFormData as Prisma.InputJsonValue },
      });
    }

    return { success: true };
  }

  async cancelRequest(id: string, requesterId: string) {
    const request = await this.prisma.dynamicRequest.findFirst({
      where: { id, requesterId },
    });
    if (!request) throw new NotFoundException(`Request ${id} not found`);
    if (!['PENDING', 'IN_PROGRESS'].includes(request.status)) {
      throw new BadRequestException('Only pending or in-review requests can be withdrawn');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.workflowInstance.updateMany({
        where: { requestId: id, status: { in: ['PENDING', 'IN_PROGRESS', 'RETURNED'] } },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
      await tx.dynamicRequest.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
    });

    return { success: true };
  }

  async hrDeleteRequest(id: string) {
    const request = await this.prisma.dynamicRequest.findUnique({
      where: { id },
    });
    if (!request) throw new NotFoundException(`Request ${id} not found`);
    if (request.status === 'APPROVED') {
      throw new BadRequestException('Approved requests cannot be permanently deleted');
    }

    await this.prisma.$transaction(async (tx) => {
      // Step instances cascade-delete when their parent instance is deleted
      await tx.workflowInstance.deleteMany({ where: { requestId: id } });
      await tx.dynamicRequest.delete({ where: { id } });
    });

    return { success: true };
  }

  async splitLeave(id: string, hrId: string, dto: HrSplitLeaveRequestDto) {
    const request = await this.prisma.dynamicRequest.findUnique({
      where: { id },
      select: { id: true, typeKey: true, formData: true, requesterId: true, status: true },
    });

    if (!request) throw new NotFoundException(`Dynamic request ${id} not found`);
    if (request.typeKey !== 'LEAVE') {
      throw new BadRequestException('Only LEAVE requests can be split');
    }
    if (request.status === 'CANCELLED' || request.status === 'REJECTED') {
      throw new BadRequestException(`Cannot split a request that is already ${request.status}`);
    }
    if (!dto.splits?.length) {
      throw new BadRequestException('At least one split portion is required');
    }

    const formData = request.formData as Record<string, unknown>;
    const leaveType = formData.leaveType as string;
    const dateRange = formData.dateRange as { from?: string; to?: string } | undefined;
    const halfDayPeriod = formData.halfDayPeriod as string | undefined;

    if (!leaveType || !dateRange?.from || !dateRange?.to) {
      throw new BadRequestException('Original request is missing required leave fields');
    }

    const origStart = new Date(dateRange.from);
    const origEnd = new Date(dateRange.to);
    const origLeaveInfo = calculateLeaveDays(
      leaveType as LeaveType,
      origStart,
      origEnd,
      halfDayPeriod as any,
    );
    const origYear = origStart.getFullYear();
    const origMonth = origStart.getMonth() + 1;
    const wasApproved = request.status === 'APPROVED';
    const isWfhPending =
      leaveType === LeaveType.WFH &&
      (request.status === 'PENDING' || request.status === 'IN_PROGRESS');

    // Validate and pre-process splits
    const splitDatas = dto.splits.map((split: SplitPartDto) => {
      const startDate = new Date(split.startDate);
      const endDate = new Date(split.endDate);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new BadRequestException('Invalid date format in a split portion');
      }
      if (endDate < startDate) {
        throw new BadRequestException(
          `endDate must be >= startDate in split (${split.startDate} → ${split.endDate})`,
        );
      }
      const leaveInfo = calculateLeaveDays(
        split.leaveType,
        startDate,
        endDate,
        split.halfDayPeriod,
      );
      return { ...split, startDate, endDate, leaveInfo };
    });

    await this.prisma.$transaction(async (tx) => {
      // 1. Cancel its WorkflowInstance if active (before cancelling the request itself)
      await tx.workflowInstance.updateMany({
        where: { requestId: id, status: { in: ['PENDING', 'IN_PROGRESS', 'RETURNED'] } },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });

      // 2. Reverse original balance effects
      if (wasApproved) {
        if (origLeaveInfo.deductedFromCasual) {
          await tx.leaveBalance.updateMany({
            where: { userId: request.requesterId, year: origYear },
            data: { casualUsed: { decrement: origLeaveInfo.daysConsumed } },
          });
        } else if (origLeaveInfo.deductedFromSick) {
          await tx.leaveBalance.updateMany({
            where: { userId: request.requesterId, year: origYear },
            data: { sickUsed: { decrement: origLeaveInfo.daysConsumed } },
          });
        } else if (origLeaveInfo.isWfh) {
          await tx.wfhMonthlyUsage.updateMany({
            where: { userId: request.requesterId, year: origYear, month: origMonth },
            data: { used: { decrement: origLeaveInfo.daysConsumed } },
          });
        }
      }

      // 3. Reverse WFH pending slot
      if (isWfhPending) {
        await tx.wfhMonthlyUsage.updateMany({
          where: { userId: request.requesterId, year: origYear, month: origMonth },
          data: { pending: { decrement: origLeaveInfo.daysConsumed } },
        });
      }

      // 4. Create new APPROVED DynamicRequests for each split and apply balance.
      //    Collect their IDs so we can stamp splitInto on the original.
      const splitIds: string[] = [];
      for (const split of splitDatas) {
        const splitYear = split.startDate.getFullYear();
        const splitMonth = split.startDate.getMonth() + 1;

        const created = await tx.dynamicRequest.create({
          data: {
            typeKey: 'LEAVE',
            requesterId: request.requesterId,
            status: 'APPROVED',
            formData: {
              leaveType: split.leaveType,
              dateRange: {
                from: split.startDate.toISOString().slice(0, 10),
                to: split.endDate.toISOString().slice(0, 10),
              },
              ...(split.halfDayPeriod ? { halfDayPeriod: split.halfDayPeriod } : {}),
              reason: (formData.reason as string) ?? '',
              ...(formData.reportingManagerId
                ? { reportingManagerId: formData.reportingManagerId }
                : {}),
              splitFrom: id,
              splitByHrId: hrId,
              splitComment: dto.comment.trim(),
            } as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        splitIds.push(created.id);

        if (split.leaveInfo.deductedFromCasual) {
          await this.upsertAndIncrementBalance(
            request.requesterId,
            splitYear,
            'casualUsed',
            split.leaveInfo.daysConsumed,
            tx,
          );
        } else if (split.leaveInfo.deductedFromSick) {
          await this.upsertAndIncrementBalance(
            request.requesterId,
            splitYear,
            'sickUsed',
            split.leaveInfo.daysConsumed,
            tx,
          );
        } else if (split.leaveInfo.isWfh) {
          await tx.wfhMonthlyUsage.upsert({
            where: {
              userId_year_month: {
                userId: request.requesterId,
                year: splitYear,
                month: splitMonth,
              },
            },
            create: {
              userId: request.requesterId,
              year: splitYear,
              month: splitMonth,
              used: split.leaveInfo.daysConsumed,
              pending: 0,
            },
            update: { used: { increment: split.leaveInfo.daysConsumed } },
          });
        }
      }

      // 5. Cancel the original request and stamp splitInto so the employee view
      //    knows to hide it and show the split parts instead.
      await tx.dynamicRequest.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          formData: { ...formData, splitInto: splitIds } as Prisma.InputJsonValue,
        },
      });
    });

    return { success: true, splits: dto.splits.length };
  }

  @OnEvent('workflow.completed', { async: true })
  async handleWorkflowCompleted(event: WorkflowCompletedEvent) {
    const statusMap: Record<string, string> = {
      APPROVED: 'APPROVED',
      REJECTED: 'REJECTED',
      CANCELLED: 'CANCELLED',
    };

    const newStatus = statusMap[event.resolution];
    if (!newStatus) return;

    // Don't clobber post-disbursement states — once funds have been released
    // (DISBURSED/REPAYING/COMPLETED), a later workflow step approving the
    // request must not overwrite the loan/advance-salary back to APPROVED.
    // Payroll reads PENDING repayments only when the parent is DISBURSED or
    // REPAYING, so losing that status silently hides the deduction.
    await this.prisma.dynamicRequest.updateMany({
      where: {
        id: event.requestId,
        status: { in: ['PENDING', 'IN_PROGRESS'] },
      },
      data: { status: newStatus as any },
    });

    if (event.requestType === 'LEAVE') {
      await this.handleLeaveWorkflowCompleted(event);
    }
  }

  private async handleLeaveWorkflowCompleted(event: WorkflowCompletedEvent) {
    const request = await this.prisma.dynamicRequest.findUnique({
      where: { id: event.requestId },
      select: { formData: true, requesterId: true },
    });
    if (!request) return;

    const formData = request.formData as Record<string, unknown>;
    const leaveType = formData.leaveType as string;
    const dateRange = formData.dateRange as { from?: string; to?: string } | undefined;
    const halfDayPeriod = formData.halfDayPeriod as string | undefined;

    if (!leaveType || !dateRange?.from || !dateRange?.to) return;

    const startDate = new Date(dateRange.from);
    const endDate = new Date(dateRange.to);
    const year = startDate.getFullYear();
    const month = startDate.getMonth() + 1;
    const userId = request.requesterId;

    let leaveInfo: ReturnType<typeof calculateLeaveDays>;
    try {
      leaveInfo = calculateLeaveDays(
        leaveType as LeaveType,
        startDate,
        endDate,
        halfDayPeriod as any,
      );
    } catch {
      return;
    }

    if (event.resolution === 'APPROVED') {
      // Compute PAID / PARTIAL / UNPAID before deducting so we read the
      // pre-deduction remaining balance.  PARTIAL means the balance covers
      // some days but not all (e.g. 2 remaining, 4 requested → 2 paid + 2 unpaid).
      let category = 'PAID';
      let paidDays: number = leaveInfo.daysConsumed;
      let unpaidDays = 0;

      if (leaveInfo.deductedFromCasual || leaveInfo.deductedFromSick) {
        const balance = await this.prisma.leaveBalance.findUnique({
          where: { userId_year: { userId, year } },
        });
        if (balance) {
          const field = leaveInfo.deductedFromCasual ? 'casual' : 'sick';
          const remaining = Math.max(
            0,
            (balance[`${field}Balance` as 'casualBalance'] as any).toNumber() -
              (balance[`${field}Used` as 'casualUsed'] as any).toNumber(),
          );

          if (remaining <= 0) {
            category = 'UNPAID';
            paidDays = 0;
            unpaidDays = leaveInfo.daysConsumed;
          } else if (leaveInfo.daysConsumed <= remaining) {
            category = 'PAID';
            paidDays = leaveInfo.daysConsumed;
            unpaidDays = 0;
          } else {
            // Balance covers part of the request — split gracefully.
            category = 'PARTIAL';
            paidDays = remaining;
            unpaidDays = leaveInfo.daysConsumed - remaining;
          }
        }
      }

      // Persist the computed category (and breakdown for PARTIAL) into formData.
      await this.prisma.dynamicRequest.update({
        where: { id: event.requestId },
        data: {
          formData: {
            ...(request.formData as Record<string, unknown>),
            category,
            ...(category === 'PARTIAL' ? { paidDays, unpaidDays } : {}),
          },
        },
      });

      if (leaveInfo.deductedFromCasual) {
        await this.upsertAndIncrementBalance(userId, year, 'casualUsed', leaveInfo.daysConsumed);
      } else if (leaveInfo.deductedFromSick) {
        await this.upsertAndIncrementBalance(userId, year, 'sickUsed', leaveInfo.daysConsumed);
      }

      if (leaveInfo.isWfh) {
        // Move pending → used in WfhMonthlyUsage
        await this.prisma.wfhMonthlyUsage.upsert({
          where: { userId_year_month: { userId, year, month } },
          create: { userId, year, month, used: leaveInfo.daysConsumed, pending: 0 },
          update: {
            used: { increment: leaveInfo.daysConsumed },
            pending: { decrement: leaveInfo.daysConsumed },
          },
        });
      }
    } else if (event.resolution === 'REJECTED' || event.resolution === 'CANCELLED') {
      if (leaveInfo.isWfh) {
        // Release the pending WFH slot
        await this.prisma.wfhMonthlyUsage.updateMany({
          where: { userId, year, month },
          data: { pending: { decrement: leaveInfo.daysConsumed } },
        });
      }
    }
  }

  private async upsertAndIncrementBalance(
    userId: string,
    year: number,
    field: 'casualUsed' | 'sickUsed',
    amount: number,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const existing = await db.leaveBalance.findUnique({
      where: { userId_year: { userId, year } },
    });

    if (existing) {
      await db.leaveBalance.update({
        where: { userId_year: { userId, year } },
        data: { [field]: { increment: amount } },
      });
    } else {
      // Balance row doesn't exist yet — create it with the used amount and defaults
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { casualLeaveBalance: true, sickLeaveBalance: true },
      });
      await db.leaveBalance.create({
        data: {
          userId,
          year,
          casualBalance: user?.casualLeaveBalance ?? 10,
          sickBalance: user?.sickLeaveBalance ?? 5,
          casualUsed: field === 'casualUsed' ? amount : 0,
          sickUsed: field === 'sickUsed' ? amount : 0,
        },
      });
    }
  }
}
