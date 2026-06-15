import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from 'src/common/services/request-context.service';
import { isProductionEnv } from 'src/common/environment';
import {
  AdvanceSalaryRepaymentStatus,
  EmployeeStatus,
  LoanRepaymentStatus,
  PayrollPeriodStatus,
  Prisma,
  ReimbursementProcessingType,
  ReimbursementStatus,
} from '@prisma/client';
import { PrismaService } from 'src/prisma';
import { SystemConfigService } from 'src/system-config';
import { countWeekdaysInUtcMonth, PayrollCalculationService } from './payroll-calculation.service';
import { RepaymentAutoDeductService } from 'src/scheduler/repayment-auto-deduct.service';
import { SalaryHoldsService } from 'src/salary-holds/salary-holds.service';
import type { ListHeldSalariesDto } from 'src/salary-holds/dto/list-held-salaries.dto';
import type { CreatePayrollPeriodDto } from './dto/create-payroll-period.dto';
import type { RejectPayrollReviewDto } from './dto/reject-payroll-review.dto';
import type { PayrollLinesQueryDto } from './dto/payroll-lines-query.dto';
import type { UpdatePayrollLineDto } from './dto/update-payroll-line.dto';
import type { UpsertPayrollProfileDto } from './dto/upsert-payroll-profile.dto';
import {
  PayrollSubmittedForReviewEvent,
  PayrollAuthorizedEvent,
  PayrollAuthorizationRevokedEvent,
  PayrollReviewRejectedEvent,
  PayrollRecalledFromReviewEvent,
  PayrollTempAuthorizerDesignatedEvent,
} from './events/payroll-review.events';

const VALID_TRANSITIONS: Record<PayrollPeriodStatus, PayrollPeriodStatus[]> = {
  DRAFT: [PayrollPeriodStatus.PENDING_REVIEW],
  PENDING_REVIEW: [PayrollPeriodStatus.DRAFT, PayrollPeriodStatus.AUTHORIZED],
  AUTHORIZED: [PayrollPeriodStatus.PENDING_REVIEW, PayrollPeriodStatus.LOCKED],
  LOCKED: [PayrollPeriodStatus.AUTHORIZED],
};

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ExpiredHoldAlert {
  holdId: string;
  userId: string;
  name: string;
  heldBalance: number;
  endDate: string;
}

const MONTH_TOKENS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

/** "2026-05" → "MAY-2026" — the human-friendly token a user types to confirm a purge. */
function monthToken(yearMonth: string): string {
  const [y, m] = yearMonth.split('-');
  const name = MONTH_TOKENS[Number(m) - 1] ?? m;
  return `${name}-${y}`;
}

/**
 * Shape a period's aggregated line sums (+ paid head-count) into the analytics
 * payload. `Total Deductions` uses the authoritative `totalDeductions` column,
 * and "penaltiesOther" is the reconciling remainder so the parts always add up.
 */
function buildPeriodMetrics(
  sum: Partial<Prisma.PayrollLineSumAggregateOutputType> | undefined,
  paidCount: number,
) {
  const num = (v: Prisma.Decimal | null | undefined): number => Number(v ?? 0);
  const tax = num(sum?.taxDeduction);
  const loan = num(sum?.loanDeduction) + num(sum?.advanceDeduction);
  const food = num(sum?.foodDeduction);
  const totalDeductions = num(sum?.totalDeductions);
  const penaltiesOther = round2(totalDeductions - tax - loan - food);
  const reimbursementHr = num(sum?.reimbursementFromHr);
  const reimbursementManual = num(sum?.reimbursementManual);

  return {
    metrics: {
      totalUsersPaid: paidCount,
      totalTaxesPaid: round2(tax),
      totalDeductions: round2(totalDeductions),
      totalReimbursements: round2(reimbursementHr + reimbursementManual),
    },
    deductionBreakdown: {
      tax: round2(tax),
      loan: round2(loan),
      food: round2(food),
      penaltiesOther,
    },
    reimbursementBreakdown: {
      hr: round2(reimbursementHr),
      manual: round2(reimbursementManual),
    },
  };
}

