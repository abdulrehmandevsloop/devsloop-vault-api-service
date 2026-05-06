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

    const request = await this.prisma.dynamicRequest.create({
      data: {
        typeKey: dto.typeKey,
        requesterId,
        formData: dto.formData as Prisma.InputJsonValue,
        status: 'PENDING',
      },
      include: { typeDef: true },
    });

    await this.workflowEngine.startWorkflow(dto.typeKey, request.id, requesterId, dto.formData);

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

    return { data, total, page, limit };
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
        stepInstances: {
          select: {
            stepOrder: true,
            resolution: true,
            stepSnapshot: true,
            actorId: true,
            eligibleApproverIds: true,
          },
        },
      },
    });

    // Filter to instances the actor is allowed to see.
    //
    // For active requests (a PENDING step exists at currentStepOrder):
    //   → only show if the user matches the CURRENT pending step.
    //   This ensures a user disappears from the list the moment they finish
    //   their step and the workflow advances to someone else.
    //
    // For completed requests (no pending step — APPROVED / REJECTED / CANCELLED):
    //   → show if the user matched any step, so they retain a history view.
    //
    // System users match any ENTITY-typed step (they hold all entity
    // permissions) but are excluded from ROLE and SPECIFIC_USER steps.
    const relevantInstances = allInstances.filter((i) => {
      // An "active" step is PENDING with eligibleApproverIds stamped (non-empty).
      // After a RETURN, eligibleApproverIds is cleared to [] so returned-but-not-yet-activated
      // steps are excluded — preventing spurious visibility for out-of-order steps.
      // Optional steps stamp the next step in parallel, so both can appear here simultaneously.
      const activeSteps = i.stepInstances.filter(
        (s) => s.resolution === 'PENDING' && s.eligibleApproverIds.length > 0,
      );

      if (activeSteps.length > 0) {
        return activeSteps.some(
          (s) =>
            // eligibleApproverIds is the resolved ground truth — covers metadata:reportingManagerId
            // and any SPECIFIC_USER whose value was resolved at activation time.
            s.eligibleApproverIds.includes(actorId) ||
            this.snapshotMatchesUser(
              s.stepSnapshot,
              actorId,
              roleNames,
              entityNames,
              actor?.isSystem ?? false,
            ),
        );
      }

      // Completed request — show if the user was a configured approver in any step,
      // OR was the actual actor who resolved it (preserves history when permissions change).
      return i.stepInstances.some(
        (s) =>
          s.actorId === actorId ||
          s.eligibleApproverIds.includes(actorId) ||
          this.snapshotMatchesUser(
            s.stepSnapshot,
            actorId,
            roleNames,
            entityNames,
            actor?.isSystem ?? false,
          ),
      );
    });

    const allRequestIds = relevantInstances.map((i) => i.requestId);

    // canAct: at least one active (stamped + PENDING) step matches the actor.
    const eligibleRequestIds = new Set(
      relevantInstances
        .filter((i) => {
          const activeSteps = i.stepInstances.filter(
            (s) => s.resolution === 'PENDING' && s.eligibleApproverIds.length > 0,
          );
          return activeSteps.some((s) =>
            this.snapshotMatchesUser(
              s.stepSnapshot,
              actorId,
              roleNames,
              entityNames,
              actor?.isSystem ?? false,
            ),
          );
        })
        .map((i) => i.requestId),
    );

    // Map requestId → union of available actions across all active steps the actor can act on.
    const actionsMap = new Map<string, string[]>();
    for (const instance of relevantInstances) {
      const activeSteps = instance.stepInstances.filter(
        (s) => s.resolution === 'PENDING' && s.eligibleApproverIds.length > 0,
      );
      const allActions = new Set<string>();
      for (const step of activeSteps) {
        if (
          this.snapshotMatchesUser(
            step.stepSnapshot,
            actorId,
            roleNames,
            entityNames,
            actor?.isSystem ?? false,
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

    const enriched = data.map((r) => ({
      ...r,
      canAct: eligibleRequestIds.has(r.id),
      availableActions: actionsMap.get(r.id) ?? [],
    }));

    return { data: enriched, total, page, limit, pending, approved, rejected };
  }

  private snapshotMatchesUser(
    stepSnapshot: unknown,
    userId: string,
    roleNames: Set<string>,
    entityNames: Set<string>,
    isSystem = false,
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
          if (value.startsWith('metadata:')) return false;
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
