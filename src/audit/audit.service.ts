import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditQueryDto } from './dto/audit-query.dto';
import {
  PaginatedAuditLogsResponseDto,
  AuditFilterOptionsDto,
  EntityDetailsDto,
} from './dto/audit-response.dto';
import { Prisma } from '@prisma/client';

/** Keys in `changes` that hold user IDs and should be resolved to names */
const USER_ID_KEYS = [
  'authorId',
  'reviewerId',
  'approvedBy',
  'rejectedBy',
  'changedBy',
  // Leave management
  'employeeId',
  'teamLeadId',
  'hrId',
  'reportingManagerId',
];

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetch paginated audit logs with filters.
   * Resolves entityId → entity details and user IDs in changes → names.
   */
  async findAll(query: AuditQueryDto): Promise<PaginatedAuditLogsResponseDto> {
    const {
      search,
      action,
      entityType,
      userId,
      startDate,
      endDate,
      page = 1,
      limit = 20,
      sortBy = 'timestamp',
      sortOrder = 'desc',
    } = query;

    // Build the where clause
    const where: Prisma.AuditLogWhereInput = {};

    if (search) {
      where.OR = [
        { action: { contains: search, mode: 'insensitive' } },
        { entityType: { contains: search, mode: 'insensitive' } },
        { entityId: { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (userId) where.userId = userId;

    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = startDate;
      if (endDate) where.timestamp.lte = endDate;
    }

    const allowedSortFields = ['timestamp', 'action', 'entityType'];
    const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'timestamp';
    const skip = (page - 1) * limit;

    // Fetch data + count in parallel
    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
        },
        orderBy: { [safeSortBy]: sortOrder },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // ---------------------------------------------------------------
    // Resolve entity IDs and user IDs in changes (batched)
    // ---------------------------------------------------------------
    const enrichedData = await this.enrichAuditLogs(data);

    const totalPages = Math.ceil(total / limit);

    this.logger.debug(
      `Fetched ${data.length} audit logs (page ${page}/${totalPages}, total ${total})`,
    );

    return {
      data: enrichedData,
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  /**
   * Enrich audit logs by resolving entityId and user IDs inside changes.
   * Uses batch queries to avoid N+1.
   */
  private async enrichAuditLogs(
    logs: Array<{
      id: string;
      userId: string | null;
      action: string;
      entityType: string;
      entityId: string;
      changes: Prisma.JsonValue;
      ipAddress: string | null;
      userAgent: string | null;
      timestamp: Date;
      user: { id: string; name: string; email: string; avatarUrl: string | null } | null;
    }>,
  ) {
    // 1. Collect all unique IDs that need resolution
    const userIds = new Set<string>();
    const contributionIds = new Set<string>();
    const projectIds = new Set<string>();
    const leaveRequestIds = new Set<string>();

    for (const log of logs) {
      // Entity-level IDs
      if (log.entityType === 'User' && this.isCuid(log.entityId)) {
        userIds.add(log.entityId);
      } else if (log.entityType === 'Contribution' && this.isCuid(log.entityId)) {
        contributionIds.add(log.entityId);
      } else if (log.entityType === 'Project' && this.isCuid(log.entityId)) {
        projectIds.add(log.entityId);
      } else if (log.entityType === 'LeaveRequest' && this.isCuid(log.entityId)) {
        leaveRequestIds.add(log.entityId);
      }

      // IDs inside changes
      const changes = log.changes as Record<string, any> | null;
      if (changes) {
        for (const key of USER_ID_KEYS) {
          if (changes[key] && typeof changes[key] === 'string' && this.isCuid(changes[key])) {
            userIds.add(changes[key]);
          }
        }
        if (
          changes.projectId &&
          typeof changes.projectId === 'string' &&
          this.isCuid(changes.projectId)
        ) {
          projectIds.add(changes.projectId);
        }
      }
    }

    // 2. Batch-fetch all referenced entities in parallel
    const [userMap, contributionMap, projectMap, leaveRequestMap] = await Promise.all([
      this.batchFetchUsers([...userIds]),
      this.batchFetchContributions([...contributionIds]),
      this.batchFetchProjects([...projectIds]),
      this.batchFetchLeaveRequests([...leaveRequestIds]),
    ]);

    // 3. Enrich each log
    return logs.map((log) => {
      const changes = (log.changes as Record<string, any>) ?? null;

      // Resolve entityDetails
      let entityDetails: EntityDetailsDto | null = null;
      if (log.entityType === 'User') {
        const resolved = userMap.get(log.entityId);
        if (resolved) {
          entityDetails = { label: resolved.name, description: resolved.email };
        }
      } else if (log.entityType === 'Contribution') {
        const resolved = contributionMap.get(log.entityId);
        if (resolved) {
          entityDetails = {
            label: resolved.problem
              ? resolved.problem.length > 80
                ? resolved.problem.substring(0, 80) + '...'
                : resolved.problem
              : 'Contribution',
            description: resolved.projectName ?? undefined,
          };
        }
      } else if (log.entityType === 'Project') {
        const resolved = projectMap.get(log.entityId);
        if (resolved) {
          entityDetails = {
            label: resolved.name,
            description: resolved.clientName ?? undefined,
          };
        }
      } else if (log.entityType === 'LeaveRequest') {
        const resolved = leaveRequestMap.get(log.entityId);
        if (resolved) {
          entityDetails = {
            label: `${resolved.employeeName} · ${resolved.leaveType}`,
            description: `${resolved.dateRange} · ${resolved.status}`,
          };
        }
      } else if (log.entityType === 'UserWarning' && changes) {
        // Derive from changes — works for both WARNING_CREATED and WARNING_DELETED
        // (deleted warnings no longer exist in DB, so changes is the only source)
        const wt = typeof changes.warningType === 'string' ? changes.warningType : null;
        const employeeName =
          typeof changes.issuedToName === 'string'
            ? changes.issuedToName
            : typeof changes.employeeName === 'string'
              ? changes.employeeName
              : null;
        const employeeEmail =
          typeof changes.issuedToEmail === 'string'
            ? changes.issuedToEmail
            : typeof changes.employeeEmail === 'string'
              ? changes.employeeEmail
              : null;
        entityDetails = {
          label: wt ? wt.charAt(0) + wt.slice(1).toLowerCase() + ' Warning' : 'Warning',
          description: employeeName ?? employeeEmail ?? undefined,
        };
      }

      // Resolve user IDs in changes to names
      let enrichedChanges = changes;
      if (changes) {
        enrichedChanges = { ...changes };
        for (const key of USER_ID_KEYS) {
          if (enrichedChanges[key] && typeof enrichedChanges[key] === 'string') {
            const resolved = userMap.get(enrichedChanges[key]);
            if (resolved) {
              // Replace raw ID with a name+email object
              enrichedChanges[key] = {
                id: enrichedChanges[key],
                name: resolved.name,
                email: resolved.email,
              };
            }
          }
        }
        // Resolve projectId
        if (enrichedChanges.projectId && typeof enrichedChanges.projectId === 'string') {
          const resolved = projectMap.get(enrichedChanges.projectId);
          if (resolved) {
            enrichedChanges.projectId = {
              id: enrichedChanges.projectId,
              name: resolved.name,
              clientName: resolved.clientName,
            };
          }
        }
      }

      return {
        ...log,
        entityDetails,
        changes: enrichedChanges,
      };
    });
  }

  /** Batch-fetch users by ID → Map<id, {name, email}> */
  private async batchFetchUsers(
    ids: string[],
  ): Promise<Map<string, { name: string; email: string }>> {
    if (ids.length === 0) return new Map();

    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true },
    });

    return new Map(users.map((u) => [u.id, { name: u.name, email: u.email }]));
  }

  /** Batch-fetch contributions by ID → Map<id, {problem, projectName}> */
  private async batchFetchContributions(
    ids: string[],
  ): Promise<Map<string, { problem: string; projectName: string | null }>> {
    if (ids.length === 0) return new Map();

    const contributions = await this.prisma.contribution.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        problem: true,
        project: { select: { name: true } },
      },
    });

    return new Map(
      contributions.map((c) => [
        c.id,
        { problem: c.problem, projectName: c.project?.name ?? null },
      ]),
    );
  }

  /** Batch-fetch projects by ID → Map<id, {name, clientName}> */
  private async batchFetchProjects(
    ids: string[],
  ): Promise<Map<string, { name: string; clientName: string | null }>> {
    if (ids.length === 0) return new Map();

    const projects = await this.prisma.project.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, clientName: true },
    });

    return new Map(projects.map((p) => [p.id, { name: p.name, clientName: p.clientName }]));
  }

  /** Batch-fetch leave requests by ID → Map<id, {employeeName, leaveType, dateRange, status}> */
  private async batchFetchLeaveRequests(ids: string[]): Promise<
    Map<
      string,
      {
        employeeName: string;
        leaveType: string;
        dateRange: string;
        status: string;
      }
    >
  > {
    if (ids.length === 0) return new Map();

    const leaves = await this.prisma.leaveRequest.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        leaveType: true,
        status: true,
        startDate: true,
        endDate: true,
        employee: { select: { name: true } },
      },
    });

    const fmt = (d: Date): string =>
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    return new Map(
      leaves.map((l) => [
        l.id,
        {
          employeeName: l.employee?.name ?? 'Employee',
          leaveType: String(l.leaveType),
          status: String(l.status),
          dateRange:
            l.startDate.toDateString() === l.endDate.toDateString()
              ? fmt(l.startDate)
              : `${fmt(l.startDate)} – ${fmt(l.endDate)}`,
        },
      ]),
    );
  }

  /** Simple CUID check — starts with 'c' and is 25 chars */
  private isCuid(value: string): boolean {
    return /^c[a-z0-9]{24}$/.test(value);
  }

  /**
   * Get distinct filter options for the audit log filters UI
   */
  async getFilterOptions(): Promise<AuditFilterOptionsDto> {
    const [actionGroups, entityTypeGroups] = await this.prisma.$transaction([
      this.prisma.auditLog.groupBy({
        by: ['action'],
        orderBy: { action: 'asc' },
      }),
      this.prisma.auditLog.groupBy({
        by: ['entityType'],
        orderBy: { entityType: 'asc' },
      }),
    ]);

    return {
      actions: actionGroups.map((g) => g.action),
      entityTypes: entityTypeGroups.map((g) => g.entityType),
    };
  }
}