const _LINE_AUDIT_FIELDS = [
  'extraWorkingDays',
  'pendingWorkingDays',
  'lunchDaysOverride',
  'performanceBonus',
  'reimbursementManual',
  'includeHrReimbursements',
  'paymentMode',
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

type LineAuditField = (typeof _LINE_AUDIT_FIELDS)[number];

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payrollCalculation: PayrollCalculationService,
    private readonly requestContext: RequestContextService,
    private readonly systemConfig: SystemConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly repaymentAutoDeduct: RepaymentAutoDeductService,
    private readonly salaryHolds: SalaryHoldsService,
  ) {}

  async listPeriods() {
    return this.prisma.payrollPeriod.findMany({
      select: {
        id: true,
        yearMonth: true,
        status: true,
        createdAt: true,
        lockedAt: true,
        submittedForReviewAt: true,
        authorizedAt: true,
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
        lunchDaysApplied: true,
        consultantTaxRateApplied: true,
        defaultTaxPercent: true,
        submittedForReviewAt: true,
        submittedForReviewById: true,
        submittedForReviewBy: { select: { name: true } },
        authorizedAt: true,
        authorizedById: true,
        authorizedBy: { select: { name: true } },
        tempAuthorizerId: true,
        tempAuthorizer: { select: { name: true } },
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
      consultantTaxRateApplied: period.consultantTaxRateApplied.toString(),
      defaultTaxPercent: period.defaultTaxPercent.toString(),
      lastExportChecksum: period.lastExportChecksum?.toString() ?? null,
      submittedForReviewByName: period.submittedForReviewBy?.name ?? null,
      authorizedByName: period.authorizedBy?.name ?? null,
      tempAuthorizerName: period.tempAuthorizer?.name ?? null,
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
    if (dto.paymentMode !== undefined) {
      (data as Record<string, unknown>).paymentMode = dto.paymentMode;
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
        ...(dto.paymentMode !== undefined ? { paymentMode: dto.paymentMode } : {}),
      },
    });
    const fieldsUpdated: string[] = [
      ...(dto.rentalAllowanceMonthly !== undefined ? ['rentalAllowanceMonthly'] : []),
      ...(dto.commuteAllowanceMonthly !== undefined ? ['commuteAllowanceMonthly'] : []),
      ...(dto.defaultConsultantPayMode !== undefined ? ['defaultConsultantPayMode'] : []),
      ...(dto.defaultDailyRate !== undefined ? ['defaultDailyRate'] : []),
      ...(dto.defaultHourlyRate !== undefined ? ['defaultHourlyRate'] : []),
      ...(dto.paymentMode !== undefined ? ['paymentMode'] : []),
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
      paymentMode: ((profile as Record<string, unknown>).paymentMode as string) ?? 'LOCAL_BANK',
    };
  }

  async createPeriod(dto: CreatePayrollPeriodDto, actorId: string) {
    const existing = await this.prisma.payrollPeriod.findUnique({
      where: { yearMonth: dto.yearMonth },
    });
    if (existing) {
      throw new ConflictException(`Payroll period ${dto.yearMonth} already exists`);
    }
    const payrollConfig = await this.systemConfig.getPayrollConfig();
    const lunchDaysApplied = await this.systemConfig.getLunchDaysForMonth(dto.yearMonth);
    const period = await this.prisma.payrollPeriod.create({
      data: {
        yearMonth: dto.yearMonth,
        lunchRatePerDay: new Prisma.Decimal(dto.lunchRatePerDay ?? payrollConfig.defaultLunchRate),
        lunchDaysApplied,
        consultantTaxRateApplied: new Prisma.Decimal(payrollConfig.consultantTaxRate),
        ...(dto.defaultTaxPercent !== undefined
          ? { defaultTaxPercent: new Prisma.Decimal(dto.defaultTaxPercent) }
          : {}),
      },
      select: {
        id: true,
        yearMonth: true,
        status: true,
        lunchRatePerDay: true,
        lunchDaysApplied: true,
        consultantTaxRateApplied: true,
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
      consultantTaxRateApplied: period.consultantTaxRateApplied.toString(),
      defaultTaxPercent: period.defaultTaxPercent.toString(),
    };
  }

  /**
   * [STAGING ONLY] Permanently purge a payroll period and re-open its month so
   * it can be rebuilt from scratch. Used by QA to tear down and re-run cycles.
   *
   * Two-part teardown:
   *  1. Reverse the loan / advance-salary installments this period collected for
   *     its month — flips them DEDUCTED → PENDING, restores the balances, and
   *     removes the payroll-deduction ledger rows. The loan / advance /
   *     reimbursement REQUESTS themselves are NOT deleted; only the per-month
   *     deduction is undone, so recreating the period re-collects it.
   *  2. Delete every PayrollLine (PayrollAdjustmentAudit rows follow via FK
   *     cascade) and the PayrollPeriod row.
   *
   * The reversal runs first: if it fails the period is left intact and the
   * caller can safely retry. Hard-gated to non-production via
   * {@link StagingOnlyGuard} on the route, with a defensive re-check here.
   * Requires a matching typed confirmation.
   */
  async deletePeriodStaging(
    periodId: string,
    confirmation: string,
    actorId: string,
  ): Promise<{
    success: true;
    yearMonth: string;
    deletedLines: number;
    reopenedLoanInstallments: number;
    reopenedAdvanceSalaryInstallments: number;
  }> {
    // Defense in depth — the route is StagingOnlyGuard-gated, but a destructive
    // purge must never run in production even if reached through another path.
    if (isProductionEnv()) {
      throw new ForbiddenException('Payroll period deletion is not available in production');
    }

    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: { id: true, yearMonth: true, status: true },
    });
    if (!period) throw new NotFoundException(`Payroll period ${periodId} not found`);

    const provided = confirmation.trim().toUpperCase();
    const expectedToken = monthToken(period.yearMonth);
    if (provided !== 'DELETE' && provided !== expectedToken) {
      throw new BadRequestException(
        `Confirmation must be "DELETE" or "${expectedToken}" to purge this period`,
      );
    }

    // 1. Re-open the month's collected loan / advance installments BEFORE the
    // destructive delete, so a failure here aborts with the period still intact.
    const reopened = await this.repaymentAutoDeduct.reverseRepaymentsForPeriod(
      period.yearMonth,
      actorId,
    );

    // 2. Atomic purge of the payroll period. PayrollLine.period and
    // PayrollAdjustmentAudit.line both declare onDelete: Cascade, so deleting
    // the period row alone would suffice; we delete lines explicitly first only
    // to report an accurate count.
    const results = await this.prisma.$transaction([
      this.prisma.payrollLine.deleteMany({ where: { periodId } }),
      this.prisma.payrollPeriod.delete({ where: { id: periodId } }),
      this.prisma.auditLog.create({
        data: {
          userId: actorId,
          action: 'PAYROLL_PERIOD_DELETED_STAGING',
          entityType: 'PayrollPeriod',
          entityId: periodId,
          changes: {
            yearMonth: period.yearMonth,
            status: period.status,
            reopenedLoanInstallments: reopened.loanInstallments,
            reopenedAdvanceSalaryInstallments: reopened.advanceSalaryInstallments,
          },
          ipAddress: this.requestContext.getIpAddress(),
          userAgent: this.requestContext.getUserAgent(),
        },
      }),
    ]);
    const deletedLines = results[0].count;

    this.logger.warn(
      `[STAGING] Payroll period ${period.yearMonth} (${periodId}) purged by ${actorId}: ` +
        `${deletedLines} lines deleted; re-opened ${reopened.loanInstallments} loan + ` +
        `${reopened.advanceSalaryInstallments} advance-salary installments`,
    );

    return {
      success: true,
      yearMonth: period.yearMonth,
      deletedLines,
      reopenedLoanInstallments: reopened.loanInstallments,
      reopenedAdvanceSalaryInstallments: reopened.advanceSalaryInstallments,
    };
  }

  private async assertPeriodEditable(status: PayrollPeriodStatus, actorId?: string): Promise<void> {
    if (status === PayrollPeriodStatus.LOCKED) {
      throw new ForbiddenException('This payroll period is locked and cannot be changed');
    }
    if (status === PayrollPeriodStatus.AUTHORIZED) {
      throw new ForbiddenException(
        'This payroll period is authorized. Revoke authorization to make changes.',
      );
    }
    if (status === PayrollPeriodStatus.PENDING_REVIEW) {
      if (!actorId) {
        throw new ForbiddenException('Period is pending review');
      }
      const config = await this.systemConfig.getPayrollConfig();
      const isAuthorizer = config.primaryAuthorizerId === actorId;
      const isSilentReviewer = config.silentReviewerIds.includes(actorId);
      if (!isAuthorizer && !isSilentReviewer) {
        throw new ForbiddenException(
          'Only the primary authorizer or silent reviewers can edit during review',
        );
      }
    }
  }

  private assertValidTransition(from: PayrollPeriodStatus, to: PayrollPeriodStatus): void {
    if (!VALID_TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(`Cannot transition payroll period from ${from} to ${to}`);
    }
  }

  private assertExportable(status: PayrollPeriodStatus): void {
    if (status !== PayrollPeriodStatus.AUTHORIZED && status !== PayrollPeriodStatus.LOCKED) {
      throw new ForbiddenException(
        'Exports are only available after the payroll period has been authorized',
      );
    }
  }

  async validatePayrollPeriodEditable(periodId: string, actorId: string): Promise<void> {
    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: { status: true },
    });
    if (!period) {
      throw new NotFoundException(`Payroll period ${periodId} not found`);
    }
    await this.assertPeriodEditable(period.status, actorId);
  }

  private async assertActorIsPayrollAdmin(actorId: string): Promise<void> {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: {
        isSystem: true,
        userRoleAssignments: { select: { role: { select: { name: true } } } },
      },
    });
    if (!actor) {
      throw new NotFoundException(`User ${actorId} not found`);
    }
    const roleNames = actor.userRoleAssignments.map((a) => a.role.name);
    const isAdmin = actor.isSystem === true || roleNames.includes('ADMIN');
    if (!isAdmin) {
      throw new ForbiddenException('Only administrators can designate a temporary authorizer');
    }
  }

  // ─── Authorization Lifecycle ─────────────────────────────────

  async submitForReview(periodId: string, actorId: string): Promise<void> {
    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: { id: true, status: true, yearMonth: true },
    });
    if (!period) throw new NotFoundException(`Payroll period ${periodId} not found`);
    this.assertValidTransition(period.status, PayrollPeriodStatus.PENDING_REVIEW);

    const config = await this.systemConfig.getPayrollConfig();
    if (!config.primaryAuthorizerId) {
      throw new BadRequestException(
        'No primary authorizer configured. Please set one in Payroll Settings before submitting for review.',
      );
    }

    const authorizer = await this.prisma.user.findUnique({
      where: { id: config.primaryAuthorizerId },
      select: { id: true, name: true, email: true },
    });
    if (!authorizer) {
      throw new BadRequestException(
        'Configured primary authorizer user not found. Please update Payroll Settings.',
      );
    }

    const submitter = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true, email: true },
    });

    await this.prisma.payrollPeriod.update({
      where: { id: periodId },
      data: {
        status: PayrollPeriodStatus.PENDING_REVIEW,
        submittedForReviewAt: new Date(),
        submittedForReviewById: actorId,
      },
    });

    this.eventEmitter.emit(
      'payroll.submitted-for-review',
      new PayrollSubmittedForReviewEvent({
        periodId,
        yearMonth: period.yearMonth,
        submitterId: actorId,
        submitterName: submitter?.name ?? 'Unknown',
        submitterEmail: submitter?.email ?? '',
        authorizerId: authorizer.id,
        authorizerEmail: authorizer.email,
        authorizerName: authorizer.name,
      }),
    );

    this.logger.log(
      `Payroll ${period.yearMonth} submitted for review by ${actorId}, authorizer: ${authorizer.id}`,
    );
  }

  async authorizePayroll(periodId: string, actorId: string): Promise<void> {
    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: {
        id: true,
        status: true,
        yearMonth: true,
        tempAuthorizerId: true,
        submittedForReviewById: true,
      },
    });
    if (!period) throw new NotFoundException(`Payroll period ${periodId} not found`);
    this.assertValidTransition(period.status, PayrollPeriodStatus.AUTHORIZED);

    const config = await this.systemConfig.getPayrollConfig();
    const isPrimary = config.primaryAuthorizerId === actorId;
    const isTemp = period.tempAuthorizerId === actorId;
    if (!isPrimary && !isTemp) {
      throw new ForbiddenException('Only the primary or designated temp authorizer can approve');
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    });

    await this.prisma.payrollPeriod.update({
      where: { id: periodId },
      data: {
        status: PayrollPeriodStatus.AUTHORIZED,
        authorizedAt: new Date(),
        authorizedById: actorId,
      },
    });

    // Notify HR submitter
    if (period.submittedForReviewById) {
      const submitter = await this.prisma.user.findUnique({
        where: { id: period.submittedForReviewById },
        select: { email: true, name: true },
      });
      if (submitter) {
        this.eventEmitter.emit(
          'payroll.authorized',
          new PayrollAuthorizedEvent({
            periodId,
            yearMonth: period.yearMonth,
            authorizerId: actorId,
            authorizerName: actor?.name ?? 'Unknown',
            submitterEmail: submitter.email,
            submitterName: submitter.name,
          }),
        );
      }
    }

    this.logger.log(`Payroll ${period.yearMonth} authorized by ${actorId}`);
  }

  async revokeAuthorization(periodId: string, actorId: string): Promise<void> {
    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: {
        id: true,
        status: true,
        yearMonth: true,
        tempAuthorizerId: true,
        submittedForReviewById: true,
      },
    });
    if (!period) throw new NotFoundException(`Payroll period ${periodId} not found`);
    this.assertValidTransition(period.status, PayrollPeriodStatus.PENDING_REVIEW);

    const config = await this.systemConfig.getPayrollConfig();
    const isPrimary = config.primaryAuthorizerId === actorId;
    const isTemp = period.tempAuthorizerId === actorId;
    if (!isPrimary && !isTemp) {
      throw new ForbiddenException(
        'Only the primary or designated temp authorizer can revoke authorization',
      );
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    });

    await this.prisma.payrollPeriod.update({
      where: { id: periodId },
      data: {
        status: PayrollPeriodStatus.PENDING_REVIEW,
        authorizedAt: null,
        authorizedById: null,
      },
    });

    if (period.submittedForReviewById) {
      const submitter = await this.prisma.user.findUnique({
        where: { id: period.submittedForReviewById },
        select: { email: true, name: true },
      });
      if (submitter) {
        this.eventEmitter.emit(
          'payroll.authorization-revoked',
          new PayrollAuthorizationRevokedEvent({
            periodId,
            yearMonth: period.yearMonth,
            actorId,
            actorName: actor?.name ?? 'Unknown',
            submitterEmail: submitter.email,
            submitterName: submitter.name,
          }),
        );
      }
    }

    this.logger.log(`Payroll ${period.yearMonth} authorization revoked by ${actorId}`);
  }

  async recallFromReview(periodId: string, actorId: string): Promise<void> {
    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: {
        id: true,
        status: true,
        yearMonth: true,
        submittedForReviewById: true,
        tempAuthorizerId: true,
      },
    });
    if (!period) throw new NotFoundException(`Payroll period ${periodId} not found`);
    this.assertValidTransition(period.status, PayrollPeriodStatus.DRAFT);

    if (period.submittedForReviewById !== actorId) {
      throw new ForbiddenException('Only the original HR submitter can recall from review');
    }

    const submitter = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true, email: true },
    });

    const payrollConfig = await this.systemConfig.getPayrollConfig();
    const authorizer = payrollConfig.primaryAuthorizerId
      ? await this.prisma.user.findUnique({
          where: { id: payrollConfig.primaryAuthorizerId },
          select: { id: true, name: true, email: true },
        })
      : null;

    let tempAuthorizerEmail: string | null = null;
    if (period.tempAuthorizerId && period.tempAuthorizerId !== payrollConfig.primaryAuthorizerId) {
      const temp = await this.prisma.user.findUnique({
        where: { id: period.tempAuthorizerId },
        select: { email: true },
      });
      if (temp) {
        tempAuthorizerEmail = temp.email;
      }
    }

    await this.prisma.payrollPeriod.update({
      where: { id: periodId },
      data: {
        status: PayrollPeriodStatus.DRAFT,
        submittedForReviewAt: null,
        submittedForReviewById: null,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'PAYROLL_RECALLED_FROM_REVIEW',
        entityType: 'PayrollPeriod',
        entityId: periodId,
        changes: { yearMonth: period.yearMonth },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    if (authorizer) {
      this.eventEmitter.emit(
        'payroll.recalled-from-review',
        new PayrollRecalledFromReviewEvent({
          periodId,
          yearMonth: period.yearMonth,
          submitterId: actorId,
          submitterName: submitter?.name ?? 'Unknown',
          submitterEmail: submitter?.email ?? '',
          authorizerId: authorizer.id,
          authorizerEmail: authorizer.email,
          tempAuthorizerEmail,
        }),
      );
    }

    this.logger.log(`Payroll ${period.yearMonth} recalled from review by ${actorId}`);
  }

  async rejectReview(
    periodId: string,
    actorId: string,
    dto: RejectPayrollReviewDto,
  ): Promise<void> {
    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: {
        id: true,
        status: true,
        yearMonth: true,
        tempAuthorizerId: true,
        submittedForReviewById: true,
      },
    });
    if (!period) throw new NotFoundException(`Payroll period ${periodId} not found`);
    this.assertValidTransition(period.status, PayrollPeriodStatus.DRAFT);

    const submitterId = period.submittedForReviewById;
    if (!submitterId) {
      throw new BadRequestException('This payroll has no submitter to return to');
    }

    const config = await this.systemConfig.getPayrollConfig();
    const isPrimary = config.primaryAuthorizerId === actorId;
    const isTemp = period.tempAuthorizerId === actorId;
    if (!isPrimary && !isTemp) {
      throw new ForbiddenException(
        'Only the primary or designated temp authorizer can send back for changes',
      );
    }

    const rejector = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    });

    const submitter = await this.prisma.user.findUnique({
      where: { id: submitterId },
      select: { email: true, name: true },
    });
    if (!submitter) {
      throw new NotFoundException('Original submitter not found');
    }

    const comment = dto.comment?.trim() ? dto.comment.trim() : undefined;

    await this.prisma.payrollPeriod.update({
      where: { id: periodId },
      data: {
        status: PayrollPeriodStatus.DRAFT,
        submittedForReviewAt: null,
        submittedForReviewById: null,
      },
    });

    this.eventEmitter.emit(
      'payroll.rejected-from-review',
      new PayrollReviewRejectedEvent({
        periodId,
        yearMonth: period.yearMonth,
        rejectorId: actorId,
        rejectorName: rejector?.name ?? 'Unknown',
        submitterId,
        submitterEmail: submitter.email,
        submitterName: submitter.name,
        comment,
      }),
    );

    this.logger.log(`Payroll ${period.yearMonth} sent back for changes by ${actorId}`);
  }

  async designateTempAuthorizer(
    periodId: string,
    tempAuthorizerId: string,
    actorId: string,
  ): Promise<void> {
    await this.assertActorIsPayrollAdmin(actorId);

    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: { id: true, status: true, yearMonth: true },
    });
    if (!period) throw new NotFoundException(`Payroll period ${periodId} not found`);

    if (period.status !== PayrollPeriodStatus.PENDING_REVIEW) {
      throw new BadRequestException('Temp authorizer can only be designated during review');
    }

    const tempUser = await this.prisma.user.findUnique({
      where: { id: tempAuthorizerId },
      select: { id: true, name: true },
    });
    if (!tempUser) throw new NotFoundException(`User ${tempAuthorizerId} not found`);

    await this.prisma.payrollPeriod.update({
      where: { id: periodId },
      data: { tempAuthorizerId },
    });

    this.eventEmitter.emit(
      'payroll.temp-authorizer-designated',
      new PayrollTempAuthorizerDesignatedEvent({
        periodId,
        yearMonth: period.yearMonth,
        actorId,
        tempAuthorizerId,
      }),
    );

    this.logger.log(
      `Temp authorizer ${tempAuthorizerId} designated for payroll ${period.yearMonth} by ${actorId}`,
    );
  }

  async refreshLines(
    periodId: string,
    actorId: string,
  ): Promise<{ created: number; updated: number }> {
    const period = await this.prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) {
      throw new NotFoundException(`Payroll period ${periodId} not found`);
    }
    await this.assertPeriodEditable(period.status, actorId);

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

      const paymentModeDefault =
        ((profile as Record<string, unknown> | undefined)?.paymentMode as string | undefined) ??
        'LOCAL_BANK';

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
            paymentMode: paymentModeDefault as any,
            ...consultantData,
          } as any,
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
            paymentMode: paymentModeDefault as any,
            ...consultantData,
          } as any,
        });
        created++;
      }
    }

    await this.recalculatePeriod(periodId, actorId);
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

  async refreshSingleLine(periodId: string, lineId: string, actorId: string): Promise<void> {
    const period = await this.prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new NotFoundException(`Payroll period ${periodId} not found`);
    await this.assertPeriodEditable(period.status, actorId);

    const line = await this.prisma.payrollLine.findUnique({ where: { id: lineId } });
    if (!line || line.periodId !== periodId) {
      throw new NotFoundException(`Payroll line ${lineId} not found in period ${periodId}`);
    }

    const standardWorkingDays = countWeekdaysInUtcMonth(period.yearMonth);

    const user = await this.prisma.user.findUnique({
      where: { id: line.userId },
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
    if (!user) throw new NotFoundException(`User for line ${lineId} not found`);

    const taxRows = await this.prisma.$queryRaw<{ incomeTaxAmount: string | null }[]>`
      SELECT "incomeTaxAmount"::text FROM users WHERE id = ${user.id}
    `;
    const userTaxAmount = taxRows[0]?.incomeTaxAmount ? Number(taxRows[0].incomeTaxAmount) : 0;

    const profile = await this.prisma.payrollProfile.findUnique({ where: { userId: user.id } });
    const base = user.baseSalaryMonthly ?? new Prisma.Decimal(0);
    const rental = profile?.rentalAllowanceMonthly ?? new Prisma.Decimal(0);
    const commute = profile?.commuteAllowanceMonthly ?? new Prisma.Decimal(0);
    const isConsultant = user.employeeType === 'CONSULTANT';
    const userTaxForLine = isConsultant ? 0 : userTaxAmount;
    const paymentModeDefault =
      ((profile as Record<string, unknown> | undefined)?.paymentMode as string | undefined) ??
      'LOCAL_BANK';

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

    await this.prisma.payrollLine.update({
      where: { id: lineId },
      data: {
        displayName: user.name,
        employeeCode: user.employeeId,
        departments: user.departments,
        designation: user.designation,
        employeeType: user.employeeType,
        employeeStatus: user.employeeStatus,
        baseSalaryMonthly: base,
        rentalAllowanceMonthly: rental,
        commuteAllowanceMonthly: commute,
        standardWorkingDays,
        taxPercentOverride: new Prisma.Decimal(userTaxForLine),
        paymentMode: paymentModeDefault as any,
        ...consultantData,
      } as any,
    });

    const payrollConfig = await this.systemConfig.getPayrollConfig();
    const periodFresh = await this.prisma.payrollPeriod.findUniqueOrThrow({
      where: { id: periodId },
    });
    await this.recalculateLineById(
      lineId,
      periodFresh,
      payrollConfig.consultantTaxRate,
      periodFresh.lunchDaysApplied,
    );

    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'PAYROLL_LINE_SYNCED',
        entityType: 'PayrollLine',
        entityId: lineId,
        changes: { yearMonth: period.yearMonth, targetUserId: user.id, targetUserName: user.name },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });
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
    const monthStartStr = `${y}-${String(m).padStart(2, '0')}-01`;
    const monthEndStr = `${y}-${String(m).padStart(2, '0')}-${String(monthEnd.getUTCDate()).padStart(2, '0')}`;

    // Source: dynamic_requests (typeKey='LEAVE'). Legacy leave_requests rows were
    // mirrored here by migration 20260520000001_migrate_leaves_data. Date range is
    // stored in formData.dateRange as ISO strings; we compare the first 10 chars
    // (YYYY-MM-DD) lexicographically, which is equivalent to chronological order.
    const leaves = await this.prisma.$queryRaw<
      Array<{
        category: string | null;
        unpaidDays: string | null;
        startDate: string;
        endDate: string;
      }>
    >`
      SELECT
        "formData"->>'category'                                    AS "category",
        "formData"->>'unpaidDays'                                  AS "unpaidDays",
        substring("formData"->'dateRange'->>'from' from 1 for 10)  AS "startDate",
        substring("formData"->'dateRange'->>'to'   from 1 for 10)  AS "endDate"
      FROM "dynamic_requests"
      WHERE "typeKey" = 'LEAVE'
        AND "requesterId" = ${userId}
        AND "status" = 'APPROVED'
        AND substring("formData"->'dateRange'->>'from' from 1 for 10) <= ${monthEndStr}
        AND substring("formData"->'dateRange'->>'to'   from 1 for 10) >= ${monthStartStr}
    `;

    let paidLeaveDays = 0;
    let unpaidLeaveDays = 0;

    for (const l of leaves) {
      const unpaid = Number(l.unpaidDays ?? 0);
      const startDate = new Date(`${l.startDate}T00:00:00.000Z`);
      const endDate = new Date(`${l.endDate}T23:59:59.999Z`);
      // Total calendar days capped to the month window
      const effectiveStart = startDate < monthStart ? monthStart : startDate;
      const effectiveEnd = endDate > monthEnd ? monthEnd : endDate;
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

  private async sumActiveLoanRepayments(userId: string, yearMonth: string): Promise<number> {
    // Loan deductions are realized (PENDING → DEDUCTED) when the bank sheet is
    // exported, which can happen while the period is still recalculable. Include
    // DEDUCTED installments and COMPLETED loans so the payroll line keeps showing
    // the month's deduction after it has been collected/settled.
    const repayments = await this.prisma.loanRepayment.findMany({
      where: {
        scheduledMonth: yearMonth,
        status: { in: [LoanRepaymentStatus.PENDING, LoanRepaymentStatus.DEDUCTED] },
        request: {
          requesterId: userId,
          status: { in: ['DISBURSED', 'REPAYING', 'COMPLETED'] },
        },
      },
      select: { amount: true },
    });

    const total = repayments.reduce((sum, r) => sum + Number(r.amount), 0);
    return Math.round(total * 100) / 100;
  }

  private async sumActiveAdvanceSalaryRepayments(
    userId: string,
    yearMonth: string,
  ): Promise<number> {
    const repayments = await this.prisma.advanceSalaryRepayment.findMany({
      where: {
        scheduledMonth: yearMonth,
        status: {
          in: [AdvanceSalaryRepaymentStatus.PENDING, AdvanceSalaryRepaymentStatus.DEDUCTED],
        },
        request: {
          requesterId: userId,
          status: { in: ['DISBURSED', 'REPAYING', 'COMPLETED'] },
        },
      },
      select: { amount: true },
    });

    const total = repayments.reduce((sum, r) => sum + Number(r.amount), 0);
    return Math.round(total * 100) / 100;
  }

  private async sumHrReimbursementsForSalaryMonth(
    userId: string,
    salaryMonth: string,
  ): Promise<number> {
    // Non-installment reimbursements: matched by salaryMonth on the request itself
    const directRows = await this.prisma.reimbursementRequest.findMany({
      where: {
        employeeId: userId,
        salaryMonth,
        processingType: ReimbursementProcessingType.SALARY_ADJUSTMENT,
        status: { in: [ReimbursementStatus.APPROVED, ReimbursementStatus.PROCESSED] },
        hasInstallmentPlan: false,
      },
      select: { approvedAmount: true, amount: true },
    });

    // Installment reimbursements: sum only the installments scheduled for this month
    const installmentRows = await this.prisma.reimbursementInstallment.findMany({
      where: {
        scheduledMonth: salaryMonth,
        reimbursement: {
          employeeId: userId,
          processingType: ReimbursementProcessingType.SALARY_ADJUSTMENT,
          status: { in: [ReimbursementStatus.APPROVED, ReimbursementStatus.PROCESSED] },
          hasInstallmentPlan: true,
        },
      },
      select: { amount: true },
    });

    // Dynamic-request reimbursement installments (workflow-driven REIMBURSEMENT type)
    const dynamicInstallmentRows = await this.prisma.reimbursementInstallment.findMany({
      where: {
        scheduledMonth: salaryMonth,
        dynamicRequestId: { not: null },
        dynamicRequest: {
          requesterId: userId,
          typeKey: 'REIMBURSEMENT',
          status: 'APPROVED',
          formData: {
            path: ['processingType'],
            equals: ReimbursementProcessingType.SALARY_ADJUSTMENT,
          },
        },
      },
      select: { amount: true },
    });

    let sum = 0;
    for (const r of directRows) {
      sum += Number(r.approvedAmount ?? r.amount);
    }
    for (const inst of installmentRows) {
      sum += Number(inst.amount);
    }
    for (const inst of dynamicInstallmentRows) {
      sum += Number(inst.amount);
    }
    return Math.round(sum * 100) / 100;
  }

  async recalculatePeriod(
    periodId: string,
    actorId?: string,
  ): Promise<{ expiredHolds: ExpiredHoldAlert[] }> {
    const period = await this.prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) {
      throw new NotFoundException(`Payroll period ${periodId} not found`);
    }
    await this.assertPeriodEditable(period.status, actorId);

    // Process past-due reimbursement installments before computing line
    // deductions. (Loan + advance-salary deductions are NOT realized here — they
    // are realized when the bank sheet is exported — but their PENDING/DEDUCTED
    // installments are still summed into the line below.)
    await this.repaymentAutoDeduct.autoDeductPastDue();

    const payrollConfig = await this.systemConfig.getPayrollConfig();
    const lunchDaysApplied = await this.systemConfig.getLunchDaysForMonth(period.yearMonth);

    await this.prisma.payrollPeriod.update({
      where: { id: periodId },
      data: {
        lunchRatePerDay: new Prisma.Decimal(payrollConfig.defaultLunchRate),
        lunchDaysApplied,
        consultantTaxRateApplied: new Prisma.Decimal(payrollConfig.consultantTaxRate),
      },
    });

    const periodForCalc = await this.prisma.payrollPeriod.findUniqueOrThrow({
      where: { id: periodId },
    });

    const lines = await this.prisma.payrollLine.findMany({
      where: { periodId },
      select: { id: true, userId: true },
    });
    for (const line of lines) {
      await this.recalculateLineById(
        line.id,
        periodForCalc,
        payrollConfig.consultantTaxRate,
        periodForCalc.lunchDaysApplied,
      );
    }

    // Surface expired salary holds that still carry an unreleased balance. This is
    // an informational reminder only — funds are released manually from the Held
    // Salaries tab, never automatically here.
    const expiredHolds = await this.getExpiredHoldAlertsForPeriod(lines.map((l) => l.userId));
    return { expiredHolds };
  }

  /**
   * Active salary holds whose end date has already passed as of today but which
   * still hold an unreleased balance. Used by the recalculation alert. The cutoff
   * is "now" (not the period month-end), so a hold ending later this month is not
   * flagged while it is still active.
   */
  private async getExpiredHoldAlertsForPeriod(userIds: string[]): Promise<ExpiredHoldAlert[]> {
    if (userIds.length === 0) return [];
    const expired = await this.salaryHolds.getExpiredHolds(userIds, new Date());
    if (expired.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: expired.map((e) => e.userId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    return expired.map((e) => ({
      holdId: e.holdId,
      userId: e.userId,
      name: nameById.get(e.userId) ?? '',
      heldBalance: e.heldBalance,
      endDate: e.endDate.toISOString(),
    }));
  }

  /**
   * Recompute a single employee's payroll line in every still-editable period from
   * `fromMonth` onward. Used when a loan/advance balance is recalibrated (e.g. a
   * manual overpayment) so the stored loan deduction reflects the new installment
   * without waiting for a full period recalculation. LOCKED periods are skipped.
   */
  async recalculateUserLinesFrom(userId: string, fromMonth: string): Promise<void> {
    const periods = await this.prisma.payrollPeriod.findMany({
      where: {
        yearMonth: { gte: fromMonth },
        status: {
          in: [
            PayrollPeriodStatus.DRAFT,
            PayrollPeriodStatus.PENDING_REVIEW,
            PayrollPeriodStatus.AUTHORIZED,
          ],
        },
        lines: { some: { userId } },
      },
    });
    if (periods.length === 0) return;

    const payrollConfig = await this.systemConfig.getPayrollConfig();
    for (const period of periods) {
      const line = await this.prisma.payrollLine.findUnique({
        where: { periodId_userId: { periodId: period.id, userId } },
        select: { id: true },
      });
      if (!line) continue;
      await this.recalculateLineById(
        line.id,
        period,
        payrollConfig.consultantTaxRate,
        period.lunchDaysApplied,
      );
    }
  }

  // ── Salary holds ────────────────────────────────────────────────────────────

  /**
   * Manually release part/all of a held balance (the "Rollout Held Salary"
   * action). Records the release in the hold ledger and posts the released amount
   * as an approved salary addition on the target open period so it flows into the
   * next payroll calculation.
   */
  async releaseHeldSalary(
    holdId: string,
    dto: { amount: number; yearMonth?: string; remarks?: string },
    actorId: string,
  ) {
    const hold = await this.prisma.salaryHold.findUnique({ where: { id: holdId } });
    if (!hold) throw new NotFoundException(`Salary hold ${holdId} not found`);

    // Releasing simply withholds less: the released amount is taken off the held
    // balance (FIFO across the held months), so the employee is paid that much
    // more in the affected month(s). No separate payout/addition is created.
    const ledgerMonth =
      dto.yearMonth ??
      `${hold.startDate.getUTCFullYear()}-${String(hold.startDate.getUTCMonth() + 1).padStart(2, '0')}`;

    const { heldBalance, released } = await this.salaryHolds.recordRelease(holdId, {
      yearMonth: ledgerMonth,
      amount: dto.amount,
      remarks: dto.remarks,
      actorId,
    });

    // Recompute the employee's editable payroll lines from the hold's first month
    // so the reduced hold deduction (and higher net pay) takes effect.
    const fromMonth = `${hold.startDate.getUTCFullYear()}-${String(
      hold.startDate.getUTCMonth() + 1,
    ).padStart(2, '0')}`;
    await this.recalculateUserLinesFrom(hold.userId, fromMonth);

    return { heldBalance, released };
  }

  listHeldSalaries(query: ListHeldSalariesDto) {
    return this.salaryHolds.listHeldSalaries(query);
  }

  async recalculateLineById(
    lineId: string,
    period: {
      id: string;
      yearMonth: string;
      lunchRatePerDay: Prisma.Decimal;
      lunchDaysApplied?: number | null;
    },
    consultantTaxRate: number,
    defaultLunchDays: number | null = null,
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

    const loanDeduction = await this.sumActiveLoanRepayments(line.userId, period.yearMonth);
    const advanceDeduction = await this.sumActiveAdvanceSalaryRepayments(
      line.userId,
      period.yearMonth,
    );

    const lunchRows = await this.prisma.$queryRaw<{ lunchEnabled: boolean }[]>`
      SELECT "lunchEnabled" FROM users WHERE id = ${line.userId}
    `;
    const lunchEnabled = lunchRows[0]?.lunchEnabled ?? true;

    const adjustmentTotals = await this.sumApprovedSalaryAdjustments(line.userId, period.yearMonth);

    // Salary hold: withhold only the held days of this month (per-day = base / 30)
    // minus anything already released (FIFO). The rest is paid normally and shows
    // as a deduction on the line.
    const baseForHold = Number(line.baseSalaryMonthly ?? user.baseSalaryMonthly ?? 0);
    const holdInfo = await this.salaryHolds.getMonthHoldDeduction(
      line.userId,
      period.yearMonth,
      baseForHold,
    );
    const holdDeduction = holdInfo?.amount ?? 0;

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
      loanDeduction,
      advanceDeduction,
      lunchRatePerDay: Number(period.lunchRatePerDay),
      lunchEnabled,
      lunchDaysOverride:
        ((line as Record<string, unknown>)['lunchDaysOverride'] as number | null) ?? null,
      defaultLunchDays: period.lunchDaysApplied ?? defaultLunchDays,
      incomeTaxAmount: line.taxPercentOverride ? Number(line.taxPercentOverride) : 0,
      consultantPayMode: line.consultantPayMode ?? null,
      contractedDailyRate: Number(line.contractedDailyRate ?? 0),
      contractedHourlyRate: Number(line.contractedHourlyRate ?? 0),
      hoursWorked: Number(line.hoursWorked ?? 0),
      consultantTaxRate,
      salaryAdditions: adjustmentTotals.additions,
      salaryDeductions: adjustmentTotals.deductions,
      holdDeduction,
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
        loanDeduction: new Prisma.Decimal(loanDeduction),
        advanceDeduction: new Prisma.Decimal(advanceDeduction),
        reimbursementFromHr: new Prisma.Decimal(reimbursementFromHr),
        overtimeEarnings: new Prisma.Decimal(calcResult.overtimeEarnings),
        basicProRated: new Prisma.Decimal(calcResult.basicProRated),
        grossSalary: new Prisma.Decimal(calcResult.grossSalary),
        foodDeduction: new Prisma.Decimal(calcResult.foodDeduction),
        taxDeduction: new Prisma.Decimal(calcResult.taxDeduction),
        unpaidLeaveDeduction: new Prisma.Decimal(calcResult.unpaidLeaveDeduction),
        totalDeductions: new Prisma.Decimal(calcResult.totalDeductions),
        netSalary: new Prisma.Decimal(calcResult.netSalary),
        salaryAdditions: new Prisma.Decimal(adjustmentTotals.additions),
        salaryDeductions: new Prisma.Decimal(adjustmentTotals.deductions),
        holdDeduction: new Prisma.Decimal(holdDeduction),
        calculatedAt: new Date(),
      },
    });
  }

  private async sumApprovedSalaryAdjustments(
    userId: string,
    yearMonth: string,
  ): Promise<{ additions: number; deductions: number }> {
    const grouped = await this.prisma.salaryAdjustment.groupBy({
      by: ['category'],
      where: {
        employeeId: userId,
        yearMonth,
        status: { in: ['APPROVED', 'APPLIED'] },
      },
      _sum: { amount: true },
    });
    let additions = 0;
    let deductions = 0;
    for (const g of grouped) {
      const v = Number(g._sum.amount ?? 0);
      if (g.category === 'ADDITION') additions = v;
      else deductions = v;
    }
    return { additions, deductions };
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
      select: {
        id: true,
        iban: true,
        email: true,
        avatarUrl: true,
        bankCode: true,
        accountHolderName: true,
        swiftCode: true,
        cityOfResidence: true,
        province: true,
        joiningDate: true,
      },
    });
    const userMap = new Map(userRows.map((r) => [r.id, r]));

    // Active salary holds covering this period's month → drives the line hold badge.
    const heldHolds = await this.salaryHolds.getActiveHoldsForMonth(period.yearMonth);

    const data = lines.map((l) => {
      const u = userMap.get(l.userId);
      const hold = heldHolds.get(l.userId);
      const isRemittance =
        l.employeeType === 'CONSULTANT' ||
        ((l as Record<string, unknown>)['paymentMode'] as string | undefined) === 'UAE';

      const missingBankFields: string[] = [];
      if (!u?.iban?.trim()) missingBankFields.push('IBAN');
      if (!u?.bankCode?.trim()) missingBankFields.push('Bank Code');
      if (!u?.accountHolderName?.trim()) missingBankFields.push('Account Holder Name');
      if (isRemittance) {
        if (!u?.swiftCode?.trim()) missingBankFields.push('SWIFT Code');
        if (!u?.cityOfResidence?.trim()) missingBankFields.push('City of Residence');
        if (!u?.province?.trim()) missingBankFields.push('Province / State');
      }

      return {
        ...this.serializeLine(l),
        iban: u?.iban ?? null,
        email: u?.email ?? null,
        avatarUrl: u?.avatarUrl ?? null,
        joiningDate: u?.joiningDate?.toISOString() ?? null,
        missingBankFields,
        onSalaryHold: !!hold,
        salaryHoldId: hold?.id ?? null,
      };
    });

    const totalNetAll = await this.prisma.payrollLine.aggregate({
      where: { periodId },
      _sum: { netSalary: true },
    });

    // Whole-period count of employees who currently have any bulk variable applied
    // (performance bonus, extra working days or penalties) — drives the toolbar badge.
    const variablesAppliedCount = await this.prisma.payrollLine.count({
      where: {
        periodId,
        OR: [
          { performanceBonus: { gt: 0 } },
          { fines: { gt: 0 } },
          { extraWorkingDays: { gt: 0 } },
        ],
      },
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
      variablesAppliedCount,
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
    paymentMode?: string;
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
    salaryAdditions: Prisma.Decimal;
    salaryDeductions: Prisma.Decimal;
    holdDeduction: Prisma.Decimal;
    calculatedAt: Date | null;
    version: number;
  }) {
    const dec = (d: Prisma.Decimal): string => d.toString();
    return {
      id: l.id,
      periodId: l.periodId,
      userId: l.userId,
      version: l.version,
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
      paymentMode: l.paymentMode ?? 'LOCAL_BANK',

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
      salaryAdditions: dec(l.salaryAdditions),
      salaryDeductions: dec(l.salaryDeductions),
      holdDeduction: dec(l.holdDeduction),
      calculatedAt: l.calculatedAt?.toISOString() ?? null,
      totalEarnings: dec(l.grossSalary),
    };
  }

  /**
   * High-level financial KPIs for a payroll period, aggregated across all lines.
   *
   * All figures are read from the persisted PayrollLine columns, so an open
   * (DRAFT/PENDING_REVIEW/AUTHORIZED) period reflects current workspace edits in
   * real time, while a LOCKED period returns the frozen snapshot — edits are
   * blocked once locked, so the stored totals no longer move.
   *
   * Total Deductions uses the authoritative `totalDeductions` column (the same
   * value that drives net salary): tax + food + unpaidLeave + fines + loan +
   * advance + salaryDeductions. The breakdown derives "penaltiesOther" as the
   * remainder so the parts always reconcile to the headline figure.
   */
  /**
   * Aggregate per-period analytics metrics for an arbitrary set of periods in
   * two grouped queries (sums + paid head-count), regardless of how many.
   * Returns a Map keyed by periodId; periods with no lines map to zeroed metrics.
   */
  private async aggregateMetricsByPeriod(periodIds: string[]) {
    const result = new Map<string, ReturnType<typeof buildPeriodMetrics>>();
    if (periodIds.length === 0) return result;

    const [sumsGrouped, paidGrouped] = await this.prisma.$transaction([
      this.prisma.payrollLine.groupBy({
        by: ['periodId'],
        where: { periodId: { in: periodIds } },
        _sum: {
          taxDeduction: true,
          totalDeductions: true,
          loanDeduction: true,
          advanceDeduction: true,
          foodDeduction: true,
          reimbursementFromHr: true,
          reimbursementManual: true,
        },
        orderBy: { periodId: 'asc' },
      }),
      this.prisma.payrollLine.groupBy({
        by: ['periodId'],
        where: { periodId: { in: periodIds }, netSalary: { gt: 0 } },
        _count: true,
        orderBy: { periodId: 'asc' },
      }),
    ]);

    const sumsById = new Map(sumsGrouped.map((g) => [g.periodId, g._sum]));
    const paidById = new Map(paidGrouped.map((g) => [g.periodId, Number(g._count ?? 0)]));

    for (const pid of periodIds) {
      result.set(pid, buildPeriodMetrics(sumsById.get(pid), paidById.get(pid) ?? 0));
    }
    return result;
  }

  async getPeriodAnalytics(periodId: string) {
    // How many trailing payroll cycles (including the selected one) to surface
    // for the default month-over-month comparison and trend chart.
    const TREND_MONTHS = 6;

    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: { id: true, yearMonth: true, status: true, updatedAt: true },
    });
    if (!period) {
      throw new NotFoundException(`Payroll period ${periodId} not found`);
    }

    // Trailing window: the selected period plus up to TREND_MONTHS-1 earlier
    // cycles. yearMonth is a sortable "YYYY-MM" string, so lexical order is
    // chronological order.
    const windowPeriods = await this.prisma.payrollPeriod.findMany({
      where: { yearMonth: { lte: period.yearMonth } },
      orderBy: { yearMonth: 'desc' },
      take: TREND_MONTHS,
      select: { id: true, yearMonth: true, status: true },
    });

    const byId = await this.aggregateMetricsByPeriod(windowPeriods.map((p) => p.id));
    const current = byId.get(period.id) ?? buildPeriodMetrics(undefined, 0);
    // windowPeriods[0] is the selected period (desc order); [1] is the month before.
    const prior = windowPeriods[1] ?? null;

    // Trend series ascending in time so the chart reads left-to-right.
    const trend = [...windowPeriods].reverse().map((p) => ({
      yearMonth: p.yearMonth,
      status: p.status,
      ...(byId.get(p.id) ?? buildPeriodMetrics(undefined, 0)).metrics,
    }));

    return {
      period: {
        id: period.id,
        yearMonth: period.yearMonth,
        status: period.status,
        updatedAt: period.updatedAt,
      },
      // A finalized (LOCKED) period is a frozen snapshot; anything else is live.
      isFinalized: period.status === PayrollPeriodStatus.LOCKED,
      metrics: current.metrics,
      deductionBreakdown: current.deductionBreakdown,
      reimbursementBreakdown: current.reimbursementBreakdown,
      previous: prior
        ? {
            yearMonth: prior.yearMonth,
            metrics: (byId.get(prior.id) ?? buildPeriodMetrics(undefined, 0)).metrics,
          }
        : null,
      trend,
    };
  }

  /**
   * Side-by-side analytics for an explicit set of payroll months (YYYY-MM),
   * for the interactive multi-month comparison. Returns one entry per month
   * that has a payroll period (ascending by month) plus the list of requested
   * months that have no period yet.
   */
  async getAnalyticsComparison(yearMonths: string[]) {
    const MAX_MONTHS = 12;
    const cleaned = Array.from(new Set((yearMonths ?? []).map((m) => m.trim()).filter(Boolean)));

    if (cleaned.length === 0) {
      throw new BadRequestException('At least one month (YYYY-MM) is required');
    }
    if (cleaned.length > MAX_MONTHS) {
      throw new BadRequestException(`At most ${MAX_MONTHS} months can be compared at once`);
    }
    for (const m of cleaned) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) {
        throw new BadRequestException(`Invalid month '${m}', expected YYYY-MM`);
      }
    }

    const periods = await this.prisma.payrollPeriod.findMany({
      where: { yearMonth: { in: cleaned } },
      select: { id: true, yearMonth: true, status: true },
    });

    const byId = await this.aggregateMetricsByPeriod(periods.map((p) => p.id));
    const sorted = [...periods].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));

    return {
      periods: sorted.map((p) => {
        const m = byId.get(p.id) ?? buildPeriodMetrics(undefined, 0);
        return {
          yearMonth: p.yearMonth,
          status: p.status,
          metrics: m.metrics,
          deductionBreakdown: m.deductionBreakdown,
          reimbursementBreakdown: m.reimbursementBreakdown,
        };
      }),
      // Requested months that have no payroll period yet — surfaced so the UI
      // can flag them rather than silently dropping them.
      missing: cleaned.filter((m) => !periods.some((p) => p.yearMonth === m)).sort(),
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
            swiftCode: true,
            cityOfResidence: true,
            province: true,
            name: true,
            email: true,
          },
        },
      },
    });

    let sumAllNet = 0;
    let sumExportNet = 0;
    let sumRemittanceNet = 0;
    const excludedEmployees: Array<{
      name: string;
      email: string;
      reason: 'NO_IBAN' | 'HOLD' | 'DEACTIVATED' | 'REMITTANCE' | 'NEGATIVE_SALARY' | 'CONSULTANT';
    }> = [];
    // Read-only rollout notice: who has a salary-hold deduction this month and how much.
    const salaryHoldEmployees: Array<{ name: string; email: string; amount: number }> = [];
    const bankWarningEmployees: Array<{
      name: string;
      email: string;
      missingFields: string[];
    }> = [];
    const exportable: Array<{ userId: string; name: string; iban: string | null; net: number }> =
      [];
    const freezeEmployees: Array<{ name: string; pendingDays: number | null; netSalary: number }> =
      [];
    const consultantEmployees: Array<{ name: string; email: string; netSalary: number }> = [];
    const remittanceEmployees: Array<{ name: string; email: string; netSalary: number }> = [];
    const remittanceNegativeEmployees: Array<{ name: string; email: string; netSalary: number }> =
      [];
    const remittanceBankWarningEmployees: Array<{
      name: string;
      email: string;
      missingFields: string[];
    }> = [];

    for (const line of lines) {
      const net = Number(line.netSalary);
      sumAllNet += net;
      // Salary-hold deduction applied to this line (held days × per-day). The
      // employee is still paid `net`; this is shown as a read-only notice.
      const holdAmt = Number((line as Record<string, unknown>)['holdDeduction'] ?? 0);
      if (holdAmt > 0) {
        salaryHoldEmployees.push({
          name: line.user.name,
          email: line.user.email,
          amount: holdAmt,
        });
      }
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
      // Consultants and remittance employees are routed exclusively to the remittance export.
      // Check these BEFORE the IBAN check so they are counted correctly even when IBAN is missing.
      if (line.employeeType === 'CONSULTANT') {
        excludedEmployees.push({
          name: line.user.name,
          email: line.user.email,
          reason: 'CONSULTANT',
        });
        if (net < 0) {
          remittanceNegativeEmployees.push({
            name: line.user.name,
            email: line.user.email,
            netSalary: net,
          });
        } else {
          consultantEmployees.push({
            name: line.user.name,
            email: line.user.email,
            netSalary: net,
          });
          sumRemittanceNet += net;
          const missing = this.checkRemittanceBankFields(line.user);
          if (missing.length > 0) {
            remittanceBankWarningEmployees.push({
              name: line.user.name,
              email: line.user.email,
              missingFields: missing,
            });
          }
        }
        continue;
      }
      if ((line as Record<string, unknown>)['paymentMode'] === 'UAE') {
        excludedEmployees.push({
          name: line.user.name,
          email: line.user.email,
          reason: 'REMITTANCE',
        });
        if (net < 0) {
          remittanceNegativeEmployees.push({
            name: line.user.name,
            email: line.user.email,
            netSalary: net,
          });
        } else {
          remittanceEmployees.push({
            name: line.user.name,
            email: line.user.email,
            netSalary: net,
          });
          sumRemittanceNet += net;
          const missing = this.checkRemittanceBankFields(line.user);
          if (missing.length > 0) {
            remittanceBankWarningEmployees.push({
              name: line.user.name,
              email: line.user.email,
              missingFields: missing,
            });
          }
        }
        continue;
      }
      // SIMPLE_REMITTANCE: no bank export — skip IBAN check entirely, exclude from exportable sum
      if ((line as Record<string, unknown>)['paymentMode'] === 'SIMPLE_REMITTANCE') {
        excludedEmployees.push({
          name: line.user.name,
          email: line.user.email,
          reason: 'SIMPLE_REMITTANCE' as any,
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
      if (net < 0) {
        excludedEmployees.push({
          name: line.user.name,
          email: line.user.email,
          reason: 'NEGATIVE_SALARY',
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

    const negativeSalaryEmployees = excludedEmployees.filter((e) => e.reason === 'NEGATIVE_SALARY');
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
      negativeSalaryCount: negativeSalaryEmployees.length,
      negativeSalaryEmployees,
      consultantCount: consultantEmployees.length,
      consultantEmployees,
      remittanceCount: remittanceEmployees.length,
      remittanceEmployees,
      sumNetSalaryRemittance: Math.round(sumRemittanceNet * 100) / 100,
      remittanceNegativeCount: remittanceNegativeEmployees.length,
      remittanceNegativeEmployees,
      remittanceBankWarningCount: remittanceBankWarningEmployees.length,
      remittanceBankWarningEmployees,
      salaryHoldSummary: {
        count: salaryHoldEmployees.length,
        totalHeld: Math.round(salaryHoldEmployees.reduce((s, e) => s + e.amount, 0) * 100) / 100,
        employees: salaryHoldEmployees,
      },
      periodStatus: period.status,
    };
  }

  private checkRemittanceBankFields(user: {
    iban: string | null;
    bankCode: string | null;
    accountHolderName: string | null;
    swiftCode: string | null;
    cityOfResidence: string | null;
    province: string | null;
  }): string[] {
    const missing: string[] = [];
    if (!user.iban?.trim()) missing.push('IBAN');
    if (!user.bankCode?.trim()) missing.push('Bank Code');
    if (!user.accountHolderName?.trim()) missing.push('Account Holder Name');
    if (!user.swiftCode?.trim()) missing.push('SWIFT Code');
    if (!user.cityOfResidence?.trim()) missing.push('City of Residence');
    if (!user.province?.trim()) missing.push('Province / State');
    return missing;
  }

  async lockPeriod(periodId: string, actorId: string): Promise<void> {
    const lockedAt = new Date();
    const result = await this.prisma.payrollPeriod.updateMany({
      where: { id: periodId, status: PayrollPeriodStatus.AUTHORIZED },
      data: { status: PayrollPeriodStatus.LOCKED, lockedAt, lockedById: actorId },
    });
    if (result.count === 0) {
      const existing = await this.prisma.payrollPeriod.findUnique({ where: { id: periodId } });
      if (!existing) throw new NotFoundException(`Payroll period ${periodId} not found`);
      throw new ConflictException('Period must be in AUTHORIZED status before it can be locked');
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
      data: { status: PayrollPeriodStatus.AUTHORIZED, lockedAt: null, lockedById: null },
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
    this.assertExportable(period.status);

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
      if (line.employeeType === 'CONSULTANT') continue;
      if ((line as Record<string, unknown>)['paymentMode'] !== 'LOCAL_BANK') continue;
      const iban = line.user.iban?.trim() ?? '';
      if (!iban) continue;
      // netSalary already has any salary-hold deduction subtracted, so held
      // employees are paid the remainder normally.
      const net = Number(line.netSalary);
      if (net < 0) continue;
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

    // Bank sheet exported → the month's payroll is dispatched. Realize loan +
    // advance-salary deductions for this period's month (idempotent).
    await this.repaymentAutoDeduct.realizeRepaymentsForExportedPeriod(period.yearMonth, actorId);

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
    this.assertExportable(period.status);

    const lines = (await this.prisma.payrollLine.findMany({
      where: { periodId },
      select: {
        id: true,
        userId: true,
        employeeStatus: true,
        employeeType: true,
        paymentMode: true,
        netSalary: true,
        displayName: true,
      },
      orderBy: { displayName: 'asc' },
    })) as any[];

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
      if (line.employeeType === 'CONSULTANT') continue;
      if ((line as Record<string, unknown>)['paymentMode'] !== 'LOCAL_BANK') continue;
      if (Number(line.netSalary) < 0) continue;
      const u = bankUserMap.get(line.userId as string);
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
      if (line.employeeType === 'CONSULTANT') continue;
      if ((line as Record<string, unknown>)['payViaRemittance'] === true) continue;
      const u = bankUserMap.get(line.userId as string);
      if (!u?.iban?.trim()) continue;
      // netSalary already nets out any salary-hold deduction.
      const net = Number(line.netSalary);
      if (net < 0) continue;
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

    // Bank sheet exported → the month's payroll is dispatched. Realize loan +
    // advance-salary deductions for this period's month (idempotent).
    await this.repaymentAutoDeduct.realizeRepaymentsForExportedPeriod(period.yearMonth, actorId);

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
    await this.assertPeriodEditable(period.status, actorId);

    const line = await this.prisma.payrollLine.findFirst({
      where: { id: lineId, periodId },
    });
    if (!line) {
      throw new NotFoundException(`Payroll line ${lineId} not found`);
    }

    // Optimistic concurrency check
    if (dto.version !== undefined && dto.version !== line.version) {
      throw new ConflictException(
        'This line was modified by another user. Please refresh and retry.',
      );
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
    if (dto.paymentMode !== undefined) {
      const prevMode =
        ((line as Record<string, unknown>)['paymentMode'] as string | null) ?? 'LOCAL_BANK';
      if (prevMode !== (dto.paymentMode as string)) {
        audits.push({
          lineId: line.id,
          field: 'paymentMode',
          oldValue: prevMode,
          newValue: dto.paymentMode,
          actorId,
        });
      }
      (data as any).paymentMode = dto.paymentMode;
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
      this.prisma.payrollLine.update({
        where: { id: lineId },
        data: { ...data, version: { increment: 1 } },
      }),
      ...(audits.length ? [this.prisma.payrollAdjustmentAudit.createMany({ data: audits })] : []),
    ]);

    const payrollConfig = await this.systemConfig.getPayrollConfig();
    const periodFresh = await this.prisma.payrollPeriod.findUniqueOrThrow({
      where: { id: periodId },
    });
    await this.recalculateLineById(
      lineId,
      periodFresh,
      payrollConfig.consultantTaxRate,
      periodFresh.lunchDaysApplied,
    );
    return this.getLineWithIban(periodId, lineId);
  }

  /**
   * Overwrite the three "bulk variable" fields (performance bonus, extra working days, penalties)
   * across many payroll lines at once, writing an audit row per changed field and recalculating
   * each affected line. Values are absolute (the grid resolves header defaults + overrides before
   * sending). Unknown lines and deactivated employees are skipped rather than failing the batch.
   */
  async bulkUpdateVariables(
    periodId: string,
    updates: {
      lineId: string;
      extraWorkingDays?: number;
      performanceBonus?: number;
      fines?: number;
    }[],
    actorId: string,
  ): Promise<{ updated: number; skipped: number }> {
    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: {
        id: true,
        status: true,
        yearMonth: true,
        lunchRatePerDay: true,
        lunchDaysApplied: true,
      },
    });
    if (!period) {
      throw new NotFoundException(`Payroll period ${periodId} not found`);
    }
    await this.assertPeriodEditable(period.status, actorId);

    // Last write wins if a line is referenced more than once.
    const byLineId = new Map(updates.map((u) => [u.lineId, u]));
    const lineIds = [...byLineId.keys()];

    const lines = await this.prisma.payrollLine.findMany({
      where: { periodId, id: { in: lineIds } },
      select: {
        id: true,
        extraWorkingDays: true,
        performanceBonus: true,
        fines: true,
        user: { select: { employeeStatus: true } },
      },
    });
    const lineById = new Map(lines.map((l) => [l.id, l]));

    const lineUpdates: Prisma.PrismaPromise<unknown>[] = [];
    const audits: Prisma.PayrollAdjustmentAuditCreateManyInput[] = [];
    const lineIdsToRecalc: string[] = [];
    let skipped = 0;

    const pushAudit = (
      lineId: string,
      field: LineAuditField,
      prev: Prisma.Decimal | number,
      next: Prisma.Decimal | number,
    ): boolean => {
      const prevStr = String(prev);
      const nextStr = String(next);
      if (prevStr === nextStr) return false;
      audits.push({
        lineId,
        field,
        oldValue: prevStr.slice(0, 500),
        newValue: nextStr.slice(0, 500),
        actorId,
      });
      return true;
    };

    for (const lineId of lineIds) {
      const line = lineById.get(lineId);
      if (!line || line.user.employeeStatus === EmployeeStatus.DEACTIVATED) {
        skipped++;
        continue;
      }
      const item = byLineId.get(lineId)!;
      const data: Prisma.PayrollLineUpdateInput = {};
      let changed = false;

      if (item.extraWorkingDays !== undefined) {
        changed =
          pushAudit(lineId, 'extraWorkingDays', line.extraWorkingDays, item.extraWorkingDays) ||
          changed;
        data.extraWorkingDays = item.extraWorkingDays;
      }
      if (item.performanceBonus !== undefined) {
        const next = new Prisma.Decimal(item.performanceBonus);
        changed = pushAudit(lineId, 'performanceBonus', line.performanceBonus, next) || changed;
        data.performanceBonus = next;
      }
      if (item.fines !== undefined) {
        const next = new Prisma.Decimal(item.fines);
        changed = pushAudit(lineId, 'fines', line.fines, next) || changed;
        data.fines = next;
      }

      if (!changed) {
        skipped++;
        continue;
      }

      lineUpdates.push(
        this.prisma.payrollLine.update({
          where: { id: lineId },
          data: { ...data, version: { increment: 1 } },
        }),
      );
      lineIdsToRecalc.push(lineId);
    }

    if (lineUpdates.length === 0) {
      return { updated: 0, skipped };
    }

    await this.prisma.$transaction([
      ...lineUpdates,
      ...(audits.length ? [this.prisma.payrollAdjustmentAudit.createMany({ data: audits })] : []),
    ]);

    const { consultantTaxRate } = await this.systemConfig.getPayrollConfig();
    for (const lineId of lineIdsToRecalc) {
      await this.recalculateLineById(lineId, period, consultantTaxRate, period.lunchDaysApplied);
    }

    this.logger.log(
      `Bulk variable edit: ${lineIdsToRecalc.length} lines updated in period ${periodId} by ${actorId}`,
    );

    return { updated: lineIdsToRecalc.length, skipped };
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
    const lastDayOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthStartStr = `${y}-${String(m).padStart(2, '0')}-01`;
    const monthEndStr = `${y}-${String(m).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`;

    const leaves = await this.prisma.$queryRaw<
      Array<{
        id: string;
        leaveType: string;
        startDate: string;
        endDate: string;
        category: string | null;
        unpaidDays: string | null;
      }>
    >`
      SELECT
        id,
        "formData"->>'leaveType'                                   AS "leaveType",
        substring("formData"->'dateRange'->>'from' from 1 for 10)  AS "startDate",
        substring("formData"->'dateRange'->>'to'   from 1 for 10)  AS "endDate",
        "formData"->>'category'                                    AS "category",
        "formData"->>'unpaidDays'                                  AS "unpaidDays"
      FROM "dynamic_requests"
      WHERE "typeKey" = 'LEAVE'
        AND "requesterId" = ${userId}
        AND "status" = 'APPROVED'
        AND substring("formData"->'dateRange'->>'from' from 1 for 10) <= ${monthEndStr}
        AND substring("formData"->'dateRange'->>'to'   from 1 for 10) >= ${monthStartStr}
      ORDER BY substring("formData"->'dateRange'->>'from' from 1 for 10) ASC
    `;

    return leaves.map((l) => ({
      id: l.id,
      leaveType: l.leaveType,
      startDate: new Date(`${l.startDate}T00:00:00.000Z`).toISOString(),
      endDate: new Date(`${l.endDate}T23:59:59.999Z`).toISOString(),
      category: l.category,
      unpaidDays: (l.unpaidDays ?? '0').toString(),
    }));
  }

  async getHrClaimsForLine(periodId: string, userId: string) {
    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: { yearMonth: true },
    });
    if (!period) {
      throw new NotFoundException(`Payroll period ${periodId} not found`);
    }
    const { yearMonth } = period;

    // Non-installment: matched by salaryMonth on the request
    const direct = await this.prisma.reimbursementRequest.findMany({
      where: {
        employeeId: userId,
        salaryMonth: yearMonth,
        processingType: ReimbursementProcessingType.SALARY_ADJUSTMENT,
        status: { in: [ReimbursementStatus.APPROVED, ReimbursementStatus.PROCESSED] },
        hasInstallmentPlan: false,
      },
      select: {
        id: true,
        description: true,
        reimbursementType: true,
        approvedAmount: true,
        amount: true,
        receipts: {
          select: { merchantName: true, transactionDate: true },
          orderBy: { transactionDate: 'asc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Installment: one row per installment scheduled for this month
    const installments = await this.prisma.reimbursementInstallment.findMany({
      where: {
        scheduledMonth: yearMonth,
        reimbursement: {
          employeeId: userId,
          processingType: ReimbursementProcessingType.SALARY_ADJUSTMENT,
          status: { in: [ReimbursementStatus.APPROVED, ReimbursementStatus.PROCESSED] },
          hasInstallmentPlan: true,
        },
      },
      select: {
        id: true,
        amount: true,
        installmentNo: true,
        reimbursement: {
          select: {
            id: true,
            description: true,
            reimbursementType: true,
            totalInstallments: true,
            receipts: {
              select: { merchantName: true, transactionDate: true },
              orderBy: { transactionDate: 'asc' },
              take: 1,
            },
          },
        },
      },
      orderBy: { reimbursement: { createdAt: 'asc' } },
    });

    const result: Array<{
      id: string;
      description: string;
      reimbursementType: string;
      amount: number;
      merchantName: string | null;
      transactionDate: string;
      installmentNo?: number;
      totalInstallments?: number;
    }> = [];

    for (const c of direct) {
      const firstReceipt = c.receipts[0];
      result.push({
        id: c.id,
        description: c.description,
        reimbursementType: c.reimbursementType,
        amount: Number(c.approvedAmount ?? c.amount),
        merchantName: firstReceipt?.merchantName ?? null,
        transactionDate: firstReceipt?.transactionDate.toISOString() ?? new Date().toISOString(),
      });
    }

    for (const inst of installments) {
      if (!inst.reimbursement) continue; // dynamic-request installments handled separately below
      const r = inst.reimbursement;
      const firstReceipt = r.receipts[0];
      result.push({
        id: inst.id,
        description: `${r.description} (instalment ${inst.installmentNo}${r.totalInstallments ? `/${r.totalInstallments}` : ''})`,
        reimbursementType: r.reimbursementType,
        amount: Number(inst.amount),
        merchantName: firstReceipt?.merchantName ?? null,
        transactionDate: firstReceipt?.transactionDate.toISOString() ?? new Date().toISOString(),
        installmentNo: inst.installmentNo,
        totalInstallments: r.totalInstallments ?? undefined,
      });
    }

    // Dynamic-request reimbursement installments — same shape as legacy claims
    const dynamicInstallments = await this.prisma.reimbursementInstallment.findMany({
      where: {
        scheduledMonth: yearMonth,
        dynamicRequestId: { not: null },
        dynamicRequest: {
          requesterId: userId,
          typeKey: 'REIMBURSEMENT',
          status: 'APPROVED',
          formData: {
            path: ['processingType'],
            equals: ReimbursementProcessingType.SALARY_ADJUSTMENT,
          },
        },
      },
      select: {
        id: true,
        amount: true,
        installmentNo: true,
        dynamicRequest: { select: { id: true, formData: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Count total installments per dynamic request once for label rendering.
    const dynamicRequestIds = Array.from(
      new Set(
        dynamicInstallments.map((i) => i.dynamicRequest?.id).filter((id): id is string => !!id),
      ),
    );
    const totalsByDynamicRequest = new Map<string, number>();
    if (dynamicRequestIds.length > 0) {
      const grouped = await this.prisma.reimbursementInstallment.groupBy({
        by: ['dynamicRequestId'],
        where: { dynamicRequestId: { in: dynamicRequestIds } },
        _count: true,
      });
      for (const g of grouped) {
        if (g.dynamicRequestId) {
          totalsByDynamicRequest.set(g.dynamicRequestId, Number(g._count ?? 0));
        }
      }
    }

    for (const inst of dynamicInstallments) {
      const fd = (inst.dynamicRequest?.formData as Record<string, unknown> | null) ?? {};
      const description = (fd.description as string | undefined) ?? 'Reimbursement';
      const reimbursementType = (fd.reimbursementType as string | undefined) ?? 'OTHER';
      const merchantName = (fd.merchantName as string | undefined) ?? null;
      const transactionDate =
        (fd.transactionDate as string | undefined) ?? new Date().toISOString();
      const totalInstallments = inst.dynamicRequest?.id
        ? totalsByDynamicRequest.get(inst.dynamicRequest.id)
        : undefined;
      result.push({
        id: inst.id,
        description: `${description} (instalment ${inst.installmentNo}${totalInstallments ? `/${totalInstallments}` : ''})`,
        reimbursementType,
        amount: Number(inst.amount),
        merchantName,
        transactionDate,
        installmentNo: inst.installmentNo,
        totalInstallments,
      });
    }

    return result;
  }

  async getActiveLoanRepaymentsForLine(periodId: string, userId: string) {
    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: { yearMonth: true },
    });
    if (!period) {
      throw new NotFoundException(`Payroll period ${periodId} not found`);
    }
    const { yearMonth } = period;

    // Mirror sumActiveLoanRepayments: include DEDUCTED installments (already
    // realized at export) and COMPLETED loans so the payroll loan-deduction
    // accordion stays in sync with the line total — i.e. it still shows the
    // month's loan once it's been collected/settled, not only while PENDING.
    // SKIPPED (manual partial payment) is excluded — payroll charges 0 for it.
    const repayments = await this.prisma.loanRepayment.findMany({
      where: {
        scheduledMonth: yearMonth,
        status: { in: [LoanRepaymentStatus.PENDING, LoanRepaymentStatus.DEDUCTED] },
        request: {
          requesterId: userId,
          status: { in: ['DISBURSED', 'REPAYING', 'COMPLETED'] },
        },
      },
      select: {
        id: true,
        requestId: true,
        installmentNo: true,
        amount: true,
        remainingBalance: true,
        request: { select: { formData: true } },
      },
      orderBy: { installmentNo: 'asc' },
    });

    return repayments.map((r) => {
      const data = (r.request.formData ?? {}) as Record<string, unknown>;
      const approvedAmount = Number(data.approvedAmount ?? data.amount ?? 0);
      const approvedMonths = Number(
        data.approvedRepaymentMonths ?? data.requestedRepaymentMonths ?? 0,
      );
      return {
        id: r.id,
        loanId: r.requestId,
        installmentNo: r.installmentNo,
        amount: r.amount.toString(),
        remainingBalance: r.remainingBalance.toString(),
        purpose: (data.purpose as string) ?? '',
        approvedAmount: String(approvedAmount),
        approvedRepaymentMonths: approvedMonths,
        // Disbursement details — surfaced in payroll so HR can see when/how the
        // loan was disbursed (mirrors reimbursement claim details in earnings).
        disbursedAt: (data.disbursedAt as string) ?? null,
        repaymentStartMonth: (data.repaymentStartMonth as string) ?? null,
        monthlyDeduction: String(
          data.monthlyDeduction != null
            ? Number(data.monthlyDeduction)
            : approvedMonths > 0
              ? approvedAmount / approvedMonths
              : Number(r.amount),
        ),
        totalRepaid: String(Number(data.totalRepaid ?? 0)),
      };
    });
  }

  async getActiveAdvanceSalaryRepaymentsForLine(periodId: string, userId: string) {
    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: { yearMonth: true },
    });
    if (!period) {
      throw new NotFoundException(`Payroll period ${periodId} not found`);
    }
    const { yearMonth } = period;

    const repayments = await this.prisma.advanceSalaryRepayment.findMany({
      where: {
        scheduledMonth: yearMonth,
        status: AdvanceSalaryRepaymentStatus.PENDING,
        request: {
          requesterId: userId,
          status: { in: ['DISBURSED', 'REPAYING'] },
        },
      },
      select: {
        id: true,
        requestId: true,
        installmentNo: true,
        amount: true,
        request: { select: { formData: true } },
      },
      orderBy: { installmentNo: 'asc' },
    });

    return repayments.map((r) => {
      const data = (r.request.formData ?? {}) as Record<string, unknown>;
      const approvedAmount = Number(data.approvedAmount ?? data.amount ?? 0);
      const approvedMonths = Number(data.approvedRepaymentMonths ?? 1);
      return {
        id: r.id,
        advanceSalaryId: r.requestId,
        installmentNo: r.installmentNo,
        amount: r.amount.toString(),
        reason: (data.reason as string) ?? '',
        approvedAmount: String(approvedAmount),
        approvedRepaymentMonths: approvedMonths,
        // Disbursement details — surfaced in payroll so HR can see when/how the
        // advance was disbursed (mirrors reimbursement claim details in earnings).
        disbursedAt: (data.disbursedAt as string) ?? null,
        repaymentStartMonth: (data.repaymentStartMonth as string) ?? null,
        monthlyDeduction: String(
          data.monthlyDeduction != null
            ? Number(data.monthlyDeduction)
            : approvedMonths > 0
              ? approvedAmount / approvedMonths
              : Number(r.amount),
        ),
        totalRepaid: String(Number(data.totalRepaid ?? 0)),
        remainingBalance: String(Number(data.remainingBalance ?? 0)),
      };
    });
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
  async getMyPayslips(userId: string) {
    const lines = await this.prisma.payrollLine.findMany({
      where: { userId },
      select: {
        id: true,
        periodId: true,
        netSalary: true,
        period: {
          select: { id: true, yearMonth: true, status: true },
        },
      },
      orderBy: { period: { yearMonth: 'desc' } },
    });

    return lines
      .filter((l) => l.period.status === PayrollPeriodStatus.LOCKED)
      .map((l) => ({
        periodId: l.period.id,
        yearMonth: l.period.yearMonth,
        status: l.period.status,
        netSalary: l.netSalary.toString(),
      }));
  }

  async getMyPayslip(userId: string, yearMonth: string) {
    const period = await this.prisma.payrollPeriod.findUnique({
      where: { yearMonth },
      select: { id: true, yearMonth: true, status: true },
    });

    if (!period) throw new NotFoundException(`No payroll period for ${yearMonth}`);
    if (period.status !== PayrollPeriodStatus.LOCKED) {
      throw new ForbiddenException('Payslip is not yet available');
    }

    const line = await this.prisma.payrollLine.findUnique({
      where: { periodId_userId: { periodId: period.id, userId } },
    });

    if (!line) throw new NotFoundException(`No payslip found for ${yearMonth}`);

    const payrollConfig = await this.systemConfig.getPayrollConfig();

    return {
      period: { id: period.id, yearMonth: period.yearMonth, status: period.status },
      ...this.serializeLine(line),
      payslipCompany: {
        companyName: payrollConfig.companyName,
        companyTagline: payrollConfig.companyTagline,
        companyContactEmail: payrollConfig.companyContactEmail,
        hrEmail: payrollConfig.hrEmail,
        hrSignatureUrl: payrollConfig.hrSignatureUrl ?? null,
        officialStampUrl: payrollConfig.officialStampUrl ?? null,
      },
    };
  }
}
