import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Prisma,
  SalaryAdjustmentCategory,
  SalaryAdjustmentStatus,
  SalaryAdjustmentType,
} from '@prisma/client';
import { PrismaService } from 'src/prisma';
import { SystemConfigService } from 'src/system-config';
import type { CreateSalaryAdjustmentDto } from './dto/create-salary-adjustment.dto';
import type { UpdateSalaryAdjustmentDto } from './dto/update-salary-adjustment.dto';
import type { ListSalaryAdjustmentsDto } from './dto/list-salary-adjustments.dto';
import type { DecideSalaryAdjustmentDto } from './dto/decide-salary-adjustment.dto';
import {
  SalaryAdjustmentSubmittedEvent,
  SalaryAdjustmentApprovedEvent,
  SalaryAdjustmentRejectedEvent,
} from './events/salary-adjustment.events';

const ADDITION_TYPES: SalaryAdjustmentType[] = [
  SalaryAdjustmentType.SALARY_INCREMENT,
  SalaryAdjustmentType.PENDING_SALARY,
  SalaryAdjustmentType.ARREARS_ADJUSTMENT,
  SalaryAdjustmentType.CORRECTION_UNDERPAYMENT,
];

const DEDUCTION_TYPES: SalaryAdjustmentType[] = [
  SalaryAdjustmentType.LEAVE_DEDUCTION,
  SalaryAdjustmentType.TAX_ADJUSTMENT,
  SalaryAdjustmentType.PENALTY_FINE,
  SalaryAdjustmentType.CORRECTION_OVERPAYMENT,
];

@Injectable()
export class SalaryAdjustmentsService {
  private readonly logger = new Logger(SalaryAdjustmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemConfig: SystemConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private validateCategoryType(
    category: SalaryAdjustmentCategory,
    type: SalaryAdjustmentType,
  ): void {
    const allowed =
      category === SalaryAdjustmentCategory.ADDITION ? ADDITION_TYPES : DEDUCTION_TYPES;
    if (!allowed.includes(type)) {
      throw new BadRequestException(`Type ${type} is not valid for category ${category}`);
    }
  }

  async create(dto: CreateSalaryAdjustmentDto, savedById: string) {
    this.validateCategoryType(dto.category, dto.type);

    const employee = await this.prisma.user.findUnique({
      where: { id: dto.employeeId },
      select: { id: true, name: true },
    });
    if (!employee) throw new NotFoundException(`Employee ${dto.employeeId} not found`);

    const created = await this.prisma.salaryAdjustment.create({
      data: {
        employeeId: dto.employeeId,
        yearMonth: dto.yearMonth,
        category: dto.category,
        type: dto.type,
        amount: new Prisma.Decimal(dto.amount),
        reason: dto.reason,
        applyToCurrent: dto.applyToCurrent ?? true,
        savedById,
        status: SalaryAdjustmentStatus.PENDING,
      },
    });

    this.logger.log(
      `Salary adjustment ${created.id} created by ${savedById} for ${employee.id} (${dto.yearMonth})`,
    );

    await this.notifySubmitted(created.id);

    return { ...created, cutoffShifted: false };
  }

  async update(id: string, dto: UpdateSalaryAdjustmentDto, actorId: string) {
    const existing = await this.prisma.salaryAdjustment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Adjustment ${id} not found`);
    if (existing.status !== SalaryAdjustmentStatus.PENDING) {
      throw new BadRequestException('Only PENDING adjustments can be edited');
    }
    if (existing.savedById !== actorId) {
      throw new ForbiddenException('Only the requester can edit this adjustment');
    }

    if (dto.category && dto.type) this.validateCategoryType(dto.category, dto.type);

    return this.prisma.salaryAdjustment.update({
      where: { id },
      data: {
        ...(dto.employeeId !== undefined && { employeeId: dto.employeeId }),
        ...(dto.yearMonth !== undefined && { yearMonth: dto.yearMonth }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.amount !== undefined && { amount: new Prisma.Decimal(dto.amount) }),
        ...(dto.reason !== undefined && { reason: dto.reason }),
        ...(dto.applyToCurrent !== undefined && { applyToCurrent: dto.applyToCurrent }),
      },
    });
  }

  async delete(id: string, actorId: string): Promise<void> {
    const existing = await this.prisma.salaryAdjustment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Adjustment ${id} not found`);
    if (existing.status !== SalaryAdjustmentStatus.PENDING) {
      throw new BadRequestException('Only PENDING adjustments can be deleted');
    }
    if (existing.savedById !== actorId) {
      throw new ForbiddenException('Only the requester can delete this adjustment');
    }
    await this.prisma.salaryAdjustment.delete({ where: { id } });
  }

