import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { InstallmentStatus, ReimbursementStatus } from '@prisma/client';
import { RequestContextService } from 'src/common/services/request-context.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CreateInstallmentPlanDto,
  ProcessInstallmentDto,
  BulkProcessInstallmentsDto,
} from 'src/reimbursements/dto';

@Injectable()
export class ReimbursementInstallmentsService {
  constructor(
    private prisma: PrismaService,
    private requestContext: RequestContextService,
    private eventEmitter: EventEmitter2,
  ) {}

  async createPlan(reimbursementId: string, dto: CreateInstallmentPlanDto, hrId: string) {
    const reimbursement = await this.prisma.reimbursementRequest.findUnique({
      where: { id: reimbursementId },
      include: {
        employee: { select: { id: true, name: true, email: true } },
      },
    });

    if (!reimbursement) {
      throw new NotFoundException('Reimbursement request not found');
    }

    if (reimbursement.status !== ReimbursementStatus.APPROVED) {
      throw new BadRequestException(
        'Installment plan can only be created for approved reimbursements',
      );
    }

    if (reimbursement.hasInstallmentPlan) {
      throw new BadRequestException(
        'An installment plan already exists for this reimbursement. Delete the existing plan before creating a new one.',
      );
    }

    // The base amount is always approvedAmount (HR may have changed it); fall back to requested amount
    const baseAmount = reimbursement.approvedAmount?.toNumber() ?? reimbursement.amount.toNumber();

    // Validate: sum of installment amounts must exactly equal approved amount
    const sum = dto.installments.reduce((acc, i) => acc + i.amount, 0);
    // Use rounding to handle floating-point precision (round to 2 decimal places)
    if (Math.round(sum * 100) !== Math.round(baseAmount * 100)) {
      throw new BadRequestException(
        `Sum of installment amounts (${sum.toFixed(2)}) must equal the approved amount (${baseAmount.toFixed(2)})`,
      );
    }

    // Validate installment numbers are sequential 1..N with no gaps/duplicates
    const sortedNos = dto.installments.map((i) => i.installmentNo).sort((a, b) => a - b);
    for (let idx = 0; idx < sortedNos.length; idx++) {
      if (sortedNos[idx] !== idx + 1) {
        throw new BadRequestException(
          'Installment numbers must be sequential starting from 1 with no gaps or duplicates',
        );
      }
    }

    // Validate no duplicate scheduled months
    const months = dto.installments.map((i) => i.scheduledMonth);
    const uniqueMonths = new Set(months);
    if (uniqueMonths.size !== months.length) {
      throw new BadRequestException('Each installment must have a unique scheduled month');
    }

    await this.prisma.$transaction([
      this.prisma.reimbursementRequest.update({
        where: { id: reimbursementId },
        data: {
          hasInstallmentPlan: true,
          totalInstallments: dto.installments.length,
        },
      }),
      this.prisma.reimbursementInstallment.createMany({
        data: dto.installments.map((item) => ({
          reimbursementId,
          installmentNo: item.installmentNo,
          scheduledMonth: item.scheduledMonth,
          amount: item.amount,
          status: InstallmentStatus.PENDING,
        })),
      }),
    ]);

    await this.prisma.auditLog.create({
      data: {
        userId: hrId,
        action: 'INSTALLMENT_PLAN_CREATED',
        entityType: 'ReimbursementRequest',
        entityId: reimbursementId,
        changes: {
          before: { hasInstallmentPlan: false },
          after: { hasInstallmentPlan: true, totalInstallments: dto.installments.length },
        },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    this.eventEmitter.emit('reimbursement.installment_plan_created', {
      reimbursement: {
        ...reimbursement,
        totalInstallments: dto.installments.length,
        installments: dto.installments,
      },
      userId: hrId,
    });

    return this.getInstallments(reimbursementId);
  }

  async getInstallments(reimbursementId: string, requestingUserId?: string) {
    const reimbursement = await this.prisma.reimbursementRequest.findUnique({
      where: { id: reimbursementId },
      select: {
        id: true,
        employeeId: true,
        hasInstallmentPlan: true,
        totalInstallments: true,
        approvedAmount: true,
        amount: true,
        status: true,
        installments: {
          orderBy: { installmentNo: 'asc' },
          include: {
            processedBy: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    });

    if (!reimbursement) {
      throw new NotFoundException('Reimbursement request not found');
    }

    if (requestingUserId && reimbursement.employeeId !== requestingUserId) {
      throw new ForbiddenException('Access denied');
    }

    return {
      reimbursementId: reimbursement.id,
      hasInstallmentPlan: reimbursement.hasInstallmentPlan,
      totalInstallments: reimbursement.totalInstallments,
      approvedAmount: reimbursement.approvedAmount?.toNumber() ?? reimbursement.amount.toNumber(),
      installments: reimbursement.installments.map((i) => this.toInstallmentDto(i)),
    };
  }

  async getCurrentMonthInstallments(query: { page?: number; limit?: number; search?: string }) {
    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 20);
    const search = query.search;
    const skip = (page - 1) * limit;

    const currentMonth = this.getCurrentYearMonth();

    const where: Record<string, unknown> = {
      scheduledMonth: currentMonth,
      status: InstallmentStatus.PENDING,
      reimbursement: {
        status: ReimbursementStatus.APPROVED,
      },
    };

    if (search?.trim()) {
      where.reimbursement = {
        ...(where.reimbursement as Record<string, unknown>),
        OR: [
          { employee: { name: { contains: search.trim(), mode: 'insensitive' } } },
          { employee: { email: { contains: search.trim(), mode: 'insensitive' } } },
          { description: { contains: search.trim(), mode: 'insensitive' } },
        ],
      };
    }

    const [installments, total] = await this.prisma.$transaction([
      this.prisma.reimbursementInstallment.findMany({
        where: where as never,
        include: {
          reimbursement: {
            include: {
              employee: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  employeeId: true,
                  bankName: true,
                  iban: true,
                },
              },
            },
          },
          processedBy: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: [{ reimbursement: { createdAt: 'asc' } }, { installmentNo: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.reimbursementInstallment.count({ where: where as never }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data: installments.map((i) => ({
        ...this.toInstallmentDto(i),
        reimbursement: {
          id: i.reimbursement.id,
          description: i.reimbursement.description,
          reimbursementType: i.reimbursement.reimbursementType,
          approvedAmount:
            i.reimbursement.approvedAmount?.toNumber() ?? i.reimbursement.amount.toNumber(),
          totalInstallments: i.reimbursement.totalInstallments,
          employee: i.reimbursement.employee,
        },
      })),
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      currentMonth,
    };
  }

  async processInstallment(
    installmentId: string,
    dto: ProcessInstallmentDto,
    processedById: string,
  ) {
    const installment = await this.prisma.reimbursementInstallment.findUnique({
      where: { id: installmentId },
      include: { reimbursement: true },
    });

    if (!installment) {
      throw new NotFoundException('Installment not found');
    }

    if (installment.status === InstallmentStatus.PROCESSED) {
      throw new BadRequestException('Installment is already processed');
    }

    const updated = await this.prisma.reimbursementInstallment.update({
      where: { id: installmentId },
      data: {
        status: InstallmentStatus.PROCESSED,
        processedAt: new Date(),
        processedById,
        processingNotes: dto.processingNotes,
      },
      include: {
        reimbursement: {
          include: {
            installments: true,
            employee: { select: { id: true, name: true, email: true } },
          },
        },
        processedBy: { select: { id: true, name: true, email: true } },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: processedById,
        action: 'INSTALLMENT_PROCESSED',
        entityType: 'ReimbursementInstallment',
        entityId: installmentId,
        changes: {
          before: { status: InstallmentStatus.PENDING },
          after: { status: InstallmentStatus.PROCESSED },
        },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    // Notify employee about this individual installment payment
    const processedCount = updated.reimbursement.installments.filter(
      (i) => i.id === installmentId || i.status === InstallmentStatus.PROCESSED,
    ).length;
    const totalInstallments =
      updated.reimbursement.totalInstallments ?? updated.reimbursement.installments.length;

    this.eventEmitter.emit('reimbursement.installment_processed', {
      installment: updated,
      reimbursement: updated.reimbursement,
      processedCount,
      totalInstallments,
      userId: processedById,
    });

    // If all installments are now processed, mark the parent reimbursement as PROCESSED
    const allProcessed = updated.reimbursement.installments.every(
      (i) => i.id === installmentId || i.status === InstallmentStatus.PROCESSED,
    );

    if (allProcessed) {
      await this.prisma.reimbursementRequest.update({
        where: { id: updated.reimbursementId },
        data: {
          status: ReimbursementStatus.PROCESSED,
          processedAt: new Date(),
          processedById,
        },
      });

      await this.prisma.auditLog.create({
        data: {
          userId: processedById,
          action: 'REIMBURSEMENT_PROCESSED',
          entityType: 'ReimbursementRequest',
          entityId: updated.reimbursementId,
          changes: {
            before: { status: ReimbursementStatus.APPROVED },
            after: { status: ReimbursementStatus.PROCESSED, reason: 'All installments processed' },
          },
          ipAddress: this.requestContext.getIpAddress(),
          userAgent: this.requestContext.getUserAgent(),
        },
      });

      this.eventEmitter.emit('reimbursement.processed', {
        reimbursement: updated.reimbursement,
        userId: processedById,
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      });
    }

    return this.toInstallmentDto(updated);
  }

  async bulkProcessInstallments(dto: BulkProcessInstallmentsDto, processedById: string) {
    const { ids } = dto;

    const installments = await this.prisma.reimbursementInstallment.findMany({
      where: { id: { in: ids } },
    });

    if (installments.length !== ids.length) {
      const foundIds = new Set(installments.map((i) => i.id));
      const missing = ids.filter((id) => !foundIds.has(id));
      throw new NotFoundException(`Installments not found: ${missing.join(', ')}`);
    }

    const alreadyProcessed = installments.filter((i) => i.status === InstallmentStatus.PROCESSED);
    if (alreadyProcessed.length > 0) {
      throw new BadRequestException(
        `${alreadyProcessed.length} installment(s) are already processed`,
      );
    }

    const results = await Promise.all(
      ids.map((id) => this.processInstallment(id, {}, processedById)),
    );

    await this.prisma.auditLog.create({
      data: {
        userId: processedById,
        action: 'INSTALLMENTS_BULK_PROCESSED',
        entityType: 'ReimbursementInstallment',
        entityId: ids[0],
        changes: {
          before: null,
          after: { processedIds: ids, count: ids.length },
        },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    return { count: results.length, ids };
  }

  async deletePlan(reimbursementId: string, hrId: string) {
    const reimbursement = await this.prisma.reimbursementRequest.findUnique({
      where: { id: reimbursementId },
      include: { installments: true },
    });

    if (!reimbursement) {
      throw new NotFoundException('Reimbursement request not found');
    }

    if (!reimbursement.hasInstallmentPlan) {
      throw new BadRequestException('No installment plan exists for this reimbursement');
    }

    const hasProcessed = reimbursement.installments.some(
      (i) => i.status === InstallmentStatus.PROCESSED,
    );
    if (hasProcessed) {
      throw new BadRequestException('Cannot delete plan with already-processed installments');
    }

    await this.prisma.$transaction([
      this.prisma.reimbursementInstallment.deleteMany({ where: { reimbursementId } }),
      this.prisma.reimbursementRequest.update({
        where: { id: reimbursementId },
        data: { hasInstallmentPlan: false, totalInstallments: null },
      }),
    ]);

    await this.prisma.auditLog.create({
      data: {
        userId: hrId,
        action: 'INSTALLMENT_PLAN_DELETED',
        entityType: 'ReimbursementRequest',
        entityId: reimbursementId,
        changes: {
          before: { hasInstallmentPlan: true, totalInstallments: reimbursement.totalInstallments },
          after: { hasInstallmentPlan: false },
        },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    return { message: 'Installment plan deleted successfully' };
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private getCurrentYearMonth(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  private toInstallmentDto(i: {
    id: string;
    reimbursementId: string;
    installmentNo: number;
    scheduledMonth: string;
    amount: { toNumber: () => number };
    status: InstallmentStatus;
    processedAt: Date | null;
    processedById: string | null;
    processingNotes: string | null;
    createdAt: Date;
    updatedAt: Date;
    processedBy?: { id: string; name: string; email: string } | null;
  }) {
    return {
      id: i.id,
      reimbursementId: i.reimbursementId,
      installmentNo: i.installmentNo,
      scheduledMonth: i.scheduledMonth,
      amount: i.amount.toNumber(),
      status: i.status,
      processedAt: i.processedAt?.toISOString() ?? null,
      processedById: i.processedById,
      processingNotes: i.processingNotes,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
      processedBy: i.processedBy ?? null,
    };
  }
}
