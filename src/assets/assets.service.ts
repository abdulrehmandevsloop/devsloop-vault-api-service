import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import {
  AssetStatus,
  AssetEventType,
  AssetIssueType,
  AssetIssuePriority,
  AssetIssueStatus,
  Prisma,
} from '@prisma/client';
import {
  CreateAssetDto,
  AssignAssetDto,
  AssetResponseDto,
  AssetListItemDto,
  AssetHistoryItemDto,
  AssetTypeResponseDto,
  EmployeeDropdownItemDto,
  UpdateAssetQuantityDto,
  UpdateAssetTypeQuantityDto,
  CreateAssetTypeDto,
  UpdateAssetTypeDto,
  ReportAssetIssueDto,
  AssetIssueResponseDto,
  AssetIssueListItemDto,
  UpdateAssetIssueDto,
  MyAssignedAssetDto,
  UpdateAssetDto,
} from './dto';

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Create one or more assets. When quantity > 1, serials are generated as base-1, base-2, ...
   * Each asset gets its own totalQuantity=1, assignedQuantity=0.
   * Status defaults to AVAILABLE. Creates ASSET_CREATED history per asset.
   */
  async create(dto: CreateAssetDto, performedBy: string): Promise<AssetResponseDto> {
    const serialTrimmed = dto.serialNumber.trim();
    if (!serialTrimmed) {
      throw new BadRequestException('Serial number cannot be empty or whitespace only');
    }

    const quantity = Math.min(100, Math.max(1, dto.quantity ?? 1));

    // Build serials: single or base-1, base-2, ...
    const serials =
      quantity === 1
        ? [serialTrimmed]
        : Array.from({ length: quantity }, (_, i) => `${serialTrimmed}-${i + 1}`);

    // Case-insensitive unique check for all serials
    const existing = await this.prisma.asset.findMany({
      where: {
        OR: serials.map((s) => ({
          serialNumber: { equals: s, mode: 'insensitive' },
        })),
      },
      select: { serialNumber: true },
    });
    if (existing.length > 0) {
      throw new ConflictException(
        `Serial number(s) already exist: ${existing.map((e) => e.serialNumber).join(', ')}`,
      );
    }

    // Validate asset type exists and is active
    const assetType = await this.prisma.assetType.findFirst({
      where: { id: dto.assetTypeId, isActive: true },
    });
    if (!assetType) {
      throw new BadRequestException('Invalid or inactive asset type');
    }

    const purchaseDate = dto.purchaseDate ? new Date(dto.purchaseDate) : null;
    const notes = dto.notes?.trim() || null;

    const firstCreatedId = await this.prisma.$transaction(async (tx) => {
      let firstId: string | null = null;
      for (let i = 0; i < serials.length; i++) {
        const created = await tx.asset.create({
          data: {
            assetName: dto.assetName.trim(),
            assetTypeId: dto.assetTypeId,
            serialNumber: serials[i],
            purchaseDate,
            status: AssetStatus.AVAILABLE,
            notes,
            totalQuantity: 1,
            assignedQuantity: 0,
          },
        });
        if (firstId === null) firstId = created.id;

        await tx.assetHistory.create({
          data: {
            assetId: created.id,
            eventType: AssetEventType.ASSET_CREATED,
            performedBy,
            employeeId: null,
            metadata: Prisma.JsonNull,
          },
        });
      }
      return firstId!;
    });

    const asset = await this.prisma.asset.findUnique({
      where: { id: firstCreatedId },
      include: {
        assetType: true,
        assignments: {
          where: { returnedAt: null },
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!asset) throw new NotFoundException(`Asset with ID ${firstCreatedId} not found`);
    return this.toAssetResponse(asset);
  }

  /**
   * Get paginated asset list with search and filters
   */
  async findAll(query: {
    search?: string;
    status?: AssetStatus;
    assetTypeId?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    data: AssetListItemDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { assetName: { contains: term, mode: 'insensitive' } },
        { serialNumber: { contains: term, mode: 'insensitive' } },
      ];
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.assetTypeId) {
      where.assetTypeId = query.assetTypeId;
    }

    const [assets, total] = await Promise.all([
      this.prisma.asset.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          assetType: true,
          assignments: {
            where: { returnedAt: null },
            include: { user: { select: { name: true } } },
          },
        },
      }),
      this.prisma.asset.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: assets.map((a) => {
        const availableQuantity = Math.max(0, a.totalQuantity - a.assignedQuantity);
        const assigneeNames = a.assignments.map((asn) => asn.user.name);
        return {
          id: a.id,
          assetName: a.assetName,
          assetTypeName: a.assetType.name,
          assetTypeId: a.assetType.id,
          totalQuantity: a.totalQuantity,
          assignedQuantity: a.assignedQuantity,
          availableQuantity,
          serialNumber: a.serialNumber,
          status: a.status,
          assignedToName: assigneeNames.length > 0 ? assigneeNames.join(', ') : null,
          createdAt: a.createdAt,
        };
      }),
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  /**
   * Get asset by ID with full details
   */
  async findOne(id: string): Promise<AssetResponseDto> {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: {
        assetType: true,
        assignments: {
          where: { returnedAt: null },
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });

    if (!asset) {
      throw new NotFoundException(`Asset with ID ${id} not found`);
    }

    return this.toAssetResponse(asset);
  }

  /**
   * Update basic asset details (name, serial number, purchase date, notes).
   */
  async updateAsset(id: string, dto: UpdateAssetDto): Promise<AssetResponseDto> {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: {
        assetType: true,
        assignments: {
          where: { returnedAt: null },
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });

    if (!asset) {
      throw new NotFoundException(`Asset with ID ${id} not found`);
    }

    const data: Prisma.AssetUpdateInput = {};

    if (dto.assetName !== undefined) {
      const trimmed = dto.assetName.trim();
      if (!trimmed) {
        throw new BadRequestException('Asset name cannot be empty');
      }
      data.assetName = trimmed;
    }

    if (dto.serialNumber !== undefined) {
      const trimmedSerial = dto.serialNumber.trim();
      if (!trimmedSerial) {
        throw new BadRequestException('Serial number cannot be empty');
      }

      const existing = await this.prisma.asset.findFirst({
        where: {
          id: { not: id },
          serialNumber: { equals: trimmedSerial, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(
          `Serial number "${trimmedSerial}" is already in use by another asset`,
        );
      }

      data.serialNumber = trimmedSerial;
    }

    if (dto.purchaseDate !== undefined) {
      data.purchaseDate = dto.purchaseDate ? new Date(dto.purchaseDate) : null;
    }

    if (dto.notes !== undefined) {
      const trimmedNotes = dto.notes?.trim();
      data.notes = trimmedNotes ? trimmedNotes : null;
    }

    if (Object.keys(data).length === 0) {
      return this.toAssetResponse(asset);
    }

    const updated = await this.prisma.asset.update({
      where: { id },
      data,
      include: {
        assetType: true,
        assignments: {
          where: { returnedAt: null },
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });

    return this.toAssetResponse(updated);
  }

  /**
   * Assign asset to one or more employees. Asset can have multiple assignees.
   * Same employee cannot be assigned twice (active assignment).
   */
  async assign(id: string, dto: AssignAssetDto, performedBy: string): Promise<AssetResponseDto> {
    const assignmentDate = dto.assignmentDate ? new Date(dto.assignmentDate) : new Date();
    const employeeIds = [...new Set(dto.employeeIds)];

    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: {
        assetType: true,
        assignments: { where: { returnedAt: null }, include: { user: { select: { id: true } } } },
      },
    });

    if (!asset) {
      throw new NotFoundException(`Asset with ID ${id} not found`);
    }

    const availableQuantity = asset.totalQuantity - asset.assignedQuantity;
    if (availableQuantity <= 0) {
      throw new BadRequestException(
        `Cannot assign. No available inventory for ${asset.assetName}. Available count is 0.`,
      );
    }

    if (employeeIds.length > availableQuantity) {
      throw new BadRequestException(
        `Cannot assign ${employeeIds.length} employees. Only ${availableQuantity} available slot(s) for ${asset.assetName}.`,
      );
    }

    const assignedSet = new Set(asset.assignments.map((a) => a.user.id));
    const alreadyAssigned = employeeIds.filter((eid) => assignedSet.has(eid));
    if (alreadyAssigned.length > 0) {
      throw new BadRequestException(
        `Already assigned to this asset: ${alreadyAssigned.join(', ')}.`,
      );
    }

    const employees = await this.prisma.user.findMany({
      where: {
        id: { in: employeeIds },
        isSystem: false,
        approvalStatus: 'APPROVED',
        hasAccess: 1,
      },
      select: { id: true, name: true, email: true },
    });

    const foundIds = new Set(employees.map((e) => e.id));
    const missing = employeeIds.filter((eid) => !foundIds.has(eid));
    if (missing.length > 0) {
      throw new BadRequestException(`Employee(s) not found or inactive: ${missing.join(', ')}.`);
    }

    const hadNoAssignments = asset.assignments.length === 0;
    const employeeMap = new Map(employees.map((e) => [e.id, e]));

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const employeeId of employeeIds) {
        await tx.assetAssignment.create({
          data: {
            assetId: id,
            userId: employeeId,
            assignmentDate,
            assignedById: performedBy,
          },
        });

        const emp = employeeMap.get(employeeId)!;
        await tx.assetHistory.create({
          data: {
            assetId: id,
            eventType: AssetEventType.ASSIGNED,
            performedBy,
            employeeId,
            metadata: {
              employeeName: emp.name,
              assignmentDate: assignmentDate.toISOString(),
            },
          },
        });
      }

      if (hadNoAssignments) {
        await tx.asset.update({
          where: { id },
          data: { status: AssetStatus.ASSIGNED },
        });
      }
      await tx.asset.update({
        where: { id },
        data: { assignedQuantity: { increment: employeeIds.length } },
      });

      const result = await tx.asset.findUnique({
        where: { id },
        include: {
          assetType: true,
          assignments: {
            where: { returnedAt: null },
            include: { user: { select: { id: true, name: true, email: true } } },
          },
        },
      });
      if (!result) throw new NotFoundException(`Asset with ID ${id} not found`);
      return result;
    });

    for (const emp of employees) {
      this.eventEmitter.emit('asset.assigned', {
        assetId: id,
        assetName: asset.assetName,
        employeeId: emp.id,
        employeeName: emp.name,
        employeeEmail: emp.email,
      });
    }
    return this.toAssetResponse(updated);
  }

  /**
   * Return asset (one or more assignees). When asset has multiple assignees, userIds in body is required.
   */
  async returnAsset(
    id: string,
    performedBy: string,
    returnUserIds?: string[],
  ): Promise<AssetResponseDto> {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: {
        assetType: true,
        assignments: {
          where: { returnedAt: null },
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });

    if (!asset) {
      throw new NotFoundException(`Asset with ID ${id} not found`);
    }

    const activeAssignments = asset.assignments;
    if (activeAssignments.length === 0) {
      throw new BadRequestException('Asset has no active assignments to return.');
    }

    let toReturnList: typeof activeAssignments;
    if (returnUserIds?.length) {
      const idSet = new Set(returnUserIds);
      toReturnList = activeAssignments.filter((a) => idSet.has(a.user.id));
      const notAssigned = returnUserIds.filter(
        (uid) => !activeAssignments.some((a) => a.user.id === uid),
      );
      if (notAssigned.length > 0) {
        throw new BadRequestException(
          `User(s) not assigned to this asset: ${notAssigned.join(', ')}.`,
        );
      }
    } else if (activeAssignments.length === 1) {
      toReturnList = activeAssignments;
    } else {
      throw new BadRequestException(
        'Asset has multiple assignees. Specify userIds in request body to return.',
      );
    }

    const count = toReturnList.length;
    const willHaveNoAssignments = activeAssignments.length === count;

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const toReturn of toReturnList) {
        await tx.assetAssignment.update({
          where: { id: toReturn.id },
          data: { returnedAt: new Date() },
        });
        await tx.assetHistory.create({
          data: {
            assetId: id,
            eventType: AssetEventType.RETURNED,
            performedBy,
            employeeId: toReturn.userId,
            metadata: { formerEmployeeName: toReturn.user.name },
          },
        });
      }

      // Always decrement assignedQuantity on return, clamp to 0
      await tx.asset.update({
        where: { id },
        data: {
          assignedQuantity: { decrement: count },
          ...(willHaveNoAssignments && { status: AssetStatus.AVAILABLE }),
        },
      });

      const result = await tx.asset.findUnique({
        where: { id },
        include: {
          assetType: true,
          assignments: {
            where: { returnedAt: null },
            include: { user: { select: { id: true, name: true, email: true } } },
          },
        },
      });
      if (!result) throw new NotFoundException(`Asset with ID ${id} not found`);
      return result;
    });

    for (const toReturn of toReturnList) {
      this.eventEmitter.emit('asset.returned', {
        assetId: id,
        assetName: asset.assetName,
        userId: toReturn.userId,
        formerEmployeeName: toReturn.user.name,
      });
    }
    return this.toAssetResponse(updated);
  }

  /**
   * Get asset history (immutable timeline)
   */
  async getHistory(id: string): Promise<AssetHistoryItemDto[]> {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!asset) {
      throw new NotFoundException(`Asset with ID ${id} not found`);
    }

    const history = await this.prisma.assetHistory.findMany({
      where: { assetId: id },
      orderBy: { createdAt: 'desc' },
    });

    return history.map((h) => ({
      id: h.id,
      eventType: h.eventType,
      performedBy: h.performedBy,
      employeeId: h.employeeId,
      metadata: h.metadata as Record<string, unknown> | null,
      createdAt: h.createdAt,
    }));
  }

  /**
   * Get asset types. When includeInactive is true, returns all types for admin CRUD.
   */
  async getAssetTypes(includeInactive = false): Promise<AssetTypeResponseDto[]> {
    const types = await this.prisma.assetType.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { name: 'asc' },
    });
    return types.map((t) => this.toAssetTypeResponse(t));
  }

  /**
   * Get a single asset type by ID
   */
  async getAssetTypeById(id: string): Promise<AssetTypeResponseDto> {
    const type = await this.prisma.assetType.findUnique({
      where: { id },
    });
    if (!type) {
      throw new NotFoundException(`Asset type with ID ${id} not found`);
    }
    return this.toAssetTypeResponse(type);
  }

  /**
   * Create a new asset type
   */
  async createAssetType(dto: CreateAssetTypeDto): Promise<AssetTypeResponseDto> {
    const nameTrimmed = dto.name.trim();
    const existing = await this.prisma.assetType.findFirst({
      where: { name: { equals: nameTrimmed, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictException(`Asset type "${nameTrimmed}" already exists`);
    }
    const created = await this.prisma.assetType.create({
      data: {
        name: nameTrimmed,
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
    return this.toAssetTypeResponse(created);
  }

  /**
   * Update asset type name and/or isActive
   */
  async updateAssetType(id: string, dto: UpdateAssetTypeDto): Promise<AssetTypeResponseDto> {
    const type = await this.prisma.assetType.findUnique({
      where: { id },
    });
    if (!type) {
      throw new NotFoundException(`Asset type with ID ${id} not found`);
    }
    const data: { name?: string; isActive?: boolean } = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (Object.keys(data).length === 0) {
      return this.toAssetTypeResponse(type);
    }
    const updated = await this.prisma.assetType.update({
      where: { id },
      data,
    });
    return this.toAssetTypeResponse(updated);
  }

  /**
   * Soft-delete asset type (set isActive to false). Inactive types are hidden from dropdowns.
   */
  async removeAssetType(id: string): Promise<AssetTypeResponseDto> {
    const type = await this.prisma.assetType.findUnique({
      where: { id },
    });
    if (!type) {
      throw new NotFoundException(`Asset type with ID ${id} not found`);
    }
    const updated = await this.prisma.assetType.update({
      where: { id },
      data: { isActive: false },
    });
    return this.toAssetTypeResponse(updated);
  }

  private toAssetTypeResponse(t: {
    id: string;
    name: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): AssetTypeResponseDto {
    return {
      id: t.id,
      name: t.name,
      isActive: t.isActive,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }

  /**
   * Update asset inventory quantity. Cannot set below assignedQuantity.
   * This is now per-asset, not per-asset-type.
   */
  async updateAssetQuantity(
    assetId: string,
    dto: UpdateAssetQuantityDto,
  ): Promise<AssetResponseDto> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: {
        assetType: true,
        assignments: {
          where: { returnedAt: null },
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });

    if (!asset) {
      throw new NotFoundException(`Asset with ID ${assetId} not found`);
    }

    if (dto.totalQuantity < asset.assignedQuantity) {
      throw new BadRequestException(
        `Quantity cannot be below assigned count (${asset.assignedQuantity}). Reduce assignments first.`,
      );
    }

    const updated = await this.prisma.asset.update({
      where: { id: assetId },
      data: { totalQuantity: dto.totalQuantity },
      include: {
        assetType: true,
        assignments: {
          where: { returnedAt: null },
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });

    return this.toAssetResponse(updated);
  }

  /**
   * Legacy: Update asset type quantity (kept for backward compatibility if needed).
   * @deprecated Use updateAssetQuantity instead.
   */
  async updateAssetTypeQuantity(
    assetTypeId: string,
    dto: UpdateAssetTypeQuantityDto,
  ): Promise<AssetTypeResponseDto> {
    const assetType = await this.prisma.assetType.findUnique({
      where: { id: assetTypeId },
    });

    if (!assetType) {
      throw new NotFoundException(`Asset type with ID ${assetTypeId} not found`);
    }

    return this.toAssetTypeResponse(assetType);
  }

  /**
   * Get assets assigned to a specific user (for employee "My Assets" view).
   * Returns assignedAt (assignment date) for each asset.
   */
  async findAssignedToUser(userId: string): Promise<MyAssignedAssetDto[]> {
    const assets = await this.prisma.asset.findMany({
      where: {
        assignments: {
          some: { userId, returnedAt: null },
        },
      },
      include: {
        assetType: true,
        assignments: {
          where: { userId, returnedAt: null },
          select: { assignmentDate: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return assets.map((a) => {
      const assignedAt = a.assignments[0]?.assignmentDate ?? a.createdAt;
      return {
        id: a.id,
        assetName: a.assetName,
        assetType: { id: a.assetType.id, name: a.assetType.name },
        serialNumber: a.serialNumber,
        purchaseDate: a.purchaseDate,
        status: a.status,
        assignedAt,
        notes: a.notes,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      };
    });
  }

  /**
   * Report an issue with an asset (employee). User must be assigned to the asset.
   * Creates issue, sets asset status to UNDER_REPAIR, adds REPAIR_REPORTED history.
   */
  async reportIssue(
    assetId: string,
    reportedByUserId: string,
    dto: ReportAssetIssueDto,
  ): Promise<AssetIssueResponseDto> {
    const assignment = await this.prisma.assetAssignment.findFirst({
      where: { assetId, userId: reportedByUserId, returnedAt: null },
      select: { id: true },
    });
    if (!assignment) {
      throw new BadRequestException(
        'You can only report issues for assets currently assigned to you.',
      );
    }

    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true, assetName: true },
    });
    if (!asset) {
      throw new NotFoundException(`Asset with ID ${assetId} not found`);
    }

    const priority = dto.priority ?? 'MEDIUM';
    const issue = await this.prisma.$transaction(async (tx) => {
      const created = await tx.assetIssue.create({
        data: {
          assetId,
          reportedById: reportedByUserId,
          issueType: dto.issueType as AssetIssueType,
          description: dto.description.trim(),
          priority: priority as AssetIssuePriority,
          status: AssetIssueStatus.OPEN,
        },
      });

      await tx.asset.update({
        where: { id: assetId },
        data: { status: AssetStatus.UNDER_REPAIR },
      });

      const reporter = await tx.user.findUnique({
        where: { id: reportedByUserId },
        select: { name: true },
      });

      await tx.assetHistory.create({
        data: {
          assetId,
          eventType: AssetEventType.REPAIR_REPORTED,
          performedBy: reportedByUserId,
          employeeId: reportedByUserId,
          metadata: {
            issueId: created.id,
            issueType: dto.issueType,
            priority,
            description: dto.description.trim().slice(0, 200),
            reportedByName: reporter?.name ?? 'Unknown',
          },
        },
      });

      return created;
    });

    this.eventEmitter.emit('asset.issue.reported', {
      assetId,
      assetName: asset.assetName,
      issueId: issue.id,
      reportedById: reportedByUserId,
      issueType: dto.issueType,
      priority,
    });

    const full = await this.getIssueById(issue.id);
    return full!;
  }

  /**
   * List asset issues for admin (optional status filter, paginated).
   */
  async findAllIssues(query: {
    status?: AssetIssueStatus;
    page?: number;
    limit?: number;
  }): Promise<{
    data: AssetIssueListItemDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;
    const where: { status?: AssetIssueStatus } = {};
    if (query.status) where.status = query.status;

    const [issues, total] = await Promise.all([
      this.prisma.assetIssue.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          asset: { select: { assetName: true, serialNumber: true } },
          reportedBy: { select: { name: true } },
        },
      }),
      this.prisma.assetIssue.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);
    return {
      data: issues.map((i) => ({
        id: i.id,
        assetId: i.assetId,
        assetName: i.asset.assetName,
        serialNumber: i.asset.serialNumber,
        issueType: i.issueType,
        priority: i.priority,
        status: i.status,
        reportedByName: i.reportedBy.name,
        createdAt: i.createdAt,
      })),
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  /**
   * Get a single asset issue by ID (admin).
   */
  async getIssueById(id: string): Promise<AssetIssueResponseDto | null> {
    const issue = await this.prisma.assetIssue.findUnique({
      where: { id },
      include: {
        asset: { select: { assetName: true, serialNumber: true } },
        reportedBy: { select: { name: true, email: true } },
      },
    });
    if (!issue) return null;
    return this.toAssetIssueResponse(issue);
  }

  /**
   * Update issue status (admin). When status is RESOLVED, sets resolvedAt/resolvedById,
   * adds REPAIR_RESOLVED to asset history, and sets asset status back to ASSIGNED.
   */
  async updateIssueStatus(
    issueId: string,
    dto: UpdateAssetIssueDto,
    performedBy: string,
  ): Promise<AssetIssueResponseDto> {
    const issue = await this.prisma.assetIssue.findUnique({
      where: { id: issueId },
      include: {
        asset: { select: { id: true, assetName: true, serialNumber: true, status: true } },
        reportedBy: { select: { name: true, email: true } },
      },
    });
    if (!issue) {
      throw new NotFoundException(`Asset issue with ID ${issueId} not found`);
    }

    const isResolving =
      dto.status === AssetIssueStatus.RESOLVED && issue.status !== AssetIssueStatus.RESOLVED;

    await this.prisma.$transaction(async (tx) => {
      await tx.assetIssue.update({
        where: { id: issueId },
        data: {
          status: dto.status,
          ...(isResolving && {
            resolvedAt: new Date(),
            resolvedById: performedBy,
          }),
        },
      });

      if (isResolving) {
        await tx.asset.update({
          where: { id: issue.assetId },
          data: { status: AssetStatus.ASSIGNED },
        });
        await tx.assetHistory.create({
          data: {
            assetId: issue.assetId,
            eventType: AssetEventType.REPAIR_RESOLVED,
            performedBy,
            employeeId: null,
            metadata: {
              issueId,
              formerStatus: issue.asset.status,
            },
          },
        });
      }
    });

    const updated = await this.getIssueById(issueId);
    if (!updated) throw new NotFoundException(`Asset issue with ID ${issueId} not found`);
    return updated;
  }

  private toAssetIssueResponse(issue: {
    id: string;
    assetId: string;
    reportedById: string;
    issueType: string;
    description: string;
    priority: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    resolvedAt: Date | null;
    resolvedById: string | null;
    asset: { assetName: string; serialNumber: string };
    reportedBy: { name: string; email: string };
  }): AssetIssueResponseDto {
    return {
      id: issue.id,
      assetId: issue.assetId,
      assetName: issue.asset.assetName,
      serialNumber: issue.asset.serialNumber,
      issueType: issue.issueType,
      description: issue.description,
      priority: issue.priority,
      status: issue.status,
      reportedById: issue.reportedById,
      reportedByName: issue.reportedBy.name,
      reportedByEmail: issue.reportedBy.email,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      resolvedAt: issue.resolvedAt,
      resolvedById: issue.resolvedById,
    };
  }

  /**
   * Get active employees for assign dropdown. Optional search by name or email.
   */
  async getActiveEmployees(search?: string): Promise<EmployeeDropdownItemDto[]> {
    const where: Record<string, unknown> = {
      isSystem: false,
      approvalStatus: 'APPROVED',
      hasAccess: 1,
    };

    if (search?.trim()) {
      const term = search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
      ];
    }

    const users = await this.prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
    return users;
  }

  private toAssetResponse(asset: {
    id: string;
    assetName: string;
    serialNumber: string;
    purchaseDate: Date | null;
    status: AssetStatus;
    notes: string | null;
    totalQuantity: number;
    assignedQuantity: number;
    createdAt: Date;
    updatedAt: Date;
    assetType: { id: string; name: string };
    assignments: { user: { id: string; name: string; email: string } }[];
  }): AssetResponseDto {
    const availableQuantity = Math.max(0, asset.totalQuantity - asset.assignedQuantity);
    const assignedEmployees = asset.assignments.map((a) => ({
      id: a.user.id,
      name: a.user.name,
      email: a.user.email,
    }));
    return {
      id: asset.id,
      assetName: asset.assetName,
      assetType: {
        id: asset.assetType.id,
        name: asset.assetType.name,
      },
      serialNumber: asset.serialNumber,
      purchaseDate: asset.purchaseDate,
      status: asset.status,
      totalQuantity: asset.totalQuantity,
      assignedQuantity: asset.assignedQuantity,
      availableQuantity,
      assignedEmployees,
      notes: asset.notes,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    };
  }
}
