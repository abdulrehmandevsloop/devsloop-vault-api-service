import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Expense, ExpenseStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma';
import { AclService } from 'src/rbac/rbac.service';
import { CreateExpenseDto, ExpensesQueryDto, UpdateExpenseDto } from 'src/expenses/dto';

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aclService: AclService,
  ) {}

  private async assertAction(
    userId: string,
    action: 'view' | 'create' | 'edit' | 'delete' | 'export' | 'view-reports',
  ): Promise<void> {
    const actions = await this.aclService.getUserEntityActions(userId, 'manage-expense');
    const normalizedActionAliases: Record<
      'view' | 'create' | 'edit' | 'delete' | 'export' | 'view-reports',
      string[]
    > = {
      view: ['view', 'read', 'read_all', 'write'],
      create: ['create', 'write'],
      edit: ['edit', 'write'],
      delete: ['delete'],
      export: ['export', 'write'],
      'view-reports': ['view-reports', 'export', 'write'],
    };
    const allowedAliases = normalizedActionAliases[action];
    // Having any action on manage-expense implicitly grants view access
    const hasAction =
      action === 'view'
        ? actions.length > 0
        : actions.some((candidate) => allowedAliases.includes(candidate));
    if (!hasAction) {
      throw new ForbiddenException(`Access denied. Missing "${action}" action for manage-expense.`);
    }
  }

  private toResponse(expense: Expense & { createdBy: { name: string } }) {
    return {
      ...expense,
      amount: expense.amount.toString(),
      createdByName: expense.createdBy.name,
    };
  }

  async create(dto: CreateExpenseDto, userId: string) {
    await this.assertAction(userId, 'create');

    const expense = await this.prisma.expense.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        category: dto.category.trim(),
        amount: dto.amount,
        currency: dto.currency?.trim() || 'PKR',
        status: dto.status ?? ExpenseStatus.DRAFT,
        incurredAt: new Date(dto.incurredAt),
        createdById: userId,
      },
      include: {
        createdBy: {
          select: {
            name: true,
          },
        },
      },
    });

    return this.toResponse(expense);
  }

  async findAll(query: ExpensesQueryDto, userId: string) {
    await this.assertAction(userId, 'view');

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' as const } },
              { category: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.expense.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ incurredAt: 'desc' }, { createdAt: 'desc' }],
        include: {
          createdBy: {
            select: {
              name: true,
            },
          },
        },
      }),
      this.prisma.expense.count({ where }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: rows.map((row) => this.toResponse(row)),
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  async findOne(id: string, userId: string) {
    await this.assertAction(userId, 'view');

    const expense = await this.prisma.expense.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!expense) {
      throw new NotFoundException('Expense not found');
    }

    return this.toResponse(expense);
  }

  async update(id: string, dto: UpdateExpenseDto, userId: string) {
    await this.assertAction(userId, 'edit');

    const existing = await this.prisma.expense.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!existing) {
      throw new NotFoundException('Expense not found');
    }

    if (existing.status === ExpenseStatus.RECORDED) {
      throw new ForbiddenException('Recorded expenses cannot be edited');
    }

    const expense = await this.prisma.expense.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.category !== undefined ? { category: dto.category.trim() } : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency.trim() || 'PKR' } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.incurredAt !== undefined ? { incurredAt: new Date(dto.incurredAt) } : {}),
      },
      include: {
        createdBy: {
          select: {
            name: true,
          },
        },
      },
    });

    return this.toResponse(expense);
  }

  async remove(id: string, userId: string) {
    await this.assertAction(userId, 'delete');

    const existing = await this.prisma.expense.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Expense not found');
    }

    await this.prisma.expense.delete({ where: { id } });
  }

  // ── Reports ─────────────────────────────────────────────────────────────────

  async getMonthlyReport(year: number, month: number, userId: string) {
    await this.assertAction(userId, 'view-reports');

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);

    const dateRange = { incurredAt: { gte: start, lte: end } };

    const [byStatus, byCategory] = await Promise.all([
      this.prisma.expense.groupBy({
        by: ['status'],
        where: dateRange,
        _count: true,
        _sum: { amount: true },
        orderBy: { status: 'asc' },
      }),
      this.prisma.expense.groupBy({
        by: ['category'],
        where: { ...dateRange, status: ExpenseStatus.RECORDED },
        _count: true,
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
      }),
    ]);

    const draftEntry = byStatus.find((s) => s.status === ExpenseStatus.DRAFT);
    const recordedEntry = byStatus.find((s) => s.status === ExpenseStatus.RECORDED);
    const totalAmount = Number(recordedEntry?._sum.amount ?? 0);
    const totalCount = Number(recordedEntry?._count ?? 0);

    return {
      year,
      month,
      label: `${MONTH_LABELS[month - 1]} ${year}`,
      total: totalAmount.toFixed(2),
      count: totalCount,
      draft: {
        amount: Number(draftEntry?._sum.amount ?? 0).toFixed(2),
        count: Number(draftEntry?._count ?? 0),
      },
      recorded: {
        amount: Number(recordedEntry?._sum.amount ?? 0).toFixed(2),
        count: Number(recordedEntry?._count ?? 0),
      },
      byCategory: byCategory.map((c) => ({
        category: c.category,
        amount: Number(c._sum.amount ?? 0).toFixed(2),
        count: Number(c._count ?? 0),
      })),
    };
  }

  async getComparison(months: number, userId: string) {
    await this.assertAction(userId, 'view-reports');

    // Build N monthly slots going back from today
    const now = new Date();
    const slots: { year: number; month: number }[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      slots.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }

    const minDate = new Date(slots[0].year, slots[0].month - 1, 1);
    const maxDate = new Date(slots[slots.length - 1].year, slots[slots.length - 1].month, 0);

    const expenses = await this.prisma.expense.findMany({
      where: { incurredAt: { gte: minDate, lte: maxDate } },
      select: { incurredAt: true, amount: true, status: true },
    });

    const slotTotals = slots.map((slot) => {
      const slotExpenses = expenses.filter((e) => {
        const d = new Date(e.incurredAt);
        return d.getFullYear() === slot.year && d.getMonth() + 1 === slot.month;
      });

      const draft = slotExpenses
        .filter((e) => e.status === ExpenseStatus.DRAFT)
        .reduce((sum, e) => sum + Number(e.amount), 0);
      const recorded = slotExpenses
        .filter((e) => e.status === ExpenseStatus.RECORDED)
        .reduce((sum, e) => sum + Number(e.amount), 0);

      return { ...slot, total: recorded, count: slotExpenses.length, draft, recorded };
    });

    return {
      months: slotTotals.map((slot, i) => {
        const prevTotal = i > 0 ? slotTotals[i - 1].total : null;
        const changePercent =
          prevTotal !== null && prevTotal > 0
            ? Number((((slot.total - prevTotal) / prevTotal) * 100).toFixed(1))
            : null;

        return {
          year: slot.year,
          month: slot.month,
          label: `${MONTH_LABELS[slot.month - 1]} ${slot.year}`,
          total: slot.total.toFixed(2),
          count: slot.count,
          draft: slot.draft.toFixed(2),
          recorded: slot.recorded.toFixed(2),
          changePercent,
        };
      }),
    };
  }

  async exportCsv(year: number, month: number, userId: string): Promise<string> {
    await this.assertAction(userId, 'export');

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);

    const expenses = await this.prisma.expense.findMany({
      where: { incurredAt: { gte: start, lte: end } },
      include: { createdBy: { select: { name: true } } },
      orderBy: [{ incurredAt: 'asc' }, { createdAt: 'asc' }],
    });

    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const header = [
      'Title',
      'Category',
      'Amount',
      'Currency',
      'Status',
      'Date',
      'Recorded By',
    ].join(',');
    const rows = expenses.map((e) =>
      [
        escape(e.title),
        escape(e.category),
        e.amount.toString(),
        e.currency,
        e.status,
        fmtDate(e.incurredAt),
        escape(e.createdBy.name),
      ].join(','),
    );

    return [header, ...rows].join('\n');
  }
}
