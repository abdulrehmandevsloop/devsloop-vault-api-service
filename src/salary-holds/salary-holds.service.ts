import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, SalaryHold, SalaryHoldLedgerType, SalaryHoldStatus } from '@prisma/client';
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

/** Held days of `[holdStart, holdEnd]` that fall inside the given month. */
export function heldDaysInMonth(holdStart: Date, holdEnd: Date, yearMonth: string): number {
  const { start, end } = monthBounds(yearMonth);
  const from = holdStart > start ? holdStart : start;
  const to = holdEnd < end ? holdEnd : end;
  return inclusiveDays(from, to);
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

/** Total amount a hold will withhold across its whole window. */
export function projectedHeldTotal(monthlySalary: number, holdStart: Date, holdEnd: Date): number {
  return round2(perDaySalary(monthlySalary) * heldDaysTotal(holdStart, holdEnd));
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

    const existing = await this.prisma.salaryHold.findFirst({
      where: { userId, status: SalaryHoldStatus.ACTIVE },
    });
    if (existing) {
      throw new ConflictException('Employee already has an active salary hold');
    }

    // The held amount is the salary for the held days (per-day = salary / 30),
    // known up-front from the dates — not gated on a payroll export.
    const projected = projectedHeldTotal(Number(user.baseSalaryMonthly), start, end);

    const hold = await this.prisma.salaryHold.create({
      data: {
        userId,
        startDate: start,
        endDate: end,
        notes: dto.notes,
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

    const salary = Number(hold.user.baseSalaryMonthly ?? 0);
    const released = await this.totalReleased(holdId);
    const projectedNew = projectedHeldTotal(salary, newStart, newEnd);
    // Can't shrink the window below what's already been released back to the staff.
    if (round2(projectedNew) < round2(released)) {
      throw new BadRequestException(
        `Cannot shorten the hold below the amount already released (${round2(released)})`,
      );
    }

    // Remaining held = projected for the new window − everything already released.
    const newBalance = remainingHeldTotal(salary, newStart, newEnd, released);
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

  /** Sum of everything released against a hold so far. */
  private async totalReleased(holdId: string, client: Prisma.TransactionClient = this.prisma) {
    const agg = await client.salaryHoldLedgerEntry.aggregate({
      where: { holdId, type: SalaryHoldLedgerType.RELEASE },
      _sum: { amount: true },
    });
    return Number(agg._sum.amount ?? 0);
  }

  /**
   * The salary-hold deduction to apply to one payroll month for a user: the held
   * days of that month priced at salary/30, minus releases (FIFO). Returns the
   * hold id so the caller can correlate. `null` when the user has no active hold
   * touching that month.
   */
  async getMonthHoldDeduction(
    userId: string,
    yearMonth: string,
    monthlySalary: number,
  ): Promise<{ holdId: string; amount: number } | null> {
    const hold = await this.getActiveHoldForUser(userId);
    if (!hold) return null;
    const released = await this.totalReleased(hold.id);
    const amount = remainingHeldForMonth(
      monthlySalary,
      hold.startDate,
      hold.endDate,
      yearMonth,
      released,
    );
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

    const releasedRows = await this.prisma.salaryHoldLedgerEntry.groupBy({
      by: ['holdId'],
      where: { holdId: { in: holds.map((h) => h.id) }, type: SalaryHoldLedgerType.RELEASE },
      _sum: { amount: true },
    });
    const releasedByHold = new Map(releasedRows.map((r) => [r.holdId, Number(r._sum.amount ?? 0)]));

    const enriched = holds.map((h) => {
      const salary = Number(h.user.baseSalaryMonthly ?? 0);
      const released = releasedByHold.get(h.id) ?? 0;
      const remaining = remainingHeldTotal(salary, h.startDate, h.endDate, released);
      const projected = projectedHeldTotal(salary, h.startDate, h.endDate);
      return { h, salary, released, remaining, projected };
    });

    const total = enriched.length;
    const totalHeld = round2(enriched.reduce((s, e) => s + e.remaining, 0));
    const expiredCount = enriched.filter((e) => e.h.endDate < now && e.remaining > 0).length;

    const items = enriched
      .slice((page - 1) * pageSize, page * pageSize)
      .map(({ h, salary, released, remaining, projected }) => ({
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
        monthlySalary: salary,
        expectedReleaseDate: h.endDate.toISOString(),
        status: h.status,
        expired: h.endDate < now && remaining > 0,
      }));

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

    const salary = Number(hold.user.baseSalaryMonthly ?? 0);
    const releasedSoFar = await this.totalReleased(holdId, tx);
    const remaining = remainingHeldTotal(salary, hold.startDate, hold.endDate, releasedSoFar);

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