  async list(query: ListSalaryAdjustmentsDto) {
    const where: Prisma.SalaryAdjustmentWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.yearMonth) where.yearMonth = query.yearMonth;
    if (query.employeeId) where.employeeId = query.employeeId;

    const orderBy: Prisma.SalaryAdjustmentOrderByWithRelationInput[] = [
      { status: 'asc' },
      { createdAt: 'desc' },
    ];
    const include = {
      employee: { select: { id: true, name: true, employeeId: true, baseSalaryMonthly: true } },
      savedBy: { select: { id: true, name: true } },
      authorizedBy: { select: { id: true, name: true } },
    };

    const usePagination = query.page != null || query.limit != null;
    if (!usePagination) {
      const data = await this.prisma.salaryAdjustment.findMany({
        where,
        orderBy,
        include,
      });
      const total = data.length;
      return {
        data,
        total,
        page: 1,
        limit: total,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      };
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [total, data] = await Promise.all([
      this.prisma.salaryAdjustment.count({ where }),
      this.prisma.salaryAdjustment.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data,
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  async getOne(id: string) {
    const adj = await this.prisma.salaryAdjustment.findUnique({
      where: { id },
      include: {
        employee: { select: { id: true, name: true, employeeId: true, baseSalaryMonthly: true } },
        savedBy: { select: { id: true, name: true } },
        authorizedBy: { select: { id: true, name: true } },
      },
    });
    if (!adj) throw new NotFoundException(`Adjustment ${id} not found`);
    return adj;
  }

  async approve(id: string, dto: DecideSalaryAdjustmentDto, actorId: string) {
    await this.assertIsPrimaryAuthorizer(actorId);
    const adj = await this.prisma.salaryAdjustment.findUnique({ where: { id } });
    if (!adj) throw new NotFoundException(`Adjustment ${id} not found`);
    if (adj.status !== SalaryAdjustmentStatus.PENDING) {
      throw new BadRequestException('Only PENDING adjustments can be approved');
    }

    // Negative-balance check: total approved+pending deductions for that month vs gross.
    if (adj.category === SalaryAdjustmentCategory.DEDUCTION) {
      await this.checkNegativeBalance(adj.employeeId, adj.yearMonth, adj.amount);
    }

    return this.prisma
      .$transaction(async (tx) => {
        const updated = await tx.salaryAdjustment.update({
          where: { id },
          data: {
            status: SalaryAdjustmentStatus.APPROVED,
            authorizedById: actorId,
            decidedAt: new Date(),
            decisionComment: dto.comment ?? null,
          },
        });

        // Salary increment → mutate baseSalaryMonthly, optionally for next month only.
        if (adj.type === SalaryAdjustmentType.SALARY_INCREMENT && adj.applyToCurrent) {
          // Increment is treated as ADDITION delta. Bump base salary now.
          await tx.user.update({
            where: { id: adj.employeeId },
            data: {
              baseSalaryMonthly: {
                increment: adj.amount,
              },
            },
          });
        } else if (adj.type === SalaryAdjustmentType.SALARY_INCREMENT && !adj.applyToCurrent) {
          // Defer: bump on first day of target month — handled here at approval time
          // since that month must be the target month already.
          await tx.user.update({
            where: { id: adj.employeeId },
            data: { baseSalaryMonthly: { increment: adj.amount } },
          });
        }

        // Always update payroll line aggregates regardless of period lock status —
        // adjustments are a post-lock correction flow and must reflect immediately.
        const period = await tx.payrollPeriod.findUnique({
          where: { yearMonth: adj.yearMonth },
          select: { id: true, status: true },
        });
        if (period) {
          const line = await tx.payrollLine.findUnique({
            where: { periodId_userId: { periodId: period.id, userId: adj.employeeId } },
            select: { id: true, salaryAdditions: true, salaryDeductions: true },
          });
          if (line) {
            const isAddition = adj.category === SalaryAdjustmentCategory.ADDITION;
            await tx.payrollLine.update({
              where: { id: line.id },
              data: isAddition
                ? { salaryAdditions: { increment: adj.amount } }
                : { salaryDeductions: { increment: adj.amount } },
            });
          }
        }

        return updated;
      })
      .then(async (updated) => {
        await this.notifyApproved(updated.id);
        return updated;
      });
  }

  async reject(id: string, dto: DecideSalaryAdjustmentDto, actorId: string) {
    await this.assertIsPrimaryAuthorizer(actorId);
    const adj = await this.prisma.salaryAdjustment.findUnique({ where: { id } });
    if (!adj) throw new NotFoundException(`Adjustment ${id} not found`);
    if (adj.status !== SalaryAdjustmentStatus.PENDING) {
      throw new BadRequestException('Only PENDING adjustments can be rejected');
    }

    const updated = await this.prisma.salaryAdjustment.update({
      where: { id },
      data: {
        status: SalaryAdjustmentStatus.REJECTED,
        authorizedById: actorId,
        decidedAt: new Date(),
        decisionComment: dto.comment ?? null,
      },
    });

    await this.notifyRejected(updated.id);
    return updated;
  }

  /** Sum of approved adjustments for a (user, month) — used by payroll calc. */
  async getApprovedTotalsForLine(
    userId: string,
    yearMonth: string,
  ): Promise<{ additions: number; deductions: number }> {
    const grouped = await this.prisma.salaryAdjustment.groupBy({
      by: ['category'],
      where: {
        employeeId: userId,
        yearMonth,
        status: { in: [SalaryAdjustmentStatus.APPROVED, SalaryAdjustmentStatus.APPLIED] },
      },
      _sum: { amount: true },
    });
    let additions = 0;
    let deductions = 0;
    for (const g of grouped) {
      const v = Number(g._sum.amount ?? 0);
      if (g.category === SalaryAdjustmentCategory.ADDITION) additions = v;
      else deductions = v;
    }
    return { additions, deductions };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async assertIsPrimaryAuthorizer(actorId: string): Promise<void> {
    const config = await this.systemConfig.getPayrollConfig();
    if (!config.primaryAuthorizerId || config.primaryAuthorizerId !== actorId) {
      throw new ForbiddenException(
        'Only the primary payroll authorizer can approve or reject salary adjustments',
      );
    }
  }

  private async checkNegativeBalance(
    employeeId: string,
    yearMonth: string,
    pendingDeduction: Prisma.Decimal,
  ): Promise<void> {
    const employee = await this.prisma.user.findUnique({
      where: { id: employeeId },
      select: { baseSalaryMonthly: true },
    });
    const gross = Number(employee?.baseSalaryMonthly ?? 0);
    const approved = await this.prisma.salaryAdjustment.aggregate({
      where: {
        employeeId,
        yearMonth,
        category: SalaryAdjustmentCategory.DEDUCTION,
        status: SalaryAdjustmentStatus.APPROVED,
      },
      _sum: { amount: true },
    });
    const totalDeductions = Number(approved._sum.amount ?? 0) + Number(pendingDeduction);
    if (gross > 0 && totalDeductions > gross) {
      // Flag the record for manual review and block approval.
      await this.prisma.salaryAdjustment.updateMany({
        where: { employeeId, yearMonth, status: SalaryAdjustmentStatus.PENDING },
        data: { flaggedReview: true },
      });
      throw new BadRequestException(
        `Total deductions (PKR ${totalDeductions}) exceed gross salary (PKR ${gross}). Flagged for manual financial review.`,
      );
    }
  }

  private async notifySubmitted(id: string): Promise<void> {
    const adj = await this.getOne(id);
    const config = await this.systemConfig.getPayrollConfig();
    if (!config.primaryAuthorizerId) return;
    const authorizer = await this.prisma.user.findUnique({
      where: { id: config.primaryAuthorizerId },
      select: { email: true, name: true },
    });
    if (!authorizer) return;
    this.eventEmitter.emit(
      'salary-adjustment.submitted',
      new SalaryAdjustmentSubmittedEvent(
        adj.id,
        adj.yearMonth,
        adj.employee.name,
        adj.savedBy.name,
        Number(adj.amount),
        adj.category,
        adj.type,
        authorizer.email,
      ),
    );
  }

  private async notifyApproved(id: string): Promise<void> {
    const adj = await this.getOne(id);
    const submitter = await this.prisma.user.findUnique({
      where: { id: adj.savedById },
      select: { email: true, name: true },
    });
    if (!submitter) return;
    this.eventEmitter.emit(
      'salary-adjustment.approved',
      new SalaryAdjustmentApprovedEvent(
        adj.id,
        adj.yearMonth,
        adj.employee.name,
        adj.authorizedBy?.name ?? 'Authorizer',
        Number(adj.amount),
        submitter.email,
      ),
    );
  }

  private async notifyRejected(id: string): Promise<void> {
    const adj = await this.getOne(id);
    const submitter = await this.prisma.user.findUnique({
      where: { id: adj.savedById },
      select: { email: true, name: true },
    });
    if (!submitter) return;
    this.eventEmitter.emit(
      'salary-adjustment.rejected',
      new SalaryAdjustmentRejectedEvent(
        adj.id,
        adj.yearMonth,
        adj.employee.name,
        adj.authorizedBy?.name ?? 'Authorizer',
        adj.decisionComment ?? null,
        submitter.email,
      ),
    );
  }
}
