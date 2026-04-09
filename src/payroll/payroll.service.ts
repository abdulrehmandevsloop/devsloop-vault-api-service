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
  'lunchDaysOverride',
  'performanceBonus',
  'reimbursementManual',
  'includeHrReimbursements',
  'payViaRemittance',
  'fines',
  'loanDeduction',
  'advanceDeduction',
  'baseSalaryMonthly',
  'taxPercentOverride',
  'rentalAllowanceMonthly',
  'commuteAllowanceMonthly',
  'consultantPayMode',
  'contractedDailyRate',
  'contractedHourlyRate',
  'hoursWorked',
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
    if (dto.defaultConsultantPayMode !== undefined) {
      data.defaultConsultantPayMode = dto.defaultConsultantPayMode;
    }
    if (dto.defaultDailyRate !== undefined) {
      data.defaultDailyRate = new Prisma.Decimal(dto.defaultDailyRate);
    }
    if (dto.defaultHourlyRate !== undefined) {
      data.defaultHourlyRate = new Prisma.Decimal(dto.defaultHourlyRate);
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
        ...(dto.defaultConsultantPayMode !== undefined
          ? { defaultConsultantPayMode: dto.defaultConsultantPayMode }
          : {}),
        ...(dto.defaultDailyRate !== undefined
          ? { defaultDailyRate: new Prisma.Decimal(dto.defaultDailyRate) }
          : {}),
        ...(dto.defaultHourlyRate !== undefined
          ? { defaultHourlyRate: new Prisma.Decimal(dto.defaultHourlyRate) }
          : {}),
      },
    });
    const fieldsUpdated: string[] = [
      ...(dto.rentalAllowanceMonthly !== undefined ? ['rentalAllowanceMonthly'] : []),
      ...(dto.commuteAllowanceMonthly !== undefined ? ['commuteAllowanceMonthly'] : []),
      ...(dto.defaultConsultantPayMode !== undefined ? ['defaultConsultantPayMode'] : []),
      ...(dto.defaultDailyRate !== undefined ? ['defaultDailyRate'] : []),
      ...(dto.defaultHourlyRate !== undefined ? ['defaultHourlyRate'] : []),
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
      defaultConsultantPayMode: profile.defaultConsultantPayMode ?? null,
      defaultDailyRate: profile.defaultDailyRate?.toString() ?? null,
      defaultHourlyRate: profile.defaultHourlyRate?.toString() ?? null,
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

    // $queryRaw because incomeTaxPercent may not be in the generated Prisma client yet
    const taxRows = await this.prisma.$queryRaw<{ id: string; incomeTaxAmount: string | null }[]>`
      SELECT id, "incomeTaxAmount"::text FROM users WHERE id = ANY(${users.map((u) => u.id)})
    `;
    const taxByUser = new Map(
      taxRows.map((r) => [r.id, r.incomeTaxAmount ? Number(r.incomeTaxAmount) : 0]),
    );

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

      const isConsultant = u.employeeType === 'CONSULTANT';
      const userTaxAmount = isConsultant ? 0 : (taxByUser.get(u.id) ?? 0);
      const consultantData = isConsultant
        ? {
            ...(profile?.defaultConsultantPayMode != null
              ? { consultantPayMode: profile.defaultConsultantPayMode }
              : {}),
            ...(profile?.defaultDailyRate != null
              ? { contractedDailyRate: profile.defaultDailyRate }
              : {}),
            ...(profile?.defaultHourlyRate != null
              ? { contractedHourlyRate: profile.defaultHourlyRate }
              : {}),
          }
        : {};

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
            taxPercentOverride: new Prisma.Decimal(userTaxAmount),
            ...consultantData,
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
            taxPercentOverride: new Prisma.Decimal(userTaxAmount),
            ...consultantData,
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

  async recalculateLineById(
    lineId: string,
    period: {
      id: string;
      yearMonth: string;
      lunchRatePerDay: Prisma.Decimal;
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

    const lunchRows = await this.prisma.$queryRaw<{ lunchEnabled: boolean }[]>`
      SELECT "lunchEnabled" FROM users WHERE id = ${line.userId}
    `;
    const lunchEnabled = lunchRows[0]?.lunchEnabled ?? true;

    const calcResult = this.payrollCalculation.calculateLine(period.yearMonth, {
      employeeStatus: user.employeeStatus,
      employeeType: user.employeeType,
      // Use line's baseSalaryMonthly (may be overridden by HR for FIXED consultants)
      baseSalaryMonthly: Number(line.baseSalaryMonthly ?? user.baseSalaryMonthly ?? 0),
      rentalAllowanceMonthly: Number(line.rentalAllowanceMonthly),
      commuteAllowanceMonthly: Number(line.commuteAllowanceMonthly),
      standardWorkingDays,
      extraWorkingDays: line.extraWorkingDays,
      pendingWorkingDays: line.pendingWorkingDays,
      unpaidLeaveDays,
      performanceBonus: Number(line.performanceBonus),
      reimbursementManual: Number(line.reimbursementManual),
      reimbursementFromHr,
      fines: Number(line.fines),
      loanDeduction: Number(line.loanDeduction),
      advanceDeduction: Number(line.advanceDeduction),
      lunchRatePerDay: Number(period.lunchRatePerDay),
      lunchEnabled,
      lunchDaysOverride:
        ((line as Record<string, unknown>)['lunchDaysOverride'] as number | null) ?? null,
      incomeTaxAmount: line.taxPercentOverride ? Number(line.taxPercentOverride) : 0,
      consultantPayMode: line.consultantPayMode ?? null,
      contractedDailyRate: Number(line.contractedDailyRate ?? 0),
      contractedHourlyRate: Number(line.contractedHourlyRate ?? 0),
      hoursWorked: Number(line.hoursWorked ?? 0),
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
    if (query.employeeType) {
      where.employeeType = query.employeeType;
    }
    if (query.search?.trim()) {
      where.displayName = { contains: query.search.trim(), mode: 'insensitive' };
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
    lunchDaysOverride?: number | null;
    performanceBonus: Prisma.Decimal;
    reimbursementManual: Prisma.Decimal;
    includeHrReimbursements: boolean;
    payViaRemittance?: boolean;
    fines: Prisma.Decimal;
    loanDeduction: Prisma.Decimal;
    advanceDeduction: Prisma.Decimal;
    taxPercentOverride: Prisma.Decimal | null;
    consultantPayMode: string | null;
    contractedDailyRate: Prisma.Decimal | null;
    contractedHourlyRate: Prisma.Decimal | null;
    hoursWorked: Prisma.Decimal | null;
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
      lunchDaysOverride:
        ((l as Record<string, unknown>)['lunchDaysOverride'] as number | null) ?? null,
      performanceBonus: dec(l.performanceBonus),
      reimbursementManual: dec(l.reimbursementManual),
      includeHrReimbursements: l.includeHrReimbursements,
      payViaRemittance: l.payViaRemittance ?? false,

      fines: dec(l.fines),
      loanDeduction: dec(l.loanDeduction),
      advanceDeduction: dec(l.advanceDeduction),
      incomeTaxAmount: l.taxPercentOverride?.toString() ?? null,
      consultantPayMode: l.consultantPayMode,
      contractedDailyRate: l.contractedDailyRate?.toString() ?? null,
      contractedHourlyRate: l.contractedHourlyRate?.toString() ?? null,
      hoursWorked: l.hoursWorked?.toString() ?? null,
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
      include: {
        user: {
          select: {
            employeeStatus: true,
            iban: true,
            bankCode: true,
            accountHolderName: true,
            name: true,
            email: true,
          },
        },
      },
    });

    let sumAllNet = 0;
    let sumExportNet = 0;
    const excludedEmployees: Array<{
      name: string;
      email: string;
      reason: 'NO_IBAN' | 'HOLD' | 'DEACTIVATED' | 'REMITTANCE';
    }> = [];
    const bankWarningEmployees: Array<{
      name: string;
      email: string;
      missingFields: string[];
    }> = [];
    const exportable: Array<{ userId: string; name: string; iban: string | null; net: number }> =
      [];
    const freezeEmployees: Array<{ name: string; pendingDays: number | null; netSalary: number }> =
      [];

    for (const line of lines) {
      const net = Number(line.netSalary);
      sumAllNet += net;
      const st = line.user.employeeStatus;
      if (st === EmployeeStatus.HOLD) {
        excludedEmployees.push({ name: line.user.name, email: line.user.email, reason: 'HOLD' });
        continue;
      }
      if (st === EmployeeStatus.DEACTIVATED) {
        excludedEmployees.push({
          name: line.user.name,
          email: line.user.email,
          reason: 'DEACTIVATED',
        });
        continue;
      }
      const iban = line.user.iban?.trim() ?? '';
      if (!iban) {
        excludedEmployees.push({
          name: line.user.name,
          email: line.user.email,
          reason: 'NO_IBAN',
        });
        continue;
      }
      if ((line as Record<string, unknown>)['payViaRemittance'] === true) {
        excludedEmployees.push({
          name: line.user.name,
          email: line.user.email,
          reason: 'REMITTANCE',
        });
        continue;
      }
      sumExportNet += net;
      exportable.push({
        userId: line.userId,
        name: line.user.name,
        iban,
        net,
      });
      const missingFields: string[] = [];
      if (!line.user.bankCode?.trim()) missingFields.push('Bank Code');
      if (!line.user.accountHolderName?.trim()) missingFields.push('Account Holder Name');
      if (missingFields.length > 0) {
        bankWarningEmployees.push({
          name: line.user.name,
          email: line.user.email,
          missingFields,
        });
      }
      if (line.pendingWorkingDays !== null) {
        freezeEmployees.push({
          name: line.user.name,
          pendingDays: line.pendingWorkingDays,
          netSalary: net,
        });
      }
    }

    return {
      sumNetSalaryUi: Math.round(sumAllNet * 100) / 100,
      sumNetSalaryExportable: Math.round(sumExportNet * 100) / 100,
      exportableCount: exportable.length,
      excludedCount: excludedEmployees.length,
      excludedEmployees,
      bankWarningCount: bankWarningEmployees.length,
      bankWarningEmployees,
      freezeCount: freezeEmployees.length,
      freezeEmployees,
      periodStatus: period.status,
    };
  }

  async lockPeriod(periodId: string, actorId: string): Promise<void> {
    const lockedAt = new Date();
    const result = await this.prisma.payrollPeriod.updateMany({
      where: { id: periodId, status: PayrollPeriodStatus.DRAFT },
      data: { status: PayrollPeriodStatus.LOCKED, lockedAt, lockedById: actorId },
    });
    if (result.count === 0) {
      const existing = await this.prisma.payrollPeriod.findUnique({ where: { id: periodId } });
      if (!existing) throw new NotFoundException(`Payroll period ${periodId} not found`);
      throw new ConflictException('Period is already locked');
    }
    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'PAYROLL_PERIOD_LOCKED',
        entityType: 'PayrollPeriod',
        entityId: periodId,
        changes: {},
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });
  }

  async unlockPeriod(periodId: string, actorId: string): Promise<void> {
    const result = await this.prisma.payrollPeriod.updateMany({
      where: { id: periodId, status: PayrollPeriodStatus.LOCKED },
      data: { status: PayrollPeriodStatus.DRAFT, lockedAt: null, lockedById: null },
    });
    if (result.count === 0) {
      const existing = await this.prisma.payrollPeriod.findUnique({ where: { id: periodId } });
      if (!existing) throw new NotFoundException(`Payroll period ${periodId} not found`);
      throw new ConflictException('Period is not locked');
    }
    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'PAYROLL_PERIOD_UNLOCKED',
        entityType: 'PayrollPeriod',
        entityId: periodId,
        changes: {},
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });
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
    const period = await this.prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new NotFoundException(`Payroll period ${periodId} not found`);

    const lines = await this.prisma.payrollLine.findMany({
      where: { periodId },
      include: { user: { select: { employeeStatus: true, iban: true, name: true } } },
      orderBy: { displayName: 'asc' },
    });

    const rows: Array<{ name: string; iban: string; net: string }> = [];
    let checksum = 0;

    for (const line of lines) {
      const st = line.user.employeeStatus;
      if (st === EmployeeStatus.HOLD || st === EmployeeStatus.DEACTIVATED) continue;
      if ((line as Record<string, unknown>)['payViaRemittance'] === true) continue;
      const iban = line.user.iban?.trim() ?? '';
      if (!iban) continue;
      const net = Number(line.netSalary);
      checksum += net;
      rows.push({ name: line.user.name, iban, net: net.toFixed(2) });
    }

    checksum = Math.round(checksum * 100) / 100;

    const header = 'Employee Name,IBAN,Net Salary';
    const escape = (s: string): string => {
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const csvBody = `\uFEFF${[
      header,
      ...rows.map((r) => [escape(r.name), escape(r.iban), r.net].join(',')),
    ].join('\r\n')}`;

    await this.prisma.$transaction([
      this.prisma.payrollPeriod.update({
        where: { id: periodId },
        data: { lastExportChecksum: new Prisma.Decimal(checksum), lastExportAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: actorId,
          action: 'PAYROLL_EXPORT_CSV',
          entityType: 'PayrollPeriod',
          entityId: periodId,
          changes: { yearMonth: period.yearMonth, exportRowCount: rows.length, checksum },
          ipAddress: this.requestContext.getIpAddress(),
          userAgent: this.requestContext.getUserAgent(),
        },
      }),
    ]);

    return { csvBody, checksum, rowCount: rows.length, yearMonth: period.yearMonth };
  }

  async exportLocalBankCsvAndLock(
    periodId: string,
    actorId: string,
  ): Promise<{
    csvBody: string;
    checksum: number;
    rowCount: number;
    yearMonth: string;
    validationErrors: Array<{ employeeId: string; name: string; missingFields: string[] }>;
  }> {
    const period = await this.prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new NotFoundException(`Payroll period ${periodId} not found`);

    const lines = await this.prisma.payrollLine.findMany({
      where: { periodId },
      select: { id: true, userId: true, employeeStatus: true, netSalary: true, displayName: true },
      orderBy: { displayName: 'asc' },
    });

    const lineUserIds = lines.map((l) => l.userId);

    // Raw query to access new fields not yet in generated Prisma client
    const bankUsers = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        employeeId: string | null;
        iban: string | null;
        bankCode: string | null;
        accountHolderName: string | null;
      }>
    >`
      SELECT id, name, "employeeId", iban, "bankCode", "accountHolderName"
      FROM users
      WHERE id = ANY(${lineUserIds})
    `;
    const bankUserMap = new Map(bankUsers.map((u) => [u.id, u]));

    // Pre-validation
    const validationErrors: Array<{ employeeId: string; name: string; missingFields: string[] }> =
      [];
    for (const line of lines) {
      const st = line.employeeStatus;
      if (st === EmployeeStatus.HOLD || st === EmployeeStatus.DEACTIVATED) continue;
      if ((line as Record<string, unknown>)['payViaRemittance'] === true) continue;
      const u = bankUserMap.get(line.userId);
      if (!u) continue;
      const missing: string[] = [];
      if (!u.bankCode?.trim()) missing.push('bankCode');
      if (!u.accountHolderName?.trim()) missing.push('accountHolderName');
      if (!u.iban?.trim()) missing.push('iban');
      if (missing.length > 0) {
        validationErrors.push({
          employeeId: u.employeeId ?? '',
          name: u.name,
          missingFields: missing,
        });
      }
    }

    if (validationErrors.length > 0) {
      return {
        csvBody: '',
        checksum: 0,
        rowCount: 0,
        yearMonth: period.yearMonth,
        validationErrors,
      };
    }

    const escape = (s: string): string => {
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const rows: string[] = [];
    let checksum = 0;

    for (const line of lines) {
      const st = line.employeeStatus;
      if (st === EmployeeStatus.HOLD || st === EmployeeStatus.DEACTIVATED) continue;
      if ((line as Record<string, unknown>)['payViaRemittance'] === true) continue;
      const u = bankUserMap.get(line.userId);
      if (!u?.iban?.trim()) continue;
      const net = Number(line.netSalary);
      checksum += net;
      rows.push(
        [
          escape(u.employeeId ?? ''),
          'PAY',
          'BA',
          escape(u.bankCode ?? ''),
          escape(u.accountHolderName ?? u.name),
          escape(u.iban.trim()),
          net.toFixed(2),
        ].join(','),
      );
    }

    checksum = Math.round(checksum * 100) / 100;
    const header =
      'Customer Reference,Payment Type,Processing Mode,Beneficiary Bank Code,Beneficiary Name,Beneficiary Account Number,Payment Amount';
    const csvBody = `\uFEFF${header}\r\n${rows.join('\r\n')}`;

    await this.prisma.$transaction([
      this.prisma.payrollPeriod.update({
        where: { id: periodId },
        data: { lastExportChecksum: new Prisma.Decimal(checksum), lastExportAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: actorId,
          action: 'PAYROLL_LOCAL_BANK_EXPORT',
          entityType: 'PayrollPeriod',
          entityId: periodId,
          changes: { yearMonth: period.yearMonth, exportRowCount: rows.length, checksum },
          ipAddress: this.requestContext.getIpAddress(),
          userAgent: this.requestContext.getUserAgent(),
        },
      }),
    ]);

    return {
      csvBody,
      checksum,
      rowCount: rows.length,
      yearMonth: period.yearMonth,
      validationErrors: [],
    };
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
    if (dto.payViaRemittance !== undefined) {
      applyDec(
        'payViaRemittance',
        ((line as Record<string, unknown>)['payViaRemittance'] as boolean | null) ?? false,
        dto.payViaRemittance,
      );
      (data as Record<string, unknown>)['payViaRemittance'] = dto.payViaRemittance;
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
    if (dto.baseSalaryMonthly !== undefined) {
      applyDec('baseSalaryMonthly', line.baseSalaryMonthly, dto.baseSalaryMonthly);
      data.baseSalaryMonthly = new Prisma.Decimal(dto.baseSalaryMonthly);
    }
    if (dto.incomeTaxAmount !== undefined) {
      const taxAmt = dto.incomeTaxAmount ?? null;
      applyDec('taxPercentOverride', line.taxPercentOverride, taxAmt);
      data.taxPercentOverride = taxAmt === null ? null : new Prisma.Decimal(taxAmt);
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
    if (dto.consultantPayMode !== undefined) {
      const nextMode = dto.consultantPayMode ?? null;
      if (line.consultantPayMode !== nextMode) {
        audits.push({
          lineId: line.id,
          field: 'consultantPayMode',
          oldValue: line.consultantPayMode ?? '',
          newValue: nextMode ?? '',
          actorId,
        });
      }
      data.consultantPayMode = nextMode;
    }
    if (dto.contractedDailyRate !== undefined) {
      applyDec('contractedDailyRate', line.contractedDailyRate, dto.contractedDailyRate ?? null);
      data.contractedDailyRate =
        dto.contractedDailyRate != null ? new Prisma.Decimal(dto.contractedDailyRate) : null;
    }
    if (dto.contractedHourlyRate !== undefined) {
      applyDec('contractedHourlyRate', line.contractedHourlyRate, dto.contractedHourlyRate ?? null);
      data.contractedHourlyRate =
        dto.contractedHourlyRate != null ? new Prisma.Decimal(dto.contractedHourlyRate) : null;
    }
    if (dto.hoursWorked !== undefined) {
      applyDec('hoursWorked', line.hoursWorked, dto.hoursWorked ?? null);
      data.hoursWorked = dto.hoursWorked != null ? new Prisma.Decimal(dto.hoursWorked) : null;
    }
    if (dto.lunchDaysOverride !== undefined) {
      applyDec(
        'lunchDaysOverride',
        ((line as Record<string, unknown>)['lunchDaysOverride'] as number | null) ?? null,
        dto.lunchDaysOverride ?? null,
      );
      (data as Record<string, unknown>)['lunchDaysOverride'] = dto.lunchDaysOverride ?? null;
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
