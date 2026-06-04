import { Injectable, Logger } from '@nestjs/common';
import {
  AdvanceSalaryRepaymentStatus,
  DynamicRequestStatus,
  InstallmentStatus,
  LoanLedgerEntryType,
  LoanRepaymentStatus,
  Prisma,
  ReimbursementStatus,
} from '@prisma/client';
import { PrismaService } from 'src/prisma';

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export interface AutoDeductResult {
  loanInstallments: number;
  advanceSalaryInstallments: number;
  reimbursementInstallments: number;
}

@Injectable()
export class RepaymentAutoDeductService {
  private readonly logger = new Logger(RepaymentAutoDeductService.name);

  // In-memory guard: skip repeated calls within the same calendar month.
  // Resets automatically when the month rolls over.
  private lastRunMonth: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // Month-transition auto-deduct. Loans and advance salary are NO LONGER realized
  // here — they are realized when the payroll bank sheet is exported (see
  // `realizeRepaymentsForExportedPeriod`). Only reimbursement installments still
  // follow the time-based trigger.
  async autoDeductPastDue(): Promise<AutoDeductResult> {
    const cutoff = currentYearMonth();

    if (this.lastRunMonth === cutoff) {
      return { loanInstallments: 0, advanceSalaryInstallments: 0, reimbursementInstallments: 0 };
    }

    const processedAt = new Date();
    const note = 'Auto-processed on month transition';

    this.logger.log(
      `Auto-deduct (reimbursements): marking installments with scheduledMonth < ${cutoff}`,
    );

    const reimbursementInstallments = await this.processReimbursementInstallments(
      cutoff,
      processedAt,
      note,
    );

    this.lastRunMonth = cutoff;
    this.logger.log(`Auto-deduct complete — reimbursements: ${reimbursementInstallments}`);

    return { loanInstallments: 0, advanceSalaryInstallments: 0, reimbursementInstallments };
  }

