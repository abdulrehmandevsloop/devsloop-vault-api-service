import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AdvanceSalaryRepaymentStatus, AdvanceSalaryStatus, Prisma } from '@prisma/client';
import { RequestContextService } from 'src/common/services/request-context.service';
import { WorkflowEngineService } from 'src/workflows/workflow-engine.service';
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

const TERMINAL_ADVANCE_SALARY_STATUSES: AdvanceSalaryStatus[] = [
  AdvanceSalaryStatus.COMPLETED,
  AdvanceSalaryStatus.REJECTED,
  AdvanceSalaryStatus.CANCELLED,
];

@Injectable()
export class AdvanceSalaryService {
  constructor(
    private prisma: PrismaService,
    private requestContext: RequestContextService,
    private workflowEngine: WorkflowEngineService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: Create
  // ─────────────────────────────────────────────────────────────────────────────

  async create(dto: CreateAdvanceSalaryRequestDto, userId: string) {
    // const hasIncompleteAdvanceSalary = await this.hasIncompleteAdvanceSalary(userId);
    // if (hasIncompleteAdvanceSalary) {
    //   throw new ConflictException(
    //     'You already have an advance salary request in progress.'
    //   );
    // }

    const monthlyDeduction = dto.amount;

    const request = await this.prisma.advanceSalaryRequest.create({
      data: {
        employeeId: userId,
        amount: dto.amount,
        reason: dto.reason,
        requestedRepaymentMonths: 1,
        notes: dto.notes,
        monthlyDeduction,
        status: AdvanceSalaryStatus.PENDING,
      },
      include: { employee: { select: EMPLOYEE_SELECT } },
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
        amount: Number(request.amount),
        ...(requester?.teamLeadId ? { reportingManagerId: requester.teamLeadId } : {}),
      });
    } catch (err) {
      await this.prisma.advanceSalaryRequest.delete({ where: { id: request.id } });
      throw err;
    }

    return request;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: List own requests
  // ─────────────────────────────────────────────────────────────────────────────

  async findMyRequests(userId: string, query: AdvanceSalaryQueryDto) {
    const { page = 1, limit = 20, status } = query;
    const skip = (page - 1) * limit;

    const where = {
      employeeId: userId,
      ...(status && { status }),
    };

    const [data, total, incompleteCount] = await this.prisma.$transaction([
      this.prisma.advanceSalaryRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { employee: { select: EMPLOYEE_SELECT } },
      }),
      this.prisma.advanceSalaryRequest.count({ where }),
      this.prisma.advanceSalaryRequest.count({
        where: {
          employeeId: userId,
          status: { notIn: TERMINAL_ADVANCE_SALARY_STATUSES },
        },
      }),
    ]);

