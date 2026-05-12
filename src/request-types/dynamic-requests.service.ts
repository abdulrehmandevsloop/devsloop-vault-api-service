import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LeaveType, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma';
import { WorkflowEngineService } from 'src/workflows/workflow-engine.service';
import { SubmitDynamicRequestDto } from './dto';
import { OnEvent } from '@nestjs/event-emitter';
import { WorkflowCompletedEvent } from 'src/workflows/events';
import { calculateLeaveDays } from 'src/leaves/utils/leave-days.calculator';
import { HrSplitLeaveRequestDto, SplitPartDto } from 'src/leaves/dto';

const BUILT_IN_KEYS = new Set(['LEAVE', 'LOAN', 'REIMBURSEMENT', 'ADVANCE_SALARY']);

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
    const now = new Date();
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

  async findMyRequests(requesterId: string, page = 1, limit = 20, typeKey?: string) {
    const skip = (page - 1) * limit;
    const where = {
      requesterId,
      ...(typeKey && { typeKey }),
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
          select: { stepOrder: true, stepName: true, resolution: true },
        },
      },
    });

    const instanceMap = new Map(instances.map((i) => [i.requestId, i]));

    const enriched = data.map((r) => {
      const inst = instanceMap.get(r.id);
      if (!inst) return r;
      const currentStep = inst.stepInstances.find(
        (s) => s.stepOrder === inst.currentStepOrder && s.resolution === 'PENDING',
      );
      return {
        ...r,
        currentStage: currentStep
          ? {
              stepOrder: currentStep.stepOrder,
              stepName: currentStep.stepName,
              totalSteps: inst.stepInstances.length,
            }
          : undefined,
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

  async findForReview(actorId: string, page = 1, limit = 20, typeKey?: string, status?: string) {
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
    //   → show only if the actor's CURRENT roles/entities match the active step's snapshot.
    //   Users gain or lose visibility the moment their permissions change.
    //
    // For completed requests (APPROVED / REJECTED / CANCELLED):
    //   → show if the actor matched any step (history view) or was the actual resolver.
    //
    // System users match any ENTITY-typed step but are excluded from ROLE/SPECIFIC_USER steps.
    const relevantInstances = allInstances.filter((i) => {
      const activeSteps = getActiveSteps(i);
      const instanceMetadata = getEffectiveMetadata(i);
      const isActiveWorkflow = ['PENDING', 'IN_PROGRESS', 'RETURNED'].includes(i.status);

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
      return i.stepInstances.some(
        (s) =>
          s.actorId === actorId ||
          this.snapshotMatchesUser(
            s.stepSnapshot,
            actorId,
            roleNames,
            entityNames,
            instanceMetadata,
          ),
      );
    });

    const allRequestIds = relevantInstances.map((i) => i.requestId);

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

    const where = {
      id: { in: allRequestIds },
      ...(typeKey && { typeKey }),
      ...(status && {
        status: status as 'PENDING' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED' | 'CANCELLED',
      }),
    };

    // Bug 4: Compute status summary counts across the full result set, not just the current page
    const statusBaseWhere = { id: { in: allRequestIds } };

    const [data, total, pending, approved, rejected] = await this.prisma.$transaction([
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
      this.prisma.dynamicRequest.count({
        where: { ...statusBaseWhere, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      }),
      this.prisma.dynamicRequest.count({ where: { ...statusBaseWhere, status: 'APPROVED' } }),
      this.prisma.dynamicRequest.count({ where: { ...statusBaseWhere, status: 'REJECTED' } }),
    ]);

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

    const enriched = data.map((r) => ({
      ...r,
      canAct: eligibleRequestIds.has(r.id),
      availableActions: actionsMap.get(r.id) ?? [],
      activeStepOrders: (activeStepInfoMap.get(r.id) ?? []).map((s) => s.stepOrder),
      activeStepInfo: activeStepInfoMap.get(r.id) ?? [],
      stepProgress: stepProgressMap.get(r.id) ?? [],
    }));

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
      // 1. Cancel the original DynamicRequest
      await tx.dynamicRequest.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });

      // 2. Cancel its WorkflowInstance if active
      await tx.workflowInstance.updateMany({
        where: { requestId: id, status: { in: ['PENDING', 'IN_PROGRESS', 'RETURNED'] } },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });

      // 3. Reverse original balance effects
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

      // 4. Reverse WFH pending slot
      if (isWfhPending) {
        await tx.wfhMonthlyUsage.updateMany({
          where: { userId: request.requesterId, year: origYear, month: origMonth },
          data: { pending: { decrement: origLeaveInfo.daysConsumed } },
        });
      }

      // 5. Create new APPROVED DynamicRequests for each split and apply balance
      for (const split of splitDatas) {
        const splitYear = split.startDate.getFullYear();
        const splitMonth = split.startDate.getMonth() + 1;

        await tx.dynamicRequest.create({
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
              splitFrom: id,
              splitByHrId: hrId,
              splitComment: dto.comment.trim(),
            } as Prisma.InputJsonValue,
          },
        });

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

    await this.prisma.dynamicRequest.updateMany({
      where: { id: event.requestId },
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
