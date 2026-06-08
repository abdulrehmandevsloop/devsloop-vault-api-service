import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventPriority, EventStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma';
import { AclService } from 'src/rbac/rbac.service';
import { AuditLogService } from 'src/auth/services/audit-log.service';
import {
  AssigneeStatus,
  CompleteEventDto,
  CreateEventDto,
  EventAttachmentDto,
  EventDetailDto,
  EventListItemDto,
  EventListResponseDto,
  EventQueryDto,
  EventStatsDto,
  MyEventDetailDto,
  MyEventItemDto,
  MyEventsFilter,
  MyEventsQueryDto,
  MyEventsListResponseDto,
  SetAssigneesDto,
  UpdateEventDto,
  UserEventAnalyticsDto,
} from './dto';

type EventAction = 'read' | 'read_all' | 'write';

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

const toAttachmentDto = (a: {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  createdAt: Date;
}) => ({
  id: a.id,
  fileName: a.fileName,
  fileUrl: a.fileUrl,
  fileSize: a.fileSize,
  createdAt: a.createdAt.toISOString(),
});

// Shared shape for the admin list query — also reused to derive the row type
// fed to `toListItemDto`, so the mapping stays in sync with what we fetch.
const EVENT_LIST_INCLUDE = {
  createdBy: { select: { name: true } },
  userAssignees: { select: { userId: true } },
  roleAssignees: { select: { roleId: true } },
  completions: { select: { userId: true } },
  attachments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.EventInclude;

type EventListRow = Prisma.EventGetPayload<{ include: typeof EVENT_LIST_INCLUDE }>;

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aclService: AclService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ── Permission helpers ──────────────────────────────────────────────────────

  /**
   * Enforce an action on the `event` entity.
   * - `read`     → any granted action (assignee self-service).
   * - `read_all` → `read_all` or `write` (oversight).
   * - `write`    → `write` (management).
   */
  private async assertAction(userId: string, action: EventAction): Promise<void> {
    const actions = await this.aclService.getUserEntityActions(userId, 'event');
    const aliases: Record<EventAction, (a: string[]) => boolean> = {
      read: (a) => a.length > 0,
      read_all: (a) => a.includes('read_all') || a.includes('write'),
      write: (a) => a.includes('write'),
    };
    if (!aliases[action](actions)) {
      throw new ForbiddenException(`Access denied. Missing "${action}" permission for events.`);
    }
  }

  // ── Assignee resolution (dynamic/live role membership) ──────────────────────

  /** All userIds currently belonging to the given (active) roles. */
  private async roleMemberIds(roleIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (roleIds.length === 0) return map;
    const assignments = await this.prisma.userRoleAssignment.findMany({
      where: { roleId: { in: roleIds }, role: { isActive: true } },
      select: { roleId: true, userId: true },
    });
    for (const a of assignments) {
      const list = map.get(a.roleId) ?? [];
      list.push(a.userId);
      map.set(a.roleId, list);
    }
    return map;
  }

  private computeStatus(
    hasCompletion: boolean,
    event: { status: EventStatus; dueDate: Date },
    now: Date,
  ): AssigneeStatus {
    if (hasCompletion) return 'completed';
    if (event.status === EventStatus.ACTIVE && event.dueDate.getTime() < now.getTime()) {
      return 'overdue';
    }
    return 'pending';
  }

  private statsFromStatuses(statuses: AssigneeStatus[]): EventStatsDto {
    const totalAssigned = statuses.length;
    const completed = statuses.filter((s) => s === 'completed').length;
    const overdue = statuses.filter((s) => s === 'overdue').length;
    const pending = statuses.filter((s) => s === 'pending').length;
    return {
      totalAssigned,
      completed,
      pending,
      overdue,
      completionRate: totalAssigned === 0 ? 0 : Math.round((completed / totalAssigned) * 100),
    };
  }

  /**
   * Collapse an event's per-assignee statuses into a single aggregate status:
   * `completed` only when every assignee has completed; `overdue` if any
   * assignee is overdue; otherwise `pending`. Used by the admin completion
   * filter so a manager can slice the grid the same way assignees see their own.
   */
  private eventLevelStatus(stats: EventStatsDto): AssigneeStatus {
    if (stats.totalAssigned > 0 && stats.completed === stats.totalAssigned) return 'completed';
    if (stats.overdue > 0) return 'overdue';
    return 'pending';
  }

  // ── Admin: create / update / delete ─────────────────────────────────────────

  async create(dto: CreateEventDto, userId: string): Promise<EventDetailDto> {
    await this.assertAction(userId, 'write');
    await this.validateAssignees(dto.userIds, dto.roleIds);

    const event = await this.prisma.event.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        dueDate: new Date(dto.dueDate),
        priority: dto.priority ?? EventPriority.MEDIUM,
        status: dto.status ?? EventStatus.ACTIVE,
        createdById: userId,
        userAssignees: dto.userIds?.length
          ? { create: dto.userIds.map((uid) => ({ userId: uid })) }
          : undefined,
        roleAssignees: dto.roleIds?.length
          ? { create: dto.roleIds.map((rid) => ({ roleId: rid })) }
          : undefined,
        attachments: dto.attachments?.length
          ? {
              create: dto.attachments.map((a) => ({
                fileName: a.fileName,
                fileUrl: a.fileUrl,
                fileSize: a.fileSize ?? null,
                uploadedById: userId,
              })),
            }
          : undefined,
      },
      select: { id: true },
    });

    await this.auditLogService.log(userId, 'EVENT_CREATED', 'event', event.id, {
      title: dto.title,
      userIds: dto.userIds ?? [],
      roleIds: dto.roleIds ?? [],
    });

    return this.findOne(event.id, userId);
  }

  async update(id: string, dto: UpdateEventDto, userId: string): Promise<EventDetailDto> {
    await this.assertAction(userId, 'write');
    await this.getEventOrThrow(id);

    await this.prisma.event.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        description: dto.description !== undefined ? dto.description?.trim() || null : undefined,
        startDate:
          dto.startDate !== undefined
            ? dto.startDate
              ? new Date(dto.startDate)
              : null
            : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        priority: dto.priority,
        status: dto.status,
      },
    });

    await this.auditLogService.log(userId, 'EVENT_UPDATED', 'event', id, { ...dto });
    return this.findOne(id, userId);
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.assertAction(userId, 'write');
    await this.getEventOrThrow(id);
    await this.prisma.event.delete({ where: { id } });
    await this.auditLogService.log(userId, 'EVENT_DELETED', 'event', id, {});
  }

  async setAssignees(id: string, dto: SetAssigneesDto, userId: string): Promise<EventDetailDto> {
    await this.assertAction(userId, 'write');
    await this.getEventOrThrow(id);
    await this.validateAssignees(dto.userIds, dto.roleIds);

    const userIds = dto.userIds ?? [];
    const roleIds = dto.roleIds ?? [];

    await this.prisma.$transaction([
      this.prisma.eventAssignee.deleteMany({ where: { eventId: id } }),
      this.prisma.eventRoleAssignee.deleteMany({ where: { eventId: id } }),
      ...(userIds.length
        ? [
            this.prisma.eventAssignee.createMany({
              data: userIds.map((uid) => ({ eventId: id, userId: uid })),
            }),
          ]
        : []),
      ...(roleIds.length
        ? [
            this.prisma.eventRoleAssignee.createMany({
              data: roleIds.map((rid) => ({ eventId: id, roleId: rid })),
            }),
          ]
        : []),
    ]);

    await this.auditLogService.log(userId, 'EVENT_ASSIGNEES_SET', 'event', id, {
      userIds,
      roleIds,
    });
    return this.findOne(id, userId);
  }

  async addAttachment(
    id: string,
    dto: { fileName: string; fileUrl: string; fileSize?: number },
    userId: string,
  ): Promise<EventAttachmentDto> {
    await this.assertAction(userId, 'write');
    await this.getEventOrThrow(id);
    const att = await this.prisma.eventAttachment.create({
      data: {
        eventId: id,
        fileName: dto.fileName,
        fileUrl: dto.fileUrl,
        fileSize: dto.fileSize ?? null,
        uploadedById: userId,
      },
    });
    return {
      id: att.id,
      fileName: att.fileName,
      fileUrl: att.fileUrl,
      fileSize: att.fileSize,
      createdAt: att.createdAt.toISOString(),
    };
  }

  async removeAttachment(id: string, attachmentId: string, userId: string): Promise<void> {
    await this.assertAction(userId, 'write');
    const att = await this.prisma.eventAttachment.findFirst({
      where: { id: attachmentId, eventId: id },
    });
    if (!att) throw new NotFoundException('Attachment not found');
    await this.prisma.eventAttachment.delete({ where: { id: attachmentId } });
  }

  // ── Admin: read ─────────────────────────────────────────────────────────────

  async findAll(query: EventQueryDto, userId: string): Promise<EventListResponseDto> {
    await this.assertAction(userId, 'read_all');
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const where: Prisma.EventWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.dueFrom || query.dueTo
        ? {
            dueDate: {
              ...(query.dueFrom ? { gte: new Date(query.dueFrom) } : {}),
              ...(query.dueTo ? { lte: new Date(query.dueTo) } : {}),
            },
          }
        : {}),
    };

    // Optional "assigned to a specific person" filter (direct or via role).
    if (query.assigneeId) {
      where.AND = [await this.assignedToUserFragment(query.assigneeId)];
    }

    const orderBy: Prisma.EventOrderByWithRelationInput[] = [
      { dueDate: 'asc' },
      { createdAt: 'desc' },
    ];

    // The completion-status filter depends on per-event status, which requires
    // expanding role membership in memory — it can't be expressed in SQL. So
    // when it's set we fetch the full matching set, filter, then paginate.
    // Otherwise we page at the DB for efficiency.
    if (query.completionStatus) {
      const events = await this.prisma.event.findMany({
        where,
        orderBy,
        include: EVENT_LIST_INCLUDE,
      });
      const now = new Date();

      // Scoped to one assignee → "completed/overdue/pending" means *that
      // person's* own status (so an event you finished shows under "Completed"
      // even if other assignees haven't). For "everyone" it's the aggregate
      // across all assignees.
      if (query.assigneeId) {
        const assigneeId = query.assigneeId;
        const filtered = events.filter(
          (e) =>
            this.computeStatus(
              e.completions.some((c) => c.userId === assigneeId),
              e,
              now,
            ) === query.completionStatus,
        );
        const total = filtered.length;
        const paged = filtered.slice((page - 1) * limit, (page - 1) * limit + limit);
        return { data: await this.toListItemDtos(paged, userId), total, page, limit };
      }

      const data = await this.toListItemDtos(events, userId);
      const filtered = data.filter(
        (e) => this.eventLevelStatus(e.stats) === query.completionStatus,
      );
      const total = filtered.length;
      const paged = filtered.slice((page - 1) * limit, (page - 1) * limit + limit);
      return { data: paged, total, page, limit };
    }

    const [total, events] = await this.prisma.$transaction([
      this.prisma.event.count({ where }),
      this.prisma.event.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: EVENT_LIST_INCLUDE,
      }),
    ]);

    const data = await this.toListItemDtos(events, userId);
    return { data, total, page, limit };
  }

  /**
   * Map admin-list event rows to DTOs, resolving role membership in one query.
   * `requestingUserId` lets each row carry that user's own status (null when
   * they aren't an assignee) so the grid can hide "mark complete" once done.
   */
  private async toListItemDtos(
    events: EventListRow[],
    requestingUserId: string,
  ): Promise<EventListItemDto[]> {
    const allRoleIds = [...new Set(events.flatMap((e) => e.roleAssignees.map((r) => r.roleId)))];
    const memberMap = await this.roleMemberIds(allRoleIds);
    const now = new Date();

    return events.map((e) => {
      const assigneeIds = this.assigneeIdSet(e, memberMap);
      const completedSet = new Set(e.completions.map((c) => c.userId));
      const statuses = [...assigneeIds].map((uid) =>
        this.computeStatus(completedSet.has(uid), e, now),
      );
      return {
        id: e.id,
        title: e.title,
        description: e.description,
        startDate: iso(e.startDate),
        dueDate: e.dueDate.toISOString(),
        priority: e.priority,
        status: e.status,
        createdById: e.createdById,
        createdByName: e.createdBy?.name,
        createdAt: e.createdAt.toISOString(),
        stats: this.statsFromStatuses(statuses),
        attachments: e.attachments.map(toAttachmentDto),
        myStatus: assigneeIds.has(requestingUserId)
          ? this.computeStatus(completedSet.has(requestingUserId), e, now)
          : null,
      };
    });
  }

  async findOne(id: string, userId: string): Promise<EventDetailDto> {
    // read_all or write may view any event detail.
    await this.assertAction(userId, 'read_all');
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        createdBy: { select: { name: true } },
        attachments: { orderBy: { createdAt: 'asc' } },
        userAssignees: { select: { userId: true } },
        roleAssignees: { include: { role: { select: { name: true, displayName: true } } } },
        completions: {
          select: {
            userId: true,
            completedAt: true,
            notes: true,
            attachments: {
              select: { id: true, fileName: true, fileUrl: true, fileSize: true, createdAt: true },
            },
          },
        },
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    const memberMap = await this.roleMemberIds(event.roleAssignees.map((r) => r.roleId));
    const directIds = new Set(event.userAssignees.map((a) => a.userId));
    const assigneeIds = this.assigneeIdSet(event, memberMap);

    // Map each assignee → which roles reached them.
    const userRoleNames = new Map<string, string[]>();
    for (const ra of event.roleAssignees) {
      for (const uid of memberMap.get(ra.roleId) ?? []) {
        const names = userRoleNames.get(uid) ?? [];
        names.push(ra.role.displayName);
        userRoleNames.set(uid, names);
      }
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: [...assigneeIds] } },
      select: { id: true, name: true, email: true, avatarUrl: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));
    const completionMap = new Map(event.completions.map((c) => [c.userId, c]));
    const now = new Date();

    const assignees = [...assigneeIds].map((uid) => {
      const completion = completionMap.get(uid);
      const u = userMap.get(uid);
      const roleNames = userRoleNames.get(uid);
      return {
        userId: uid,
        userName: u?.name ?? 'Unknown',
        userEmail: u?.email,
        avatarUrl: u?.avatarUrl,
        status: this.computeStatus(!!completion, event, now),
        viaRole: !directIds.has(uid) && !!roleNames?.length,
        roleNames,
        completedAt: iso(completion?.completedAt),
        notes: completion?.notes ?? null,
        evidence: completion?.attachments?.map((a) => toAttachmentDto(a)) ?? [],
      };
    });

    const stats = this.statsFromStatuses(assignees.map((a) => a.status));

    return {
      id: event.id,
      title: event.title,
      description: event.description,
      startDate: iso(event.startDate),
      dueDate: event.dueDate.toISOString(),
      priority: event.priority,
      status: event.status,
      createdById: event.createdById,
      createdByName: event.createdBy?.name,
      createdAt: event.createdAt.toISOString(),
      stats,
      attachments: event.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        fileUrl: a.fileUrl,
        fileSize: a.fileSize,
        createdAt: a.createdAt.toISOString(),
      })),
      roleAssignees: event.roleAssignees.map((ra) => ({
        roleId: ra.roleId,
        roleName: ra.role.name,
        roleDisplayName: ra.role.displayName,
      })),
      directUserIds: [...directIds],
      assignees,
    };
  }

  /** Event-level analytics = the detail's stats + per-user breakdown. */
  async getAnalytics(id: string, userId: string): Promise<EventDetailDto> {
    return this.findOne(id, userId);
  }

  // ── Meta (assignee pickers + person filter — available to managers) ─────────

  async metaUsers(userId: string): Promise<{ id: string; name: string; email: string }[]> {
    await this.assertAction(userId, 'read_all');
    return this.prisma.user.findMany({
      where: { isSystem: false, approvalStatus: 'APPROVED' },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
  }

  async metaRoles(userId: string): Promise<{ id: string; name: string; displayName: string }[]> {
    await this.assertAction(userId, 'read_all');
    return this.prisma.role.findMany({
      where: { isActive: true },
      select: { id: true, name: true, displayName: true },
      orderBy: { displayName: 'asc' },
    });
  }

  async getUserAnalytics(
    targetUserId: string,
    requesterId: string,
  ): Promise<UserEventAnalyticsDto> {
    await this.assertAction(requesterId, 'read_all');
    return this.computeUserAnalytics(targetUserId);
  }

  // ── Assignee: My Events ─────────────────────────────────────────────────────

  private async myRoleIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.userRoleAssignment.findMany({
      where: { userId, role: { isActive: true } },
      select: { roleId: true },
    });
    return rows.map((r) => r.roleId);
  }

  /** Where-fragment matching events assigned to a user — directly or via a role. */
  private async assignedToUserFragment(userId: string): Promise<Prisma.EventWhereInput> {
    const roleIds = await this.myRoleIds(userId);
    return {
      OR: [
        { userAssignees: { some: { userId } } },
        roleIds.length ? { roleAssignees: { some: { roleId: { in: roleIds } } } } : { id: '' },
      ],
    };
  }

  private myEventsWhere(userId: string, roleIds: string[], q?: string): Prisma.EventWhereInput {
    return {
      AND: [
        {
          OR: [
            { userAssignees: { some: { userId } } },
            roleIds.length ? { roleAssignees: { some: { roleId: { in: roleIds } } } } : { id: '' },
          ],
        },
        q
          ? {
              OR: [
                { title: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
    };
  }

  async listMine(query: MyEventsQueryDto, userId: string): Promise<MyEventsListResponseDto> {
    await this.assertAction(userId, 'read');
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const filter: MyEventsFilter = query.filter ?? 'all';
    const roleIds = await this.myRoleIds(userId);

    const events = await this.prisma.event.findMany({
      where: this.myEventsWhere(userId, roleIds, query.q),
      orderBy: [{ dueDate: 'asc' }],
      include: {
        createdBy: { select: { name: true } },
        completions: { where: { userId }, select: { completedAt: true, notes: true } },
        attachments: { orderBy: { createdAt: 'asc' } },
      },
    });

    const now = new Date();
    let items: MyEventItemDto[] = events.map((e) => {
      const completion = e.completions[0];
      const myStatus = this.computeStatus(!!completion, e, now);
      return {
        id: e.id,
        title: e.title,
        description: e.description,
        startDate: iso(e.startDate),
        dueDate: e.dueDate.toISOString(),
        priority: e.priority,
        status: e.status,
        myStatus,
        completedAt: iso(completion?.completedAt),
        notes: completion?.notes ?? null,
        createdByName: e.createdBy?.name,
        attachments: e.attachments.map(toAttachmentDto),
      };
    });

    items = items.filter((i) => this.matchesFilter(i, filter, now));

    const total = items.length;
    const paged = items.slice((page - 1) * limit, (page - 1) * limit + limit);
    return { data: paged, total, page, limit };
  }

  private matchesFilter(item: MyEventItemDto, filter: MyEventsFilter, now: Date): boolean {
    switch (filter) {
      case 'completed':
        return item.myStatus === 'completed';
      case 'overdue':
        return item.myStatus === 'overdue';
      case 'pending':
        return item.myStatus === 'pending';
      case 'upcoming':
        return item.myStatus !== 'completed' && new Date(item.dueDate).getTime() >= now.getTime();
      default:
        return true;
    }
  }

  async findOneMine(id: string, userId: string): Promise<MyEventDetailDto> {
    await this.assertAction(userId, 'read');
    await this.assertAssignee(id, userId);

    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        createdBy: { select: { name: true } },
        attachments: { orderBy: { createdAt: 'asc' } },
        completions: {
          where: { userId },
          include: { attachments: { orderBy: { createdAt: 'asc' } } },
        },
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    const completion = event.completions[0];
    const now = new Date();
    const toAtt = (a: {
      id: string;
      fileName: string;
      fileUrl: string;
      fileSize: number | null;
      createdAt: Date;
    }): EventAttachmentDto => ({
      id: a.id,
      fileName: a.fileName,
      fileUrl: a.fileUrl,
      fileSize: a.fileSize,
      createdAt: a.createdAt.toISOString(),
    });

    return {
      id: event.id,
      title: event.title,
      description: event.description,
      startDate: iso(event.startDate),
      dueDate: event.dueDate.toISOString(),
      priority: event.priority,
      status: event.status,
      myStatus: this.computeStatus(!!completion, event, now),
      completedAt: iso(completion?.completedAt),
      notes: completion?.notes ?? null,
      createdByName: event.createdBy?.name,
      attachments: event.attachments.map(toAtt),
      myEvidence: completion?.attachments.map(toAtt) ?? [],
    };
  }

  async complete(id: string, dto: CompleteEventDto, userId: string): Promise<MyEventDetailDto> {
    await this.assertAction(userId, 'read');
    await this.assertAssignee(id, userId);

    // Completion is final: once submitted, an assignee can't edit notes/evidence
    // or re-submit. Reject any attempt to complete an event already completed.
    const prior = await this.prisma.eventCompletion.findUnique({
      where: { eventId_userId: { eventId: id, userId } },
      select: { id: true },
    });
    if (prior) {
      throw new ForbiddenException(
        'You have already marked this event complete. Completions are final and cannot be changed.',
      );
    }

    const completion = await this.prisma.eventCompletion.create({
      data: { eventId: id, userId, notes: dto.notes?.trim() || null },
    });

    if (dto.attachments?.length) {
      await this.prisma.eventCompletionAttachment.createMany({
        data: dto.attachments.map((a) => ({
          completionId: completion.id,
          fileName: a.fileName,
          fileUrl: a.fileUrl,
          fileSize: a.fileSize ?? null,
        })),
      });
    }

    await this.auditLogService.log(userId, 'EVENT_COMPLETED', 'event_completion', id, {
      completionId: completion.id,
      hasNotes: !!dto.notes,
      evidenceCount: dto.attachments?.length ?? 0,
    });

    return this.findOneMine(id, userId);
  }

  async myAnalytics(userId: string): Promise<UserEventAnalyticsDto> {
    await this.assertAction(userId, 'read');
    return this.computeUserAnalytics(userId);
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private assigneeIdSet(
    event: { userAssignees: { userId: string }[]; roleAssignees: { roleId: string }[] },
    memberMap: Map<string, string[]>,
  ): Set<string> {
    const ids = new Set(event.userAssignees.map((a) => a.userId));
    for (const ra of event.roleAssignees) {
      for (const uid of memberMap.get(ra.roleId) ?? []) ids.add(uid);
    }
    return ids;
  }

  /** Throws ForbiddenException if the user is not a current assignee of the event. */
  private async assertAssignee(eventId: string, userId: string): Promise<void> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        userAssignees: { where: { userId }, select: { userId: true } },
        roleAssignees: { select: { roleId: true } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.userAssignees.length > 0) return;

    if (event.roleAssignees.length > 0) {
      const match = await this.prisma.userRoleAssignment.findFirst({
        where: {
          userId,
          role: { isActive: true },
          roleId: { in: event.roleAssignees.map((r) => r.roleId) },
        },
        select: { id: true },
      });
      if (match) return;
    }
    throw new ForbiddenException('This event is not assigned to you.');
  }

  private async computeUserAnalytics(userId: string): Promise<UserEventAnalyticsDto> {
    const roleIds = await this.myRoleIds(userId);
    const events = await this.prisma.event.findMany({
      where: this.myEventsWhere(userId, roleIds),
      include: { completions: { where: { userId }, select: { id: true } } },
    });
    const now = new Date();
    const statuses = events.map((e) => this.computeStatus(e.completions.length > 0, e, now));
    const assigned = statuses.length;
    const completed = statuses.filter((s) => s === 'completed').length;
    const overdue = statuses.filter((s) => s === 'overdue').length;
    const pending = statuses.filter((s) => s === 'pending').length;
    return {
      assigned,
      completed,
      pending,
      overdue,
      completionRate: assigned === 0 ? 0 : Math.round((completed / assigned) * 100),
    };
  }

  private async getEventOrThrow(id: string): Promise<{ id: string }> {
    const event = await this.prisma.event.findUnique({ where: { id }, select: { id: true } });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  private async validateAssignees(userIds?: string[], roleIds?: string[]): Promise<void> {
    if (userIds?.length) {
      const count = await this.prisma.user.count({ where: { id: { in: userIds } } });
      if (count !== new Set(userIds).size) {
        throw new NotFoundException('One or more assigned users do not exist.');
      }
    }
    if (roleIds?.length) {
      const count = await this.prisma.role.count({ where: { id: { in: roleIds } } });
      if (count !== new Set(roleIds).size) {
        throw new NotFoundException('One or more assigned roles do not exist.');
      }
    }
  }
}
