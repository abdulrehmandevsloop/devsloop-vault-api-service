import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { LoanStatus, LoanRepaymentStatus } from '@prisma/client';
import { RequestContextService } from 'src/common/services/request-context.service';
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

@Injectable()
export class LoansService {
  constructor(
    private prisma: PrismaService,
    private requestContext: RequestContextService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: Create
  // ─────────────────────────────────────────────────────────────────────────────

  async create(dto: CreateLoanRequestDto, userId: string) {
    const monthlyDeduction = dto.amount / dto.requestedRepaymentMonths;

    const loan = await this.prisma.loanRequest.create({
      data: {
        employeeId: userId,
        amount: dto.amount,
        purpose: dto.purpose,
        requestedRepaymentMonths: dto.requestedRepaymentMonths,
        notes: dto.notes,
        monthlyDeduction,
        status: LoanStatus.PENDING,
      },
      include: { employee: { select: EMPLOYEE_SELECT } },
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

    return loan;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: List own loans
  // ─────────────────────────────────────────────────────────────────────────────

  async findMyLoans(userId: string, query: LoansQueryDto) {
    const { page = 1, limit = 20, status } = query;
    const skip = (page - 1) * limit;

    const where = {
      employeeId: userId,
      ...(status && { status }),
    };

    const globalWhere = { employeeId: userId };

    const [data, total, statusGroups, amountAgg] = await this.prisma.$transaction([
      this.prisma.loanRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { employee: { select: EMPLOYEE_SELECT } },
      }),
      this.prisma.loanRequest.count({ where }),
      this.prisma.loanRequest.groupBy({
        by: ['status'],
        where: globalWhere,
        _count: true,
        orderBy: { status: 'asc' },
      }),
      this.prisma.loanRequest.aggregate({
        where: {
          ...globalWhere,
          status: { in: [LoanStatus.DISBURSED, LoanStatus.REPAYING, LoanStatus.COMPLETED] },
        },
        _sum: { totalRepaid: true, remainingBalance: true },
      }),
    ]);

    const countByStatus = (s: LoanStatus) =>
      Number(statusGroups.find((g) => g.status === s)?._count ?? 0);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPreviousPage: page > 1,
      pending: countByStatus(LoanStatus.PENDING),
      approved: countByStatus(LoanStatus.APPROVED),
      disbursed: countByStatus(LoanStatus.DISBURSED),
      repaying: countByStatus(LoanStatus.REPAYING),
      completed: countByStatus(LoanStatus.COMPLETED),
      rejected: countByStatus(LoanStatus.REJECTED),
      totalRepaid: Number(amountAgg._sum.totalRepaid ?? 0),
      totalOutstanding: Number(amountAgg._sum.remainingBalance ?? 0),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: Get single loan
  // ─────────────────────────────────────────────────────────────────────────────

  async findOne(id: string, userId: string, isManagement = false) {
    const loan = await this.prisma.loanRequest.findUnique({
      where: { id },
      include: {
        employee: { select: EMPLOYEE_SELECT },
        reviewer: { select: EMPLOYEE_SELECT },
        repayments: { orderBy: { installmentNo: 'asc' } },
      },
    });

    if (!loan) throw new NotFoundException('Loan request not found');
    if (!isManagement && loan.employeeId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return loan;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: Update pending loan
  // ─────────────────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateLoanRequestDto, userId: string) {
    const loan = await this.prisma.loanRequest.findUnique({ where: { id } });
    if (!loan) throw new NotFoundException('Loan request not found');
    if (loan.employeeId !== userId) throw new ForbiddenException('Access denied');
    if (loan.status !== LoanStatus.PENDING) {
      throw new BadRequestException('Only PENDING loan requests can be updated');
    }

    const amount = dto.amount ?? Number(loan.amount);
    const months = dto.requestedRepaymentMonths ?? loan.requestedRepaymentMonths;
    const monthlyDeduction = amount / months;

    return this.prisma.loanRequest.update({
      where: { id },
      data: { ...dto, monthlyDeduction },
      include: { employee: { select: EMPLOYEE_SELECT } },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: Cancel pending loan
  // ─────────────────────────────────────────────────────────────────────────────

  async cancel(id: string, userId: string) {
    const loan = await this.prisma.loanRequest.findUnique({ where: { id } });
    if (!loan) throw new NotFoundException('Loan request not found');
    if (loan.employeeId !== userId) throw new ForbiddenException('Access denied');
    if (loan.status !== LoanStatus.PENDING) {
      throw new BadRequestException('Only PENDING loan requests can be cancelled');
    }

    return this.prisma.loanRequest.update({
      where: { id },
      data: { status: LoanStatus.CANCELLED },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee: Get repayment schedule
  // ─────────────────────────────────────────────────────────────────────────────

  async getRepayments(id: string, userId: string, isManagement = false) {
    const loan = await this.prisma.loanRequest.findUnique({ where: { id } });
    if (!loan) throw new NotFoundException('Loan request not found');
    if (!isManagement && loan.employeeId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return this.prisma.loanRepayment.findMany({
      where: { loanId: id },
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
      this.prisma.loanRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          employee: { select: EMPLOYEE_SELECT },
          reviewer: { select: { id: true, name: true } },
        },
      }),
      this.prisma.loanRequest.count({ where }),
      this.prisma.loanRequest.groupBy({
        by: ['status'],
        _count: true,
        orderBy: { status: 'asc' },
      }),
      this.prisma.loanRequest.aggregate({
        where: {
          status: { in: [LoanStatus.DISBURSED, LoanStatus.REPAYING, LoanStatus.COMPLETED] },
        },
        _sum: { totalRepaid: true, remainingBalance: true },
      }),
    ]);

    const countByStatus = (s: LoanStatus) =>
      Number(statusGroups.find((g) => g.status === s)?._count ?? 0);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPreviousPage: page > 1,
      pending: countByStatus(LoanStatus.PENDING),
      approved: countByStatus(LoanStatus.APPROVED),
      disbursed: countByStatus(LoanStatus.DISBURSED),
      repaying: countByStatus(LoanStatus.REPAYING),
      completed: countByStatus(LoanStatus.COMPLETED),
      rejected: countByStatus(LoanStatus.REJECTED),
      totalRepaid: Number(amountAgg._sum.totalRepaid ?? 0),
      totalOutstanding: Number(amountAgg._sum.remainingBalance ?? 0),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Management: Approve
  // ─────────────────────────────────────────────────────────────────────────────

  async approve(id: string, dto: ApproveLoanDto, reviewerId: string) {
    const loan = await this.prisma.loanRequest.findUnique({ where: { id } });
    if (!loan) throw new NotFoundException('Loan request not found');
    if (loan.status !== LoanStatus.PENDING) {
      throw new BadRequestException('Only PENDING loan requests can be approved');
    }

    const approvedAmount = dto.approvedAmount ?? Number(loan.amount);
    const approvedMonths = dto.approvedRepaymentMonths ?? loan.requestedRepaymentMonths;
    const monthlyDeduction = approvedAmount / approvedMonths;

    const updated = await this.prisma.loanRequest.update({
      where: { id },
      data: {
        status: LoanStatus.APPROVED,
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
        action: 'LOAN_REQUEST_APPROVED',
        entityType: 'LoanRequest',
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

  async reject(id: string, dto: RejectLoanDto, reviewerId: string) {
    const loan = await this.prisma.loanRequest.findUnique({ where: { id } });
    if (!loan) throw new NotFoundException('Loan request not found');
    const rejectableStatuses: LoanStatus[] = [LoanStatus.PENDING, LoanStatus.APPROVED];
    if (!rejectableStatuses.includes(loan.status)) {
      throw new BadRequestException('Only PENDING or APPROVED loans can be rejected');
    }

    const updated = await this.prisma.loanRequest.update({
      where: { id },
      data: {
        status: LoanStatus.REJECTED,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewComment: dto.reviewComment,
      },
      include: { employee: { select: EMPLOYEE_SELECT } },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: reviewerId,
        action: 'LOAN_REQUEST_REJECTED',
        entityType: 'LoanRequest',
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

  async disburse(id: string, dto: DisburseLoanDto, disburserId: string) {
    const loan = await this.prisma.loanRequest.findUnique({ where: { id } });
    if (!loan) throw new NotFoundException('Loan request not found');
    if (loan.status !== LoanStatus.APPROVED) {
      throw new BadRequestException('Only APPROVED loans can be disbursed');
    }

    const approvedAmount = Number(loan.approvedAmount ?? loan.amount);
    const approvedMonths = loan.approvedRepaymentMonths ?? loan.requestedRepaymentMonths;
    const monthlyDeduction = Number(loan.monthlyDeduction ?? approvedAmount / approvedMonths);

    // Generate repayment schedule
    const repayments = this.generateRepaymentSchedule(
      id,
      dto.repaymentStartMonth,
      approvedMonths,
      approvedAmount,
      monthlyDeduction,
    );

    const [updatedLoan] = await this.prisma.$transaction([
      this.prisma.loanRequest.update({
        where: { id },
        data: {
          status: LoanStatus.DISBURSED,
          disbursedAt: new Date(),
          disbursedById: disburserId,
          repaymentStartMonth: dto.repaymentStartMonth,
          remainingBalance: approvedAmount,
        },
        include: { employee: { select: EMPLOYEE_SELECT } },
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

    return updatedLoan;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helper: Generate repayment schedule
  // ─────────────────────────────────────────────────────────────────────────────

  private generateRepaymentSchedule(
    loanId: string,
    startMonth: string,
    months: number,
    totalAmount: number,
    monthlyAmount: number,
  ) {
    const [year, month] = startMonth.split('-').map(Number);
    const repayments: {
      loanId: string;
      installmentNo: number;
      scheduledMonth: string;
      amount: number;
      remainingBalance: number;
    }[] = [];
    let remaining = totalAmount;

    for (let i = 0; i < months; i++) {
      const d = new Date(year, month - 1 + i);
      const scheduledMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      // Last installment absorbs rounding differences
      const amount = i === months - 1 ? remaining : Math.round(monthlyAmount * 100) / 100;
      remaining = Math.round((remaining - amount) * 100) / 100;

      repayments.push({
        loanId,
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
    const loan = await this.prisma.loanRequest.findUnique({
      where: { id: loanId },
    });
    if (!loan) throw new NotFoundException('Loan request not found');

    const validStatuses: LoanStatus[] = [LoanStatus.DISBURSED, LoanStatus.REPAYING];
    if (!validStatuses.includes(loan.status)) {
      throw new BadRequestException(
        'Only DISBURSED or REPAYING loans can have repayments processed',
      );
    }

    const repayment = await this.prisma.loanRepayment.findUnique({
      where: { loanId_installmentNo: { loanId, installmentNo } },
    });
    if (!repayment) throw new NotFoundException('Repayment installment not found');
    if (repayment.status !== LoanRepaymentStatus.PENDING) {
      throw new BadRequestException(
        `Installment #${installmentNo} has already been ${repayment.status.toLowerCase()}`,
      );
    }

    const deductionAmount = Number(repayment.amount);
    const newTotalRepaid = Math.round((Number(loan.totalRepaid) + deductionAmount) * 100) / 100;
    const newRemainingBalance =
      Math.round((Number(loan.remainingBalance) - deductionAmount) * 100) / 100;

    // Determine new loan status
    const isLastInstallment = newRemainingBalance <= 0;
    const newLoanStatus = isLastInstallment ? LoanStatus.COMPLETED : LoanStatus.REPAYING;

    const [_updatedRepayment, updatedLoan] = await this.prisma.$transaction([
      this.prisma.loanRepayment.update({
        where: { id: repayment.id },
        data: {
          status: LoanRepaymentStatus.DEDUCTED,
          processedAt: new Date(),
          processedById,
          processingNote,
        },
      }),
      this.prisma.loanRequest.update({
        where: { id: loanId },
        data: {
          totalRepaid: newTotalRepaid,
          remainingBalance: newRemainingBalance,
          status: newLoanStatus,
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
        action: 'LOAN_REPAYMENT_PROCESSED',
        entityType: 'LoanRepayment',
        entityId: repayment.id,
        changes: {
          loanId,
          installmentNo,
          deductionAmount,
          totalRepaid: newTotalRepaid,
          remainingBalance: newRemainingBalance,
          loanStatus: newLoanStatus,
        },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    return updatedLoan;
  }
}
