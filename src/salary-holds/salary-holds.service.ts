import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  PayrollPeriodStatus,
  Prisma,
  SalaryHold,
  SalaryHoldLedgerType,
  SalaryHoldStatus,
} from '@prisma/client';
import { PrismaService } from 'src/prisma';
import { RequestContextService } from 'src/common/services/request-context.service';
import type { CreateSalaryHoldDto } from './dto/create-salary-hold.dto';
import type { ExtendSalaryHoldDto } from './dto/extend-salary-hold.dto';
import type { ListHeldSalariesDto } from './dto/list-held-salaries.dto';

/** Inclusive UTC bounds for a `YYYY-MM` month. */
export function monthBounds(yearMonth: string): { start: Date; end: Date } {
  const [y, m] = yearMonth.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
  return { start, end };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// A held day costs 1/30th of the monthly salary, regardless of the calendar
// month length — the same flat 30-day basis payroll uses for daily proration.
const HOLD_DAY_BASIS = 30;
const DAY_MS = 86_400_000;

/** Inclusive number of days between two dates (0 if end is before start). */
function inclusiveDays(start: Date, end: Date): number {
  if (end < start) return 0;
  return Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

/**
 * Held days of `[holdStart, holdEnd]` that fall inside the given month, capped at
 * the flat 30-day basis. A 31-day month that is fully held still counts as 30
 * days, so a single month never withholds more than the full monthly salary.
 */
export function heldDaysInMonth(holdStart: Date, holdEnd: Date, yearMonth: string): number {
  const { start, end } = monthBounds(yearMonth);
  const from = holdStart > start ? holdStart : start;
  const to = holdEnd < end ? holdEnd : end;
  return Math.min(inclusiveDays(from, to), HOLD_DAY_BASIS);
}

/** Total inclusive held days across the whole hold window. */
export function heldDaysTotal(holdStart: Date, holdEnd: Date): number {
  return inclusiveDays(holdStart, holdEnd);
}

/** Per-day salary on the flat 30-day basis. */
export function perDaySalary(monthlySalary: number): number {
  return monthlySalary / HOLD_DAY_BASIS;
}

/** Amount withheld for a single payroll month from a hold (held days × per-day). */
export function holdDeductionForMonth(
  monthlySalary: number,
  holdStart: Date,
  holdEnd: Date,
  yearMonth: string,
): number {
  return round2(perDaySalary(monthlySalary) * heldDaysInMonth(holdStart, holdEnd, yearMonth));
}

/**
 * Total amount a hold will withhold across its whole window — the sum of each
 * month's (30-day-capped) deduction, so a multi-month hold never exceeds one
 * full salary per month it spans.
 */
export function projectedHeldTotal(monthlySalary: number, holdStart: Date, holdEnd: Date): number {
  const total = monthsInRange(holdStart, holdEnd).reduce(
    (sum, m) => sum + holdDeductionForMonth(monthlySalary, holdStart, holdEnd, m),
    0,
  );
  return round2(total);
}

/**
 * Like {@link projectedHeldTotal} but each month is priced at its own salary
 * (e.g. months before a mid-hold increment keep the old rate, months from the
 * increment on use the new rate). `salaryByMonth` maps `YYYY-MM` → salary.
 */
export function projectedHeldFromSalaries(
  salaryByMonth: Map<string, number>,
  holdStart: Date,
  holdEnd: Date,
): number {
  const total = monthsInRange(holdStart, holdEnd).reduce(
    (sum, m) => sum + holdDeductionForMonth(salaryByMonth.get(m) ?? 0, holdStart, holdEnd, m),
    0,
  );
  return round2(total);
}

/** The `YYYY-MM` months a hold window spans, in chronological order. */
export function monthsInRange(start: Date, end: Date): string[] {
  const out: string[] = [];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  const ey = end.getUTCFullYear();
  const em = end.getUTCMonth();
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m + 1).padStart(2, '0')}`);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

/**
 * Remaining (still-withheld) amount for one payroll month of a hold, after
 * applying total releases FIFO across the hold's months (earliest first). This
 * is exactly what gets deducted from that month's payroll.
 */
export function remainingHeldForMonth(
  monthlySalary: number,
  holdStart: Date,
  holdEnd: Date,
  yearMonth: string,
  totalReleased: number,
): number {
  let releaseLeft = totalReleased;
  for (const m of monthsInRange(holdStart, holdEnd)) {
    const raw = holdDeductionForMonth(monthlySalary, holdStart, holdEnd, m);
    const alloc = Math.min(Math.max(0, releaseLeft), raw);
    releaseLeft -= alloc;
    if (m === yearMonth) return round2(Math.max(0, raw - alloc));
  }
  return 0; // month outside the hold window
}

/** Remaining held amount across the whole hold = projected − releases. */
export function remainingHeldTotal(
  monthlySalary: number,
  holdStart: Date,
  holdEnd: Date,
  totalReleased: number,
): number {
  return round2(Math.max(0, projectedHeldTotal(monthlySalary, holdStart, holdEnd) - totalReleased));
}

function monthsBetween(start: Date, end: Date): number {
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth()) +
    1;
  return Math.max(months, 0);
}

@Injectable()
export class SalaryHoldsService {
  private readonly logger = new Logger(SalaryHoldsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private monthOf(d: Date): string {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Ask payroll to recompute this employee's still-editable lines from `fromMonth`
   * onward so the salary-hold deduction reflects the change immediately. Handled
   * by a listener in PayrollModule (decoupled to avoid a circular dependency).
   * Awaited so the recalc finishes before we return — the UI sees fresh data on
   * its next fetch.
   */
  private async emitHoldChanged(userId: string, fromMonth: string): Promise<void> {
    await this.eventEmitter.emitAsync('salary-hold.changed', { userId, fromMonth });
  }

  private async audit(
    actorId: string,
    action: string,
    entityId: string,
    changes: Prisma.InputJsonValue,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await client.auditLog.create({
      data: {
        userId: actorId,
        action,
        entityType: 'SalaryHold',
        entityId,
        changes,
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * A hold's deduction lands on the payroll of every month it spans, so a hold
   * window may only cover months whose payroll is still editable (DRAFT) or not
   * created yet. Reject if any of `months` already has a payroll that is under
   * review, authorized or locked — its figures are frozen for sign-off.
   */
  private async assertMonthsHoldable(months: string[]): Promise<void> {
    if (months.length === 0) return;
    const conflicts = await this.prisma.payrollPeriod.findMany({
      where: {
        yearMonth: { in: months },
        status: {
          in: [
            PayrollPeriodStatus.PENDING_REVIEW,
            PayrollPeriodStatus.AUTHORIZED,
            PayrollPeriodStatus.LOCKED,
          ],
        },
      },
      select: { yearMonth: true, status: true },
      orderBy: { yearMonth: 'asc' },
    });
    if (conflicts.length === 0) return;
    const describe = (s: PayrollPeriodStatus): string =>
      s === PayrollPeriodStatus.PENDING_REVIEW
        ? 'under review'
        : s === PayrollPeriodStatus.AUTHORIZED
          ? 'authorized'
          : 'locked';
    const list = conflicts.map((c) => `${c.yearMonth} (${describe(c.status)})`).join(', ');
    throw new BadRequestException(
      `Salary can't be held over a payroll that is already being processed — ${list}. ` +
        'Adjust the hold period to cover only draft (not-yet-reviewed) months.',
    );
  }

  async createHold(userId: string, dto: CreateSalaryHoldDto, actorId: string): Promise<SalaryHold> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, isSystem: true, baseSalaryMonthly: true },
    });
    if (!user) throw new NotFoundException(`Employee ${userId} not found`);
    if (user.isSystem) {
      throw new BadRequestException('System users cannot be placed on salary hold');
    }
    if (!user.baseSalaryMonthly || Number(user.baseSalaryMonthly) <= 0) {
      throw new BadRequestException(
        'Cannot place salary on hold: no monthly salary is set for this employee',
      );
    }

    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (start >= end) {
      throw new BadRequestException('startDate must be before endDate');
    }

    await this.assertMonthsHoldable(monthsInRange(start, end));

    const existing = await this.prisma.salaryHold.findFirst({
      where: { userId, status: SalaryHoldStatus.ACTIVE },
    });
    if (existing) {
      throw new ConflictException('Employee already has an active salary hold');
    }

    // Snapshot the salary now so the held amount is fixed at this rate — a later
    // increment/decrement must not change what was held. The held amount is the
    // salary for the held days (per-day = salary / 30), known up-front from the
    // dates — not gated on a payroll export.
    const snapshotSalary = Number(user.baseSalaryMonthly);
    const projected = projectedHeldTotal(snapshotSalary, start, end);

    const hold = await this.prisma.salaryHold.create({
      data: {
        userId,
        startDate: start,
        endDate: end,
        notes: dto.notes,
        monthlySalary: new Prisma.Decimal(snapshotSalary),
        heldBalance: new Prisma.Decimal(projected),
        createdById: actorId,
      },
    });

    await this.audit(actorId, 'SALARY_HOLD_CREATED', hold.id, {
      userId,
      startDate: dto.startDate,
      endDate: dto.endDate,
      projectedHeld: projected,
    });
    await this.emitHoldChanged(userId, this.monthOf(start));
    return hold;
  }

  /**
   * Change a hold's period — HR can either shorten or extend it. The held balance
   * is recomputed for the new window (minus anything already released) and the
   * affected payroll months are recalculated so the deduction updates.
   */
  async changeHoldPeriod(
    holdId: string,
    dto: ExtendSalaryHoldDto,
    actorId: string,
  ): Promise<SalaryHold> {
    const hold = await this.prisma.salaryHold.findUnique({
      where: { id: holdId },
      include: { user: { select: { baseSalaryMonthly: true } } },
    });
    if (!hold) throw new NotFoundException(`Salary hold ${holdId} not found`);
    if (hold.status === SalaryHoldStatus.CANCELLED) {
      throw new BadRequestException('Cannot modify a cancelled salary hold');
    }

    const newEnd = new Date(dto.endDate);
    const newStart = dto.startDate ? new Date(dto.startDate) : hold.startDate;
    if (Number.isNaN(newEnd.getTime()) || Number.isNaN(newStart.getTime())) {
      throw new BadRequestException('Invalid start or end date');
    }
    if (newStart >= newEnd) {
      throw new BadRequestException('Start date must be before end date');
    }

    // Only newly-added months are validated — months the hold already covered are
    // grandfathered even if their payroll has since moved past draft.
    const alreadyCovered = new Set(monthsInRange(hold.startDate, hold.endDate));
    await this.assertMonthsHoldable(
      monthsInRange(newStart, newEnd).filter((m) => !alreadyCovered.has(m)),
    );

    // Price each month of the new window at its own salary (line salary per
    // month, snapshot fallback) so a mid-hold increment is respected.
    const fallbackSalary = Number(hold.monthlySalary ?? hold.user.baseSalaryMonthly ?? 0);
    const salaryByMonth = await this.holdMonthlySalaries(
      hold.userId,
      newStart,
      newEnd,
      fallbackSalary,
    );
    const released = await this.totalReleased(holdId);
    const projectedNew = projectedHeldFromSalaries(salaryByMonth, newStart, newEnd);
    // Can't shrink the window below what's already been released back to the staff.
    if (round2(projectedNew) < round2(released)) {
      throw new BadRequestException(
        `Cannot shorten the hold below the amount already released (${round2(released)})`,
      );
    }

    // Remaining held = projected for the new window − everything already released.
    const newBalance = round2(Math.max(0, projectedNew - released));
    // Active while something is still held; closed once nothing remains.
    const status = newBalance > 0 ? SalaryHoldStatus.ACTIVE : SalaryHoldStatus.CLOSED;

    const updated = await this.prisma.salaryHold.update({
      where: { id: holdId },
      data: {
        startDate: newStart,
        endDate: newEnd,
        notes: dto.notes ?? hold.notes,
        status,
        heldBalance: new Prisma.Decimal(newBalance),
      },
    });

    await this.audit(actorId, 'SALARY_HOLD_PERIOD_CHANGED', holdId, {
      previousStartDate: hold.startDate.toISOString(),
      previousEndDate: hold.endDate.toISOString(),
      startDate: updated.startDate.toISOString(),
      endDate: updated.endDate.toISOString(),
      heldBalance: newBalance,
    });

    // Recalc from the earliest of the old/new start so removed months clear their
    // deduction and added months pick it up.
    const fromMonth =
      hold.startDate < newStart ? this.monthOf(hold.startDate) : this.monthOf(newStart);
    await this.emitHoldChanged(hold.userId, fromMonth);

    return updated;
  }

  async cancelHold(holdId: string, actorId: string): Promise<SalaryHold> {
    const hold = await this.prisma.salaryHold.findUnique({ where: { id: holdId } });
    if (!hold) throw new NotFoundException(`Salary hold ${holdId} not found`);
    if (Number(hold.heldBalance) > 0) {
      throw new BadRequestException(
        'Cannot cancel a hold with a held balance — release the remaining amount first',
      );
    }
    const updated = await this.prisma.salaryHold.update({
      where: { id: holdId },
      data: { status: SalaryHoldStatus.CANCELLED },
    });
    await this.audit(actorId, 'SALARY_HOLD_CANCELLED', holdId, {});
    await this.emitHoldChanged(hold.userId, this.monthOf(hold.startDate));
    return updated;
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  /** The single active hold for a user (used by the User Management UI). */
  async getActiveHoldForUser(userId: string): Promise<SalaryHold | null> {
    return this.prisma.salaryHold.findFirst({
      where: { userId, status: SalaryHoldStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Holds whose `[startDate, endDate]` window overlaps the given month. */
  async getActiveHoldsForMonth(yearMonth: string): Promise<Map<string, SalaryHold>> {
    const { start, end } = monthBounds(yearMonth);
    const holds = await this.prisma.salaryHold.findMany({
      where: {
        status: SalaryHoldStatus.ACTIVE,
        startDate: { lte: end },
        endDate: { gte: start },
      },
    });
    return new Map(holds.map((h) => [h.userId, h]));
  }

  /**
   * The salary to price each month of a hold at: the payroll line's salary for
   * that month if it exists (frozen once the month is locked, incremented once a
   * later month is synced), else the hold's snapshot rate so not-yet-processed
   * months don't show a future increment early. `YYYY-MM` → salary.
   */
  private async holdMonthlySalaries(
    userId: string,
    holdStart: Date,
    holdEnd: Date,
    fallbackSalary: number,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<Map<string, number>> {
    const months = monthsInRange(holdStart, holdEnd);
    if (months.length === 0) return new Map();
    const lines = await client.payrollLine.findMany({
      where: { userId, period: { yearMonth: { in: months } } },
      select: { baseSalaryMonthly: true, period: { select: { yearMonth: true } } },
    });
    const byMonth = new Map(lines.map((l) => [l.period.yearMonth, Number(l.baseSalaryMonthly)]));
    return new Map(months.map((m) => [m, byMonth.get(m) ?? fallbackSalary]));
  }

  /** Sum of everything released against a hold so far. */
  private async totalReleased(holdId: string, client: Prisma.TransactionClient = this.prisma) {
    const agg = await client.salaryHoldLedgerEntry.aggregate({
      where: { holdId, type: SalaryHoldLedgerType.RELEASE },
      _sum: { amount: true },
    });
    return Number(agg._sum.amount ?? 0);
  }

  /** Sum released against a hold for one specific payroll month (`YYYY-MM`). */
  async getReleasedForMonth(
    holdId: string,
    yearMonth: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    const agg = await client.salaryHoldLedgerEntry.aggregate({
      where: { holdId, type: SalaryHoldLedgerType.RELEASE, yearMonth },
      _sum: { amount: true },
    });
    return Number(agg._sum.amount ?? 0);
  }

  /**
   * The salary-hold deduction to apply to one payroll month for a user: the held
   * days of that month priced at salary/30, minus anything released **against that
   * same month**. Returns the hold id so the caller can correlate. `null` when no
   * hold touches that month.
   *
   * Each month withholds independently (`raw − releasedAgainstMonth`). A release
   * is attributed to exactly one target month, so it only shrinks that month's
   * deduction; other months keep withholding. Crucially this looks at CLOSED
   * holds too (not just the single ACTIVE one): a release that zeroes the balance
   * closes the hold, but its other months must keep withholding — otherwise their
   * salary would be paid both here (deduction gone) and as the released-salary
   * addition, double-counting it.
   */
  async getMonthHoldDeduction(
    userId: string,
    yearMonth: string,
    monthlySalary: number,
  ): Promise<{ holdId: string; amount: number } | null> {
    const { start, end } = monthBounds(yearMonth);
    const hold = await this.prisma.salaryHold.findFirst({
      where: {
        userId,
        status: { in: [SalaryHoldStatus.ACTIVE, SalaryHoldStatus.CLOSED] },
        startDate: { lte: end },
        endDate: { gte: start },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!hold) return null;
    // Price the held days at THIS month's salary: the payroll line's salary for
    // the month (passed in) — already frozen once the month is locked, and the
    // incremented rate once a later month is re-synced. Fall back to the hold's
    // snapshot only when the line has no salary yet.
    const heldSalary = monthlySalary > 0 ? monthlySalary : Number(hold.monthlySalary ?? 0);
    const raw = holdDeductionForMonth(heldSalary, hold.startDate, hold.endDate, yearMonth);
    const releasedThisMonth = await this.getReleasedForMonth(hold.id, yearMonth);
    const amount = round2(Math.max(0, raw - releasedThisMonth));
    return { holdId: hold.id, amount };
  }

  /** Holds that are past their end date but still carry an unreleased balance. */
  async getExpiredHolds(
    userIds: string[],
    asOf: Date,
  ): Promise<Array<{ holdId: string; userId: string; heldBalance: number; endDate: Date }>> {
    const holds = await this.prisma.salaryHold.findMany({
      where: {
        userId: { in: userIds },
        status: SalaryHoldStatus.ACTIVE,
        endDate: { lt: asOf },
        heldBalance: { gt: 0 },
      },
    });
    return holds.map((h) => ({
      holdId: h.id,
      userId: h.userId,
      heldBalance: Number(h.heldBalance),
      endDate: h.endDate,
    }));
  }

  async listHeldSalaries(query: ListHeldSalariesDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    const where: Prisma.SalaryHoldWhereInput = {
      OR: [{ status: SalaryHoldStatus.ACTIVE }, { heldBalance: { gt: 0 } }],
      ...(query.search
        ? {
            user: {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { employeeId: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const now = new Date();
    // Load all matching holds (a small set) so the held amount can be derived
    // from dates − releases — always consistent with the payroll deduction and
    // immune to any stored-balance drift.
    const holds = await this.prisma.salaryHold.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, employeeId: true, baseSalaryMonthly: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const releaseLedger = await this.prisma.salaryHoldLedgerEntry.findMany({
      where: { holdId: { in: holds.map((h) => h.id) }, type: SalaryHoldLedgerType.RELEASE },
      select: { holdId: true, yearMonth: true, amount: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    // Total released per hold and the full release history (which payroll month
    // each release was paid into). Per-month "released" is derived oldest-first
    // below — not by the payment month — so the breakdown reads intuitively.
    const releasedByHold = new Map<string, number>();
    const releasesByHold = new Map<
      string,
      Array<{ yearMonth: string; amount: number; at: string }>
    >();
    for (const e of releaseLedger) {
      const amt = Number(e.amount);
      releasedByHold.set(e.holdId, (releasedByHold.get(e.holdId) ?? 0) + amt);
      const list = releasesByHold.get(e.holdId) ?? [];
      list.push({ yearMonth: e.yearMonth, amount: round2(amt), at: e.createdAt.toISOString() });
      releasesByHold.set(e.holdId, list);
    }

    // Per-month salary for every hold (line salary per month, snapshot fallback),
    // so each month is priced at its own rate — a mid-hold increment only affects
    // the months from the increment onward.
    const salaryMaps = new Map<string, Map<string, number>>();
    await Promise.all(
      holds.map(async (h) => {
        const fallback = Number(h.monthlySalary ?? h.user.baseSalaryMonthly ?? 0);
        salaryMaps.set(
          h.id,
          await this.holdMonthlySalaries(h.userId, h.startDate, h.endDate, fallback),
        );
      }),
    );

    const enriched = holds
      .map((h) => {
        const fallback = Number(h.monthlySalary ?? h.user.baseSalaryMonthly ?? 0);
        const salaryByMonth = salaryMaps.get(h.id) ?? new Map<string, number>();
        const released = releasedByHold.get(h.id) ?? 0;
        const projected = projectedHeldFromSalaries(salaryByMonth, h.startDate, h.endDate);
        const remaining = round2(Math.max(0, projected - released));
        return { h, fallback, salaryByMonth, released, remaining, projected };
      })
      // Only holds that still have money set aside count as "held". A fully
      // released hold has nothing left to roll out, so it drops off the list
      // (and out of the count) even while its row is still ACTIVE.
      .filter((e) => e.remaining > 0);

    const total = enriched.length;
    const totalHeld = round2(enriched.reduce((s, e) => s + e.remaining, 0));
    const expiredCount = enriched.filter((e) => e.h.endDate < now).length;

    const items = enriched
      .slice((page - 1) * pageSize, page * pageSize)
      .map(({ h, fallback, salaryByMonth, released, remaining, projected }) => {
        // Per-month: the raw held amount (priced at that month's own salary) and
        // how much of it has been released. Releases are applied oldest-month
        // first (FIFO) so the breakdown reads intuitively and doesn't depend on
        // which payroll month the money was actually paid into.
        let releaseLeft = released;
        const monthly = monthsInRange(h.startDate, h.endDate).map((ym) => {
          const heldAmount = round2(
            holdDeductionForMonth(salaryByMonth.get(ym) ?? 0, h.startDate, h.endDate, ym),
          );
          const releasedAmount = round2(Math.min(Math.max(0, releaseLeft), heldAmount));
          releaseLeft = round2(releaseLeft - releasedAmount);
          return {
            yearMonth: ym,
            heldDays: heldDaysInMonth(h.startDate, h.endDate, ym),
            heldAmount,
            releasedAmount,
            remaining: round2(heldAmount - releasedAmount),
          };
        });
        return {
          id: h.id,
          userId: h.userId,
          employeeName: h.user.name,
          employeeCode: h.user.employeeId,
          startDate: h.startDate.toISOString(),
          endDate: h.endDate.toISOString(),
          durationMonths: monthsBetween(h.startDate, h.endDate),
          durationDays: heldDaysTotal(h.startDate, h.endDate),
          heldBalance: remaining.toString(),
          releasedTotal: round2(released),
          projectedTotal: projected,
          monthlySalary: fallback,
          expectedReleaseDate: h.endDate.toISOString(),
          status: h.status,
          expired: h.endDate < now && remaining > 0,
          monthly,
          releases: releasesByHold.get(h.id) ?? [],
        };
      });

    return {
      items,
      total,
      page,
      pageSize,
      summary: { count: total, totalHeld, expiredCount },
    };
  }

  // ── Ledger primitives ───────────────────────────────────────────────────────

  /**
   * Record a manual release of part/all of the held balance. Returns the new
   * outstanding balance and the rounded amount actually released. Does NOT touch
   * payroll lines — the caller (PayrollService.releaseHeldSalary) creates the
   * salary-addition.
   *
   * Pass a transaction client (`tx`) to make the release atomic with the caller's
   * other writes (e.g. the salary-addition). The balance is decremented with a
   * conditional update so two concurrent releases can never over-release.
   */
  async recordRelease(
    holdId: string,
    args: {
      yearMonth: string;
      amount: number;
      reference?: string;
      remarks?: string;
      actorId: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ heldBalance: number; released: number }> {
    if (tx) return this.recordReleaseWithin(tx, holdId, args);
    return this.prisma.$transaction((client) => this.recordReleaseWithin(client, holdId, args));
  }

  private async recordReleaseWithin(
    tx: Prisma.TransactionClient,
    holdId: string,
    args: {
      yearMonth: string;
      amount: number;
      reference?: string;
      remarks?: string;
      actorId: string;
    },
  ): Promise<{ heldBalance: number; released: number }> {
    const hold = await tx.salaryHold.findUnique({
      where: { id: holdId },
      include: { user: { select: { baseSalaryMonthly: true } } },
    });
    if (!hold) throw new NotFoundException(`Salary hold ${holdId} not found`);

    // Each held month is priced at its own salary, so the releasable balance
    // reflects the per-month rates (e.g. months before a mid-hold increment stay
    // at the old rate). Snapshot is the fallback for not-yet-processed months.
    const fallbackSalary = Number(hold.monthlySalary ?? hold.user.baseSalaryMonthly ?? 0);
    const salaryByMonth = await this.holdMonthlySalaries(
      hold.userId,
      hold.startDate,
      hold.endDate,
      fallbackSalary,
      tx,
    );
    const releasedSoFar = await this.totalReleased(holdId, tx);
    const remaining = round2(
      Math.max(
        0,
        projectedHeldFromSalaries(salaryByMonth, hold.startDate, hold.endDate) - releasedSoFar,
      ),
    );

    const amount = round2(args.amount);
    if (amount <= 0) throw new BadRequestException('Release amount must be positive');
    if (amount > remaining) {
      throw new BadRequestException(
        `Release amount ${amount} exceeds the held balance ${remaining}`,
      );
    }

    const newBalance = round2(remaining - amount);

    await tx.salaryHoldLedgerEntry.create({
      data: {
        holdId,
        type: SalaryHoldLedgerType.RELEASE,
        yearMonth: args.yearMonth,
        amount: new Prisma.Decimal(amount),
        runningBalance: new Prisma.Decimal(newBalance),
        reference: args.reference,
        remarks: args.remarks ?? `Released into ${args.yearMonth} payroll`,
        createdById: args.actorId,
      },
    });

    await tx.salaryHold.update({
      where: { id: holdId },
      data: {
        heldBalance: new Prisma.Decimal(newBalance),
        // Nothing left to hold → close it (matches "if no amount remaining, don't hold").
        ...(newBalance === 0 ? { status: SalaryHoldStatus.CLOSED } : {}),
      },
    });

    await this.audit(
      args.actorId,
      'SALARY_HOLD_RELEASED',
      holdId,
      { amount, yearMonth: args.yearMonth, remainingBalance: newBalance },
      tx,
    );

    return { heldBalance: newBalance, released: amount };
  }

  async getLedger(holdId: string) {
    const hold = await this.prisma.salaryHold.findUnique({ where: { id: holdId } });
    if (!hold) throw new NotFoundException(`Salary hold ${holdId} not found`);
    return this.prisma.salaryHoldLedgerEntry.findMany({
      where: { holdId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
