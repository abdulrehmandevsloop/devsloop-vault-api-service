import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  DynamicRequestStatus,
  LoanLedgerEntryType,
  LoanPaymentMethod,
  LoanRepaymentStatus,
  PayrollPeriodStatus,
  Prisma,
} from '@prisma/client';
import { RequestContextService } from 'src/common/services/request-context.service';
import { WorkflowEngineService } from 'src/workflows/workflow-engine.service';
import { RepaymentAutoDeductService } from 'src/scheduler/repayment-auto-deduct.service';
import {
  CreateLoanRequestDto,
  UpdateLoanRequestDto,
  ApproveLoanDto,
  RejectLoanDto,
  DisburseLoanDto,
  LoansQueryDto,
  ManagementLoansQueryDto,
  ManualOverpaymentDto,
  OverpaymentTenureMode,
} from 'src/loans/dto';

const EMPLOYEE_SELECT = {
  id: true,
  name: true,
  email: true,
  departments: true,
  designation: true,
  employeeId: true,
} as const;

const DISBURSEMENT_STATUSES: DynamicRequestStatus[] = [
  DynamicRequestStatus.DISBURSED,
  DynamicRequestStatus.REPAYING,
  DynamicRequestStatus.COMPLETED,
];

type LoanFormData = Record<string, unknown>;

function fd(request: { formData: unknown }): LoanFormData {
  return (request.formData ?? {}) as LoanFormData;
}

