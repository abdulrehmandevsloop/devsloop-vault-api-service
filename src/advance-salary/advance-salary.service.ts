import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AdvanceSalaryRepaymentStatus, DynamicRequestStatus } from '@prisma/client';
import { RequestContextService } from 'src/common/services/request-context.service';
import { WorkflowEngineService } from 'src/workflows/workflow-engine.service';
import { RepaymentAutoDeductService } from 'src/scheduler/repayment-auto-deduct.service';
import {
  CreateAdvanceSalaryRequestDto,
  UpdateAdvanceSalaryRequestDto,
  ApproveAdvanceSalaryDto,
  RejectAdvanceSalaryDto,
  DisburseAdvanceSalaryDto,
  AdvanceSalaryQueryDto,
  ManagementAdvanceSalaryQueryDto,
} from 'src/advance-salary/dto';

const EMPLOYEE_SELECT = {
  id: true,
  name: true,
  email: true,
  departments: true,
  designation: true,
  employeeId: true,
} as const;

const TERMINAL_STATUSES: DynamicRequestStatus[] = [
  DynamicRequestStatus.COMPLETED,
  DynamicRequestStatus.REJECTED,
  DynamicRequestStatus.CANCELLED,
];

const DISBURSEMENT_STATUSES: DynamicRequestStatus[] = [
  DynamicRequestStatus.DISBURSED,
  DynamicRequestStatus.REPAYING,
  DynamicRequestStatus.COMPLETED,
];

type AdvanceSalaryFormData = Record<string, unknown>;

function fd(request: { formData: unknown }): AdvanceSalaryFormData {
  return (request.formData ?? {}) as AdvanceSalaryFormData;
}

// The portal expects request fields (amount, approvedAmount, etc.) flat on the
// response. Internally they live inside DynamicRequest.formData. This helper
// flattens that out and also surfaces requesterId/requester as
// employeeId/employee so the existing portal types continue to work.
function flattenAdvanceSalary<
  T extends { formData: unknown; requester?: unknown; requesterId?: string },
>(request: T): T & Record<string, unknown> {
  const data = fd(request);
  const { requester, ...rest } = request as T & { requester?: unknown };
  return {
    ...rest,
    ...data,
    ...(requester !== undefined ? { employee: requester } : {}),
    ...(request.requesterId !== undefined ? { employeeId: request.requesterId } : {}),
  } as T & Record<string, unknown>;
}