  // Realize loan + advance-salary deductions for a payroll period's month, fired
  // when its bank sheet is exported (the moment payroll is dispatched). Marks the
  // month's PENDING installments DEDUCTED, reduces balances, writes loan ledger
  // rows, and settles loans whose balance reaches zero. Idempotent: already-
  // DEDUCTED installments are filtered out, so re-exporting is a no-op.
  async realizeRepaymentsForExportedPeriod(
    yearMonth: string,
    actorId: string,
  ): Promise<{ loanInstallments: number; advanceSalaryInstallments: number }> {
    const processedAt = new Date();
    const note = `Collected via bank export (${yearMonth})`;

    this.logger.log(`Bank-export realization: marking ${yearMonth} repayments collected`);

    const [loanInstallments, advanceSalaryInstallments] = await Promise.all([
      this.deductLoanRepayments({ equals: yearMonth }, processedAt, note, actorId),
      this.deductAdvanceSalaryRepayments({ equals: yearMonth }, processedAt, note),
    ]);

    this.logger.log(
      `Bank-export realization (${yearMonth}) complete — loans: ${loanInstallments}, advance salary: ${advanceSalaryInstallments}`,
    );

    return { loanInstallments, advanceSalaryInstallments };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Loans
  // ─────────────────────────────────────────────────────────────────────────────

  private async deductLoanRepayments(
    monthFilter: Prisma.StringFilter,
    processedAt: Date,
    note: string,
    createdById: string | null,
  ): Promise<number> {
    const pending = await this.prisma.loanRepayment.findMany({
      where: {
        scheduledMonth: monthFilter,
        status: LoanRepaymentStatus.PENDING,
        request: {
          status: { in: [DynamicRequestStatus.DISBURSED, DynamicRequestStatus.REPAYING] },
        },
      },
      select: {
        id: true,
        requestId: true,
        installmentNo: true,
        scheduledMonth: true,
        amount: true,
        request: { select: { formData: true } },
      },
      orderBy: [{ requestId: 'asc' }, { installmentNo: 'asc' }],
    });

    if (pending.length === 0) return 0;

    // Group installments by loan so we can recalculate balances per request.
    const byRequest = new Map<string, typeof pending>();
    for (const r of pending) {
      const group = byRequest.get(r.requestId) ?? [];
      group.push(r);
      byRequest.set(r.requestId, group);
    }

    for (const [requestId, installments] of byRequest) {
      const formData = (installments[0].request.formData ?? {}) as Record<string, unknown>;
      let totalRepaid = Number(formData.totalRepaid ?? 0);
      let remainingBalance = Number(formData.remainingBalance ?? 0);

      // Record one immutable ledger row per installment, capturing the running
      // balance after each deduction.
      const ledgerData: Prisma.LoanLedgerEntryCreateManyInput[] = [];
      for (const inst of installments) {
        const amount = Number(inst.amount);
        totalRepaid = Math.round((totalRepaid + amount) * 100) / 100;
        remainingBalance = Math.round((remainingBalance - amount) * 100) / 100;
        ledgerData.push({
          requestId,
          type: LoanLedgerEntryType.PAYROLL_DEDUCTION,
          amount,
          runningBalance: remainingBalance < 0 ? 0 : remainingBalance,
          transactionDate: processedAt,
          reference: `repayment:${inst.id}`,
          remarks: `${inst.scheduledMonth} payroll deduction`,
          createdById,
        });
      }

      const newStatus =
        remainingBalance <= 0 ? DynamicRequestStatus.COMPLETED : DynamicRequestStatus.REPAYING;

      await this.prisma.$transaction([
        this.prisma.loanRepayment.updateMany({
          where: { id: { in: installments.map((i) => i.id) } },
          data: { status: LoanRepaymentStatus.DEDUCTED, processedAt, processingNote: note },
        }),
        this.prisma.dynamicRequest.update({
          where: { id: requestId },
          data: {
            status: newStatus,
            formData: { ...formData, totalRepaid, remainingBalance },
          },
        }),
        this.prisma.loanLedgerEntry.createMany({ data: ledgerData }),
      ]);

      await this.prisma.auditLog.create({
        data: {
          action: 'LOAN_REPAYMENTS_AUTO_DEDUCTED',
          entityType: 'DynamicRequest',
          entityId: requestId,
          changes: {
            installments: installments.map((i) => i.installmentNo),
            note,
            totalRepaid,
            remainingBalance,
            requestStatus: newStatus,
          },
        },
      });
    }

    return pending.length;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Advance Salary
  // ─────────────────────────────────────────────────────────────────────────────

  private async deductAdvanceSalaryRepayments(
    monthFilter: Prisma.StringFilter,
    processedAt: Date,
    note: string,
  ): Promise<number> {
    const pending = await this.prisma.advanceSalaryRepayment.findMany({
      where: {
        scheduledMonth: monthFilter,
        status: AdvanceSalaryRepaymentStatus.PENDING,
        request: {
          status: { in: [DynamicRequestStatus.DISBURSED, DynamicRequestStatus.REPAYING] },
        },
      },
      select: {
        id: true,
        requestId: true,
        installmentNo: true,
        amount: true,
        request: { select: { formData: true } },
      },
      orderBy: [{ requestId: 'asc' }, { installmentNo: 'asc' }],
    });

    if (pending.length === 0) return 0;

    const byRequest = new Map<string, typeof pending>();
    for (const r of pending) {
      const group = byRequest.get(r.requestId) ?? [];
      group.push(r);
      byRequest.set(r.requestId, group);
    }

    for (const [requestId, installments] of byRequest) {
      const formData = (installments[0].request.formData ?? {}) as Record<string, unknown>;
      let totalRepaid = Number(formData.totalRepaid ?? 0);
      let remainingBalance = Number(formData.remainingBalance ?? 0);

      for (const inst of installments) {
        const amount = Number(inst.amount);
        totalRepaid = Math.round((totalRepaid + amount) * 100) / 100;
        remainingBalance = Math.round((remainingBalance - amount) * 100) / 100;
      }

      const newStatus =
        remainingBalance <= 0 ? DynamicRequestStatus.COMPLETED : DynamicRequestStatus.REPAYING;

      await this.prisma.$transaction([
        this.prisma.advanceSalaryRepayment.updateMany({
          where: { id: { in: installments.map((i) => i.id) } },
          data: {
            status: AdvanceSalaryRepaymentStatus.DEDUCTED,
            processedAt,
            processingNote: note,
          },
        }),
        this.prisma.dynamicRequest.update({
          where: { id: requestId },
          data: {
            status: newStatus,
            formData: { ...formData, totalRepaid, remainingBalance },
          },
        }),
      ]);

      await this.prisma.auditLog.create({
        data: {
          action: 'ADVANCE_SALARY_REPAYMENTS_AUTO_DEDUCTED',
          entityType: 'DynamicRequest',
          entityId: requestId,
          changes: {
            installments: installments.map((i) => i.installmentNo),
            note,
            totalRepaid,
            remainingBalance,
            requestStatus: newStatus,
          },
        },
      });
    }

    return pending.length;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Reimbursement Installments
  // ─────────────────────────────────────────────────────────────────────────────

  private async processReimbursementInstallments(
    cutoff: string,
    processedAt: Date,
    note: string,
  ): Promise<number> {
    const pending = await this.prisma.reimbursementInstallment.findMany({
      where: {
        scheduledMonth: { lt: cutoff },
        status: InstallmentStatus.PENDING,
        OR: [
          { reimbursement: { status: ReimbursementStatus.APPROVED } },
          {
            dynamicRequestId: { not: null },
            dynamicRequest: { typeKey: 'REIMBURSEMENT', status: 'APPROVED' },
          },
        ],
      },
      select: {
        id: true,
        reimbursementId: true,
        dynamicRequestId: true,
        installmentNo: true,
      },
      orderBy: [{ reimbursementId: 'asc' }, { installmentNo: 'asc' }],
    });

    if (pending.length === 0) return 0;

    // Bulk-update all past-due installments to PROCESSED.
    await this.prisma.reimbursementInstallment.updateMany({
      where: { id: { in: pending.map((i) => i.id) } },
      data: { status: InstallmentStatus.PROCESSED, processedAt, processingNotes: note },
    });

    const nowProcessedIds = new Set(pending.map((i) => i.id));

    // Legacy reimbursements — promote parent to PROCESSED when all installments done.
    const byReimbursement = new Map<string, typeof pending>();
    for (const inst of pending) {
      if (!inst.reimbursementId) continue;
      const group = byReimbursement.get(inst.reimbursementId) ?? [];
      group.push(inst);
      byReimbursement.set(inst.reimbursementId, group);
    }

    for (const [reimbursementId] of byReimbursement) {
      const allInstallments = await this.prisma.reimbursementInstallment.findMany({
        where: { reimbursementId },
        select: { id: true, status: true },
      });
      const allDone = allInstallments.every(
        (i) => i.status === InstallmentStatus.PROCESSED || nowProcessedIds.has(i.id),
      );
      if (allDone) {
        await this.prisma.reimbursementRequest.update({
          where: { id: reimbursementId },
          data: { status: ReimbursementStatus.PROCESSED, processedAt },
        });
      }
    }

    // Dynamic-request reimbursements — parent stays APPROVED (no PROCESSED status
    // in the dynamic flow); just audit per-instalment processing.
    await this.prisma.auditLog.create({
      data: {
        action: 'REIMBURSEMENT_INSTALLMENTS_AUTO_PROCESSED',
        entityType: 'ReimbursementInstallment',
        entityId: 'BATCH',
        changes: {
          count: pending.length,
          legacyCount: pending.filter((p) => p.reimbursementId).length,
          dynamicCount: pending.filter((p) => p.dynamicRequestId).length,
          cutoffMonth: cutoff,
        },
      },
    });

    return pending.length;
  }
}
