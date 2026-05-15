import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { DynamicRequestStatus, LoanRepaymentStatus } from '@prisma/client';
import { RequestContextService } from 'src/common/services/request-context.service';
import { WorkflowEngineService } from 'src/workflows/workflow-engine.service';
import {
  CreateLoanRequestDto,
  UpdateLoanRequestDto,
  ApproveLoanDto,
  RejectLoanDto,
  DisburseLoanDto,
  LoansQueryDto,
  ManagementLoansQueryDto,
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
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: Create
  // ─────────────────────────────────────────────────────────────────────────────

  async create(dto: CreateLoanRequestDto, userId: string) {
    const monthlyDeduction = dto.amount / dto.requestedRepaymentMonths;

    const loan = await this.prisma.dynamicRequest.create({
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

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'LOAN_REQUEST_CREATED',
        entityType: 'LoanRequest',
        entityId: loan.id,
        changes: { before: null, after: loan },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    const requester = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { teamLeadId: true },
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

    return {
      data: data.map(flattenLoan),
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

    return flattenLoan(loan);
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

    return this.prisma.loanRepayment.findMany({
      where: { requestId: id },
      orderBy: { installmentNo: 'asc' },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Management: List all loans
  // ─────────────────────────────────────────────────────────────────────────────

  async findAll(query: ManagementLoansQueryDto) {
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
    const activeInstances = await this.prisma.workflowInstance.findMany({
      where: {
        requestId: { in: loanIds },
        requestType: 'LOAN',
        status: { in: ['IN_PROGRESS', 'PENDING'] },
      },
      include: { stepInstances: { where: { resolution: 'PENDING' } } },
    });
    const actionsMap = new Map<string, string[]>();
    for (const inst of activeInstances) {
      const all = new Set<string>();
      for (const step of inst.stepInstances) {
        const snap = step.stepSnapshot as Record<string, any> | null;
        (Array.isArray(snap?.actions) ? snap.actions : ['APPROVE', 'REJECT', 'VIEW']).forEach(
          (a: string) => all.add(a),
        );
        if (snap?.approverType === 'ENTITY' && snap?.approverValue === 'user') {
          all.add('EDIT');
        }
      }
      if (all.size > 0) actionsMap.set(inst.requestId, [...all]);
    }

    return {
      data: data.map((loan) => ({
        ...flattenLoan(loan),
        availableActions: actionsMap.get(loan.id) ?? [],
      })),
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

  async disburse(id: string, dto: DisburseLoanDto, disburserId: string) {
    const loan = await this.prisma.dynamicRequest.findUnique({ where: { id } });
    if (!loan || loan.typeKey !== 'LOAN') throw new NotFoundException('Loan request not found');
    const disbursableStatuses: DynamicRequestStatus[] = [
      DynamicRequestStatus.APPROVED,
      DynamicRequestStatus.IN_PROGRESS,
    ];
    if (!disbursableStatuses.includes(loan.status)) {
      throw new BadRequestException('Only APPROVED or IN_PROGRESS loans can be disbursed');
    }

    const current = fd(loan);
    const approvedAmount = Number(current.approvedAmount ?? current.amount);
    const approvedMonths = Number(
      current.approvedRepaymentMonths ?? current.requestedRepaymentMonths,
    );
    const monthlyDeduction = Number(current.monthlyDeduction ?? approvedAmount / approvedMonths);

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
            disbursedAt: new Date().toISOString(),
            disbursedById: disburserId,
            repaymentStartMonth: dto.repaymentStartMonth,
            remainingBalance: approvedAmount,
            totalRepaid: 0,
          },
        },
        include: { requester: { select: EMPLOYEE_SELECT } },
      }),
      this.prisma.loanRepayment.createMany({ data: repayments }),
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
}
