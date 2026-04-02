import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RequestContextService } from 'src/common/services/request-context.service';
import {
  EmployeeStatus,
  LeaveStatus,
  PayrollPeriodStatus,
  Prisma,
  ReimbursementProcessingType,
  ReimbursementStatus,
} from '@prisma/client';
import { PrismaService } from 'src/prisma';
import { countWeekdaysInUtcMonth, PayrollCalculationService } from './payroll-calculation.service';
import type { CreatePayrollPeriodDto } from './dto/create-payroll-period.dto';
import type { PayrollLinesQueryDto } from './dto/payroll-lines-query.dto';
import type { UpdatePayrollLineDto } from './dto/update-payroll-line.dto';
import type { UpsertPayrollProfileDto } from './dto/upsert-payroll-profile.dto';

const LINE_AUDIT_FIELDS = [
  'extraWorkingDays',
  'pendingWorkingDays',
  'performanceBonus',
  'reimbursementManual',
  'includeHrReimbursements',
  'deductionTaxable',
  'deductionNonTaxable',
  'fines',
  'loanDeduction',
  'advanceDeduction',
  'taxPercentOverride',
  'rentalAllowanceMonthly',
  'commuteAllowanceMonthly',
] as const;

type LineAuditField = (typeof LINE_AUDIT_FIELDS)[number];

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payrollCalculation: PayrollCalculationService,
    private readonly requestContext: RequestContextService,
  ) {}

  async listPeriods(): Promise<
    Array<{
      id: string;
      yearMonth: string;
      status: PayrollPeriodStatus;
      createdAt: Date;
      lockedAt: Date | null;
    }>
  > {
    return this.prisma.payrollPeriod.findMany({
      select: {
        id: true,
        yearMonth: true,
        status: true,
        createdAt: true,
        lockedAt: true,
      },
      orderBy: { yearMonth: 'desc' },
    });
  }

  async getPeriod(periodId: string) {
    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: {
        id: true,
        yearMonth: true,
        status: true,
        lunchRatePerDay: true,
        defaultTaxPercent: true,
        lockedAt: true,
        lockedById: true,
        lastExportChecksum: true,
        lastExportAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!period) {
      throw new NotFoundException(`Payroll period ${periodId} not found`);
    }
    return {
      ...period,
      lunchRatePerDay: period.lunchRatePerDay.toString(),
      defaultTaxPercent: period.defaultTaxPercent.toString(),
      lastExportChecksum: period.lastExportChecksum?.toString() ?? null,
    };
  }

  async upsertPayrollProfile(userId: string, dto: UpsertPayrollProfileDto, actorId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }
    const data: Prisma.PayrollProfileUncheckedCreateInput = { userId };
    if (dto.rentalAllowanceMonthly !== undefined) {
      data.rentalAllowanceMonthly = new Prisma.Decimal(dto.rentalAllowanceMonthly);
    }
    if (dto.commuteAllowanceMonthly !== undefined) {
      data.commuteAllowanceMonthly = new Prisma.Decimal(dto.commuteAllowanceMonthly);
    }
    const profile = await this.prisma.payrollProfile.upsert({
      where: { userId },
      create: data,
      update: {
        ...(dto.rentalAllowanceMonthly !== undefined
          ? { rentalAllowanceMonthly: new Prisma.Decimal(dto.rentalAllowanceMonthly) }
          : {}),
        ...(dto.commuteAllowanceMonthly !== undefined
          ? { commuteAllowanceMonthly: new Prisma.Decimal(dto.commuteAllowanceMonthly) }
          : {}),
      },
    });
    const fieldsUpdated: string[] = [
      ...(dto.rentalAllowanceMonthly !== undefined ? ['rentalAllowanceMonthly'] : []),
      ...(dto.commuteAllowanceMonthly !== undefined ? ['commuteAllowanceMonthly'] : []),
    ];
    if (fieldsUpdated.length > 0) {
      await this.prisma.auditLog.create({
        data: {
          userId: actorId,
          action: 'PAYROLL_PROFILE_UPSERT',
          entityType: 'PayrollProfile',
          entityId: userId,
          changes: {
            targetUserId: userId,
            fieldsUpdated,
          },
          ipAddress: this.requestContext.getIpAddress(),
          userAgent: this.requestContext.getUserAgent(),
        },
      });
    }
    return {
      userId: profile.userId,
      rentalAllowanceMonthly: profile.rentalAllowanceMonthly?.toString() ?? null,
      commuteAllowanceMonthly: profile.commuteAllowanceMonthly?.toString() ?? null,
    };
  }

  async createPeriod(dto: CreatePayrollPeriodDto, actorId: string) {
    const existing = await this.prisma.payrollPeriod.findUnique({
      where: { yearMonth: dto.yearMonth },
    });
    if (existing) {
      throw new ConflictException(`Payroll period ${dto.yearMonth} already exists`);
    }
    const period = await this.prisma.payrollPeriod.create({
      data: {
        yearMonth: dto.yearMonth,
        ...(dto.lunchRatePerDay !== undefined
          ? { lunchRatePerDay: new Prisma.Decimal(dto.lunchRatePerDay) }
          : {}),
        ...(dto.defaultTaxPercent !== undefined
          ? { defaultTaxPercent: new Prisma.Decimal(dto.defaultTaxPercent) }
          : {}),
      },
      select: {
        id: true,
        yearMonth: true,
        status: true,
        lunchRatePerDay: true,
        defaultTaxPercent: true,
        createdAt: true,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'PAYROLL_PERIOD_CREATED',
        entityType: 'PayrollPeriod',
        entityId: period.id,
        changes: { yearMonth: period.yearMonth },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });
    return {
      ...period,
      lunchRatePerDay: period.lunchRatePerDay.toString(),
      defaultTaxPercent: period.defaultTaxPercent.toString(),
    };
  }

  private assertPeriodEditable(status: PayrollPeriodStatus): void {
    if (status === PayrollPeriodStatus.LOCKED) {
      throw new ForbiddenException('This payroll period is locked and cannot be changed');
    }
  }

  async refreshLines(
    periodId: string,
    actorId: string,
  ): Promise<{ created: number; updated: number }> {
    const period = await this.prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) {
      throw new NotFoundException(`Payroll period ${periodId} not found`);
    }
    this.assertPeriodEditable(period.status);

    const standardWorkingDays = countWeekdaysInUtcMonth(period.yearMonth);
    const users = await this.prisma.user.findMany({
      where: { approvalStatus: 'APPROVED', isSystem: false },
      select: {
        id: true,
        name: true,
        employeeId: true,
        departments: true,
        designation: true,
        employeeType: true,
        employeeStatus: true,
        baseSalaryMonthly: true,
      },
    });

    const profiles = await this.prisma.payrollProfile.findMany({
      where: { userId: { in: users.map((u) => u.id) } },
    });
    const profileByUser = new Map(profiles.map((p) => [p.userId, p]));

    let created = 0;
    let updated = 0;
    for (const u of users) {
      const base = u.baseSalaryMonthly ?? new Prisma.Decimal(0);
      const profile = profileByUser.get(u.id);
      const rental = profile?.rentalAllowanceMonthly ?? new Prisma.Decimal(0);
      const commute = profile?.commuteAllowanceMonthly ?? new Prisma.Decimal(0);

      const existingLine = await this.prisma.payrollLine.findUnique({
        where: { periodId_userId: { periodId, userId: u.id } },
      });

      if (existingLine) {
        await this.prisma.payrollLine.update({
          where: { id: existingLine.id },
          data: {
            displayName: u.name,
            employeeCode: u.employeeId,
            departments: u.departments,
            designation: u.designation,
            employeeType: u.employeeType,
            employeeStatus: u.employeeStatus,
            baseSalaryMonthly: base,
            rentalAllowanceMonthly: rental,
            commuteAllowanceMonthly: commute,
            standardWorkingDays,
          },
        });
        updated++;
      } else {
        await this.prisma.payrollLine.create({
          data: {
            periodId,
            userId: u.id,
            displayName: u.name,
            employeeCode: u.employeeId,
            departments: u.departments,
            designation: u.designation,
            employeeType: u.employeeType,
            employeeStatus: u.employeeStatus,
            baseSalaryMonthly: base,
            rentalAllowanceMonthly: rental,
            commuteAllowanceMonthly: commute,
            standardWorkingDays,
          },
        });
        created++;
      }
    }

    await this.recalculatePeriod(periodId);
    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'PAYROLL_HR_SYNCED',
        entityType: 'PayrollPeriod',
        entityId: periodId,
        changes: { yearMonth: period.yearMonth, created, updated },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });
    return { created, updated };
  }

  private async sumApprovedLeaveDays(
    userId: string,
    yearMonth: string,
  ): Promise<{ paidLeaveDays: number; unpaidLeaveDays: number }> {
    const parts = yearMonth.split('-');
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const monthEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));

    const leaves = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId: userId,
        status: LeaveStatus.APPROVED,
        startDate: { lte: monthEnd },
        endDate: { gte: monthStart },
      },
      select: { category: true, unpaidDays: true, startDate: true, endDate: true },
    });

    let paidLeaveDays = 0;
    let unpaidLeaveDays = 0;

    for (const l of leaves) {
      const unpaid = Number(l.unpaidDays);
      // Total calendar days capped to the month window
      const effectiveStart = l.startDate < monthStart ? monthStart : l.startDate;
      const effectiveEnd = l.endDate > monthEnd ? monthEnd : l.endDate;
      const totalDays =
        Math.round((effectiveEnd.getTime() - effectiveStart.getTime()) / 86_400_000) + 1;

      if (l.category === 'UNPAID') {
        unpaidLeaveDays += unpaid > 0 ? unpaid : totalDays;
      } else {
        // PAID or null category — count non-unpaid days as paid leave
        const paidDays = Math.max(0, totalDays - unpaid);
        paidLeaveDays += paidDays;
        if (unpaid > 0) unpaidLeaveDays += unpaid;
      }
    }

    return {
      paidLeaveDays: Math.round(paidLeaveDays * 10) / 10,
      unpaidLeaveDays: Math.round(unpaidLeaveDays * 10) / 10,
    };
  }

  private async sumHrReimbursementsForSalaryMonth(
    userId: string,
    salaryMonth: string,
  ): Promise<number> {
    const rows = await this.prisma.reimbursementRequest.findMany({
      where: {
        employeeId: userId,
        salaryMonth,
        processingType: ReimbursementProcessingType.SALARY_ADJUSTMENT,
        status: { in: [ReimbursementStatus.APPROVED, ReimbursementStatus.PROCESSED] },
      },
      select: { amount: true, approvedAmount: true },
    });
    let sum = 0;
    for (const r of rows) {
      const amt = r.approvedAmount ?? r.amount;
      sum += Number(amt);
    }
    return Math.round(sum * 100) / 100;
  }

  async recalculatePeriod(periodId: string): Promise<void> {
    const period = await this.prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) {
      throw new NotFoundException(`Payroll period ${periodId} not found`);
    }
    this.assertPeriodEditable(period.status);

    const lines = await this.prisma.payrollLine.findMany({
      where: { periodId },
      select: { id: true },
    });
    for (const line of lines) {
      await this.recalculateLineById(line.id, period);
    }
  }

  private async recalculateLineById(
    lineId: string,
    period: {
      id: string;
      yearMonth: string;
      lunchRatePerDay: Prisma.Decimal;
      defaultTaxPercent: Prisma.Decimal;
    },
  ): Promise<void> {
    const line = await this.prisma.payrollLine.findUnique({
      where: { id: lineId },
    });
    if (!line || line.periodId !== period.id) {
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: line.userId },
      select: {
        name: true,
        employeeId: true,
        departments: true,
        designation: true,
        employeeType: true,
        employeeStatus: true,
        baseSalaryMonthly: true,
      },
    });
    if (!user) {
      return;
    }

    const standardWorkingDays = countWeekdaysInUtcMonth(period.yearMonth);
    const reimbursementFromHr = line.includeHrReimbursements
      ? await this.sumHrReimbursementsForSalaryMonth(line.userId, period.yearMonth)
      : 0;

    const { paidLeaveDays, unpaidLeaveDays } = await this.sumApprovedLeaveDays(
      line.userId,
      period.yearMonth,
    );

    const calcResult = this.payrollCalculation.calculateLine(period.yearMonth, {
      employeeStatus: user.employeeStatus,
      baseSalaryMonthly: Number(user.baseSalaryMonthly ?? 0),
      rentalAllowanceMonthly: Number(line.rentalAllowanceMonthly),
      commuteAllowanceMonthly: Number(line.commuteAllowanceMonthly),
      standardWorkingDays,
      extraWorkingDays: line.extraWorkingDays,
      pendingWorkingDays: line.pendingWorkingDays,
      unpaidLeaveDays,
      performanceBonus: Number(line.performanceBonus),
      reimbursementManual: Number(line.reimbursementManual),
      reimbursementFromHr,
      deductionTaxable: Number(line.deductionTaxable),
      deductionNonTaxable: Number(line.deductionNonTaxable),
      fines: Number(line.fines),
      loanDeduction: Number(line.loanDeduction),
      advanceDeduction: Number(line.advanceDeduction),
      lunchRatePerDay: Number(period.lunchRatePerDay),
      defaultTaxPercent: Number(period.defaultTaxPercent),
      taxPercentOverride: line.taxPercentOverride ? Number(line.taxPercentOverride) : null,
    });

    await this.prisma.payrollLine.update({
      where: { id: lineId },
      data: {
        displayName: user.name,
        employeeCode: user.employeeId,
        departments: user.departments,
        designation: user.designation,
        employeeType: user.employeeType,
        employeeStatus: user.employeeStatus,
        baseSalaryMonthly: user.baseSalaryMonthly ?? new Prisma.Decimal(0),
        standardWorkingDays,
        paidLeaveDays: new Prisma.Decimal(paidLeaveDays),
        unpaidLeaveDays: new Prisma.Decimal(unpaidLeaveDays),
        reimbursementFromHr: new Prisma.Decimal(reimbursementFromHr),
        overtimeEarnings: new Prisma.Decimal(calcResult.overtimeEarnings),
        basicProRated: new Prisma.Decimal(calcResult.basicProRated),
        grossSalary: new Prisma.Decimal(calcResult.grossSalary),
        foodDeduction: new Prisma.Decimal(calcResult.foodDeduction),
        taxDeduction: new Prisma.Decimal(calcResult.taxDeduction),
        unpaidLeaveDeduction: new Prisma.Decimal(calcResult.unpaidLeaveDeduction),
        totalDeductions: new Prisma.Decimal(calcResult.totalDeductions),
        netSalary: new Prisma.Decimal(calcResult.netSalary),
        calculatedAt: new Date(),
      },
    });
  }

  async listLines(periodId: string, query: PayrollLinesQueryDto) {
    const period = await this.prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) {
      throw new NotFoundException(`Payroll period ${periodId} not found`);
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where: Prisma.PayrollLineWhereInput = { periodId };
    if (query.department?.trim()) {
      where.departments = { has: query.department.trim() };
    }
    if (query.employeeStatus) {
      where.employeeStatus = query.employeeStatus;
    }

    const [lines, total] = await Promise.all([
      this.prisma.payrollLine.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { displayName: 'asc' },
      }),
      this.prisma.payrollLine.count({ where }),
    ]);

    const userIds = lines.map((l) => l.userId);
    const userRows = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, iban: true, email: true, avatarUrl: true },
    });
    const ibanByUser = new Map(userRows.map((r) => [r.id, r.iban]));
    const emailByUser = new Map(userRows.map((r) => [r.id, r.email]));
    const avatarByUser = new Map(userRows.map((r) => [r.id, r.avatarUrl]));

    const data = lines.map((l) => ({
      ...this.serializeLine(l),
      iban: ibanByUser.get(l.userId) ?? null,
      email: emailByUser.get(l.userId) ?? null,
      avatarUrl: avatarByUser.get(l.userId) ?? null,
    }));

    const totalNetAll = await this.prisma.payrollLine.aggregate({
      where: { periodId },
      _sum: { netSalary: true },
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPreviousPage: page > 1,
      sumNetSalaryAll: totalNetAll._sum.netSalary?.toString() ?? '0',
    };
  }

  private serializeLine(l: {
    id: string;
    periodId: string;
    userId: string;
    displayName: string;
    employeeCode: string | null;
    departments: string[];
    designation: string | null;
    employeeType: string | null;
    employeeStatus: EmployeeStatus;
    baseSalaryMonthly: Prisma.Decimal;
    rentalAllowanceMonthly: Prisma.Decimal;
    commuteAllowanceMonthly: Prisma.Decimal;
    extraWorkingDays: number;
    pendingWorkingDays: number | null;
    performanceBonus: Prisma.Decimal;
    reimbursementManual: Prisma.Decimal;
    includeHrReimbursements: boolean;
    deductionTaxable: Prisma.Decimal;
    deductionNonTaxable: Prisma.Decimal;
    fines: Prisma.Decimal;
    loanDeduction: Prisma.Decimal;
    advanceDeduction: Prisma.Decimal;
    taxPercentOverride: Prisma.Decimal | null;
    standardWorkingDays: number;
    paidLeaveDays: Prisma.Decimal;
    unpaidLeaveDays: Prisma.Decimal;
    reimbursementFromHr: Prisma.Decimal;
    overtimeEarnings: Prisma.Decimal;
    basicProRated: Prisma.Decimal;
    grossSalary: Prisma.Decimal;
    foodDeduction: Prisma.Decimal;
    taxDeduction: Prisma.Decimal;
    unpaidLeaveDeduction: Prisma.Decimal;
    totalDeductions: Prisma.Decimal;
    netSalary: Prisma.Decimal;
    calculatedAt: Date | null;
  }) {
    const dec = (d: Prisma.Decimal): string => d.toString();
    return {
      id: l.id,
      periodId: l.periodId,
      userId: l.userId,
      displayName: l.displayName,
      employeeCode: l.employeeCode,
      departments: l.departments,
      designation: l.designation,
      employeeType: l.employeeType,
      employeeStatus: l.employeeStatus,
      baseSalaryMonthly: dec(l.baseSalaryMonthly),
      rentalAllowanceMonthly: dec(l.rentalAllowanceMonthly),
      commuteAllowanceMonthly: dec(l.commuteAllowanceMonthly),
      extraWorkingDays: l.extraWorkingDays,
      pendingWorkingDays: l.pendingWorkingDays,
      performanceBonus: dec(l.performanceBonus),
      reimbursementManual: dec(l.reimbursementManual),
      includeHrReimbursements: l.includeHrReimbursements,
      deductionTaxable: dec(l.deductionTaxable),
      deductionNonTaxable: dec(l.deductionNonTaxable),
      fines: dec(l.fines),
      loanDeduction: dec(l.loanDeduction),
      advanceDeduction: dec(l.advanceDeduction),
      taxPercentOverride: l.taxPercentOverride?.toString() ?? null,
      standardWorkingDays: l.standardWorkingDays,
      paidLeaveDays: dec(l.paidLeaveDays),
      unpaidLeaveDays: dec(l.unpaidLeaveDays),
      reimbursementFromHr: dec(l.reimbursementFromHr),
      overtimeEarnings: dec(l.overtimeEarnings),
      basicProRated: dec(l.basicProRated),
      grossSalary: dec(l.grossSalary),
      foodDeduction: dec(l.foodDeduction),
      taxDeduction: dec(l.taxDeduction),
      unpaidLeaveDeduction: dec(l.unpaidLeaveDeduction),
      totalDeductions: dec(l.totalDeductions),
      netSalary: dec(l.netSalary),
      calculatedAt: l.calculatedAt?.toISOString() ?? null,
      totalEarnings: dec(l.grossSalary),
    };
  }

  async getExportMetadata(periodId: string) {
    const period = await this.prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) {
      throw new NotFoundException(`Payroll period ${periodId} not found`);
    }
    const lines = await this.prisma.payrollLine.findMany({
      where: { periodId },
      include: { user: { select: { employeeStatus: true, iban: true, name: true } } },
    });

    let sumAllNet = 0;
    let sumExportNet = 0;
    const exportable: Array<{ userId: string; name: string; iban: string | null; net: number }> =
      [];

    for (const line of lines) {
      const net = Number(line.netSalary);
      sumAllNet += net;
      const st = line.user.employeeStatus;
      if (st === EmployeeStatus.HOLD || st === EmployeeStatus.DEACTIVATED) {
        continue;
      }
      const iban = line.user.iban?.trim() ?? '';
      if (!iban) {
        continue;
      }
      sumExportNet += net;
      exportable.push({
        userId: line.userId,
        name: line.user.name,
        iban,
        net,
      });
    }

    return {
      sumNetSalaryUi: Math.round(sumAllNet * 100) / 100,
      sumNetSalaryExportable: Math.round(sumExportNet * 100) / 100,
      exportableCount: exportable.length,
      periodStatus: period.status,
    };
  }

  async exportCsvAndLock(
    periodId: string,
    actorId: string,
  ): Promise<{
    csvBody: string;
    checksum: number;
    rowCount: number;
    yearMonth: string;
  }> {
    const lockedAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      const lockAttempt = await tx.payrollPeriod.updateMany({
        where: { id: periodId, status: PayrollPeriodStatus.DRAFT },
        data: {
          status: PayrollPeriodStatus.LOCKED,
          lockedAt,
          lockedById: actorId,
          lastExportAt: lockedAt,
        },
      });
      if (lockAttempt.count === 0) {
        const existing = await tx.payrollPeriod.findUnique({ where: { id: periodId } });
        if (!existing) {
          throw new NotFoundException(`Payroll period ${periodId} not found`);
        }
        throw new ConflictException(
          'This payroll period is already locked or export is in progress',
        );
      }

      const period = await tx.payrollPeriod.findUniqueOrThrow({
        where: { id: periodId },
      });

      const lines = await tx.payrollLine.findMany({
        where: { periodId },
        include: { user: { select: { employeeStatus: true, iban: true, name: true } } },
        orderBy: { displayName: 'asc' },
      });

      const rows: Array<{ name: string; iban: string; net: string }> = [];
      let checksum = 0;

      for (const line of lines) {
        const st = line.user.employeeStatus;
        if (st === EmployeeStatus.HOLD || st === EmployeeStatus.DEACTIVATED) {
          continue;
        }
        const iban = line.user.iban?.trim() ?? '';
        if (!iban) {
          continue;
        }
        const net = Number(line.netSalary);
        checksum += net;
        rows.push({
          name: line.user.name,
          iban,
          net: net.toFixed(2),
        });
      }

      checksum = Math.round(checksum * 100) / 100;

      const header = 'Employee Name,IBAN,Net Salary';
      const escape = (s: string): string => {
        if (/[",\n\r]/.test(s)) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };
      const body = [
        header,
        ...rows.map((r) => [escape(r.name), escape(r.iban), r.net].join(',')),
      ].join('\r\n');

      const csvBody = `\uFEFF${body}`;

      await tx.payrollPeriod.update({
        where: { id: periodId },
        data: { lastExportChecksum: new Prisma.Decimal(checksum) },
      });

      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'PAYROLL_EXPORT_AND_LOCK',
          entityType: 'PayrollPeriod',
          entityId: periodId,
          changes: {
            yearMonth: period.yearMonth,
            exportRowCount: rows.length,
            checksumExportableNet: checksum,
          },
          ipAddress: this.requestContext.getIpAddress(),
          userAgent: this.requestContext.getUserAgent(),
        },
      });

      return { csvBody, checksum, rowCount: rows.length, yearMonth: period.yearMonth };
    });
  }

  async updateLine(periodId: string, lineId: string, dto: UpdatePayrollLineDto, actorId: string) {
    const period = await this.prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) {
      throw new NotFoundException(`Payroll period ${periodId} not found`);
    }
    this.assertPeriodEditable(period.status);

    const line = await this.prisma.payrollLine.findFirst({
      where: { id: lineId, periodId },
    });
    if (!line) {
      throw new NotFoundException(`Payroll line ${lineId} not found`);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: line.userId },
      select: { employeeStatus: true },
    });
    if (!user) {
      throw new NotFoundException(`User ${line.userId} not found`);
    }
    if (user.employeeStatus === EmployeeStatus.DEACTIVATED) {
      throw new ForbiddenException('Cannot adjust payroll for a deactivated employee');
    }

    const audits: Prisma.PayrollAdjustmentAuditCreateManyInput[] = [];

    const applyDec = (
      key: LineAuditField,
      prev: Prisma.Decimal | number | boolean | null,
      next: Prisma.Decimal | number | boolean | null,
    ): void => {
      const prevStr = prev === null || prev === undefined ? '' : String(prev);
      const nextStr = next === null || next === undefined ? '' : String(next);
      if (prevStr !== nextStr) {
        audits.push({
          lineId: line.id,
          field: key,
          oldValue: prevStr.slice(0, 500),
          newValue: nextStr.slice(0, 500),
          actorId,
        });
      }
    };

    const data: Prisma.PayrollLineUpdateInput = {};

    if (dto.extraWorkingDays !== undefined) {
      applyDec('extraWorkingDays', line.extraWorkingDays, dto.extraWorkingDays);
      data.extraWorkingDays = dto.extraWorkingDays;
    }
    if (dto.pendingWorkingDays !== undefined) {
      applyDec('pendingWorkingDays', line.pendingWorkingDays, dto.pendingWorkingDays);
      data.pendingWorkingDays = dto.pendingWorkingDays;
    }
    if (dto.performanceBonus !== undefined) {
      applyDec('performanceBonus', line.performanceBonus, dto.performanceBonus);
      data.performanceBonus = new Prisma.Decimal(dto.performanceBonus);
    }
    if (dto.reimbursementManual !== undefined) {
      applyDec('reimbursementManual', line.reimbursementManual, dto.reimbursementManual);
      data.reimbursementManual = new Prisma.Decimal(dto.reimbursementManual);
    }
    if (dto.includeHrReimbursements !== undefined) {
      applyDec(
        'includeHrReimbursements',
        line.includeHrReimbursements,
        dto.includeHrReimbursements,
      );
      data.includeHrReimbursements = dto.includeHrReimbursements;
    }
    if (dto.deductionTaxable !== undefined) {
      applyDec('deductionTaxable', line.deductionTaxable, dto.deductionTaxable);
      data.deductionTaxable = new Prisma.Decimal(dto.deductionTaxable);
    }
    if (dto.deductionNonTaxable !== undefined) {
      applyDec('deductionNonTaxable', line.deductionNonTaxable, dto.deductionNonTaxable);
      data.deductionNonTaxable = new Prisma.Decimal(dto.deductionNonTaxable);
    }
    if (dto.fines !== undefined) {
      applyDec('fines', line.fines, dto.fines);
      data.fines = new Prisma.Decimal(dto.fines);
    }
    if (dto.loanDeduction !== undefined) {
      applyDec('loanDeduction', line.loanDeduction, dto.loanDeduction);
      data.loanDeduction = new Prisma.Decimal(dto.loanDeduction);
    }
    if (dto.advanceDeduction !== undefined) {
      applyDec('advanceDeduction', line.advanceDeduction, dto.advanceDeduction);
      data.advanceDeduction = new Prisma.Decimal(dto.advanceDeduction);
    }
    if (dto.taxPercentOverride !== undefined) {
      applyDec('taxPercentOverride', line.taxPercentOverride, dto.taxPercentOverride);
      data.taxPercentOverride =
        dto.taxPercentOverride === null ? null : new Prisma.Decimal(dto.taxPercentOverride);
    }
    if (dto.rentalAllowanceMonthly !== undefined) {
      applyDec('rentalAllowanceMonthly', line.rentalAllowanceMonthly, dto.rentalAllowanceMonthly);
      data.rentalAllowanceMonthly = new Prisma.Decimal(dto.rentalAllowanceMonthly);
    }
    if (dto.commuteAllowanceMonthly !== undefined) {
      applyDec(
        'commuteAllowanceMonthly',
        line.commuteAllowanceMonthly,
        dto.commuteAllowanceMonthly,
      );
      data.commuteAllowanceMonthly = new Prisma.Decimal(dto.commuteAllowanceMonthly);
    }

    if (Object.keys(data).length === 0) {
      return this.getLineWithIban(periodId, lineId);
    }

    await this.prisma.$transaction([
      this.prisma.payrollLine.update({ where: { id: lineId }, data }),
      ...(audits.length ? [this.prisma.payrollAdjustmentAudit.createMany({ data: audits })] : []),
    ]);

    await this.recalculateLineById(lineId, period);
    return this.getLineWithIban(periodId, lineId);
  }

  async getApprovedLeavesForLine(periodId: string, userId: string) {
    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: { yearMonth: true },
    });
    if (!period) {
      throw new NotFoundException(`Payroll period ${periodId} not found`);
    }

    const parts = period.yearMonth.split('-');
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const monthEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));

    const leaves = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId: userId,
        status: LeaveStatus.APPROVED,
        startDate: { lte: monthEnd },
        endDate: { gte: monthStart },
      },
      select: {
        id: true,
        leaveType: true,
        startDate: true,
        endDate: true,
        category: true,
        unpaidDays: true,
      },
      orderBy: { startDate: 'asc' },
    });

    return leaves.map((l) => ({
      id: l.id,
      leaveType: l.leaveType,
      startDate: l.startDate.toISOString(),
      endDate: l.endDate.toISOString(),
      category: l.category,
      unpaidDays: l.unpaidDays.toString(),
    }));
  }

  private async getLineWithIban(periodId: string, lineId: string) {
    const line = await this.prisma.payrollLine.findFirst({
      where: { id: lineId, periodId },
    });
    if (!line) {
      throw new NotFoundException(`Payroll line ${lineId} not found`);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: line.userId },
      select: { iban: true },
    });
    return {
      ...this.serializeLine(line),
      iban: user?.iban ?? null,
    };
  }
}
