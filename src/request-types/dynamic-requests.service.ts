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
    if (BUILT_IN_KEYS.has(dto.typeKey)) {
      throw new BadRequestException(
        `"${dto.typeKey}" is a built-in request type. Use the dedicated endpoint for this request type.`,
      );
    }

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

    // Only fetch instances where the actor appears in at least one step —
    // this is the primary visibility filter (not just "can act right now").
    const allInstances = await this.prisma.workflowInstance.findMany({
      where: {
        requestType: typeKey ? typeKey : { notIn: [...BUILT_IN_KEYS] as string[] },
        stepInstances: { some: { eligibleApproverIds: { has: actorId } } },
      },
      select: {
        requestId: true,
        currentStepOrder: true,
        status: true,
        stepInstances: {
          select: {
            stepOrder: true,
            eligibleApproverIds: true,
            resolution: true,
            stepSnapshot: true,
          },
        },
      },
    });

    const allRequestIds = allInstances.map((i) => i.requestId);

    // Build eligible actor set: requestIds where this actor has a PENDING step
    const eligibleRequestIds = new Set(
      allInstances
        .filter((i) =>
          i.stepInstances.some(
            (s) => s.resolution === 'PENDING' && s.eligibleApproverIds.includes(actorId),
          ),
        )
        .map((i) => i.requestId),
    );

    // Map requestId → available actions from the current pending step's snapshot
    const actionsMap = new Map<string, string[]>();
    for (const instance of allInstances) {
      const currentStep = instance.stepInstances.find(
        (s) => s.stepOrder === instance.currentStepOrder && s.resolution === 'PENDING',
      );
      const snapshot = currentStep?.stepSnapshot as Record<string, any> | null;
      const actions: string[] = Array.isArray(snapshot?.actions)
        ? snapshot.actions
        : ['APPROVE', 'REJECT', 'VIEW'];
      actionsMap.set(instance.requestId, actions);
    }

    const where = {
      id: { in: allRequestIds },
      ...(typeKey && { typeKey }),
      ...(status && {
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

    const enriched = data.map((r) => ({
      ...r,
      canAct: eligibleRequestIds.has(r.id),
      availableActions: actionsMap.get(r.id) ?? [],
    }));

    const pending = enriched.filter(
      (r) => r.status === 'PENDING' || r.status === 'IN_PROGRESS',
    ).length;
    const approved = enriched.filter((r) => r.status === 'APPROVED').length;
    const rejected = enriched.filter((r) => r.status === 'REJECTED').length;

    return { data: enriched, total, page, limit, pending, approved, rejected };
  }

  @OnEvent('workflow.completed', { async: true })
  async handleWorkflowCompleted(event: WorkflowCompletedEvent) {
    if (BUILT_IN_KEYS.has(event.requestType)) return;

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