    return {
      data,
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
    const request = await this.prisma.advanceSalaryRequest.findUnique({
      where: { id },
      include: {
        employee: { select: EMPLOYEE_SELECT },
        reviewer: { select: EMPLOYEE_SELECT },
        repayments: { orderBy: { installmentNo: 'asc' } },
      },
    });

    if (!request) throw new NotFoundException('Advance salary request not found');
    if (!isManagement && request.employeeId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return request;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: Update pending request
  // ─────────────────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateAdvanceSalaryRequestDto, userId: string) {
    const request = await this.prisma.advanceSalaryRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Advance salary request not found');
    if (request.employeeId !== userId) throw new ForbiddenException('Access denied');
    if (request.status !== AdvanceSalaryStatus.PENDING) {
      throw new BadRequestException('Only PENDING requests can be updated');
    }

    const amount = dto.amount ?? Number(request.amount);
    const monthlyDeduction = amount;

    return this.prisma.advanceSalaryRequest.update({
      where: { id },
      data: { ...dto, requestedRepaymentMonths: 1, monthlyDeduction },
      include: { employee: { select: EMPLOYEE_SELECT } },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: Cancel pending request
  // ─────────────────────────────────────────────────────────────────────────────

  async cancel(id: string, userId: string) {
    const request = await this.prisma.advanceSalaryRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Advance salary request not found');
    if (request.employeeId !== userId) throw new ForbiddenException('Access denied');
    if (request.status !== AdvanceSalaryStatus.PENDING) {
      throw new BadRequestException('Only PENDING requests can be cancelled');
    }

    return this.prisma.advanceSalaryRequest.update({
      where: { id },
      data: { status: AdvanceSalaryStatus.CANCELLED },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: Get repayment schedule
  // ─────────────────────────────────────────────────────────────────────────────

  async getRepayments(id: string, userId: string, _isManagement = false) {
    const request = await this.prisma.advanceSalaryRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Advance salary request not found');
    // Ownership check: employees can only view their own repayments.
    // Management callers (isManagement=true) bypass this.
    // if (!isManagement && request.employeeId !== userId) {
    //   throw new ForbiddenException('Access denied');
    // }

    return this.prisma.advanceSalaryRepayment.findMany({
      where: { advanceSalaryId: id },
      orderBy: { installmentNo: 'asc' },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Management: List all requests
  // ─────────────────────────────────────────────────────────────────────────────

  async findAll(query: ManagementAdvanceSalaryQueryDto) {
    const { page = 1, limit = 20, status, search, employeeId } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.AdvanceSalaryRequestWhereInput = {
      ...(status && { status }),
      ...(employeeId && { employeeId }),
      ...(search && {
        employee: {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        },
      }),
    };

    const [data, total, statusGroups, amountAgg] = await this.prisma.$transaction([
      this.prisma.advanceSalaryRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          employee: { select: EMPLOYEE_SELECT },
          reviewer: { select: { id: true, name: true } },
        },
      }),
      this.prisma.advanceSalaryRequest.count({ where }),
      this.prisma.advanceSalaryRequest.groupBy({
        by: ['status'],
        _count: true,
        orderBy: { status: 'asc' },
      }),
      this.prisma.advanceSalaryRequest.aggregate({
        where: {
          status: {
            in: [
              AdvanceSalaryStatus.DISBURSED,
              AdvanceSalaryStatus.REPAYING,
              AdvanceSalaryStatus.COMPLETED,
            ],
          },
        },
        _sum: { totalRepaid: true, remainingBalance: true },
      }),
    ]);

    const countByStatus = (currentStatus: AdvanceSalaryStatus): number =>
      Number(statusGroups.find((group) => group.status === currentStatus)?._count ?? 0);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPreviousPage: page > 1,
      pending: countByStatus(AdvanceSalaryStatus.PENDING),
      approved: countByStatus(AdvanceSalaryStatus.APPROVED),
      disbursed: countByStatus(AdvanceSalaryStatus.DISBURSED),
      repaying: countByStatus(AdvanceSalaryStatus.REPAYING),
      completed: countByStatus(AdvanceSalaryStatus.COMPLETED),
      rejected: countByStatus(AdvanceSalaryStatus.REJECTED),
      totalRepaid: Number(amountAgg._sum.totalRepaid ?? 0),
      totalOutstanding: Number(amountAgg._sum.remainingBalance ?? 0),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Management: Persist approval metadata (no status change — status is driven by workflow events)
  // ─────────────────────────────────────────────────────────────────────────────

  async saveApprovalMetadata(id: string, dto: ApproveAdvanceSalaryDto, reviewerId: string) {
    const request = await this.prisma.advanceSalaryRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Advance salary request not found');

    const approvedAmount = dto.approvedAmount ?? Number(request.amount);
    const monthlyDeduction = approvedAmount;

    return this.prisma.advanceSalaryRequest.update({
      where: { id },
      data: {
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewComment: dto.reviewComment,
        approvedAmount,
        approvedRepaymentMonths: 1,
        monthlyDeduction,
      },
      include: { employee: { select: EMPLOYEE_SELECT } },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Management: Approve
  // ─────────────────────────────────────────────────────────────────────────────

  async approve(id: string, dto: ApproveAdvanceSalaryDto, reviewerId: string) {
    const request = await this.prisma.advanceSalaryRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Advance salary request not found');
    if (request.status !== AdvanceSalaryStatus.PENDING) {
      throw new BadRequestException('Only PENDING requests can be approved');
    }

    const approvedAmount = dto.approvedAmount ?? Number(request.amount);
    const approvedMonths = 1;
    const monthlyDeduction = approvedAmount;

    const updated = await this.prisma.advanceSalaryRequest.update({
      where: { id },
      data: {
        status: AdvanceSalaryStatus.APPROVED,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewComment: dto.reviewComment,
        approvedAmount,
        approvedRepaymentMonths: approvedMonths,
        monthlyDeduction,
      },
      include: { employee: { select: EMPLOYEE_SELECT } },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: reviewerId,
        action: 'ADVANCE_SALARY_REQUEST_APPROVED',
        entityType: 'AdvanceSalaryRequest',
        entityId: id,
        changes: { approvedAmount, approvedMonths },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Management: Reject
  // ─────────────────────────────────────────────────────────────────────────────

  async reject(id: string, dto: RejectAdvanceSalaryDto, reviewerId: string) {
    const request = await this.prisma.advanceSalaryRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Advance salary request not found');
    const rejectableStatuses: AdvanceSalaryStatus[] = [
      AdvanceSalaryStatus.PENDING,
      AdvanceSalaryStatus.APPROVED,
    ];
    if (!rejectableStatuses.includes(request.status)) {
      throw new BadRequestException('Only PENDING or APPROVED requests can be rejected');
    }

    const updated = await this.prisma.advanceSalaryRequest.update({
      where: { id },
      data: {
        status: AdvanceSalaryStatus.REJECTED,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewComment: dto.reviewComment,
      },
      include: { employee: { select: EMPLOYEE_SELECT } },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: reviewerId,
        action: 'ADVANCE_SALARY_REQUEST_REJECTED',
        entityType: 'AdvanceSalaryRequest',
        entityId: id,
        changes: { reason: dto.reviewComment },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Management: Disburse
  // ─────────────────────────────────────────────────────────────────────────────

  async disburse(id: string, dto: DisburseAdvanceSalaryDto, disburserId: string) {
    const request = await this.prisma.advanceSalaryRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Advance salary request not found');
    if (request.status !== AdvanceSalaryStatus.APPROVED) {
      throw new BadRequestException('Only APPROVED requests can be disbursed');
    }

    const approvedAmount = Number(request.approvedAmount ?? request.amount);
    const approvedMonths = request.approvedRepaymentMonths ?? request.requestedRepaymentMonths;
    const monthlyDeduction = Number(request.monthlyDeduction ?? approvedAmount / approvedMonths);

    const repayments = this.generateRepaymentSchedule(
      id,
      dto.repaymentStartMonth,
      approvedMonths,
      approvedAmount,
      monthlyDeduction,
    );

    const [updated] = await this.prisma.$transaction([
      this.prisma.advanceSalaryRequest.update({
        where: { id },
        data: {
          status: AdvanceSalaryStatus.DISBURSED,
          disbursedAt: new Date(),
          disbursedById: disburserId,
          repaymentStartMonth: dto.repaymentStartMonth,
          remainingBalance: approvedAmount,
        },
        include: { employee: { select: EMPLOYEE_SELECT } },
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

    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helper: Generate repayment schedule
  // ─────────────────────────────────────────────────────────────────────────────

  private generateRepaymentSchedule(
    advanceSalaryId: string,
    startMonth: string,
    months: number,
    totalAmount: number,
    monthlyAmount: number,
  ) {
    const [year, month] = startMonth.split('-').map(Number);
    const repayments: {
      advanceSalaryId: string;
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

      repayments.push({ advanceSalaryId, installmentNo: i + 1, scheduledMonth, amount });
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
    const request = await this.prisma.advanceSalaryRequest.findUnique({
      where: { id: advanceSalaryId },
    });
    if (!request) throw new NotFoundException('Advance salary request not found');

    const validStatuses: AdvanceSalaryStatus[] = [
      AdvanceSalaryStatus.DISBURSED,
      AdvanceSalaryStatus.REPAYING,
    ];
    if (!validStatuses.includes(request.status)) {
      throw new BadRequestException(
        'Only DISBURSED or REPAYING advance salary requests can have repayments processed',
      );
    }

    const repayment = await this.prisma.advanceSalaryRepayment.findUnique({
      where: { advanceSalaryId_installmentNo: { advanceSalaryId, installmentNo } },
    });
    if (!repayment) throw new NotFoundException('Repayment installment not found');
    if (repayment.status !== AdvanceSalaryRepaymentStatus.PENDING) {
      throw new BadRequestException(
        `Installment #${installmentNo} has already been ${repayment.status.toLowerCase()}`,
      );
    }

    const deductionAmount = Number(repayment.amount);
    const newTotalRepaid = Math.round((Number(request.totalRepaid) + deductionAmount) * 100) / 100;
    const newRemainingBalance =
      Math.round((Number(request.remainingBalance) - deductionAmount) * 100) / 100;

    const isLastInstallment = newRemainingBalance <= 0;
    const newRequestStatus = isLastInstallment
      ? AdvanceSalaryStatus.COMPLETED
      : AdvanceSalaryStatus.REPAYING;

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
      this.prisma.advanceSalaryRequest.update({
        where: { id: advanceSalaryId },
        data: {
          totalRepaid: newTotalRepaid,
          remainingBalance: newRemainingBalance,
          status: newRequestStatus,
        },
        include: {
          employee: { select: EMPLOYEE_SELECT },
          repayments: { orderBy: { installmentNo: 'asc' } },
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
          requestStatus: newRequestStatus,
        },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    return updatedRequest;
  }

  private async hasIncompleteAdvanceSalary(userId: string): Promise<boolean> {
    const incompleteCount = await this.prisma.advanceSalaryRequest.count({
      where: {
        employeeId: userId,
        status: { notIn: TERMINAL_ADVANCE_SALARY_STATUSES },
      },
    });

    return incompleteCount > 0;
  }
}
