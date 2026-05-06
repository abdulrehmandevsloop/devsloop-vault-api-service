import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, StepResolution, WorkflowInstance } from '@prisma/client';
import { PrismaService } from 'src/prisma';
import {
  WorkflowCompletedEvent,
  WorkflowReturnedEvent,
  WorkflowStepCompletedEvent,
} from './events';
import { WorkflowApproverService } from './workflow-approver.service';
import { WorkflowResolverService } from './workflow-resolver.service';
import { WorkflowSchedulerService } from './workflow-scheduler.service';

type TxClient = Prisma.TransactionClient;

interface StepSnapshot {
  approverType: string;
  approverValue: string | null;
  fallbackApproverType: string | null;
  fallbackApproverValue: string | null;
  rejectionPolicy: string;
  returnToStepOrder: number | null;
  isOptional: boolean;
  autoApproveAfterHours: number | null;
  conditionField: string | null;
  conditionOperator: string | null;
  conditionValue: string | null;
  actions: string[];
}

@Injectable()
export class WorkflowEngineService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: WorkflowResolverService,
    private readonly approver: WorkflowApproverService,
    private readonly scheduler: WorkflowSchedulerService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    this.scheduler.registerAutoApproveCallback(async (stepInstanceId) => {
      await this.autoApproveStep(stepInstanceId);
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async startWorkflow(
    requestType: string,
    requestId: string,
    requesterId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<WorkflowInstance> {
    const template = await this.resolver.resolveTemplate(requestType, requesterId);

    // Auto-inject reportingManagerId from the requester's teamLeadId when not already provided.
    if (!metadata.reportingManagerId) {
      const requester = await this.prisma.user.findUnique({
        where: { id: requesterId },
        select: { teamLeadId: true },
      });
      if (requester?.teamLeadId) {
        metadata = { ...metadata, reportingManagerId: requester.teamLeadId };
      }
    }

    const instance = await this.prisma.$transaction(async (tx) => {
      const inst = await tx.workflowInstance.create({
        data: {
          templateId: template.id,
          requestType,
          requestId,
          requesterId,
          status: 'PENDING',
          currentStepOrder: 1,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });

      await tx.workflowStepInstance.createMany({
        data: template.steps.map((step) => ({
          workflowInstanceId: inst.id,
          stepId: step.id,
          stepOrder: step.order,
          stepName: step.name,
          stepSnapshot: {
            approverType: step.approverType,
            approverValue: step.approverValue,
            fallbackApproverType: step.fallbackApproverType,
            fallbackApproverValue: step.fallbackApproverValue,
            rejectionPolicy: step.rejectionPolicy,
            returnToStepOrder: step.returnToStepOrder,
            isOptional: step.isOptional,
            autoApproveAfterHours: step.autoApproveAfterHours,
            conditionField: step.conditionField,
            conditionOperator: step.conditionOperator,
            conditionValue: step.conditionValue,
            actions: step.actions?.length ? step.actions : ['APPROVE', 'REJECT', 'VIEW'],
          } satisfies StepSnapshot,
          eligibleApproverIds: [],
          resolution: 'PENDING' as StepResolution,
        })),
      });

      await this.activateStep(tx, inst.id, 1, metadata);

      return inst;
    });

    this.logger.log(
      `Workflow started: instance=${instance.id} type=${requestType} request=${requestId}`,
    );
    return instance;
  }

  async resolveStep(
    instanceId: string,
    stepOrder: number,
    actorId: string,
    resolution: 'APPROVED' | 'REJECTED' | 'RETURNED',
    comment?: string,
  ): Promise<WorkflowInstance> {
    const result = await this.prisma.$transaction(async (tx) => {
      const stepInstance = await tx.workflowStepInstance.findUnique({
        where: { workflowInstanceId_stepOrder: { workflowInstanceId: instanceId, stepOrder } },
      });

      if (!stepInstance || stepInstance.resolution !== 'PENDING') {
        throw new ConflictException('This step has already been resolved');
      }

      const instance = await tx.workflowInstance.findUnique({
        where: { id: instanceId },
        include: { template: true },
      });

      if (!instance) throw new NotFoundException('Workflow instance not found');

      // Allow resolving either the current step OR the parallel next step of an optional stage.
      // After a RETURN, cleared steps have eligibleApproverIds=[] so they cannot be resolved out-of-order.
      let isResolvingParallelNextStep = false;
      if (stepOrder !== instance.currentStepOrder) {
        const currentStepInst = await tx.workflowStepInstance.findUnique({
          where: {
            workflowInstanceId_stepOrder: {
              workflowInstanceId: instanceId,
              stepOrder: instance.currentStepOrder,
            },
          },
        });
        const currentSnap = currentStepInst?.stepSnapshot as StepSnapshot | null;
        const isParallel =
          currentSnap?.isOptional === true &&
          stepOrder === instance.currentStepOrder + 1 &&
          stepInstance.eligibleApproverIds.length > 0;

        if (!isParallel) {
          throw new ConflictException('This step is not the current active step');
        }
        isResolvingParallelNextStep = true;
      }

      if (instance.requesterId === actorId) {
        throw new ForbiddenException('You cannot approve your own request');
      }

      const metadata = (instance.metadata as Record<string, unknown>) ?? {};
      const snapshot = stepInstance.stepSnapshot as unknown as StepSnapshot;

      // Bug 2: Re-resolve eligibility from live role/entity state instead of the stale stored array
      const eligibleIds = await this.approver.resolveEligibleApproverIds(
        {
          approverType: snapshot.approverType as import('@prisma/client').ApproverType,
          approverValue: snapshot.approverValue,
          fallbackApproverType: snapshot.fallbackApproverType as
            | import('@prisma/client').ApproverType
            | null,
          fallbackApproverValue: snapshot.fallbackApproverValue,
          isOptional: snapshot.isOptional,
        },
        metadata,
      );
      if (!eligibleIds.includes(actorId)) {
        throw new ForbiddenException('You are not authorized to act on this step');
      }

      const actionMap: Record<string, string> = {
        APPROVED: 'APPROVE',
        REJECTED: 'REJECT',
        RETURNED: 'RETURN',
      };
      const requiredAction = actionMap[resolution];
      if (snapshot.actions.length > 0 && !snapshot.actions.includes(requiredAction)) {
        throw new ForbiddenException(`Action '${requiredAction}' is not permitted on this step`);
      }

      // Bug 3: Walk back past SKIPPED steps to find the last effective actor
      if (instance.template.preventConsecutiveApproval && stepOrder > 1) {
        const lastResolved = await tx.workflowStepInstance.findFirst({
          where: {
            workflowInstanceId: instanceId,
            stepOrder: { lt: stepOrder },
            resolution: { notIn: ['PENDING', 'SKIPPED'] },
          },
          orderBy: { stepOrder: 'desc' },
        });
        if (lastResolved?.actorId === actorId) {
          throw new ForbiddenException('Same user cannot approve consecutive steps');
        }
      }

      // When the parallel next step is resolved first, auto-skip the optional step so the
      // workflow state stays consistent. Use updateMany with a PENDING condition to be safe
      // against the unlikely race where both steps are resolved simultaneously.
      if (isResolvingParallelNextStep) {
        await tx.workflowStepInstance.updateMany({
          where: {
            workflowInstanceId: instanceId,
            stepOrder: instance.currentStepOrder,
            resolution: 'PENDING',
          },
          data: { resolution: 'SKIPPED', eligibleApproverIds: [] },
        });
      }

      await tx.workflowStepInstance.update({
        where: { id: stepInstance.id },
        data: { resolution, actorId, comment, resolvedAt: new Date() },
      });

      // Reload instance if we mutated the currentStepOrder's step above
      const instanceForHandlers = isResolvingParallelNextStep
        ? ((await tx.workflowInstance.findUniqueOrThrow({
            where: { id: instanceId },
            include: { template: true },
          })) as typeof instance)
        : instance;

      let updatedInstance: WorkflowInstance;
      if (resolution === 'APPROVED') {
        updatedInstance = await this.handleStepApproved(
          tx,
          instanceForHandlers,
          stepOrder,
          metadata,
        );
      } else if (resolution === 'REJECTED') {
        updatedInstance = await this.handleStepRejected(
          tx,
          instanceForHandlers,
          stepOrder,
          snapshot,
          metadata,
        );
      } else {
        updatedInstance = await this.handleStepReturned(
          tx,
          instanceForHandlers,
          stepOrder,
          metadata,
        );
      }

      return { updatedInstance, stepInstance, snapshot };
    });

    this.eventEmitter.emit(
      'workflow.step.completed',
      new WorkflowStepCompletedEvent(
        instanceId,
        result.updatedInstance.requestType,
        result.updatedInstance.requestId,
        result.updatedInstance.requesterId,
        stepOrder,
        result.stepInstance.stepName,
        resolution,
        actorId,
        comment ?? null,
      ),
    );

    return result.updatedInstance;
  }

  async cancelWorkflow(instanceId: string, requesterId: string): Promise<WorkflowInstance> {
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id: instanceId },
    });
    if (!instance) throw new NotFoundException('Workflow instance not found');
    if (instance.requesterId !== requesterId) {
      throw new ForbiddenException('Only the requester can cancel this workflow');
    }
    if (!['PENDING', 'IN_PROGRESS', 'RETURNED'].includes(instance.status)) {
      throw new ConflictException('Cannot cancel a workflow that is already completed');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.workflowStepInstance.updateMany({
        where: { workflowInstanceId: instanceId, resolution: 'PENDING' },
        data: { resolution: 'SKIPPED' },
      });
      return tx.workflowInstance.update({
        where: { id: instanceId },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
    });

    this.eventEmitter.emit(
      'workflow.completed',
      new WorkflowCompletedEvent(
        instanceId,
        instance.requestType,
        instance.requestId,
        instance.requesterId,
        'CANCELLED',
      ),
    );

    return updated;
  }

  async findInstanceByRequest(requestType: string, requestId: string): Promise<WorkflowInstance> {
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { requestType_requestId: { requestType, requestId } },
      include: { stepInstances: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!instance) throw new NotFoundException('No workflow instance found for this request');
    return instance;
  }

  async getMyPending(userId: string, query: import('./dto').QueryWorkflowInstancesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.WorkflowStepInstanceWhereInput = {
      resolution: 'PENDING',
      eligibleApproverIds: { has: userId },
      ...(query.requestType ? { workflowInstance: { requestType: query.requestType } } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.workflowStepInstance.findMany({
        where,
        include: { workflowInstance: true },
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.workflowStepInstance.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getMyRequests(userId: string, query: import('./dto').QueryWorkflowInstancesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.WorkflowInstanceWhereInput = {
      requesterId: userId,
      ...(query.requestType ? { requestType: query.requestType } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.workflowInstance.findMany({
        where,
        include: { stepInstances: { orderBy: { stepOrder: 'asc' } } },
        skip,
        take: limit,
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.workflowInstance.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getInstance(instanceId: string) {
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id: instanceId },
      include: {
        template: { include: { steps: { orderBy: { order: 'asc' } } } },
        stepInstances: { orderBy: { stepOrder: 'asc' } },
      },
    });
    if (!instance) throw new NotFoundException('Workflow instance not found');
    return instance;
  }

  // ── Internal state machine ──────────────────────────────────────────────────

  private async handleStepApproved(
    tx: TxClient,
    instance: WorkflowInstance & {
      template: { maxReturnCount: number; preventConsecutiveApproval: boolean };
    },
    stepOrder: number,
    metadata: Record<string, unknown>,
  ): Promise<WorkflowInstance> {
    const nextOrder = stepOrder + 1;
    const nextStep = await tx.workflowStepInstance.findUnique({
      where: {
        workflowInstanceId_stepOrder: { workflowInstanceId: instance.id, stepOrder: nextOrder },
      },
    });

    if (!nextStep) {
      const updated = await tx.workflowInstance.update({
        where: { id: instance.id },
        data: { status: 'APPROVED', completedAt: new Date() },
      });
      setImmediate(() =>
        this.eventEmitter.emit(
          'workflow.completed',
          new WorkflowCompletedEvent(
            instance.id,
            instance.requestType,
            instance.requestId,
            instance.requesterId,
            'APPROVED',
          ),
        ),
      );
      return updated;
    }

    return this.advanceToNextEligibleStep(tx, instance, nextOrder, metadata);
  }

  private async handleStepRejected(
    tx: TxClient,
    instance: WorkflowInstance & {
      template: { maxReturnCount: number; preventConsecutiveApproval: boolean };
    },
    stepOrder: number,
    snapshot: StepSnapshot,
    metadata: Record<string, unknown>,
  ): Promise<WorkflowInstance> {
    const policy = snapshot.rejectionPolicy;

    if (policy === 'TERMINATE') {
      await tx.workflowStepInstance.updateMany({
        where: { workflowInstanceId: instance.id, resolution: 'PENDING' },
        data: { resolution: 'SKIPPED' },
      });
      const updated = await tx.workflowInstance.update({
        where: { id: instance.id },
        data: { status: 'REJECTED', completedAt: new Date() },
      });
      setImmediate(() =>
        this.eventEmitter.emit(
          'workflow.completed',
          new WorkflowCompletedEvent(
            instance.id,
            instance.requestType,
            instance.requestId,
            instance.requesterId,
            'REJECTED',
          ),
        ),
      );
      return updated;
    }

    if (policy === 'ADVANCE_TO_NEXT' || policy === 'ADVANCE_TO_FINAL') {
      const allSteps = await tx.workflowStepInstance.findMany({
        where: { workflowInstanceId: instance.id },
        select: { stepOrder: true },
        orderBy: { stepOrder: 'asc' },
      });
      const maxStepOrder = allSteps[allSteps.length - 1]?.stepOrder ?? stepOrder;
      const advanceTo = policy === 'ADVANCE_TO_NEXT' ? stepOrder + 1 : maxStepOrder;

      if (advanceTo > maxStepOrder) {
        // Already at or past last step — complete as REJECTED
        await tx.workflowStepInstance.updateMany({
          where: { workflowInstanceId: instance.id, resolution: 'PENDING' },
          data: { resolution: 'SKIPPED' },
        });
        const updated = await tx.workflowInstance.update({
          where: { id: instance.id },
          data: { status: 'REJECTED', completedAt: new Date() },
        });
        setImmediate(() =>
          this.eventEmitter.emit(
            'workflow.completed',
            new WorkflowCompletedEvent(
              instance.id,
              instance.requestType,
              instance.requestId,
              instance.requesterId,
              'REJECTED',
            ),
          ),
        );
        return updated;
      }

      // Skip all steps between current and the advance target
      await tx.workflowStepInstance.updateMany({
        where: {
          workflowInstanceId: instance.id,
          stepOrder: { gt: stepOrder, lt: advanceTo },
          resolution: 'PENDING',
        },
        data: { resolution: 'SKIPPED' },
      });

      const updated = await tx.workflowInstance.update({
        where: { id: instance.id },
        data: { status: 'IN_PROGRESS', currentStepOrder: advanceTo },
      });

      await this.activateStep(tx, instance.id, advanceTo, metadata);
      return updated;
    }

    let returnToStep = policy === 'RETURN_TO_STEP' ? (snapshot.returnToStepOrder ?? 1) : 1;
    const newReturnCount = instance.returnCount + 1;

    // Bug 6: Guard against an invalid returnToStepOrder that would stall the workflow permanently
    if (returnToStep !== 1) {
      const targetStepExists = await tx.workflowStepInstance.findUnique({
        where: {
          workflowInstanceId_stepOrder: {
            workflowInstanceId: instance.id,
            stepOrder: returnToStep,
          },
        },
      });
      if (!targetStepExists) {
        this.logger.warn(
          `returnToStepOrder ${returnToStep} not found on instance ${instance.id}; falling back to step 1`,
        );
        returnToStep = 1;
      }
    }

    if (newReturnCount > instance.template.maxReturnCount) {
      await tx.workflowStepInstance.updateMany({
        where: { workflowInstanceId: instance.id, resolution: 'PENDING' },
        data: { resolution: 'SKIPPED' },
      });
      const updated = await tx.workflowInstance.update({
        where: { id: instance.id },
        data: { status: 'REJECTED', completedAt: new Date(), returnCount: newReturnCount },
      });
      setImmediate(() =>
        this.eventEmitter.emit(
          'workflow.completed',
          new WorkflowCompletedEvent(
            instance.id,
            instance.requestType,
            instance.requestId,
            instance.requesterId,
            'REJECTED',
            'Max returns exceeded',
          ),
        ),
      );
      return updated;
    }

    // Reset ALL steps from returnToStep onward (including SKIPPED) and clear eligibleApproverIds.
    // Including SKIPPED ensures parallel-bypassed steps are properly re-evaluated on the next run.
    await tx.workflowStepInstance.updateMany({
      where: {
        workflowInstanceId: instance.id,
        stepOrder: { gte: returnToStep },
      },
      data: {
        resolution: 'PENDING',
        actorId: null,
        comment: null,
        resolvedAt: null,
        eligibleApproverIds: [],
      },
    });

    const updated = await tx.workflowInstance.update({
      where: { id: instance.id },
      data: { status: 'RETURNED', currentStepOrder: returnToStep, returnCount: newReturnCount },
    });

    setImmediate(() =>
      this.eventEmitter.emit(
        'workflow.returned',
        new WorkflowReturnedEvent(
          instance.id,
          instance.requestType,
          instance.requestId,
          instance.requesterId,
          stepOrder,
          returnToStep,
          newReturnCount,
          '',
          null,
        ),
      ),
    );

    await this.activateStep(tx, instance.id, returnToStep, metadata);
    return updated;
  }

  private async handleStepReturned(
    tx: TxClient,
    instance: WorkflowInstance & {
      template: { maxReturnCount: number; preventConsecutiveApproval: boolean };
    },
    stepOrder: number,
    metadata: Record<string, unknown>,
  ): Promise<WorkflowInstance> {
    const newReturnCount = instance.returnCount + 1;

    if (newReturnCount > instance.template.maxReturnCount) {
      await tx.workflowStepInstance.updateMany({
        where: { workflowInstanceId: instance.id, resolution: 'PENDING' },
        data: { resolution: 'SKIPPED' },
      });
      const updated = await tx.workflowInstance.update({
        where: { id: instance.id },
        data: { status: 'REJECTED', completedAt: new Date(), returnCount: newReturnCount },
      });
      setImmediate(() =>
        this.eventEmitter.emit(
          'workflow.completed',
          new WorkflowCompletedEvent(
            instance.id,
            instance.requestType,
            instance.requestId,
            instance.requesterId,
            'REJECTED',
            'Max returns exceeded',
          ),
        ),
      );
      return updated;
    }

    // Reset ALL steps (including SKIPPED) and clear eligibleApproverIds so parallel-bypassed
    // steps are cleanly re-evaluated when the workflow restarts from step 1.
    await tx.workflowStepInstance.updateMany({
      where: { workflowInstanceId: instance.id },
      data: {
        resolution: 'PENDING',
        actorId: null,
        comment: null,
        resolvedAt: null,
        eligibleApproverIds: [],
      },
    });

    const updated = await tx.workflowInstance.update({
      where: { id: instance.id },
      data: { status: 'RETURNED', currentStepOrder: 1, returnCount: newReturnCount },
    });

    setImmediate(() =>
      this.eventEmitter.emit(
        'workflow.returned',
        new WorkflowReturnedEvent(
          instance.id,
          instance.requestType,
          instance.requestId,
          instance.requesterId,
          stepOrder,
          1,
          newReturnCount,
          '',
          null,
        ),
      ),
    );

    await this.activateStep(tx, instance.id, 1, metadata);
    return updated;
  }

  private async advanceToNextEligibleStep(
    tx: TxClient,
    instance: WorkflowInstance & {
      template: { maxReturnCount: number; preventConsecutiveApproval: boolean };
    },
    fromStepOrder: number,
    metadata: Record<string, unknown>,
  ): Promise<WorkflowInstance> {
    const stepInstance = await tx.workflowStepInstance.findUnique({
      where: {
        workflowInstanceId_stepOrder: {
          workflowInstanceId: instance.id,
          stepOrder: fromStepOrder,
        },
      },
    });

    if (!stepInstance) {
      // No more steps — workflow complete
      const updated = await tx.workflowInstance.update({
        where: { id: instance.id },
        data: { status: 'APPROVED', completedAt: new Date() },
      });
      setImmediate(() =>
        this.eventEmitter.emit(
          'workflow.completed',
          new WorkflowCompletedEvent(
            instance.id,
            instance.requestType,
            instance.requestId,
            instance.requesterId,
            'APPROVED',
          ),
        ),
      );
      return updated;
    }

    const snapshot = stepInstance.stepSnapshot as unknown as StepSnapshot;

    if (!this.evaluateCondition(snapshot, metadata)) {
      await tx.workflowStepInstance.update({
        where: { id: stepInstance.id },
        data: { resolution: 'SKIPPED' },
      });
      return this.advanceToNextEligibleStep(tx, instance, fromStepOrder + 1, metadata);
    }

    return this.activateStep(tx, instance.id, fromStepOrder, metadata);
  }

  private async activateStep(
    tx: TxClient,
    instanceId: string,
    stepOrder: number,
    metadata: Record<string, unknown>,
  ): Promise<WorkflowInstance> {
    const stepInstance = await tx.workflowStepInstance.findUnique({
      where: { workflowInstanceId_stepOrder: { workflowInstanceId: instanceId, stepOrder } },
    });

    if (!stepInstance) {
      return tx.workflowInstance.findUniqueOrThrow({
        where: { id: instanceId },
      }) as Promise<WorkflowInstance>;
    }

    const snapshot = stepInstance.stepSnapshot as unknown as StepSnapshot;
    const eligibleApproverIds = await this.approver.resolveEligibleApproverIds(
      {
        approverType: snapshot.approverType as import('@prisma/client').ApproverType,
        approverValue: snapshot.approverValue,
        fallbackApproverType: snapshot.fallbackApproverType as
          | import('@prisma/client').ApproverType
          | null,
        fallbackApproverValue: snapshot.fallbackApproverValue,
        isOptional: snapshot.isOptional,
      },
      metadata,
    );

    if (eligibleApproverIds.length === 0 && snapshot.isOptional) {
      await tx.workflowStepInstance.update({
        where: { id: stepInstance.id },
        data: { resolution: 'SKIPPED' },
      });
      const instance = await tx.workflowInstance.findUniqueOrThrow({
        where: { id: instanceId },
        include: { template: true },
      });
      return this.advanceToNextEligibleStep(
        tx,
        instance as WorkflowInstance & {
          template: { maxReturnCount: number; preventConsecutiveApproval: boolean };
        },
        stepOrder + 1,
        metadata,
      );
    }

    await tx.workflowStepInstance.update({
      where: { id: stepInstance.id },
      data: { eligibleApproverIds },
    });

    const updated = await tx.workflowInstance.update({
      where: { id: instanceId },
      data: { status: 'IN_PROGRESS', currentStepOrder: stepOrder },
    });

    // Optional step with eligible approvers: also stamp the next step so both are
    // reviewable simultaneously. Whichever user acts first advances the workflow.
    if (snapshot.isOptional && eligibleApproverIds.length > 0) {
      await this.stampNextStepInParallel(tx, instanceId, stepOrder + 1, metadata);
    }

    if (snapshot.autoApproveAfterHours) {
      setImmediate(
        () =>
          void this.scheduler.scheduleAutoApprove(stepInstance.id, snapshot.autoApproveAfterHours!),
      );
    }

    return updated;
  }

  private async stampNextStepInParallel(
    tx: TxClient,
    instanceId: string,
    nextStepOrder: number,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const nextStep = await tx.workflowStepInstance.findUnique({
      where: {
        workflowInstanceId_stepOrder: { workflowInstanceId: instanceId, stepOrder: nextStepOrder },
      },
    });
    if (!nextStep) return;

    const nextSnap = nextStep.stepSnapshot as unknown as StepSnapshot;
    if (!this.evaluateCondition(nextSnap, metadata)) return;

    const eligibleApproverIds = await this.approver.resolveEligibleApproverIds(
      {
        approverType: nextSnap.approverType as import('@prisma/client').ApproverType,
        approverValue: nextSnap.approverValue,
        fallbackApproverType: nextSnap.fallbackApproverType as
          | import('@prisma/client').ApproverType
          | null,
        fallbackApproverValue: nextSnap.fallbackApproverValue,
        isOptional: nextSnap.isOptional,
      },
      metadata,
    );

    if (eligibleApproverIds.length > 0) {
      await tx.workflowStepInstance.update({
        where: { id: nextStep.id },
        data: { eligibleApproverIds },
      });
    }
  }

  private evaluateCondition(snapshot: StepSnapshot, metadata: Record<string, unknown>): boolean {
    if (!snapshot.conditionField || !snapshot.conditionOperator) return true;
    const fieldValue = metadata[snapshot.conditionField];
    const compareValue = snapshot.conditionValue;

    switch (snapshot.conditionOperator) {
      case 'gt':
        return Number(fieldValue) > Number(compareValue);
      case 'gte':
        return Number(fieldValue) >= Number(compareValue);
      case 'lt':
        return Number(fieldValue) < Number(compareValue);
      case 'lte':
        return Number(fieldValue) <= Number(compareValue);
      case 'eq':
        return String(fieldValue) === String(compareValue);
      case 'neq':
        return String(fieldValue) !== String(compareValue);
      case 'in':
        return (compareValue ?? '').split(',').includes(String(fieldValue));
      default:
        return true;
    }
  }

  private async autoApproveStep(stepInstanceId: string): Promise<void> {
    const stepInstance = await this.prisma.workflowStepInstance.findUnique({
      where: { id: stepInstanceId },
    });
    if (!stepInstance || stepInstance.resolution !== 'PENDING') return;

    this.logger.log(`Auto-approving step instance ${stepInstanceId}`);

    await this.prisma.$transaction(async (tx) => {
      await tx.workflowStepInstance.update({
        where: { id: stepInstanceId },
        data: {
          resolution: 'APPROVED',
          autoApproved: true,
          resolvedAt: new Date(),
        },
      });

      const instance = await tx.workflowInstance.findUniqueOrThrow({
        where: { id: stepInstance.workflowInstanceId },
        include: { template: true },
      });

      const metadata = (instance.metadata as Record<string, unknown>) ?? {};
      await this.handleStepApproved(
        tx,
        instance as WorkflowInstance & {
          template: { maxReturnCount: number; preventConsecutiveApproval: boolean };
        },
        stepInstance.stepOrder,
        metadata,
      );
    });
  }
}