@Injectable()
export class AdvanceSalaryService {
  constructor(
    private prisma: PrismaService,
    private requestContext: RequestContextService,
    private workflowEngine: WorkflowEngineService,
    private repaymentAutoDeduct: RepaymentAutoDeductService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: Create
  // ─────────────────────────────────────────────────────────────────────────────

  async create(dto: CreateAdvanceSalaryRequestDto, userId: string) {
    const request = await this.prisma.dynamicRequest.create({
      data: {
        typeKey: 'ADVANCE_SALARY',
        requesterId: userId,
        status: DynamicRequestStatus.PENDING,
        formData: {
          amount: dto.amount,
          reason: dto.reason,
          requestedRepaymentMonths: 1,
          notes: dto.notes ?? null,
          monthlyDeduction: dto.amount,
          totalRepaid: 0,
          remainingBalance: 0,
        },
      },
      include: { requester: { select: EMPLOYEE_SELECT } },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'ADVANCE_SALARY_REQUEST_CREATED',
        entityType: 'AdvanceSalaryRequest',
        entityId: request.id,
        changes: { before: null, after: request },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    const requester = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { teamLeadId: true },
    });

    try {
      await this.workflowEngine.startWorkflow('ADVANCE_SALARY', request.id, userId, {
        amount: dto.amount,
        ...(requester?.teamLeadId ? { reportingManagerId: requester.teamLeadId } : {}),
      });
    } catch (err) {
      await this.prisma.dynamicRequest.delete({ where: { id: request.id } });
      throw err;
    }

    return flattenAdvanceSalary(request);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: List own requests
  // ─────────────────────────────────────────────────────────────────────────────

  async findMyRequests(userId: string, query: AdvanceSalaryQueryDto) {
    const { page = 1, limit = 20, status } = query;
    const skip = (page - 1) * limit;

    const where = {
      typeKey: 'ADVANCE_SALARY' as const,
      requesterId: userId,
      ...(status && { status: status }),
    };

    const [data, total, incompleteCount] = await this.prisma.$transaction([
      this.prisma.dynamicRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { requester: { select: EMPLOYEE_SELECT } },
      }),
      this.prisma.dynamicRequest.count({ where }),
      this.prisma.dynamicRequest.count({
        where: {
          typeKey: 'ADVANCE_SALARY',
          requesterId: userId,
          status: { notIn: TERMINAL_STATUSES },
        },
      }),
    ]);

    const requestIds = data.map((r) => r.id);
    const viewMap = await this.workflowEngine.getActorWorkflowView(
      'ADVANCE_SALARY',
      requestIds,
      userId,
    );

    return {
      data: data.map((req) => {
        const view = viewMap.get(req.id);
        return {
          ...flattenAdvanceSalary(req),
          activeStepInfo: view?.activeStepInfo ?? [],
          activeStepOrders: view?.activeStepOrders ?? [],
          currentStage: view?.currentStage ?? null,
        };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPreviousPage: page > 1,
      hasIncompleteAdvanceSalary: incompleteCount > 0,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: Get single request
  // ─────────────────────────────────────────────────────────────────────────────

  async findOne(id: string, userId: string, isManagement = false) {
    const request = await this.prisma.dynamicRequest.findUnique({
      where: { id },
      include: {
        requester: { select: EMPLOYEE_SELECT },
        advanceSalaryRepayments: { orderBy: { installmentNo: 'asc' } },
      },
    });

    if (!request || request.typeKey !== 'ADVANCE_SALARY') {
      throw new NotFoundException('Advance salary request not found');
    }
    if (!isManagement && request.requesterId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const viewMap = await this.workflowEngine.getActorWorkflowView(
      'ADVANCE_SALARY',
      [request.id],
      userId,
    );
    const view = viewMap.get(request.id);
    return {
      ...flattenAdvanceSalary(request),
      canAct: view?.canAct ?? false,
      availableActions: view?.availableActions ?? [],
      activeStepInfo: view?.activeStepInfo ?? [],
      activeStepOrders: view?.activeStepOrders ?? [],
      currentStage: view?.currentStage ?? null,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: Update pending request
  // ─────────────────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateAdvanceSalaryRequestDto, userId: string) {
    const request = await this.prisma.dynamicRequest.findUnique({ where: { id } });
    if (!request || request.typeKey !== 'ADVANCE_SALARY') {
      throw new NotFoundException('Advance salary request not found');
    }
    if (request.requesterId !== userId) throw new ForbiddenException('Access denied');
    if (request.status !== DynamicRequestStatus.PENDING) {
      throw new BadRequestException('Only PENDING requests can be updated');
    }

    const current = fd(request);
    const amount = dto.amount ?? Number(current.amount);

    const updated = await this.prisma.dynamicRequest.update({
      where: { id },
      data: {
        formData: {
          ...current,
          ...(dto.amount !== undefined && { amount: dto.amount }),
          ...(dto.reason !== undefined && { reason: dto.reason }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          requestedRepaymentMonths: 1,
          monthlyDeduction: amount,
        },
      },
      include: { requester: { select: EMPLOYEE_SELECT } },
    });
    return flattenAdvanceSalary(updated);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: Cancel pending request
  // ─────────────────────────────────────────────────────────────────────────────

  async cancel(id: string, userId: string) {
    const request = await this.prisma.dynamicRequest.findUnique({ where: { id } });
    if (!request || request.typeKey !== 'ADVANCE_SALARY') {
      throw new NotFoundException('Advance salary request not found');
    }
    if (request.requesterId !== userId) throw new ForbiddenException('Access denied');
    const cancellableStatuses: DynamicRequestStatus[] = [
      DynamicRequestStatus.PENDING,
      DynamicRequestStatus.IN_PROGRESS,
    ];
    if (!cancellableStatuses.includes(request.status)) {
      throw new BadRequestException('Only PENDING or IN_PROGRESS requests can be cancelled');
    }

    await this.prisma.$transaction([
      this.prisma.dynamicRequest.update({
        where: { id },
        data: { status: DynamicRequestStatus.CANCELLED },
      }),
      this.prisma.workflowInstance.updateMany({
        where: { requestId: id, status: { in: ['PENDING', 'IN_PROGRESS', 'RETURNED'] } },
        data: { status: 'CANCELLED', completedAt: new Date() },
      }),
    ]);

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'ADVANCE_SALARY_REQUEST_CANCELLED',
        entityType: 'AdvanceSalaryRequest',
        entityId: id,
        changes: { before: request.status, after: DynamicRequestStatus.CANCELLED },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: Get repayment schedule
  // ─────────────────────────────────────────────────────────────────────────────

  async getRepayments(id: string, userId: string, _isManagement = false) {
    const request = await this.prisma.dynamicRequest.findUnique({ where: { id } });
    if (!request || request.typeKey !== 'ADVANCE_SALARY') {
      throw new NotFoundException('Advance salary request not found');
    }

    await this.repaymentAutoDeduct.autoDeductPastDue();

    return this.prisma.advanceSalaryRepayment.findMany({
      where: { requestId: id },
      orderBy: { installmentNo: 'asc' },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Management: List all requests
  // ─────────────────────────────────────────────────────────────────────────────

  async findAll(query: ManagementAdvanceSalaryQueryDto, actorId: string) {
    const { page = 1, limit = 20, status, search, employeeId } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      typeKey: 'ADVANCE_SALARY',
      ...(status && { status: status }),
      ...(employeeId && { requesterId: employeeId }),
      ...(search && {
        requester: {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        },
      }),
    };

    const [data, total, statusGroups] = await this.prisma.$transaction([
      this.prisma.dynamicRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { requester: { select: EMPLOYEE_SELECT } },
      }),
      this.prisma.dynamicRequest.count({ where }),
      this.prisma.dynamicRequest.groupBy({
        by: ['status'],
        where: { typeKey: 'ADVANCE_SALARY' },
        _count: true,
        orderBy: { status: 'asc' },
      }),
    ]);

    const disbursedRows = data.filter((r) => DISBURSEMENT_STATUSES.includes(r.status));
    const totalRepaid = disbursedRows.reduce(
      (sum, r) => sum + Number((fd(r).totalRepaid as number) ?? 0),
      0,
    );
    const totalOutstanding = disbursedRows.reduce(
      (sum, r) => sum + Number((fd(r).remainingBalance as number) ?? 0),
      0,
    );

    const countByStatus = (s: DynamicRequestStatus) =>
      Number(statusGroups.find((g) => g.status === s)?._count ?? 0);

    const requestIds = data.map((r) => r.id);
    const viewMap = await this.workflowEngine.getActorWorkflowView(
      'ADVANCE_SALARY',
      requestIds,
      actorId,
    );

    return {
      data: data.map((r) => {
        const view = viewMap.get(r.id);
        return {
          ...flattenAdvanceSalary(r),
          canAct: view?.canAct ?? false,
          availableActions: view?.availableActions ?? [],
          activeStepInfo: view?.activeStepInfo ?? [],
          activeStepOrders: view?.activeStepOrders ?? [],
          currentStage: view?.currentStage ?? null,
        };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPreviousPage: page > 1,
      pending: countByStatus(DynamicRequestStatus.PENDING),
      approved: countByStatus(DynamicRequestStatus.APPROVED),
      disbursed: countByStatus(DynamicRequestStatus.DISBURSED),
      repaying: countByStatus(DynamicRequestStatus.REPAYING),
      completed: countByStatus(DynamicRequestStatus.COMPLETED),
      rejected: countByStatus(DynamicRequestStatus.REJECTED),
      totalRepaid,
      totalOutstanding,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Management: Persist approval metadata (status driven by workflow events)
  // ─────────────────────────────────────────────────────────────────────────────

  async saveApprovalMetadata(id: string, dto: ApproveAdvanceSalaryDto, reviewerId: string) {
    const request = await this.prisma.dynamicRequest.findUnique({ where: { id } });
    if (!request || request.typeKey !== 'ADVANCE_SALARY') {
      throw new NotFoundException('Advance salary request not found');
    }
    const reviewableStatuses: DynamicRequestStatus[] = [
      DynamicRequestStatus.PENDING,
      DynamicRequestStatus.IN_PROGRESS,
      DynamicRequestStatus.APPROVED,
    ];
    if (!reviewableStatuses.includes(request.status)) {
      throw new BadRequestException('Advance salary request is not in a reviewable state');
    }

    const current = fd(request);
    const requestedAmount = Number(current.amount);
    const approvedAmount = dto.approvedAmount ?? requestedAmount;

    const isModified = approvedAmount !== requestedAmount;

    if (isModified) {
      const instance = await this.prisma.workflowInstance.findUnique({
        where: { requestType_requestId: { requestType: 'ADVANCE_SALARY', requestId: id } },
        include: {
          stepInstances: { where: { resolution: 'PENDING' }, orderBy: { stepOrder: 'asc' } },
        },
      });
      const activeStep = instance?.stepInstances.find(
        (s) => s.stepOrder === instance.currentStepOrder,
      );
      const snap = (activeStep?.stepSnapshot ?? null) as Record<string, unknown> | null;
      const isUserEntityStep = snap?.approverType === 'ENTITY' && snap?.approverValue === 'user';
      if (!isUserEntityStep) {
        throw new ForbiddenException('Only HR (user entity) can modify the requested amount');
      }
    }

    const updated = await this.prisma.dynamicRequest.update({
      where: { id },
      data: {
        formData: {
          ...current,
          reviewedById: reviewerId,
          reviewedAt: new Date().toISOString(),
          reviewComment: dto.reviewComment ?? null,
          approvedAmount,
          approvedRepaymentMonths: 1,
          monthlyDeduction: approvedAmount,
          ...(isModified
            ? {
                modifiedById: reviewerId,
                modifiedAt: new Date().toISOString(),
                modifyComment: dto.modifyComment?.trim() || null,
                originalAmount:
                  current.originalAmount !== undefined ? current.originalAmount : requestedAmount,
              }
            : {}),
        },
      },
      include: { requester: { select: EMPLOYEE_SELECT } },
    });
    return flattenAdvanceSalary(updated);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Management: Persist rejection metadata (status driven by workflow events)
  // ─────────────────────────────────────────────────────────────────────────────

  async saveRejectionMetadata(id: string, dto: RejectAdvanceSalaryDto, reviewerId: string) {
    const request = await this.prisma.dynamicRequest.findUnique({ where: { id } });
    if (!request || request.typeKey !== 'ADVANCE_SALARY') {
      throw new NotFoundException('Advance salary request not found');
    }

    const updated = await this.prisma.dynamicRequest.update({
      where: { id },
      data: {
        formData: {
          ...fd(request),
          reviewedById: reviewerId,
          reviewedAt: new Date().toISOString(),
          reviewComment: dto.reviewComment ?? null,
        },
      },
      include: { requester: { select: EMPLOYEE_SELECT } },
    });
    return flattenAdvanceSalary(updated);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Management: Disburse
  // ─────────────────────────────────────────────────────────────────────────────

  async disburse(id: string, dto: DisburseAdvanceSalaryDto, disburserId: string) {
    const request = await this.prisma.dynamicRequest.findUnique({ where: { id } });
    if (!request || request.typeKey !== 'ADVANCE_SALARY') {
      throw new NotFoundException('Advance salary request not found');
    }
    const disbursableStatuses: DynamicRequestStatus[] = [
      DynamicRequestStatus.PENDING,
      DynamicRequestStatus.APPROVED,
      DynamicRequestStatus.IN_PROGRESS,
    ];
    if (!disbursableStatuses.includes(request.status)) {
      throw new BadRequestException(
        'Only PENDING, APPROVED or IN_PROGRESS requests can be disbursed',
      );
    }

    const current = fd(request);
    const approvedAmount = Number(current.approvedAmount ?? current.amount);
    const approvedMonths = 1;
    const monthlyDeduction = approvedAmount;

    const repayments = this.generateRepaymentSchedule(
      id,
      dto.repaymentStartMonth,
      approvedMonths,
      approvedAmount,
      monthlyDeduction,
    );

    const [updated] = await this.prisma.$transaction([
      this.prisma.dynamicRequest.update({
        where: { id },
        data: {
          status: DynamicRequestStatus.DISBURSED,
          formData: {
            ...current,
            disbursedAt: new Date().toISOString(),
            disbursedById: disburserId,
            repaymentStartMonth: dto.repaymentStartMonth,
            remainingBalance: approvedAmount,
            totalRepaid: 0,
          },
        },
        include: { requester: { select: EMPLOYEE_SELECT } },
      }),
      this.prisma.advanceSalaryRepayment.createMany({ data: repayments }),
    ]);

    await this.prisma.auditLog.create({
      data: {
        userId: disburserId,
        action: 'ADVANCE_SALARY_REQUEST_DISBURSED',
        entityType: 'AdvanceSalaryRequest',
        entityId: id,
        changes: { repaymentStartMonth: dto.repaymentStartMonth, installments: approvedMonths },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    return flattenAdvanceSalary(updated);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helper: Generate repayment schedule
  // ─────────────────────────────────────────────────────────────────────────────

  private generateRepaymentSchedule(
    requestId: string,
    startMonth: string,
    months: number,
    totalAmount: number,
    monthlyAmount: number,
  ) {
    const [year, month] = startMonth.split('-').map(Number);
    const repayments: {
      requestId: string;
      installmentNo: number;
      scheduledMonth: string;
      amount: number;
    }[] = [];
    let remaining = totalAmount;

    for (let i = 0; i < months; i++) {
      const d = new Date(year, month - 1 + i);
      const scheduledMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const amount = i === months - 1 ? remaining : Math.round(monthlyAmount * 100) / 100;
      remaining = Math.round((remaining - amount) * 100) / 100;

      repayments.push({ requestId, installmentNo: i + 1, scheduledMonth, amount });
    }

    return repayments;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Management: Process a monthly repayment deduction
  // ─────────────────────────────────────────────────────────────────────────────

  async processRepayment(
    advanceSalaryId: string,
    installmentNo: number,
    processedById: string,
    processingNote?: string,
  ) {
    const request = await this.prisma.dynamicRequest.findUnique({
      where: { id: advanceSalaryId },
    });
    if (!request || request.typeKey !== 'ADVANCE_SALARY') {
      throw new NotFoundException('Advance salary request not found');
    }

    const validStatuses: DynamicRequestStatus[] = [
      DynamicRequestStatus.DISBURSED,
      DynamicRequestStatus.REPAYING,
    ];
    if (!validStatuses.includes(request.status)) {
      throw new BadRequestException(
        'Only DISBURSED or REPAYING advance salary requests can have repayments processed',
      );
    }

    const repayment = await this.prisma.advanceSalaryRepayment.findUnique({
      where: { requestId_installmentNo: { requestId: advanceSalaryId, installmentNo } },
    });
    if (!repayment) throw new NotFoundException('Repayment installment not found');
    if (repayment.status !== AdvanceSalaryRepaymentStatus.PENDING) {
      throw new BadRequestException(
        `Installment #${installmentNo} has already been ${repayment.status.toLowerCase()}`,
      );
    }

    const current = fd(request);
    const deductionAmount = Number(repayment.amount);
    const newTotalRepaid =
      Math.round((Number(current.totalRepaid ?? 0) + deductionAmount) * 100) / 100;
    const newRemainingBalance =
      Math.round((Number(current.remainingBalance ?? 0) - deductionAmount) * 100) / 100;

    const isLastInstallment = newRemainingBalance <= 0;
    const newStatus = isLastInstallment
      ? DynamicRequestStatus.COMPLETED
      : DynamicRequestStatus.REPAYING;

    const [, updatedRequest] = await this.prisma.$transaction([
      this.prisma.advanceSalaryRepayment.update({
        where: { id: repayment.id },
        data: {
          status: AdvanceSalaryRepaymentStatus.DEDUCTED,
          processedAt: new Date(),
          processedById,
          processingNote,
        },
      }),
      this.prisma.dynamicRequest.update({
        where: { id: advanceSalaryId },
        data: {
          status: newStatus,
          formData: {
            ...current,
            totalRepaid: newTotalRepaid,
            remainingBalance: newRemainingBalance,
          },
        },
        include: {
          requester: { select: EMPLOYEE_SELECT },
          advanceSalaryRepayments: { orderBy: { installmentNo: 'asc' } },
        },
      }),
    ]);

    await this.prisma.auditLog.create({
      data: {
        userId: processedById,
        action: 'ADVANCE_SALARY_REPAYMENT_PROCESSED',
        entityType: 'AdvanceSalaryRepayment',
        entityId: repayment.id,
        changes: {
          advanceSalaryId,
          installmentNo,
          deductionAmount,
          totalRepaid: newTotalRepaid,
          remainingBalance: newRemainingBalance,
          requestStatus: newStatus,
        },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    return flattenAdvanceSalary(updatedRequest);
  }
}
