import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, InstallmentStatus, ReimbursementStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { RequestContextService } from 'src/common/services/request-context.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CreateInstallmentPlanDto,
  ProcessInstallmentDto,
  BulkProcessInstallmentsDto,
} from 'src/reimbursements/dto';

interface CreateDynamicInstallmentPlanDto extends CreateInstallmentPlanDto {
  approvedAmount: number;
}

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

    const baseAmount = reimbursement.approvedAmount?.toNumber() ?? reimbursement.amount.toNumber();

    const sum = dto.installments.reduce((acc, i) => acc + i.amount, 0);
    if (Math.round(sum * 100) !== Math.round(baseAmount * 100)) {
      throw new BadRequestException(
        `Sum of installment amounts (${sum.toFixed(2)}) must equal the approved amount (${baseAmount.toFixed(2)})`,
      );
    }

    const sortedNos = dto.installments.map((i) => i.installmentNo).sort((a, b) => a - b);
    for (let idx = 0; idx < sortedNos.length; idx++) {
      if (sortedNos[idx] !== idx + 1) {
        throw new BadRequestException(
          'Installment numbers must be sequential starting from 1 with no gaps or duplicates',
        );
      }
    }

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

    const searchCondition = search?.trim()
      ? Prisma.sql`AND (
          eu.name ILIKE ${'%' + search.trim() + '%'}
          OR eu.email ILIKE ${'%' + search.trim() + '%'}
          OR du.name ILIKE ${'%' + search.trim() + '%'}
          OR du.email ILIKE ${'%' + search.trim() + '%'}
          OR rr.description ILIKE ${'%' + search.trim() + '%'}
          OR (dr."formData"->>'description') ILIKE ${'%' + search.trim() + '%'}
        )`
      : Prisma.empty;

    const baseWhere = Prisma.sql`
      WHERE ri."scheduledMonth" = ${currentMonth}
        AND ri.status = 'PENDING'
        AND (
          (ri."reimbursementId" IS NOT NULL AND rr.status = 'APPROVED')
          OR (ri."dynamicRequestId" IS NOT NULL AND dr.status = 'APPROVED')
        )
        ${searchCondition}
    `;

    type RawRow = {
      id: string;
      reimbursementId: string | null;
      dynamicRequestId: string | null;
      installmentNo: number;
      scheduledMonth: string;
      amount: string;
      status: string;
      processedAt: Date | null;
      processedById: string | null;
      processingNotes: string | null;
      createdAt: Date;
      updatedAt: Date;
      pb_id: string | null;
      pb_name: string | null;
      pb_email: string | null;
      rr_id: string | null;
      rr_description: string | null;
      rr_reimbursementType: string | null;
      rr_approvedAmount: string | null;
      rr_amount: string | null;
      rr_totalInstallments: number | null;
      eu_id: string | null;
      eu_name: string | null;
      eu_email: string | null;
      eu_employeeId: string | null;
      eu_bankName: string | null;
      eu_iban: string | null;
      dr_id: string | null;
      dr_formData: unknown;
      dr_totalInstallments: bigint | null;
      du_id: string | null;
      du_name: string | null;
      du_email: string | null;
      du_employeeId: string | null;
      du_bankName: string | null;
      du_iban: string | null;
    };

    const fromJoins = Prisma.sql`
      FROM reimbursement_installments ri
      LEFT JOIN users pb ON pb.id = ri."processedById"
      LEFT JOIN reimbursement_requests rr ON rr.id = ri."reimbursementId"
      LEFT JOIN users eu ON eu.id = rr."employeeId"
      LEFT JOIN dynamic_requests dr ON dr.id = ri."dynamicRequestId"
      LEFT JOIN users du ON du.id = dr."requesterId"
    `;

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<RawRow[]>(Prisma.sql`
        SELECT
          ri.id,
          ri."reimbursementId",
          ri."dynamicRequestId",
          ri."installmentNo",
          ri."scheduledMonth",
          ri.amount,
          ri.status,
          ri."processedAt",
          ri."processedById",
          ri."processingNotes",
          ri."createdAt",
          ri."updatedAt",
          pb.id AS "pb_id", pb.name AS "pb_name", pb.email AS "pb_email",
          rr.id AS "rr_id", rr.description AS "rr_description",
          rr."reimbursementType" AS "rr_reimbursementType",
          rr."approvedAmount" AS "rr_approvedAmount", rr.amount AS "rr_amount",
          rr."totalInstallments" AS "rr_totalInstallments",
          eu.id AS "eu_id", eu.name AS "eu_name", eu.email AS "eu_email",
          eu."employeeId" AS "eu_employeeId", eu."bankName" AS "eu_bankName", eu.iban AS "eu_iban",
          dr.id AS "dr_id", dr."formData" AS "dr_formData",
          (SELECT COUNT(*) FROM reimbursement_installments ri2 WHERE ri2."dynamicRequestId" = dr.id) AS "dr_totalInstallments",
          du.id AS "du_id", du.name AS "du_name", du.email AS "du_email",
          du."employeeId" AS "du_employeeId", du."bankName" AS "du_bankName", du.iban AS "du_iban"
        ${fromJoins}
        ${baseWhere}
        ORDER BY COALESCE(rr."createdAt", dr."createdAt") ASC, ri."installmentNo" ASC
        LIMIT ${limit} OFFSET ${skip}
      `),
      this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS count ${fromJoins} ${baseWhere}
      `),
    ]);

    const total = Number(countRows[0]?.count ?? 0);
    const totalPages = Math.ceil(total / limit) || 1;

    const data = rows.map((row) => {
      const installment = {
        id: row.id,
        reimbursementId: row.reimbursementId,
        installmentNo: row.installmentNo,
        scheduledMonth: row.scheduledMonth,
        amount: parseFloat(String(row.amount)),
        status: row.status as InstallmentStatus,
        processedAt: row.processedAt?.toISOString() ?? null,
        processedById: row.processedById,
        processingNotes: row.processingNotes,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        processedBy: row.pb_id ? { id: row.pb_id, name: row.pb_name!, email: row.pb_email! } : null,
      };

      let reimbursement: Record<string, unknown>;
      if (row.rr_id) {
        reimbursement = {
          id: row.rr_id,
          description: row.rr_description,
          reimbursementType: row.rr_reimbursementType,
          approvedAmount: row.rr_approvedAmount
            ? parseFloat(String(row.rr_approvedAmount))
            : parseFloat(String(row.rr_amount ?? 0)),
          totalInstallments: row.rr_totalInstallments,
          employee: {
            id: row.eu_id,
            name: row.eu_name,
            email: row.eu_email,
            employeeId: row.eu_employeeId,
            bankName: row.eu_bankName,
            iban: row.eu_iban,
          },
        };
      } else {
        const fd = row.dr_formData as Record<string, unknown> | null;
        reimbursement = {
          id: row.dr_id,
          description: (fd?.description as string | null) ?? null,
          reimbursementType: (fd?.reimbursementType as string | null) ?? null,
          approvedAmount:
            fd?.approvedAmount != null
              ? Number(fd.approvedAmount as number)
              : Number((fd?.amount as number | null | undefined) ?? 0),
          totalInstallments: row.dr_totalInstallments ? Number(row.dr_totalInstallments) : null,
          employee: {
            id: row.du_id,
            name: row.du_name,
            email: row.du_email,
            employeeId: row.du_employeeId,
            bankName: row.du_bankName,
            iban: row.du_iban,
          },
        };
      }

      return { ...installment, reimbursement };
    });

    return {
      data,
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

    // Fetch dynamicRequestId — not in Prisma client types until client is regenerated
    const [rawRow] = await this.prisma.$queryRaw<Array<{ dynamicRequestId: string | null }>>`
      SELECT "dynamicRequestId" FROM reimbursement_installments WHERE id = ${installmentId}
    `;
    const dynamicRequestId = rawRow?.dynamicRequestId ?? null;

    // Build sibling installments list and employee info for events
    let siblingInstallments: Array<{ id: string; status: string }>;
    let totalInstallments: number;
    let reimbursementForEvent: unknown;

    if (updated.reimbursement) {
      siblingInstallments = updated.reimbursement.installments;
      totalInstallments = updated.reimbursement.totalInstallments ?? siblingInstallments.length;
      reimbursementForEvent = updated.reimbursement;
    } else if (dynamicRequestId) {
      const [drRow] = await this.prisma.$queryRaw<
        Array<{
          id: string;
          formData: unknown;
          requester_id: string;
          requester_name: string;
          requester_email: string;
        }>
      >`
        SELECT dr.id, dr."formData",
               u.id AS requester_id, u.name AS requester_name, u.email AS requester_email
        FROM dynamic_requests dr
        JOIN users u ON u.id = dr."requesterId"
        WHERE dr.id = ${dynamicRequestId}
      `;
      const allSiblings = await this.prisma.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM reimbursement_installments WHERE "dynamicRequestId" = ${dynamicRequestId}
      `;
      siblingInstallments = allSiblings;
      totalInstallments = allSiblings.length;
      const fd = drRow?.formData as Record<string, unknown> | null;
      reimbursementForEvent = {
        id: drRow?.id,
        employee: {
          id: drRow?.requester_id,
          name: drRow?.requester_name,
          email: drRow?.requester_email,
        },
        approvedAmount: fd?.approvedAmount ?? fd?.amount ?? 0,
        amount: fd?.amount ?? 0,
        totalInstallments,
        installments: allSiblings,
      };
    } else {
      siblingInstallments = [];
      totalInstallments = 0;
      reimbursementForEvent = null;
    }

    const processedCount = siblingInstallments.filter(
      (i) => i.id === installmentId || i.status === InstallmentStatus.PROCESSED,
    ).length;

    this.eventEmitter.emit('reimbursement.installment_processed', {
      installment: updated,
      reimbursement: reimbursementForEvent,
      processedCount,
      totalInstallments,
      userId: processedById,
    });

    const allProcessed = siblingInstallments.every(
      (i) => i.id === installmentId || i.status === InstallmentStatus.PROCESSED,
    );

    if (allProcessed) {
      if (updated.reimbursement && updated.reimbursementId) {
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
              after: {
                status: ReimbursementStatus.PROCESSED,
                reason: 'All installments processed',
              },
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
      } else if (dynamicRequestId) {
        await this.prisma.$executeRaw`
          UPDATE dynamic_requests SET status = 'PROCESSED', "updatedAt" = NOW()
          WHERE id = ${dynamicRequestId}
        `;

        await this.prisma.auditLog.create({
          data: {
            userId: processedById,
            action: 'REIMBURSEMENT_PROCESSED',
            entityType: 'DynamicRequest',
            entityId: dynamicRequestId,
            changes: {
              before: { status: 'APPROVED' },
              after: { status: 'PROCESSED', reason: 'All installments processed' },
            },
            ipAddress: this.requestContext.getIpAddress(),
            userAgent: this.requestContext.getUserAgent(),
          },
        });

        this.eventEmitter.emit('reimbursement.processed', {
          reimbursement: reimbursementForEvent,
          userId: processedById,
          ipAddress: this.requestContext.getIpAddress(),
          userAgent: this.requestContext.getUserAgent(),
        });
      }
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
  // Dynamic request installment plan methods
  // =========================================================================

  async createPlanForDynamicRequest(
    dynamicRequestId: string,
    dto: CreateDynamicInstallmentPlanDto,
    hrId: string,
  ) {
    const [drRow] = await this.prisma.$queryRaw<
      Array<{
        id: string;
        status: string;
        typeKey: string;
        formData: unknown;
        requester_id: string;
        requester_name: string;
        requester_email: string;
      }>
    >`
      SELECT dr.id, dr.status, dr."typeKey", dr."formData",
             u.id AS requester_id, u.name AS requester_name, u.email AS requester_email
      FROM dynamic_requests dr
      JOIN users u ON u.id = dr."requesterId"
      WHERE dr.id = ${dynamicRequestId}
    `;

    if (!drRow) {
      throw new NotFoundException('Dynamic request not found');
    }

    if (drRow.status !== 'APPROVED') {
      throw new BadRequestException('Installment plan can only be created for approved requests');
    }

    // Check for existing installments
    const [countRow] = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM reimbursement_installments
      WHERE "dynamicRequestId" = ${dynamicRequestId}
    `;
    if (Number(countRow?.count ?? 0) > 0) {
      throw new BadRequestException(
        'An installment plan already exists for this request. Delete the existing plan before creating a new one.',
      );
    }

    const baseAmount = dto.approvedAmount;

    const sum = dto.installments.reduce((acc, i) => acc + i.amount, 0);
    if (Math.round(sum * 100) !== Math.round(baseAmount * 100)) {
      throw new BadRequestException(
        `Sum of installment amounts (${sum.toFixed(2)}) must equal the approved amount (${baseAmount.toFixed(2)})`,
      );
    }

    const sortedNos = dto.installments.map((i) => i.installmentNo).sort((a, b) => a - b);
    for (let idx = 0; idx < sortedNos.length; idx++) {
      if (sortedNos[idx] !== idx + 1) {
        throw new BadRequestException(
          'Installment numbers must be sequential starting from 1 with no gaps or duplicates',
        );
      }
    }

    const months = dto.installments.map((i) => i.scheduledMonth);
    const uniqueMonths = new Set(months);
    if (uniqueMonths.size !== months.length) {
      throw new BadRequestException('Each installment must have a unique scheduled month');
    }

    // Insert installments via raw SQL (Prisma client not yet regenerated with dynamicRequestId)
    const now = new Date();
    for (const item of dto.installments) {
      const newId = randomUUID();
      await this.prisma.$executeRaw`
        INSERT INTO reimbursement_installments
          (id, "dynamicRequestId", "installmentNo", "scheduledMonth", amount, status, "createdAt", "updatedAt")
        VALUES
          (${newId}, ${dynamicRequestId}, ${item.installmentNo}, ${item.scheduledMonth},
           ${item.amount}, 'PENDING', ${now}, ${now})
      `;
    }

    await this.prisma.auditLog.create({
      data: {
        userId: hrId,
        action: 'INSTALLMENT_PLAN_CREATED',
        entityType: 'DynamicRequest',
        entityId: dynamicRequestId,
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
        id: drRow.id,
        employee: {
          id: drRow.requester_id,
          name: drRow.requester_name,
          email: drRow.requester_email,
        },
        approvedAmount: baseAmount,
        totalInstallments: dto.installments.length,
        installments: dto.installments,
      },
      userId: hrId,
    });

    return this.getInstallmentsForDynamicRequest(dynamicRequestId);
  }

  async getInstallmentsForDynamicRequest(dynamicRequestId: string) {
    const [drRow] = await this.prisma.$queryRaw<
      Array<{
        id: string;
        status: string;
        formData: unknown;
      }>
    >`
      SELECT id, status, "formData"
      FROM dynamic_requests
      WHERE id = ${dynamicRequestId}
    `;

    if (!drRow) {
      throw new NotFoundException('Dynamic request not found');
    }

    type InstRow = {
      id: string;
      installmentNo: number;
      scheduledMonth: string;
      amount: string;
      status: string;
      processedAt: Date | null;
      processedById: string | null;
      processingNotes: string | null;
      createdAt: Date;
      updatedAt: Date;
      pb_id: string | null;
      pb_name: string | null;
      pb_email: string | null;
    };

    const installments = await this.prisma.$queryRaw<InstRow[]>`
      SELECT
        ri.id, ri."installmentNo", ri."scheduledMonth", ri.amount, ri.status,
        ri."processedAt", ri."processedById", ri."processingNotes", ri."createdAt", ri."updatedAt",
        pb.id AS pb_id, pb.name AS pb_name, pb.email AS pb_email
      FROM reimbursement_installments ri
      LEFT JOIN users pb ON pb.id = ri."processedById"
      WHERE ri."dynamicRequestId" = ${dynamicRequestId}
      ORDER BY ri."installmentNo" ASC
    `;

    const fd = drRow.formData as Record<string, unknown> | null;
    const approvedAmount =
      fd?.approvedAmount != null
        ? Number(fd.approvedAmount as number)
        : Number((fd?.amount as number | null | undefined) ?? 0);

    return {
      dynamicRequestId,
      hasInstallmentPlan: installments.length > 0,
      totalInstallments: installments.length,
      approvedAmount,
      installments: installments.map((i) => ({
        id: i.id,
        reimbursementId: null,
        installmentNo: i.installmentNo,
        scheduledMonth: i.scheduledMonth,
        amount: parseFloat(String(i.amount)),
        status: i.status as InstallmentStatus,
        processedAt: i.processedAt?.toISOString() ?? null,
        processedById: i.processedById,
        processingNotes: i.processingNotes,
        createdAt: i.createdAt.toISOString(),
        updatedAt: i.updatedAt.toISOString(),
        processedBy: i.pb_id ? { id: i.pb_id, name: i.pb_name!, email: i.pb_email! } : null,
      })),
    };
  }

  async deletePlanForDynamicRequest(dynamicRequestId: string, hrId: string) {
    const [drRow] = await this.prisma.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id, status FROM dynamic_requests WHERE id = ${dynamicRequestId}
    `;

    if (!drRow) {
      throw new NotFoundException('Dynamic request not found');
    }

    const [countRow] = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM reimbursement_installments
      WHERE "dynamicRequestId" = ${dynamicRequestId}
    `;

    if (Number(countRow?.count ?? 0) === 0) {
      throw new BadRequestException('No installment plan exists for this request');
    }

    const processed = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM reimbursement_installments
      WHERE "dynamicRequestId" = ${dynamicRequestId} AND status = 'PROCESSED'
    `;

    if (Number(processed[0]?.count ?? 0) > 0) {
      throw new BadRequestException('Cannot delete plan with already-processed installments');
    }

    await this.prisma.$executeRaw`
      DELETE FROM reimbursement_installments WHERE "dynamicRequestId" = ${dynamicRequestId}
    `;

    await this.prisma.auditLog.create({
      data: {
        userId: hrId,
        action: 'INSTALLMENT_PLAN_DELETED',
        entityType: 'DynamicRequest',
        entityId: dynamicRequestId,
        changes: {
          before: { hasInstallmentPlan: true },
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
    reimbursementId: string | null;
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
