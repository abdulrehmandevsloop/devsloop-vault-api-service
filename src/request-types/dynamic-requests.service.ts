import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma';
import { WorkflowEngineService } from 'src/workflows/workflow-engine.service';
import { SubmitDynamicRequestDto } from './dto';
import { OnEvent } from '@nestjs/event-emitter';
import { WorkflowCompletedEvent } from 'src/workflows/events';

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

    return request;
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
        currentStepOrder: true,
        status: true,
        metadata: true,
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
      const instanceMetadata = (i.metadata as Record<string, unknown>) ?? {};
      const isActiveWorkflow = ['PENDING', 'IN_PROGRESS', 'RETURNED'].includes(i.status);

      if (isActiveWorkflow) {
        return activeSteps.some((s) =>
          this.snapshotMatchesUser(
            s.stepSnapshot,
            actorId,
            roleNames,
            entityNames,
            actor?.isSystem ?? false,
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
            actor?.isSystem ?? false,
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
          const instanceMetadata = (i.metadata as Record<string, unknown>) ?? {};
          return activeSteps.some((s) =>
            this.snapshotMatchesUser(
              s.stepSnapshot,
              actorId,
              roleNames,
              entityNames,
              actor?.isSystem ?? false,
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
      const instanceMetadata = (instance.metadata as Record<string, unknown>) ?? {};
      const allActions = new Set<string>();
      for (const step of activeSteps) {
        if (
          this.snapshotMatchesUser(
            step.stepSnapshot,
            actorId,
            roleNames,
            entityNames,
            actor?.isSystem ?? false,
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
      const instanceMetadata = (i.metadata as Record<string, unknown>) ?? {};
      const info = activeSteps
        .filter((s) =>
          this.snapshotMatchesUser(
            s.stepSnapshot,
            actorId,
            roleNames,
            entityNames,
            actor?.isSystem ?? false,
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

    const enriched = data.map((r) => ({
      ...r,
      canAct: eligibleRequestIds.has(r.id),
      availableActions: actionsMap.get(r.id) ?? [],
      activeStepOrders: (activeStepInfoMap.get(r.id) ?? []).map((s) => s.stepOrder),
      activeStepInfo: activeStepInfoMap.get(r.id) ?? [],
    }));

    return { data: enriched, total, page, limit, pending, approved, rejected };
  }

  private snapshotMatchesUser(
    stepSnapshot: unknown,
    userId: string,
    roleNames: Set<string>,
    entityNames: Set<string>,
    isSystem = false,
    metadata: Record<string, unknown> = {},
  ): boolean {
    const snapshot = stepSnapshot as Record<string, any> | null;
    if (!snapshot) return false;

    const matches = (type: string, value: string | null | undefined): boolean => {
      if (!value) return false;
      switch (type) {
        case 'ENTITY':
          // System users implicitly belong to all entity-based approver groups.
          return isSystem || entityNames.has(value);
        case 'ROLE':
          // System users are not members of named roles — skip.
          return !isSystem && roleNames.has(value);
        case 'SPECIFIC_USER':
          // System users are never the intended specific person — skip.
          if (isSystem) return false;
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
  }
}
