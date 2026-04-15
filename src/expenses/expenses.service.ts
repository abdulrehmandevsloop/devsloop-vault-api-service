import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Expense, ExpenseStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma';
import { AclService } from 'src/rbac/rbac.service';
import { CreateExpenseDto, ExpensesQueryDto, UpdateExpenseDto } from 'src/expenses/dto';

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aclService: AclService,
  ) {}

  private async assertAction(
    userId: string,
    action: 'view' | 'create' | 'edit' | 'delete',
  ): Promise<void> {
    const actions = await this.aclService.getUserEntityActions(userId, 'manage-expense');
    const normalizedActionAliases: Record<'view' | 'create' | 'edit' | 'delete', string[]> = {
      view: ['view', 'read', 'read_all', 'write'],
      create: ['create', 'write'],
      edit: ['edit', 'write'],
      delete: ['delete'],
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
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Expense not found');
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
}