// Round to 2 decimal places (PKR amounts), matching the convention used across
// the loan/payroll services.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// The portal expects loan fields (amount, approvedAmount, etc.) to be flat on
// the response. Internally they live inside the DynamicRequest.formData JSON
// blob, so every public-returning method runs the row through this helper.
// `requesterId`/`requester` are also surfaced as `employeeId`/`employee` for
// the same reason.
function flattenLoan<T extends { formData: unknown; requester?: unknown; requesterId?: string }>(
  request: T,
): T & Record<string, unknown> {
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
export class LoansService {
  constructor(
    private prisma: PrismaService,
    private requestContext: RequestContextService,
    private workflowEngine: WorkflowEngineService,
    private repaymentAutoDeduct: RepaymentAutoDeductService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: Create
  // ─────────────────────────────────────────────────────────────────────────────

  async create(dto: CreateLoanRequestDto, userId: string) {
    const monthlyDeduction = dto.amount / dto.requestedRepaymentMonths;

    const ipAddress = this.requestContext.getIpAddress();
    const userAgent = this.requestContext.getUserAgent();

    const [loan, requester] = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dynamicRequest.create({
        data: {
          typeKey: 'LOAN',
          requesterId: userId,
          status: DynamicRequestStatus.PENDING,
          formData: {
            amount: dto.amount,
            purpose: dto.purpose,
            requestedRepaymentMonths: dto.requestedRepaymentMonths,
            notes: dto.notes ?? null,
            monthlyDeduction,
            totalRepaid: 0,
            remainingBalance: 0,
          },
        },
        include: { requester: { select: EMPLOYEE_SELECT } },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'LOAN_REQUEST_CREATED',
          entityType: 'LoanRequest',
          entityId: created.id,
          changes: { before: null, after: created },
          ipAddress,
          userAgent,
        },
      });

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { teamLeadId: true },
      });

      return [created, user] as const;
    });

    try {
      await this.workflowEngine.startWorkflow('LOAN', loan.id, userId, {
        amount: dto.amount,
        ...(requester?.teamLeadId ? { reportingManagerId: requester.teamLeadId } : {}),
      });
    } catch (err) {
      await this.prisma.dynamicRequest.delete({ where: { id: loan.id } });
      throw err;
    }

    return flattenLoan(loan);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: List own loans
  // ─────────────────────────────────────────────────────────────────────────────

  async findMyLoans(userId: string, query: LoansQueryDto) {
    const { page = 1, limit = 20, status } = query;
    const skip = (page - 1) * limit;

    const where = {
      typeKey: 'LOAN' as const,
      requesterId: userId,
      ...(status && { status: status }),
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
        where: { typeKey: 'LOAN', requesterId: userId },
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

    const loanIds = data.map((l) => l.id);
    const viewMap = await this.workflowEngine.getActorWorkflowView('LOAN', loanIds, userId);

    return {
      data: data.map((loan) => {
        const view = viewMap.get(loan.id);
        return {
          ...flattenLoan(loan),
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
  // Employee: Get single loan
  // ─────────────────────────────────────────────────────────────────────────────

  async findOne(id: string, userId: string, isManagement = false) {
    const loan = await this.prisma.dynamicRequest.findUnique({
      where: { id },
      include: {
        requester: { select: EMPLOYEE_SELECT },
        loanRepayments: { orderBy: { installmentNo: 'asc' } },
      },
    });

    if (!loan || loan.typeKey !== 'LOAN') throw new NotFoundException('Loan request not found');
    if (!isManagement && loan.requesterId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const viewMap = await this.workflowEngine.getActorWorkflowView('LOAN', [loan.id], userId);
    const view = viewMap.get(loan.id);
    return {
      ...flattenLoan(loan),
      canAct: view?.canAct ?? false,
      availableActions: view?.availableActions ?? [],
      activeStepInfo: view?.activeStepInfo ?? [],
      activeStepOrders: view?.activeStepOrders ?? [],
      currentStage: view?.currentStage ?? null,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: Update pending loan
  // ─────────────────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateLoanRequestDto, userId: string) {
    const loan = await this.prisma.dynamicRequest.findUnique({ where: { id } });
    if (!loan || loan.typeKey !== 'LOAN') throw new NotFoundException('Loan request not found');
    if (loan.requesterId !== userId) throw new ForbiddenException('Access denied');
    if (loan.status !== DynamicRequestStatus.PENDING) {
      throw new BadRequestException('Only PENDING loan requests can be updated');
    }

    const current = fd(loan);
    const amount = dto.amount ?? Number(current.amount);
    const months = dto.requestedRepaymentMonths ?? Number(current.requestedRepaymentMonths);
    const monthlyDeduction = amount / months;

    const updated = await this.prisma.dynamicRequest.update({
      where: { id },
      data: {
        formData: {
          ...current,
          ...(dto.amount !== undefined && { amount: dto.amount }),
          ...(dto.requestedRepaymentMonths !== undefined && {
            requestedRepaymentMonths: dto.requestedRepaymentMonths,
          }),
          ...(dto.purpose !== undefined && { purpose: dto.purpose }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          monthlyDeduction,
        },
      },
      include: { requester: { select: EMPLOYEE_SELECT } },
    });
    return flattenLoan(updated);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: Cancel pending loan
  // ─────────────────────────────────────────────────────────────────────────────

  async cancel(id: string, userId: string) {
    const loan = await this.prisma.dynamicRequest.findUnique({ where: { id } });
    if (!loan || loan.typeKey !== 'LOAN') throw new NotFoundException('Loan request not found');
    if (loan.requesterId !== userId) throw new ForbiddenException('Access denied');
    const cancellableStatuses: DynamicRequestStatus[] = [
      DynamicRequestStatus.PENDING,
      DynamicRequestStatus.IN_PROGRESS,
    ];
    if (!cancellableStatuses.includes(loan.status)) {
      throw new BadRequestException('Only PENDING or IN_PROGRESS loan requests can be cancelled');
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
        action: 'LOAN_REQUEST_CANCELLED',
        entityType: 'LoanRequest',
        entityId: id,
        changes: { before: loan.status, after: DynamicRequestStatus.CANCELLED },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: Get repayment schedule
  // ─────────────────────────────────────────────────────────────────────────────

  async getRepayments(id: string, userId: string, isManagement = false) {
    const loan = await this.prisma.dynamicRequest.findUnique({ where: { id } });
    if (!loan || loan.typeKey !== 'LOAN') throw new NotFoundException('Loan request not found');
    if (!isManagement && loan.requesterId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    await this.repaymentAutoDeduct.autoDeductPastDue();

    return this.prisma.loanRepayment.findMany({
      where: { requestId: id },
      orderBy: { installmentNo: 'asc' },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Management: List all loans
  // ─────────────────────────────────────────────────────────────────────────────

  async findAll(query: ManagementLoansQueryDto, actorId: string) {
    const { page = 1, limit = 20, status, search, employeeId } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      typeKey: 'LOAN',
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
        where: { typeKey: 'LOAN' },
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

    const loanIds = data.map((l) => l.id);
    const viewMap = await this.workflowEngine.getActorWorkflowView('LOAN', loanIds, actorId);

    return {
      data: data.map((loan) => {
        const view = viewMap.get(loan.id);
        return {
          ...flattenLoan(loan),
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

  async saveApprovalMetadata(id: string, dto: ApproveLoanDto, reviewerId: string) {
    const loan = await this.prisma.dynamicRequest.findUnique({ where: { id } });
    if (!loan || loan.typeKey !== 'LOAN') throw new NotFoundException('Loan request not found');
    const reviewableStatuses: DynamicRequestStatus[] = [
      DynamicRequestStatus.PENDING,
      DynamicRequestStatus.IN_PROGRESS,
      DynamicRequestStatus.APPROVED,
    ];
    if (!reviewableStatuses.includes(loan.status)) {
      throw new BadRequestException('Loan request is not in a reviewable state');
    }

    const current = fd(loan);
    const requestedAmount = Number(current.amount);
    const requestedMonths = Number(current.requestedRepaymentMonths);
    const approvedAmount = dto.approvedAmount ?? requestedAmount;
    const approvedMonths = dto.approvedRepaymentMonths ?? requestedMonths;
    const monthlyDeduction = approvedAmount / approvedMonths;

    const isModified = approvedAmount !== requestedAmount || approvedMonths !== requestedMonths;

    if (isModified) {
      const instance = await this.prisma.workflowInstance.findUnique({
        where: { requestType_requestId: { requestType: 'LOAN', requestId: id } },
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
        throw new ForbiddenException(
          'Only HR (user entity) can modify the requested amount or repayment term',
        );
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
          approvedRepaymentMonths: approvedMonths,
          monthlyDeduction,
          ...(isModified
            ? {
                modifiedById: reviewerId,
                modifiedAt: new Date().toISOString(),
                modifyComment: dto.modifyComment?.trim() || null,
                originalAmount:
                  current.originalAmount !== undefined ? current.originalAmount : requestedAmount,
                originalRepaymentMonths:
                  current.originalRepaymentMonths !== undefined
                    ? current.originalRepaymentMonths
                    : requestedMonths,
              }
            : {}),
        },
      },
      include: { requester: { select: EMPLOYEE_SELECT } },
    });
    return flattenLoan(updated);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Management: Persist rejection metadata (status driven by workflow events)
  // ─────────────────────────────────────────────────────────────────────────────

  async saveRejectionMetadata(id: string, dto: RejectLoanDto, reviewerId: string) {
    const loan = await this.prisma.dynamicRequest.findUnique({ where: { id } });
    if (!loan || loan.typeKey !== 'LOAN') throw new NotFoundException('Loan request not found');

    const updated = await this.prisma.dynamicRequest.update({
      where: { id },
      data: {
        formData: {
          ...fd(loan),
          reviewedById: reviewerId,
          reviewedAt: new Date().toISOString(),
          reviewComment: dto.reviewComment ?? null,
        },
      },
      include: { requester: { select: EMPLOYEE_SELECT } },
    });
    return flattenLoan(updated);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Management: Disburse
  // ─────────────────────────────────────────────────────────────────────────────

  async disburse(id: string, dto: DisburseLoanDto, disburserId: string, canModify = false) {
    const loan = await this.prisma.dynamicRequest.findUnique({ where: { id } });
    if (!loan || loan.typeKey !== 'LOAN') throw new NotFoundException('Loan request not found');
    const disbursableStatuses: DynamicRequestStatus[] = [
      DynamicRequestStatus.PENDING,
      DynamicRequestStatus.APPROVED,
      DynamicRequestStatus.IN_PROGRESS,
    ];
    if (!disbursableStatuses.includes(loan.status)) {
      throw new BadRequestException('Only PENDING, APPROVED or IN_PROGRESS loans can be disbursed');
    }

    const current = fd(loan);
    const requestedAmount = Number(current.amount);
    const requestedMonths = Number(current.requestedRepaymentMonths);
    // Values carried in from a prior approval step (fall back to the request).
    const priorAmount =
      current.approvedAmount != null ? Number(current.approvedAmount) : requestedAmount;
    const priorMonths =
      current.approvedRepaymentMonths != null
        ? Number(current.approvedRepaymentMonths)
        : requestedMonths;

    // The disburser may override the amount/term at this step (e.g. a single
    // "Approve & disburse" stage). Only the HR (user entity) step may do so.
    const approvedAmount = dto.approvedAmount ?? priorAmount;
    const approvedMonths = dto.approvedRepaymentMonths ?? priorMonths;
    const changedHere = approvedAmount !== priorAmount || approvedMonths !== priorMonths;
    if (changedHere && !canModify) {
      throw new ForbiddenException(
        'Only HR (user entity) can modify the amount or repayment term at disbursement',
      );
    }
    const monthlyDeduction = approvedAmount / approvedMonths;

    const repayments = this.generateRepaymentSchedule(
      id,
      dto.repaymentStartMonth,
      approvedMonths,
      approvedAmount,
      monthlyDeduction,
    );

    const [updatedLoan] = await this.prisma.$transaction([
      this.prisma.dynamicRequest.update({
        where: { id },
        data: {
          status: DynamicRequestStatus.DISBURSED,
          formData: {
            ...current,
            approvedAmount,
            approvedRepaymentMonths: approvedMonths,
            monthlyDeduction,
            disbursedAt: new Date().toISOString(),
            disbursedById: disburserId,
            repaymentStartMonth: dto.repaymentStartMonth,
            remainingBalance: approvedAmount,
            totalRepaid: 0,
            ...(changedHere
              ? {
                  modifiedById: disburserId,
                  modifiedAt: new Date().toISOString(),
                  modifyComment: dto.modifyComment?.trim() || current.modifyComment || null,
                  originalAmount:
                    current.originalAmount !== undefined ? current.originalAmount : requestedAmount,
                  originalRepaymentMonths:
                    current.originalRepaymentMonths !== undefined
                      ? current.originalRepaymentMonths
                      : requestedMonths,
                }
              : {}),
          },
        },
        include: { requester: { select: EMPLOYEE_SELECT } },
      }),
      this.prisma.loanRepayment.createMany({ data: repayments }),
      this.prisma.loanLedgerEntry.create({
        data: this.buildLedgerEntry(
          id,
          LoanLedgerEntryType.LOAN_DISBURSAL,
          approvedAmount,
          approvedAmount,
          {
            transactionDate: new Date(),
            createdById: disburserId,
            remarks: 'Loan disbursed',
          },
        ),
      }),
    ]);

    await this.prisma.auditLog.create({
      data: {
        userId: disburserId,
        action: 'LOAN_REQUEST_DISBURSED',
        entityType: 'LoanRequest',
        entityId: id,
        changes: { repaymentStartMonth: dto.repaymentStartMonth, installments: approvedMonths },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    return flattenLoan(updatedLoan);
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
      remainingBalance: number;
    }[] = [];
    let remaining = totalAmount;

    for (let i = 0; i < months; i++) {
      const d = new Date(year, month - 1 + i);
      const scheduledMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const amount = i === months - 1 ? remaining : Math.round(monthlyAmount * 100) / 100;
      remaining = Math.round((remaining - amount) * 100) / 100;

      repayments.push({
        requestId,
        installmentNo: i + 1,
        scheduledMonth,
        amount,
        remainingBalance: remaining,
      });
    }

    return repayments;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Management: Process a monthly repayment deduction
  // ─────────────────────────────────────────────────────────────────────────────

  async processRepayment(
    loanId: string,
    installmentNo: number,
    processedById: string,
    processingNote?: string,
  ) {
    const loan = await this.prisma.dynamicRequest.findUnique({ where: { id: loanId } });
    if (!loan || loan.typeKey !== 'LOAN') throw new NotFoundException('Loan request not found');

    const validStatuses: DynamicRequestStatus[] = [
      DynamicRequestStatus.DISBURSED,
      DynamicRequestStatus.REPAYING,
    ];
    if (!validStatuses.includes(loan.status)) {
      throw new BadRequestException(
        'Only DISBURSED or REPAYING loans can have repayments processed',
      );
    }

    const repayment = await this.prisma.loanRepayment.findUnique({
      where: { requestId_installmentNo: { requestId: loanId, installmentNo } },
    });
    if (!repayment) throw new NotFoundException('Repayment installment not found');
    if (repayment.status !== LoanRepaymentStatus.PENDING) {
      throw new BadRequestException(
        `Installment #${installmentNo} has already been ${repayment.status.toLowerCase()}`,
      );
    }

    const current = fd(loan);
    const deductionAmount = Number(repayment.amount);
    const newTotalRepaid =
      Math.round((Number(current.totalRepaid ?? 0) + deductionAmount) * 100) / 100;
    const newRemainingBalance =
      Math.round((Number(current.remainingBalance ?? 0) - deductionAmount) * 100) / 100;

    const isLastInstallment = newRemainingBalance <= 0;
    const newStatus = isLastInstallment
      ? DynamicRequestStatus.COMPLETED
      : DynamicRequestStatus.REPAYING;

    const [, updatedLoan] = await this.prisma.$transaction([
      this.prisma.loanRepayment.update({
        where: { id: repayment.id },
        data: {
          status: LoanRepaymentStatus.DEDUCTED,
          processedAt: new Date(),
          processedById,
          processingNote,
        },
      }),
      this.prisma.dynamicRequest.update({
        where: { id: loanId },
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
          loanRepayments: { orderBy: { installmentNo: 'asc' } },
        },
      }),
      this.prisma.loanLedgerEntry.create({
        data: this.buildLedgerEntry(
          loanId,
          LoanLedgerEntryType.PAYROLL_DEDUCTION,
          deductionAmount,
          newRemainingBalance,
          {
            transactionDate: new Date(),
            createdById: processedById,
            reference: `repayment:${repayment.id}`,
            remarks: processingNote ?? `${repayment.scheduledMonth} payroll deduction`,
          },
        ),
      }),
    ]);

    await this.prisma.auditLog.create({
      data: {
        userId: processedById,
        action: 'LOAN_REPAYMENT_PROCESSED',
        entityType: 'LoanRepayment',
        entityId: repayment.id,
        changes: {
          loanId,
          installmentNo,
          deductionAmount,
          totalRepaid: newTotalRepaid,
          remainingBalance: newRemainingBalance,
          loanStatus: newStatus,
        },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    return flattenLoan(updatedLoan);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Balance-sheet engine: manual overpayments, ledger, dynamic recalibration
  // ─────────────────────────────────────────────────────────────────────────────

  private currentYearMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * The first month whose installments are safe to recalibrate. If the current
   * month's payroll period is already AUTHORIZED or LOCKED (awaiting bank
   * dispatch), that month's deduction is frozen — recalibration is deferred to
   * the next calendar month so we never disturb a locked payroll run.
   */
  private async computeRecalibrationFromMonth(): Promise<string> {
    const current = this.currentYearMonth();
    const period = await this.prisma.payrollPeriod.findUnique({
      where: { yearMonth: current },
      select: { status: true },
    });
    const frozen =
      period?.status === PayrollPeriodStatus.AUTHORIZED ||
      period?.status === PayrollPeriodStatus.LOCKED;
    if (!frozen) return current;
    const [year, month] = current.split('-').map(Number);
    // `month` is 1-based, so `new Date(year, month, 1)` is the first of next month.
    const next = new Date(year, month, 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  }

  private buildLedgerEntry(
    loanId: string,
    type: LoanLedgerEntryType,
    amount: number,
    runningBalanceAfter: number,
    extra: {
      transactionDate?: Date;
      paymentMethod?: LoanPaymentMethod | null;
      reference?: string | null;
      remarks?: string | null;
      createdById?: string | null;
    } = {},
  ): Prisma.LoanLedgerEntryUncheckedCreateInput {
    return {
      requestId: loanId,
      type,
      amount: round2(amount),
      runningBalance: runningBalanceAfter < 0 ? 0 : round2(runningBalanceAfter),
      transactionDate: extra.transactionDate ?? new Date(),
      paymentMethod: extra.paymentMethod ?? null,
      reference: extra.reference ?? null,
      remarks: extra.remarks ?? null,
      createdById: extra.createdById ?? null,
    };
  }

  /**
   * Loans disbursed before the ledger feature have no LOAN_DISBURSAL row. Create
   * one lazily (dated at disbursement) so the ledger reads as a coherent balance
   * sheet the first time it is touched.
   */
  private async ensureDisbursalAnchor(
    tx: Prisma.TransactionClient,
    loan: { id: string; formData: unknown },
  ): Promise<void> {
    const existing = await tx.loanLedgerEntry.count({
      where: { requestId: loan.id, type: LoanLedgerEntryType.LOAN_DISBURSAL },
    });
    if (existing > 0) return;

    const data = fd(loan);
    const approvedAmount = Number(data.approvedAmount ?? data.amount ?? 0);
    const disbursedAt =
      typeof data.disbursedAt === 'string' ? new Date(data.disbursedAt) : new Date();
    await tx.loanLedgerEntry.create({
      data: this.buildLedgerEntry(
        loan.id,
        LoanLedgerEntryType.LOAN_DISBURSAL,
        approvedAmount,
        approvedAmount,
        {
          transactionDate: disbursedAt,
          createdById: (data.disbursedById as string) ?? null,
          remarks: 'Loan disbursed',
        },
      ),
    });
  }

  /**
   * Rebuild the FUTURE (PENDING, scheduledMonth >= fromMonth) installments so the
   * remaining schedule reflects the new outstanding balance. Protected months
   * (before fromMonth) are left untouched.
   *
   * - balance <= 0           → delete all future PENDING rows (loan fully settled).
   * - REDUCE_INSTALLMENT     → keep the row count, lower each amount.
   * - MAINTAIN_INSTALLMENT…  → keep the monthly amount, drop trailing months.
   */
  private async recalibrateFutureInstallments(
    tx: Prisma.TransactionClient,
    loanId: string,
    outstandingBalance: number,
    opts: { fromMonth: string; mode: OverpaymentTenureMode; monthlyAmount: number },
  ): Promise<{ remainingInstallments: number; deletedInstallmentNos: number[] }> {
    const future = await tx.loanRepayment.findMany({
      where: {
        requestId: loanId,
        status: LoanRepaymentStatus.PENDING,
        scheduledMonth: { gte: opts.fromMonth },
      },
      orderBy: { installmentNo: 'asc' },
    });

    // PENDING installments scheduled BEFORE fromMonth are "protected" — a locked /
    // in-flight (or overdue, not-yet-collected) payroll run will still deduct their
    // current amounts. We leave them untouched AND hold their total back from the
    // recalibration, so the future installments only cover what remains once those
    // protected deductions land. Without this, the locked month would collect on
    // top of a fully-recalibrated future schedule and over-collect.
    const protectedAgg = await tx.loanRepayment.aggregate({
      where: {
        requestId: loanId,
        status: LoanRepaymentStatus.PENDING,
        scheduledMonth: { lt: opts.fromMonth },
      },
      _sum: { amount: true },
    });
    const protectedSum = round2(Number(protectedAgg._sum.amount ?? 0));
    const futureTarget = Math.max(0, round2(round2(outstandingBalance) - protectedSum));

    // No balance left for the future installments — either the loan is fully
    // settled, or the protected (locked/overdue) installments already cover the
    // remaining balance. Remove every future PENDING row so payroll collects
    // nothing further from them.
    if (futureTarget <= 0) {
      if (future.length > 0) {
        await tx.loanRepayment.deleteMany({ where: { id: { in: future.map((r) => r.id) } } });
      }
      return {
        remainingInstallments: 0,
        deletedInstallmentNos: future.map((r) => r.installmentNo),
      };
    }

    // Defensive: balance remains for the future but no future PENDING rows exist
    // to carry it (e.g. every installment already deducted). Append a catch-up row.
    if (future.length === 0) {
      const maxRow = await tx.loanRepayment.findFirst({
        where: { requestId: loanId },
        orderBy: { installmentNo: 'desc' },
        select: { installmentNo: true },
      });
      await tx.loanRepayment.create({
        data: {
          requestId: loanId,
          installmentNo: (maxRow?.installmentNo ?? 0) + 1,
          scheduledMonth: opts.fromMonth,
          amount: futureTarget,
          remainingBalance: 0,
          status: LoanRepaymentStatus.PENDING,
        },
      });
      return { remainingInstallments: 1, deletedInstallmentNos: [] };
    }

    if (opts.mode === OverpaymentTenureMode.MAINTAIN_INSTALLMENT_SHORTEN_TENURE) {
      const monthly = round2(opts.monthlyAmount);
      const needed = monthly > 0 ? Math.max(1, Math.ceil(futureTarget / monthly)) : future.length;
      const keep = future.slice(0, needed);
      const drop = future.slice(needed);

      if (drop.length > 0) {
        await tx.loanRepayment.deleteMany({ where: { id: { in: drop.map((r) => r.id) } } });
      }

      let remaining = futureTarget;
      for (let i = 0; i < keep.length; i++) {
        const isLast = i === keep.length - 1;
        const amount = isLast ? round2(remaining) : monthly;
        remaining = round2(remaining - amount);
        await tx.loanRepayment.update({
          where: { id: keep[i].id },
          data: { amount, remainingBalance: remaining < 0 ? 0 : remaining },
        });
      }
      return {
        remainingInstallments: keep.length,
        deletedInstallmentNos: drop.map((r) => r.installmentNo),
      };
    }

    // REDUCE_INSTALLMENT (default): keep all future rows, spread the target evenly,
    // with the LAST future row absorbing any rounding remainder.
    const n = future.length;
    const perInstallment = round2(futureTarget / n);
    let remaining = futureTarget;
    for (let i = 0; i < n; i++) {
      const isLast = i === n - 1;
      const amount = isLast ? round2(remaining) : perInstallment;
      remaining = round2(remaining - amount);
      await tx.loanRepayment.update({
        where: { id: future[i].id },
        data: { amount, remainingBalance: remaining < 0 ? 0 : remaining },
      });
    }
    return { remainingInstallments: n, deletedInstallmentNos: [] };
  }

  /**
   * HR logs a manual lump-sum overpayment. Immediately reduces the outstanding
   * balance, writes an immutable ledger entry, and recalibrates the remaining
   * installments (race-protected against a locked current-month payroll).
   */
  async logManualOverpayment(loanId: string, dto: ManualOverpaymentDto, actorId: string) {
    const loan = await this.prisma.dynamicRequest.findUnique({ where: { id: loanId } });
    if (!loan || loan.typeKey !== 'LOAN') throw new NotFoundException('Loan request not found');

    const activeStatuses: DynamicRequestStatus[] = [
      DynamicRequestStatus.DISBURSED,
      DynamicRequestStatus.REPAYING,
    ];
    if (!activeStatuses.includes(loan.status)) {
      throw new BadRequestException(
        'Manual overpayments can only be logged against DISBURSED or REPAYING loans',
      );
    }

    const mode = dto.tenureMode ?? OverpaymentTenureMode.REDUCE_INSTALLMENT;
    const amount = round2(dto.amount);
    const fromMonth = await this.computeRecalibrationFromMonth();

    const updatedLoan = await this.prisma.$transaction(async (tx) => {
      // Re-read the balance inside the transaction so a concurrent auto-deduct
      // cannot make us validate/recalibrate against a stale figure.
      const fresh = await tx.dynamicRequest.findUniqueOrThrow({ where: { id: loanId } });
      const current = fd(fresh);
      const outstanding = round2(Number(current.remainingBalance ?? 0));

      if (amount > outstanding) {
        throw new BadRequestException(
          `Overpayment amount exceeds the current outstanding balance of ${outstanding} PKR. Please input a valid matching or lesser amount.`,
        );
      }

      const newRemaining = round2(outstanding - amount);
      const newTotalRepaid = round2(Number(current.totalRepaid ?? 0) + amount);
      const monthlyAmount = Number(current.monthlyDeduction ?? 0);
      const fullySettled = newRemaining <= 0;

      await this.ensureDisbursalAnchor(tx, fresh);

      const recal = await this.recalibrateFutureInstallments(tx, loanId, newRemaining, {
        fromMonth,
        mode,
        monthlyAmount,
      });

      const updated = await tx.dynamicRequest.update({
        where: { id: loanId },
        data: {
          status: fullySettled ? DynamicRequestStatus.COMPLETED : DynamicRequestStatus.REPAYING,
          formData: {
            ...current,
            remainingBalance: newRemaining < 0 ? 0 : newRemaining,
            totalRepaid: newTotalRepaid,
            lastOverpaymentAt: dto.paymentDate,
            ...(fullySettled
              ? { settledAt: new Date().toISOString(), settlementReason: 'MANUAL_OVERPAYMENT' }
              : {}),
          },
        },
        include: {
          requester: { select: EMPLOYEE_SELECT },
          loanRepayments: { orderBy: { installmentNo: 'asc' } },
        },
      });

      await tx.loanLedgerEntry.create({
        data: this.buildLedgerEntry(
          loanId,
          LoanLedgerEntryType.MANUAL_OVERPAYMENT,
          amount,
          newRemaining,
          {
            transactionDate: new Date(dto.paymentDate),
            paymentMethod: dto.paymentMethod,
            remarks: dto.notes ?? null,
            createdById: actorId,
          },
        ),
      });

      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'LOAN_MANUAL_OVERPAYMENT',
          entityType: 'LoanRequest',
          entityId: loanId,
          changes: {
            amount,
            paymentMethod: dto.paymentMethod,
            mode,
            fromMonth,
            newRemainingBalance: newRemaining < 0 ? 0 : newRemaining,
            totalRepaid: newTotalRepaid,
            remainingInstallments: recal.remainingInstallments,
            deletedInstallmentNos: recal.deletedInstallmentNos,
            status: fullySettled ? 'COMPLETED' : 'REPAYING',
          },
          ipAddress: this.requestContext.getIpAddress(),
          userAgent: this.requestContext.getUserAgent(),
        },
      });

      return updated;
    });

    return flattenLoan(updatedLoan);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Ledger history (employee + management)
  // ─────────────────────────────────────────────────────────────────────────────

  async getLedger(id: string, userId: string, isManagement = false) {
    const loan = await this.prisma.dynamicRequest.findUnique({ where: { id } });
    if (!loan || loan.typeKey !== 'LOAN') throw new NotFoundException('Loan request not found');
    if (!isManagement && loan.requesterId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    // Payroll deductions are realized at bank-sheet export (not lazily here), so
    // the ledger already reflects everything collected to date.
    return this.prisma.loanLedgerEntry.findMany({
      where: { requestId: id },
      orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
      include: { createdBy: { select: EMPLOYEE_SELECT } },
    });
  }
}
