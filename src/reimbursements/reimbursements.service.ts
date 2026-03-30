import {
  Injectable,
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
import { ReimbursementStatus, ReimbursementProcessingType } from '@prisma/client';
import { RequestContextService } from 'src/common/services/request-context.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class ReimbursementsService {
  constructor(
    private prisma: PrismaService,
    private requestContext: RequestContextService,
    private eventEmitter: EventEmitter2,
  ) {}

  async create(createReimbursementDto: CreateReimbursementDto, userId: string) {
    // Validate receipt is required for non-MEDICAL types
    if (!createReimbursementDto.receiptUrl) {
      throw new BadRequestException({
        error: 'Receipt Required',
        message: 'Receipt upload is required. Please upload a receipt image or PDF to continue.',
        field: 'receiptUrl',
        requiredFor: createReimbursementDto.reimbursementType,
      });
    }

    const reimbursement = await this.prisma.reimbursementRequest.create({
      data: {
        ...createReimbursementDto,
        employeeId: userId,
        status: ReimbursementStatus.PENDING,
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
        userId,
        action: 'REIMBURSEMENT_CREATED',
        entityType: 'ReimbursementRequest',
        entityId: reimbursement.id,
        changes: {
          before: null,
          after: reimbursement,
        },
        ipAddress: this.requestContext.getIpAddress(),
        userAgent: this.requestContext.getUserAgent(),
      },
    });

    // Emit event for notifications
    this.eventEmitter.emit('reimbursement.created', {
      reimbursement,
      userId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
    });

    return reimbursement;
  }

  async findAll(
    userId: string,
    query: ReimbursementsQueryDto,
  ): Promise<PaginatedReimbursementsResponseDto> {
    const { page = 1, limit = 20, status, reimbursementType, dateFrom, dateTo } = query;
    const skip = (page - 1) * limit;

    const baseWhere: Record<string, unknown> = { employeeId: userId };

    if (reimbursementType) {
      baseWhere.reimbursementType = reimbursementType;
    }

    if (dateFrom || dateTo) {
      const dateFilter: Record<string, unknown> = {};
      if (dateFrom) dateFilter.gte = new Date(dateFrom);
      if (dateTo) dateFilter.lte = new Date(dateTo);
      baseWhere.transactionDate = dateFilter;
    }

    return this.paginateReimbursements(baseWhere, status, page, limit, skip, false);
  }

  async findOne(id: string, userId?: string) {
    const reimbursement = await this.prisma.reimbursementRequest.findUnique({
      where: { id },
      include: {
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

    const reimbursement = await this.prisma.reimbursementRequest.update({
      where: { id },
      data: updateReimbursementDto,
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
    const { page = 1, limit = 10, status, dateFrom, dateTo, search } = query;
    const skip = (page - 1) * limit;

    const whereClauses: Record<string, unknown>[] = [];

    // Filter by specific status if provided (APPROVED, REJECTED, PROCESSED, etc.)
    if (status) {
      whereClauses.push({ status });
    }

    // Date range filter on transactionDate
    if (dateFrom || dateTo) {
      const dateFilter: Record<string, unknown> = {};
      if (dateFrom) dateFilter.gte = new Date(dateFrom);
      if (dateTo) dateFilter.lte = new Date(dateTo);
      whereClauses.push({ transactionDate: dateFilter });
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

    return this.paginateReimbursements(baseWhere, effectiveStatus, page, limit, skip, true);
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

    const reimbursement = await this.prisma.reimbursementRequest.update({
      where: { id },
      data: {
        status: ReimbursementStatus.APPROVED,
        hrId,
        hrComment: approveReimbursementDto.hrComment,
        hrReviewedAt: new Date(),
        approvedAmount: approveReimbursementDto.approvedAmount ?? existing.amount,
        processingType: approveReimbursementDto.processingType,
        salaryMonth: approveReimbursementDto.salaryMonth,
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

    const whereClauses: Record<string, unknown>[] = [];

    if (reimbursementType) {
      whereClauses.push({ reimbursementType });
    }

    if (employeeId) {
      whereClauses.push({ employeeId });
    }

    if (department) {
      whereClauses.push({
        employee: { departments: { has: department } },
      });
    }

    if (dateFrom || dateTo) {
      const dateFilter: Record<string, unknown> = {};
      if (dateFrom) dateFilter.gte = new Date(dateFrom);
      if (dateTo) dateFilter.lte = new Date(dateTo);
      whereClauses.push({ transactionDate: dateFilter });
    }

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

    return this.paginateReimbursements(baseWhere, status, page, limit, skip, true);
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
      where.transactionDate = {
        gte: new Date(filters.startDate),
        lte: new Date(filters.endDate),
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
        // Just a warning - we'll log this heavily in audit
        console.warn(
          `Admin ${adminId} is changing amount of processed request ${id}. This may cause payroll discrepancy.`,
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
  ): Promise<PaginatedReimbursementsResponseDto> {
    const statusWhere: Record<string, unknown> = statusFilter ? { status: statusFilter } : {};

    const listWhere: Record<string, unknown> = {
      ...baseWhere,
      ...statusWhere,
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

    const [requests, total, statusCounts, totalAmountAgg] = await this.prisma.$transaction([
      this.prisma.reimbursementRequest.findMany({
        where: listWhere as never,
        include: {
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
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.reimbursementRequest.count({ where: listWhere as never }),
      this.prisma.reimbursementRequest.groupBy({
        by: ['status'],
        where: baseWhere as never,
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
    receiptUrl: string | null;
    merchantName: string | null;
    transactionDate: Date;
    status: string;
    processingType: string | null;
    otherComments: string | null;
    // Medical-specific fields
    patientName: string | null;
    patientRelationship: string | null;
    treatmentType: string | null;
    hospitalName: string | null;
    // HR Review Fields
    hrId: string | null;
    hrComment: string | null;
    hrReviewedAt: Date | null;
    approvedAmount: { toNumber: () => number } | null;
    // Processing Fields
    processedAt: Date | null;
    processedById: string | null;
    processingNotes: string | null;
    salaryMonth: string | null;
    createdAt: Date;
    updatedAt: Date;
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
  }) {
    return {
      id: r.id,
      employeeId: r.employeeId,
      reimbursementType: r.reimbursementType,
      amount: r.amount.toNumber(),
      description: r.description,
      receiptUrl: r.receiptUrl,
      merchantName: r.merchantName,
      transactionDate: r.transactionDate.toISOString(),
      status: r.status,
      processingType: r.processingType ?? '',
      otherComments: r.otherComments,
      // Medical-specific fields
      patientName: r.patientName,
      patientRelationship: r.patientRelationship,
      treatmentType: r.treatmentType,
      hospitalName: r.hospitalName,
      // HR Review Fields
      hrId: r.hrId,
      hrComment: r.hrComment,
      hrReviewedAt: r.hrReviewedAt?.toISOString() ?? null,
      approvedAmount: r.approvedAmount?.toNumber() ?? null,
      processedAt: r.processedAt?.toISOString() ?? null,
      processedById: r.processedById,
      processingNotes: r.processingNotes,
      salaryMonth: r.salaryMonth,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
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
}
