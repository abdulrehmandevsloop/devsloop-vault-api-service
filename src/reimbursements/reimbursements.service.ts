import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  ApproveReimbursementDto,
  CreateReimbursementDto,
  ProcessReimbursementDto,
  RejectReimbursementDto,
  UpdateReimbursementDto,
  ReimbursementsQueryDto,
  PendingReimbursementsQueryDto,
  ManagementReimbursementsQueryDto,
  PaginatedReimbursementsResponseDto,
  AdminOverrideReimbursementDto,
} from 'src/reimbursements/dto';
import {
  Prisma,
  InstallmentStatus,
  ReimbursementStatus,
  ReimbursementProcessingType,
} from '@prisma/client';
import { RequestContextService } from 'src/common/services/request-context.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkflowEngineService } from 'src/workflows/workflow-engine.service';

@Injectable()
export class ReimbursementsService {
  private readonly logger = new Logger(ReimbursementsService.name);

  constructor(
    private prisma: PrismaService,
    private requestContext: RequestContextService,
    private eventEmitter: EventEmitter2,
    private workflowEngine: WorkflowEngineService,
  ) {}

  async create(createReimbursementDto: CreateReimbursementDto, userId: string) {
    const requester = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { teamLeadId: true },
    });

    if (!createReimbursementDto.receipts?.length) {
      throw new BadRequestException({
        error: 'Receipt Required',
        message: 'At least one receipt is required to submit a reimbursement request.',
        field: 'receipts',
        requiredFor: createReimbursementDto.reimbursementType,
      });
    }

    const dynamicRequest = await this.prisma.dynamicRequest.create({
      data: {
        typeKey: 'REIMBURSEMENT',
        requesterId: userId,
        status: 'PENDING',
        formData: {
          reimbursementType: createReimbursementDto.reimbursementType,
          amount: createReimbursementDto.amount,
          description: createReimbursementDto.description,
          receipts: createReimbursementDto.receipts ?? [],
          processingType: createReimbursementDto.processingType ?? null,
          otherComments: createReimbursementDto.otherComments ?? null,
          patientName: createReimbursementDto.patientName ?? null,
          patientRelationship: createReimbursementDto.patientRelationship ?? null,
          treatmentType: createReimbursementDto.treatmentType ?? null,
          hospitalName: createReimbursementDto.hospitalName ?? null,
        } as unknown as Prisma.InputJsonValue,
      },
      include: {
        requester: { select: { id: true, name: true, email: true } },
      },
    });

    try {
      await this.workflowEngine.startWorkflow('REIMBURSEMENT', dynamicRequest.id, userId, {
        amount: createReimbursementDto.amount,
        description: createReimbursementDto.description,
        reimbursementType: createReimbursementDto.reimbursementType,
        ...(requester?.teamLeadId ? { reportingManagerId: requester.teamLeadId } : {}),
      });
    } catch (err) {
      await this.prisma.dynamicRequest.delete({ where: { id: dynamicRequest.id } });
      throw err;
    }

    this.eventEmitter.emit('reimbursement.created', {
      reimbursement: dynamicRequest,
      userId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
    });

    return dynamicRequest;
  }

  async findAll(
    userId: string,
    query: ReimbursementsQueryDto,
  ): Promise<PaginatedReimbursementsResponseDto> {
    const { page = 1, limit = 20, status, reimbursementType, dateFrom, dateTo } = query;
    const skip = (page - 1) * limit;

    let requests = await this.prisma.dynamicRequest.findMany({
      where: { requesterId: userId, typeKey: 'REIMBURSEMENT' },
      include: { requester: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });

    if (status) {
      requests = requests.filter((r) => this.mapDynamicStatus(r.status) === status);
    }
    if (reimbursementType) {
      requests = requests.filter(
        (r) =>
          ((r.formData as Record<string, unknown>).reimbursementType as string) ===
          reimbursementType,
      );
    }
    if (dateFrom || dateTo) {
      requests = requests.filter((r) => {
        const receipts =
          ((r.formData as Record<string, unknown>).receipts as Array<Record<string, unknown>>) ??
          [];
        return receipts.some((rec) => {
          const d = rec.transactionDate ? new Date(rec.transactionDate as string) : null;
          if (!d) return false;
          if (dateFrom && d < new Date(dateFrom)) return false;
          if (dateTo && d > new Date(dateTo)) return false;
          return true;
        });
      });
    }

    return this.paginateDynamic(
      requests.map((r) => this.toDtoFromDynamic(r)),
      page,
      limit,
      skip,
    );
  }

  async findOne(id: string, userId?: string) {
    const reimbursement = await this.prisma.reimbursementRequest.findUnique({
      where: { id },
      include: {
        receipts: true,
        employee: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        hrReviewer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        processedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!reimbursement) {
      throw new NotFoundException('Reimbursement request not found');
    }

    // Check if user has access to this request
    if (userId && reimbursement.employeeId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return reimbursement;
  }

  async update(id: string, updateReimbursementDto: UpdateReimbursementDto, userId: string) {
    const existing = await this.findOne(id, userId);

    if (existing.status !== ReimbursementStatus.PENDING) {
      throw new BadRequestException('Cannot update request after HR review');
    }

    const oldData = { ...existing };

    const { receipts, ...rest } = updateReimbursementDto;

    const reimbursement = await this.prisma.reimbursementRequest.update({
      where: { id },
      data: {
        ...rest,
        ...(receipts !== undefined
          ? {
              receipts: {
                deleteMany: {},
                create: receipts.map((r) => ({
                  receiptUrl: r.receiptUrl,
                  merchantName: r.merchantName,
                  transactionDate: new Date(r.transactionDate),
                  amount: r.amount ?? null,
                  isManuallyEdited: r.isManuallyEdited ?? false,
                })),
              },
            }
          : {}),
      },
      include: {
        receipts: true,
        employee: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Create audit log entry
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'REIMBURSEMENT_UPDATED',
        entityType: 'ReimbursementRequest',
        entityId: reimbursement.id,
        changes: {
          before: oldData,
          after: reimbursement,
        },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    // Emit event for notifications
    this.eventEmitter.emit('reimbursement.updated', {
      reimbursement,
      oldData,
      userId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
    });

    return reimbursement;
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id, userId);

    if (existing.status !== ReimbursementStatus.PENDING) {
      throw new BadRequestException('Cannot cancel request after HR review');
    }

    const reimbursement = await this.prisma.reimbursementRequest.delete({
      where: { id },
    });

    // Create audit log entry
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'REIMBURSEMENT_CANCELLED',
        entityType: 'ReimbursementRequest',
        entityId: reimbursement.id,
        changes: {
          before: existing,
          after: null,
        },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    // Emit event for notifications
    this.eventEmitter.emit('reimbursement.cancelled', {
      reimbursement,
      userId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
    });

    return reimbursement;
  }

  async findPendingForHR(
    query: PendingReimbursementsQueryDto,
  ): Promise<PaginatedReimbursementsResponseDto> {
    const { page = 1, limit = 10, status, dateFrom, dateTo, search, hasInstallmentPlan } = query;
    const skip = (page - 1) * limit;

    const whereClauses: Record<string, unknown>[] = [];

    // Filter by specific status if provided (APPROVED, REJECTED, PROCESSED, etc.)
    if (status) {
      whereClauses.push({ status });
    }

    // Date range filter on transactionDate (via receipts relation)
    if (dateFrom || dateTo) {
      const dateFilter: Record<string, unknown> = {};
      if (dateFrom) dateFilter.gte = new Date(dateFrom);
      if (dateTo) dateFilter.lte = new Date(dateTo);
      whereClauses.push({ receipts: { some: { transactionDate: dateFilter } } });
    }

    // Search filter
    const normalizedSearch = search?.trim();
    if (normalizedSearch) {
      whereClauses.push({
        OR: [
          { description: { contains: normalizedSearch, mode: 'insensitive' } },
          { employee: { name: { contains: normalizedSearch, mode: 'insensitive' } } },
          { employee: { email: { contains: normalizedSearch, mode: 'insensitive' } } },
        ],
      });
    }

    const baseWhere: Record<string, unknown> =
      whereClauses.length === 0
        ? {}
        : whereClauses.length === 1
          ? whereClauses[0]
          : { AND: whereClauses };

    // If a specific status is requested, use it for pagination; otherwise don't add extra status filter
    const effectiveStatus = status ?? undefined;

    return this.paginateReimbursements(
      baseWhere,
      effectiveStatus,
      page,
      limit,
      skip,
      true,
      hasInstallmentPlan,
    );
  }

  async saveApprovalMetadata(
    id: string,
    approveReimbursementDto: ApproveReimbursementDto,
    hrId: string,
  ) {
    const existing = await this.findOne(id);

    if (approveReimbursementDto.approvedAmount !== undefined) {
      const requestedAmount = existing.amount.toNumber();
      if (approveReimbursementDto.approvedAmount > requestedAmount) {
        throw new BadRequestException(
          `Approved amount (${approveReimbursementDto.approvedAmount}) cannot exceed requested amount (${requestedAmount})`,
        );
      }
      if (approveReimbursementDto.approvedAmount < 0) {
        throw new BadRequestException('Approved amount cannot be negative');
      }
    }

    const finalApprovedAmount =
      approveReimbursementDto.approvedAmount ?? existing.amount.toNumber();

    if (approveReimbursementDto.installments?.length) {
      const installments = approveReimbursementDto.installments;
      const sum = installments.reduce((acc, i) => acc + i.amount, 0);
      if (Math.round(sum * 100) !== Math.round(finalApprovedAmount * 100)) {
        throw new BadRequestException(
          `Sum of installment amounts (${sum.toFixed(2)}) must equal the approved amount (${finalApprovedAmount.toFixed(2)})`,
        );
      }
      const sortedNos = installments.map((i) => i.installmentNo).sort((a, b) => a - b);
      for (let idx = 0; idx < sortedNos.length; idx++) {
        if (sortedNos[idx] !== idx + 1) {
          throw new BadRequestException('Installment numbers must be sequential starting from 1');
        }
      }
      const months = installments.map((i) => i.scheduledMonth);
      if (new Set(months).size !== months.length) {
        throw new BadRequestException('Each installment must have a unique scheduled month');
      }
    }

    const reimbursement = await this.prisma.reimbursementRequest.update({
      where: { id },
      data: {
        hrId,
        hrComment: approveReimbursementDto.hrComment,
        hrReviewedAt: new Date(),
        approvedAmount: finalApprovedAmount,
        processingType: approveReimbursementDto.processingType,
        salaryMonth: approveReimbursementDto.salaryMonth,
        ...(approveReimbursementDto.installments?.length
          ? {
              hasInstallmentPlan: true,
              totalInstallments: approveReimbursementDto.installments.length,
            }
          : {}),
      },
      include: { employee: { select: { id: true, name: true, email: true } } },
    });

    if (approveReimbursementDto.installments?.length) {
      await this.prisma.reimbursementInstallment.createMany({
        data: approveReimbursementDto.installments.map((item) => ({
          reimbursementId: id,
          installmentNo: item.installmentNo,
          scheduledMonth: item.scheduledMonth,
          amount: item.amount,
          status: InstallmentStatus.PENDING,
        })),
        skipDuplicates: true,
      });
    }

    return reimbursement;
  }

  async approve(id: string, approveReimbursementDto: ApproveReimbursementDto, hrId: string) {
    const existing = await this.findOne(id);

    if (existing.status !== ReimbursementStatus.PENDING) {
      throw new BadRequestException('Request cannot be approved');
    }

    // Validate approved amount if provided
    if (approveReimbursementDto.approvedAmount !== undefined) {
      const requestedAmount = existing.amount.toNumber();
      if (approveReimbursementDto.approvedAmount > requestedAmount) {
        throw new BadRequestException(
          `Approved amount (${approveReimbursementDto.approvedAmount}) cannot exceed requested amount (${requestedAmount})`,
        );
      }
      if (approveReimbursementDto.approvedAmount < 0) {
        throw new BadRequestException('Approved amount cannot be negative');
      }
    }

    const oldData = { ...existing };

    const finalApprovedAmount =
      approveReimbursementDto.approvedAmount ?? existing.amount.toNumber();

    // If installment plan provided, validate sum before persisting anything
    if (approveReimbursementDto.installments?.length) {
      const installments = approveReimbursementDto.installments;
      const sum = installments.reduce((acc, i) => acc + i.amount, 0);
      if (Math.round(sum * 100) !== Math.round(finalApprovedAmount * 100)) {
        throw new BadRequestException(
          `Sum of installment amounts (${sum.toFixed(2)}) must equal the approved amount (${finalApprovedAmount.toFixed(2)})`,
        );
      }
      const sortedNos = installments.map((i) => i.installmentNo).sort((a, b) => a - b);
      for (let idx = 0; idx < sortedNos.length; idx++) {
        if (sortedNos[idx] !== idx + 1) {
          throw new BadRequestException('Installment numbers must be sequential starting from 1');
        }
      }
      const months = installments.map((i) => i.scheduledMonth);
      if (new Set(months).size !== months.length) {
        throw new BadRequestException('Each installment must have a unique scheduled month');
      }
    }

    const reimbursement = await this.prisma.reimbursementRequest.update({
      where: { id },
      data: {
        status: ReimbursementStatus.APPROVED,
        hrId,
        hrComment: approveReimbursementDto.hrComment,
        hrReviewedAt: new Date(),
        approvedAmount: finalApprovedAmount,
        processingType: approveReimbursementDto.processingType,
        salaryMonth: approveReimbursementDto.salaryMonth,
        ...(approveReimbursementDto.installments?.length
          ? {
              hasInstallmentPlan: true,
              totalInstallments: approveReimbursementDto.installments.length,
            }
          : {}),
      },
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // If installment plan was provided, create installments in the same transaction
    if (approveReimbursementDto.installments?.length) {
      await this.prisma.reimbursementInstallment.createMany({
        data: approveReimbursementDto.installments.map((item) => ({
          reimbursementId: id,
          installmentNo: item.installmentNo,
          scheduledMonth: item.scheduledMonth,
          amount: item.amount,
          status: InstallmentStatus.PENDING,
        })),
      });
    }

    // Create audit log entry
    await this.prisma.auditLog.create({
      data: {
        userId: hrId,
        action: 'REIMBURSEMENT_APPROVED',
        entityType: 'ReimbursementRequest',
        entityId: reimbursement.id,
        changes: {
          before: oldData,
          after: reimbursement,
        },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    // Emit events for notifications
    this.eventEmitter.emit('reimbursement.approved', {
      reimbursement,
      oldData,
      userId: hrId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
    });

    return reimbursement;
  }

  async reject(id: string, rejectReimbursementDto: RejectReimbursementDto, hrId: string) {
    const existing = await this.findOne(id);

    if (existing.status !== ReimbursementStatus.PENDING) {
      throw new BadRequestException('Request cannot be rejected');
    }

    const oldData = { ...existing };

    const reimbursement = await this.prisma.reimbursementRequest.update({
      where: { id },
      data: {
        status: ReimbursementStatus.REJECTED,
        hrId,
        hrComment: rejectReimbursementDto.hrComment,
        hrReviewedAt: new Date(),
      },
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Create audit log entry
    await this.prisma.auditLog.create({
      data: {
        userId: hrId,
        action: 'REIMBURSEMENT_REJECTED',
        entityType: 'ReimbursementRequest',
        entityId: reimbursement.id,
        changes: {
          before: oldData,
          after: reimbursement,
        },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    // Emit events for notifications
    this.eventEmitter.emit('reimbursement.rejected', {
      reimbursement,
      oldData,
      userId: hrId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
    });

    return reimbursement;
  }

  async findAllForManagement(
    query: ManagementReimbursementsQueryDto,
  ): Promise<PaginatedReimbursementsResponseDto> {
    const {
      page = 1,
      limit = 20,
      status,
      reimbursementType,
      dateFrom,
      dateTo,
      employeeId,
      department,
      search,
    } = query;
    const skip = (page - 1) * limit;

    const dbWhere: Record<string, unknown> = { typeKey: 'REIMBURSEMENT' };
    if (employeeId) dbWhere.requesterId = employeeId;

    let requests = await this.prisma.dynamicRequest.findMany({
      where: dbWhere,
      include: {
        requester: {
          select: {
            id: true,
            name: true,
            email: true,
            employeeId: true,
            designation: true,
            departments: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (status) {
      requests = requests.filter((r) => this.mapDynamicStatus(r.status) === status);
    }
    if (reimbursementType) {
      requests = requests.filter(
        (r) =>
          ((r.formData as Record<string, unknown>).reimbursementType as string) ===
          reimbursementType,
      );
    }
    if (dateFrom || dateTo) {
      requests = requests.filter((r) => {
        const receipts =
          ((r.formData as Record<string, unknown>).receipts as Array<Record<string, unknown>>) ??
          [];
        return receipts.some((rec) => {
          const d = rec.transactionDate ? new Date(rec.transactionDate as string) : null;
          if (!d) return false;
          if (dateFrom && d < new Date(dateFrom)) return false;
          if (dateTo && d > new Date(dateTo)) return false;
          return true;
        });
      });
    }
    const normalizedSearch = search?.trim().toLowerCase();
    if (normalizedSearch) {
      requests = requests.filter((r) => {
        const fd = r.formData as Record<string, unknown>;
        const desc = ((fd.description as string) ?? '').toLowerCase();
        const name = r.requester.name.toLowerCase();
        const email = r.requester.email.toLowerCase();
        return (
          desc.includes(normalizedSearch) ||
          name.includes(normalizedSearch) ||
          email.includes(normalizedSearch)
        );
      });
    }
    if (department) {
      requests = requests.filter((r) => (r.requester.departments ?? []).includes(department));
    }

    return this.paginateDynamic(
      requests.map((r) => this.toDtoFromDynamic(r)),
      page,
      limit,
      skip,
    );
  }

  async process(
    id: string,
    processReimbursementDto: ProcessReimbursementDto,
    processedById: string,
  ) {
    const existing = await this.findOne(id);

    if (existing.status !== ReimbursementStatus.APPROVED) {
      throw new BadRequestException('Only approved requests can be processed');
    }

    const oldData = { ...existing };

    const reimbursement = await this.prisma.reimbursementRequest.update({
      where: { id },
      data: {
        status: ReimbursementStatus.PROCESSED,
        processedById,
        processedAt: new Date(),
        processingNotes: processReimbursementDto.processingNotes,
      },
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            email: true,
            bankName: true,
            iban: true,
          },
        },
      },
    });

    // Create audit log entry
    await this.prisma.auditLog.create({
      data: {
        userId: processedById,
        action: 'REIMBURSEMENT_PROCESSED',
        entityType: 'ReimbursementRequest',
        entityId: reimbursement.id,
        changes: {
          before: oldData,
          after: reimbursement,
        },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    // Emit events for notifications
    this.eventEmitter.emit('reimbursement.processed', {
      reimbursement,
      oldData,
      userId: processedById,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
    });

    return reimbursement;
  }

  async getSalaryPendingRequests(salaryMonth: string) {
    return this.prisma.reimbursementRequest.findMany({
      where: {
        status: ReimbursementStatus.APPROVED,
        processingType: ReimbursementProcessingType.SALARY_ADJUSTMENT,
        salaryMonth: salaryMonth,
      },
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            email: true,
            employeeId: true,
            baseSalaryMonthly: true,
            bankName: true,
            iban: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async getReports(filters: any) {
    const where: any = {};

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.reimbursementType) {
      where.reimbursementType = filters.reimbursementType;
    }

    if (filters.startDate && filters.endDate) {
      where.receipts = {
        some: {
          transactionDate: {
            gte: new Date(filters.startDate as string),
            lte: new Date(filters.endDate as string),
          },
        },
      };
    }

    if (filters.employeeId) {
      where.employeeId = filters.employeeId;
    }

    return this.prisma.reimbursementRequest.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            email: true,
            employeeId: true,
            departments: true,
          },
        },
        hrReviewer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        processedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async bulkUpdateStatus(ids: string[], status: ReimbursementStatus, userId: string) {
    const oldDataList: any[] = [];
    const errors: string[] = [];

    // Get all requests first for audit logging and validation
    for (const id of ids) {
      const request = await this.findOne(id);
      oldDataList.push(request);

      // Validate status transitions
      const currentStatus = request.status;

      if (status === ReimbursementStatus.APPROVED) {
        // Can only approve PENDING requests (or REJECTED that need reconsideration)
        if (currentStatus === ReimbursementStatus.PROCESSED) {
          errors.push(`Request is already PROCESSED and cannot be changed`);
        }
      } else if (status === ReimbursementStatus.REJECTED) {
        // Cannot reject already PROCESSED requests
        if (currentStatus === ReimbursementStatus.PROCESSED) {
          errors.push(`Request is already PROCESSED and cannot be changed`);
        }
      } else if (status === ReimbursementStatus.PROCESSED) {
        // Can only process APPROVED requests
        if (currentStatus !== ReimbursementStatus.APPROVED) {
          errors.push(`Request must be APPROVED before processing (current: ${currentStatus})`);
        }
      }
    }

    // If there are errors, throw bad request
    if (errors.length > 0) {
      throw new BadRequestException({
        error: 'Invalid Status Transition',
        message: errors.join('; '),
      });
    }

    // Update all requests
    const updatedRequests = await this.prisma.reimbursementRequest.updateMany({
      where: {
        id: { in: ids },
      },
      data: {
        status,
        hrId: userId,
        hrReviewedAt: new Date(),
      },
    });

    // Fetch updated reimbursement data and emit events for email notifications
    for (let i = 0; i < ids.length; i++) {
      const updatedReimbursement = await this.findOne(ids[i]);
      const oldData = oldDataList[i];

      // Emit appropriate event based on status
      if (status === ReimbursementStatus.APPROVED) {
        this.eventEmitter.emit('reimbursement.approved', {
          reimbursement: updatedReimbursement,
          oldData,
          userId,
          ipAddress: this.requestContext.getIpAddress(),
        });
      } else if (status === ReimbursementStatus.REJECTED) {
        this.eventEmitter.emit('reimbursement.rejected', {
          reimbursement: updatedReimbursement,
          oldData,
          userId,
          ipAddress: this.requestContext.getIpAddress(),
        });
      } else if (status === ReimbursementStatus.PROCESSED) {
        this.eventEmitter.emit('reimbursement.processed', {
          reimbursement: updatedReimbursement,
          oldData,
          userId,
          ipAddress: this.requestContext.getIpAddress(),
        });
      }

      // Create audit logs
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'REIMBURSEMENT_BULK_UPDATE',
          entityType: 'ReimbursementRequest',
          entityId: ids[i],
          changes: {
            before: oldData,
            after: { status },
          },
        },
      });
    }

    return { count: updatedRequests.count, ids };
  }

  async adminOverride(id: string, overrideDto: AdminOverrideReimbursementDto, adminId: string) {
    const existing = await this.findOne(id);
    const oldData = { ...existing };
    const updateData: Record<string, unknown> = {};

    // Check if admin is trying to change amount
    const isAmountChange = overrideDto.approvedAmount !== undefined;
    const isStatusChange = overrideDto.status !== undefined;

    // Validate amount change
    if (isAmountChange) {
      const requestedAmount = existing.amount.toNumber();

      if (overrideDto.approvedAmount! > requestedAmount) {
        throw new BadRequestException(
          `Approved amount (${overrideDto.approvedAmount}) cannot exceed requested amount (${requestedAmount})`,
        );
      }

      if (overrideDto.approvedAmount! < 0) {
        throw new BadRequestException('Approved amount cannot be negative');
      }

      // Warning for changing processed requests (but allow it)
      if (existing.status === ReimbursementStatus.PROCESSED && isAmountChange) {
        this.logger.warn(
          `Admin ${adminId} overriding amount on already-processed reimbursement ${id} — potential payroll discrepancy`,
        );
      }

      updateData.approvedAmount = overrideDto.approvedAmount;
      updateData.hrId = adminId;
      updateData.hrReviewedAt = new Date();
    }

    // Validate status change
    if (isStatusChange) {
      const newStatus = overrideDto.status!;
      const currentStatus = existing.status;

      // Prevent invalid transitions
      if (
        newStatus === ReimbursementStatus.PROCESSED &&
        currentStatus !== ReimbursementStatus.APPROVED
      ) {
        throw new BadRequestException(
          `Request must be APPROVED before processing (current: ${currentStatus})`,
        );
      }

      // Allow all other status changes for admin override
      updateData.status = newStatus;
      updateData.hrId = adminId;
      updateData.hrReviewedAt = new Date();

      // If moving back to PENDING or REJECTED from APPROVED/PROCESSED, clear processing fields
      if (
        (newStatus === ReimbursementStatus.PENDING || newStatus === ReimbursementStatus.REJECTED) &&
        currentStatus === ReimbursementStatus.PROCESSED
      ) {
        updateData.processedById = null;
        updateData.processedAt = null;
        updateData.processingNotes = null;
      }
    }

    // Require override reason
    if (!overrideDto.hrComment?.trim()) {
      throw new BadRequestException('Override reason is required for administrative changes');
    }

    // Update hrComment with the override reason (replaces existing comment)
    updateData.hrComment = overrideDto.hrComment.trim();
    updateData.hrId = adminId;
    updateData.hrReviewedAt = new Date();

    // Perform the update
    const reimbursement = await this.prisma.reimbursementRequest.update({
      where: { id },
      data: updateData,
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Create detailed audit log entry
    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'REIMBURSEMENT_ADMIN_OVERRIDE',
        entityType: 'ReimbursementRequest',
        entityId: reimbursement.id,
        changes: {
          before: oldData,
          after: reimbursement,
          hrComment: overrideDto.hrComment,
          recalculateInstallments: overrideDto.recalculateInstallments,
          isAmountChange,
          isStatusChange,
          previousStatus: oldData.status,
          newStatus: reimbursement.status,
          previousApprovedAmount: oldData.approvedAmount?.toNumber() ?? null,
          newApprovedAmount: reimbursement.approvedAmount?.toNumber() ?? null,
        },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    const status = overrideDto.status;

    // Emit appropriate event based on status (for admin override)
    if (status === ReimbursementStatus.APPROVED) {
      this.eventEmitter.emit('reimbursement.approved', {
        reimbursement,
        oldData,
        userId: adminId,
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
        isAdminOverride: true,
      });
    } else if (status === ReimbursementStatus.REJECTED) {
      this.eventEmitter.emit('reimbursement.rejected', {
        reimbursement,
        oldData,
        userId: adminId,
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
        isAdminOverride: true,
      });
    } else if (status === ReimbursementStatus.PROCESSED) {
      this.eventEmitter.emit('reimbursement.processed', {
        reimbursement,
        oldData,
        userId: adminId,
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
        isAdminOverride: true,
      });
    }

    return reimbursement;
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private async paginateReimbursements(
    baseWhere: Record<string, unknown>,
    statusFilter: ReimbursementStatus | undefined,
    page: number,
    limit: number,
    skip: number,
    includeFullEmployee = false,
    hasInstallmentPlan?: boolean,
  ): Promise<PaginatedReimbursementsResponseDto> {
    const statusWhere: Record<string, unknown> = statusFilter ? { status: statusFilter } : {};
    const installmentWhere: Record<string, unknown> =
      hasInstallmentPlan !== undefined ? { hasInstallmentPlan } : {};

    const listWhere: Record<string, unknown> = {
      ...baseWhere,
      ...statusWhere,
      ...installmentWhere,
    };

    const employeeSelect = includeFullEmployee
      ? {
          id: true,
          name: true,
          email: true,
          employeeId: true,
          designation: true,
          departments: true,
        }
      : {
          id: true,
          name: true,
          email: true,
        };

    const [requests, total, statusCounts, _totalAmountAgg] = await this.prisma.$transaction([
      this.prisma.reimbursementRequest.findMany({
        where: listWhere as never,
        include: {
          receipts: true,
          employee: {
            select: employeeSelect,
          },
          hrReviewer: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          processedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          _count: {
            select: {
              installments: { where: { status: InstallmentStatus.PROCESSED } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.reimbursementRequest.count({ where: listWhere as never }),
      this.prisma.reimbursementRequest.groupBy({
        by: ['status'],
        where: baseWhere,
        orderBy: { status: 'asc' },
        _count: true,
      }),
      this.prisma.reimbursementRequest.aggregate({
        where: baseWhere as never,
        _sum: { amount: true },
      }),
    ]);

    const countByStatus = (s: ReimbursementStatus) =>
      Number(statusCounts.find((g) => g.status === s)?._count ?? 0);

    const totalPages = Math.ceil(total / limit) || 1;

    // Calculate total amount: only use approvedAmount for APPROVED/PROCESSED requests
    const totalAmount = requests.reduce((sum, r) => {
      if (r.status === ReimbursementStatus.APPROVED || r.status === ReimbursementStatus.PROCESSED) {
        return sum + (r.approvedAmount?.toNumber() ?? r.amount.toNumber());
      }
      return sum;
    }, 0);

    return {
      data: requests.map((r) => this.toDto(r)),
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      pending: countByStatus(ReimbursementStatus.PENDING),
      approved: countByStatus(ReimbursementStatus.APPROVED),
      rejected: countByStatus(ReimbursementStatus.REJECTED),
      processed: countByStatus(ReimbursementStatus.PROCESSED),
      totalAmount,
    };
  }

  private toDto(r: {
    id: string;
    employeeId: string;
    reimbursementType: string;
    amount: { toNumber: () => number };
    description: string;
    status: string;
    processingType: string | null;
    otherComments: string | null;
    patientName: string | null;
    patientRelationship: string | null;
    treatmentType: string | null;
    hospitalName: string | null;
    hrId: string | null;
    hrComment: string | null;
    hrReviewedAt: Date | null;
    approvedAmount: { toNumber: () => number } | null;
    processedAt: Date | null;
    processedById: string | null;
    processingNotes: string | null;
    salaryMonth: string | null;
    hasInstallmentPlan: boolean;
    totalInstallments: number | null;
    createdAt: Date;
    updatedAt: Date;
    receipts: {
      id: string;
      receiptUrl: string | null;
      merchantName: string | null;
      transactionDate: Date;
      amount: { toNumber: () => number } | null;
      isManuallyEdited: boolean;
      createdAt: Date;
      updatedAt: Date;
    }[];
    employee: {
      id: string;
      name: string;
      email: string;
      employeeId?: string | null;
      designation?: string | null;
      departments?: string[];
    };
    hrReviewer: { id: string; name: string; email: string } | null;
    processedBy: { id: string; name: string; email: string } | null;
    _count?: { installments: number } | null;
  }) {
    return {
      id: r.id,
      employeeId: r.employeeId,
      reimbursementType: r.reimbursementType,
      amount: r.amount.toNumber(),
      description: r.description,
      status: r.status,
      processingType: r.processingType ?? '',
      otherComments: r.otherComments,
      patientName: r.patientName,
      patientRelationship: r.patientRelationship,
      treatmentType: r.treatmentType,
      hospitalName: r.hospitalName,
      hrId: r.hrId,
      hrComment: r.hrComment,
      hrReviewedAt: r.hrReviewedAt?.toISOString() ?? null,
      approvedAmount: r.approvedAmount?.toNumber() ?? null,
      processedAt: r.processedAt?.toISOString() ?? null,
      processedById: r.processedById,
      processingNotes: r.processingNotes,
      salaryMonth: r.salaryMonth,
      hasInstallmentPlan: r.hasInstallmentPlan,
      totalInstallments: r.totalInstallments ?? null,
      processedInstallments: r._count?.installments ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      receipts: r.receipts.map((rec) => ({
        id: rec.id,
        receiptUrl: rec.receiptUrl,
        merchantName: rec.merchantName,
        transactionDate: rec.transactionDate.toISOString(),
        amount: rec.amount?.toNumber() ?? null,
        isManuallyEdited: rec.isManuallyEdited,
        createdAt: rec.createdAt.toISOString(),
        updatedAt: rec.updatedAt.toISOString(),
      })),
      employee: {
        id: r.employee.id,
        name: r.employee.name,
        email: r.employee.email,
        employeeId: r.employee.employeeId,
        designation: r.employee.designation,
        departments: r.employee.departments,
      },
      hrReviewer: r.hrReviewer
        ? { id: r.hrReviewer.id, name: r.hrReviewer.name, email: r.hrReviewer.email }
        : null,
      processedBy: r.processedBy
        ? { id: r.processedBy.id, name: r.processedBy.name, email: r.processedBy.email }
        : null,
    };
  }

  private mapDynamicStatus(status: string): string {
    const map: Record<string, string> = {
      PENDING: 'PENDING',
      IN_PROGRESS: 'PENDING',
      APPROVED: 'APPROVED',
      REJECTED: 'REJECTED',
      CANCELLED: 'REJECTED',
    };
    return map[status] ?? 'PENDING';
  }

  private toDtoFromDynamic(dr: {
    id: string;
    requesterId: string;
    formData: Prisma.JsonValue;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    requester: {
      id: string;
      name: string;
      email: string;
      employeeId?: string | null;
      designation?: string | null;
      departments?: string[];
    };
  }) {
    const fd = (dr.formData ?? {}) as Record<string, unknown>;
    const receipts = (fd.receipts as Array<Record<string, unknown>>) ?? [];
    return {
      id: dr.id,
      employeeId: dr.requesterId,
      reimbursementType: (fd.reimbursementType as string) ?? '',
      amount: Number(fd.amount ?? 0),
      description: (fd.description as string) ?? '',
      status: this.mapDynamicStatus(dr.status),
      processingType: (fd.processingType as string) ?? '',
      otherComments: (fd.otherComments as string) ?? null,
      patientName: (fd.patientName as string) ?? null,
      patientRelationship: (fd.patientRelationship as string) ?? null,
      treatmentType: (fd.treatmentType as string) ?? null,
      hospitalName: (fd.hospitalName as string) ?? null,
      hrId: null as string | null,
      hrComment: null as string | null,
      hrReviewedAt: null as string | null,
      approvedAmount: null as number | null,
      processedAt: null as string | null,
      processedById: null as string | null,
      processingNotes: null as string | null,
      salaryMonth: null as string | null,
      hasInstallmentPlan: false,
      totalInstallments: null as number | null,
      processedInstallments: null as number | null,
      createdAt: dr.createdAt.toISOString(),
      updatedAt: dr.updatedAt.toISOString(),
      receipts: receipts.map((rec, idx) => ({
        id: `${dr.id}_r${idx}`,
        receiptUrl: (rec.receiptUrl as string) ?? null,
        merchantName: (rec.merchantName as string) ?? null,
        transactionDate: (rec.transactionDate as string) ?? dr.createdAt.toISOString(),
        amount: rec.amount != null ? Number(rec.amount) : null,
        isManuallyEdited: (rec.isManuallyEdited as boolean) ?? false,
        createdAt: dr.createdAt.toISOString(),
        updatedAt: dr.updatedAt.toISOString(),
      })),
      employee: {
        id: dr.requester.id,
        name: dr.requester.name,
        email: dr.requester.email,
        employeeId: dr.requester.employeeId ?? null,
        designation: dr.requester.designation ?? null,
        departments: dr.requester.departments ?? [],
      },
      hrReviewer: null as { id: string; name: string; email: string } | null,
      processedBy: null as { id: string; name: string; email: string } | null,
    };
  }

  private paginateDynamic(
    allDtos: ReturnType<ReimbursementsService['toDtoFromDynamic']>[],
    page: number,
    limit: number,
    skip: number,
  ): PaginatedReimbursementsResponseDto {
    const total = allDtos.length;
    const paged = allDtos.slice(skip, skip + limit);
    const totalPages = Math.ceil(total / limit) || 1;
    const countByStatus = (s: string) => allDtos.filter((d) => d.status === s).length;
    const totalAmount = allDtos.reduce((sum, r) => {
      if (r.status === ReimbursementStatus.APPROVED || r.status === ReimbursementStatus.PROCESSED) {
        return sum + (r.approvedAmount ?? r.amount);
      }
      return sum;
    }, 0);
    return {
      data: paged,
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      pending: countByStatus(ReimbursementStatus.PENDING),
      approved: countByStatus(ReimbursementStatus.APPROVED),
      rejected: countByStatus(ReimbursementStatus.REJECTED),
      processed: countByStatus(ReimbursementStatus.PROCESSED),
      totalAmount,
    };
  }
}
