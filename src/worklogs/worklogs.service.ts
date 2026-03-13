import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma';
import { AclService } from '../rbac/rbac.service';
import { WorklogAiService } from './worklog-ai.service';
import { WorklogComplianceService } from './worklog-compliance.service';
import { GoogleChatService } from './google-chat.service';
import {
  CreateWorklogDto,
  UpdateWorklogDto,
  WorklogResponseDto,
  ProjectComplianceResponseDto,
  ExportWorklogResponseDto,
  ComplianceSummaryDto,
} from './dto';

const WORKLOG_VIEW_TEAM_ENTITY = 'worklog-team';

// ─── Prisma select shape ───────────────────────────────────────────────────────

const WORKLOG_SELECT = {
  id: true,
  userId: true,
  projectId: true,
  date: true,
  content: true,
  isLeave: true,
  aiScore: true,
  aiFeedback: true,
  status: true,
  manDay: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, name: true, email: true, avatarUrl: true } },
  project: { select: { id: true, name: true, clientName: true } },
} as const;

type WorklogRow = {
  id: string;
  userId: string;
  projectId: string;
  date: Date;
  content: string;
  isLeave: boolean;
  aiScore: number | null;
  aiFeedback: string | null;
  status: string;
  manDay: number;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; name: string; email: string; avatarUrl: string | null };
  project: { id: string; name: string; clientName: string };
};

@Injectable()
export class WorklogsService {
  private readonly logger = new Logger(WorklogsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aclService: AclService,
    private readonly aiService: WorklogAiService,
    private readonly complianceService: WorklogComplianceService,
    private readonly googleChatService: GoogleChatService,
  ) {}

  // ─── Create ──────────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateWorklogDto): Promise<WorklogResponseDto> {
    // Normalise to UTC midnight date
    const date = this.parseAndValidateDate(dto.date);

    // Verify user is assigned to this project
    const membership = await this.prisma.userProject.findUnique({
      where: { userId_projectId: { userId, projectId: dto.projectId } },
    });
    if (!membership) {
      throw new ForbiddenException('You are not assigned to this project.');
    }

    // Guard duplicate submission (one log per user per calendar day per project)
    const existing = await this.prisma.worklog.findUnique({
      where: {
        userId_date_projectId: { userId, date, projectId: dto.projectId },
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'You have already submitted a worklog for this date and project.',
      );
    }

    const isLeave = dto.isLeave === true;
    let content = '';
    let aiScore: number | null = null;
    let aiFeedback: string | null = null;
    let status: 'VALID' | 'NEEDS_REVIEW' = 'VALID';

    if (!isLeave) {
      content = dto.content;
      const evaluation = this.aiService.evaluate(dto.content);
      aiScore = evaluation.score;
      aiFeedback = evaluation.feedback;
      status = evaluation.verdict === 'Valid' ? 'VALID' : 'NEEDS_REVIEW';
      this.logger.log(
        `Worklog AI eval for user ${userId}: score=${aiScore} verdict=${evaluation.verdict}`,
      );
    } else {
      this.logger.log(`Leave entry submitted for user ${userId} on ${dto.date}`);
    }

    const worklog = await this.prisma.worklog.create({
      data: {
        userId,
        projectId: dto.projectId,
        date,
        content,
        isLeave,
        aiScore,
        aiFeedback,
        status,
        manDay: isLeave ? 0 : 1,
      },
      select: WORKLOG_SELECT,
    });

    const formatted = this.formatWorklog(worklog as unknown as WorklogRow);
    this.notifyGoogleChat(worklog as unknown as WorklogRow, true);
    return formatted;
  }

  // ─── Update ──────────────────────────────────────────────────────────────────

  async update(id: string, userId: string, dto: UpdateWorklogDto): Promise<WorklogResponseDto> {
    const raw = await this.prisma.worklog.findUnique({
      where: { id },
      select: WORKLOG_SELECT,
    });
    if (!raw) throw new NotFoundException(`Worklog ${id} not found`);
    const existing = raw as unknown as WorklogRow;
    if (existing.userId !== userId)
      throw new ForbiddenException('You can only edit your own worklogs.');

    const isLeave = dto.isLeave ?? existing.isLeave;
    const targetProjectId = dto.projectId ?? existing.projectId;

    // If changing project, verify membership and no duplicate
    if (dto.projectId && dto.projectId !== existing.projectId) {
      const membership = await this.prisma.userProject.findFirst({
        where: { userId, projectId: dto.projectId },
        select: { projectId: true },
      });
      if (!membership) throw new ForbiddenException('You are not assigned to this project.');

      const conflict = await this.prisma.worklog.findFirst({
        where: { userId, date: existing.date, projectId: dto.projectId },
        select: { id: true },
      });
      if (conflict)
        throw new ConflictException('A worklog for this project already exists on this date.');
    }

    let content = '';
    let aiScore: number | null = null;
    let aiFeedback: string | null = null;
    let status: 'VALID' | 'NEEDS_REVIEW' = 'VALID';

    if (!isLeave) {
      content = dto.content ?? existing.content;
      const plainLen = content
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim().length;
      if (!content || plainLen < 20) {
        throw new BadRequestException('Work content must be at least 20 characters.');
      }
      const evaluation = this.aiService.evaluate(content);
      aiScore = evaluation.score;
      aiFeedback = evaluation.feedback;
      status = evaluation.verdict === 'Valid' ? 'VALID' : 'NEEDS_REVIEW';
    }

    const updateData: Record<string, unknown> = {
      projectId: targetProjectId,
      isLeave,
      content,
      aiScore,
      aiFeedback,
      status,
      manDay: isLeave ? 0 : 1,
    };

    const updated = await this.prisma.worklog.update({
      where: { id },
      data: updateData as Parameters<typeof this.prisma.worklog.update>[0]['data'],
      select: WORKLOG_SELECT,
    });

    this.logger.log(`Worklog ${id} updated by user ${userId}`);
    const formatted = this.formatWorklog(updated as unknown as WorklogRow);
    this.notifyGoogleChat(updated as unknown as WorklogRow, false);
    return formatted;
  }

  // ─── Google Chat notification (fire-and-forget) ───────────────────────────────

  private notifyGoogleChat(worklog: WorklogRow, isCreate: boolean): void {
    Promise.all([
      this.prisma.project.findUnique({
        where: { id: worklog.projectId },
        select: { channelUrl: true },
      }),
      // On create: check if this is the first entry of the day across ALL projects.
      // On update: never show the date header again.
      isCreate
        ? this.prisma.worklog.count({
            where: {
              date: worklog.date,
              id: { not: worklog.id }, // exclude the just-saved entry
            },
          })
        : Promise.resolve(1),
    ])
      .then(([project, count]) => {
        if (!project?.channelUrl) return;
        return this.googleChatService.sendWorklogNotification(project.channelUrl, {
          userName: worklog.user.name,
          userEmail: worklog.user.email,
          projectId: worklog.projectId,
          projectName: worklog.project.name,
          date: worklog.date,
          content: worklog.content,
          isLeave: worklog.isLeave,
          aiScore: worklog.aiScore,
          status: worklog.status,
          isFirstOfDay: count === 0, // no other entries exist → first of the day
        });
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `Google Chat notification failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  // ─── Delete ──────────────────────────────────────────────────────────────────

  async delete(id: string, userId: string): Promise<void> {
    const worklog = await this.prisma.worklog.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!worklog) throw new NotFoundException(`Worklog ${id} not found`);
    if (worklog.userId !== userId)
      throw new ForbiddenException('You can only delete your own worklogs.');
    await this.prisma.worklog.delete({ where: { id } });
    this.logger.log(`Worklog ${id} deleted by user ${userId}`);
  }

  // ─── My Logs ─────────────────────────────────────────────────────────────────

  async findMyLogs(userId: string, month: string): Promise<WorklogResponseDto[]> {
    if (month == null || typeof month !== 'string' || !month.trim()) {
      throw new BadRequestException(
        'Query parameter month is required and must be in YYYY-MM format (e.g. 2026-03).',
      );
    }
    const { startDate, endDate } = this.complianceService.getMonthRange(month);

    const logs = await this.prisma.worklog.findMany({
      where: { userId, date: { gte: startDate, lt: endDate } },
      select: WORKLOG_SELECT,
      orderBy: { date: 'asc' },
    });

    return logs.map((l) => this.formatWorklog(l));
  }

  // ─── Single Log ───────────────────────────────────────────────────────────────

  async findById(id: string, requesterId: string): Promise<WorklogResponseDto> {
    const worklog = await this.prisma.worklog.findUnique({
      where: { id },
      select: { ...WORKLOG_SELECT, userId: true, projectId: true },
    });

    if (!worklog) throw new NotFoundException(`Worklog ${id} not found`);

    // Owner can always view their own log
    if (worklog.userId === requesterId) return this.formatWorklog(worklog);

    // Non-owners must be a manager/QA/admin sharing this project
    await this.assertManagerAccess(worklog.projectId, requesterId);

    return this.formatWorklog(worklog);
  }

  // ─── My Compliance ────────────────────────────────────────────────────────────

  async getMyCompliance(userId: string, month: string): Promise<ComplianceSummaryDto> {
    const { year, month: monthNum } = this.complianceService.parseMonth(month);
    const { startDate, endDate } = this.complianceService.getMonthRange(month);

    const logs = await this.prisma.worklog.findMany({
      where: { userId, date: { gte: startDate, lt: endDate } },
      select: { date: true },
    });

    return this.complianceService.buildCompliance(
      logs.map((l) => l.date),
      year,
      monthNum,
    );
  }

  // ─── Project Logs (Manager/QA/Admin) ──────────────────────────────────────────

  async findProjectLogs(
    projectId: string,
    month: string,
    requesterId: string,
    userId?: string,
  ): Promise<WorklogResponseDto[]> {
    await this.assertManagerAccess(projectId, requesterId);

    const { startDate, endDate } = this.complianceService.getMonthRange(month);

    const logs = await this.prisma.worklog.findMany({
      where: {
        projectId,
        date: { gte: startDate, lt: endDate },
        ...(userId ? { userId } : {}),
      },
      select: WORKLOG_SELECT,
      orderBy: [{ date: 'asc' }, { userId: 'asc' }],
    });

    return logs.map((l) => this.formatWorklog(l));
  }

  async findUserWorklogsForProjects(
    requesterId: string,
    userId: string,
    month: string,
    projectIds?: string[],
  ): Promise<WorklogResponseDto[]> {
    let ids = projectIds?.length ? projectIds : undefined;
    if (!ids?.length) {
      const assigned = await this.prisma.userProject.findMany({
        where: { userId: requesterId },
        select: { projectId: true },
      });
      ids = assigned.map((a) => a.projectId);
    }
    const all: WorklogResponseDto[] = [];
    for (const projectId of ids) {
      const logs = await this.findProjectLogs(projectId, month, requesterId, userId);
      all.push(...logs);
    }
    all.sort((a, b) => a.date.localeCompare(b.date));
    return all;
  }

  // ─── Project Compliance (Manager/QA/Admin) ────────────────────────────────────

  async getProjectCompliance(
    projectId: string,
    month: string,
    requesterId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<ProjectComplianceResponseDto> {
    await this.assertManagerAccess(projectId, requesterId);

    const { year, month: monthNum } = this.complianceService.parseMonth(month);
    const { startDate, endDate } = this.complianceService.getMonthRange(month);

    // All users in project
    const projectUsers = await this.prisma.userProject.findMany({
      where: { projectId },
      select: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    });

    // All worklogs for project in month
    const logs = await this.prisma.worklog.findMany({
      where: { projectId, date: { gte: startDate, lt: endDate } },
      select: { userId: true, date: true },
    });

    // Group by userId
    const logsByUser = new Map<string, Date[]>();
    for (const log of logs) {
      if (!logsByUser.has(log.userId)) logsByUser.set(log.userId, []);
      logsByUser.get(log.userId)!.push(log.date);
    }

    const allUsers = projectUsers.map(({ user }) => {
      const userLogs = logsByUser.get(user.id) ?? [];
      const compliance = this.complianceService.buildCompliance(userLogs, year, monthNum);
      return {
        userId: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl ?? null,
        ...compliance,
      };
    });

    // Sort by compliance ascending (worst first) so managers see who needs attention
    allUsers.sort((a, b) => a.compliancePct - b.compliancePct);

    const total = allUsers.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const users = allUsers.slice((page - 1) * limit, page * limit);

    return { month, projectId, users, total, page, limit, totalPages };
  }

  async getProjectsCompliance(
    requesterId: string,
    month: string,
    projectIds?: string[],
  ): Promise<ProjectComplianceResponseDto[]> {
    let ids = projectIds?.length ? projectIds : undefined;
    if (!ids?.length) {
      const assigned = await this.prisma.userProject.findMany({
        where: { userId: requesterId },
        select: { projectId: true },
      });
      ids = assigned.map((a) => a.projectId);
    }
    const results: ProjectComplianceResponseDto[] = [];
    for (const projectId of ids) {
      const compliance = await this.getProjectCompliance(projectId, month, requesterId);
      results.push(compliance);
    }
    return results;
  }

  // ─── CSV Export ───────────────────────────────────────────────────────────────

  async exportCsv(
    requesterId: string,
    params: {
      month: string;
      userId?: string;
      projectId?: string;
      projectScope?: 'present' | 'old';
    },
  ): Promise<ExportWorklogResponseDto> {
    const projectScope = params.projectScope ?? 'present';
    if (projectScope === 'old') {
      return this.exportCsvOldProjects(requesterId, params.month);
    }
    const targetUserId = params.userId ?? requesterId;
    if (targetUserId !== requesterId) {
      await this.assertExportAccess(targetUserId, requesterId);
    }
    return this.exportCsvOwn(targetUserId, params.month, params.projectId);
  }

  private async exportCsvOwn(
    targetUserId: string,
    month: string,
    projectId?: string,
  ): Promise<ExportWorklogResponseDto> {
    const { year, month: monthNum } = this.complianceService.parseMonth(month);
    const { startDate, endDate } = this.complianceService.getMonthRange(month);
    const weekdays = this.complianceService.getWeekdaysInMonth(year, monthNum);

    const logs = await this.prisma.worklog.findMany({
      where: {
        userId: targetUserId,
        date: { gte: startDate, lt: endDate },
        ...(projectId ? { projectId } : {}),
      },
      select: {
        date: true,
        content: true,
        manDay: true,
        aiScore: true,
        aiFeedback: true,
        isLeave: true,
      },
      orderBy: { date: 'asc' },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { name: true },
    });

    type LogRow = {
      date: Date;
      content: string;
      manDay: number;
      aiScore: number | null;
      aiFeedback: string | null;
      isLeave: boolean;
    };
    const logMap = new Map<string, LogRow>(
      logs.map((l) => [this.complianceService.toDateKey(l.date), l]),
    );
    const rows = weekdays.map((day) => {
      const key = this.complianceService.toDateKey(day);
      const log = logMap.get(key);
      const dateStr = key;
      const tasks = log
        ? log.isLeave
          ? 'Leave'
          : this.escapeCsvField(log.content)
        : 'No Submission';
      const manDay = log ? log.manDay : 0;
      const aiScore = log?.aiScore != null ? String(log.aiScore) : '';
      const remarks = log?.aiFeedback ? this.escapeCsvField(log.aiFeedback) : '';
      return `${dateStr},"${tasks}",${manDay},${aiScore},"${remarks}"`;
    });

    const csv = ['Date,Tasks,Man Day,AI Score,Remarks', ...rows].join('\n');
    const safeName = (user?.name ?? 'user').toLowerCase().replace(/\s+/g, '-');
    const filename = `worklog-${safeName}-${month}.csv`;
    return { csv, filename };
  }

  /** Export worklogs for projects the user is no longer assigned to (old/past projects). */
  private async exportCsvOldProjects(
    requesterId: string,
    month: string,
  ): Promise<ExportWorklogResponseDto> {
    const assigned = await this.prisma.userProject.findMany({
      where: { userId: requesterId },
      select: { projectId: true },
    });
    const assignedProjectIds = assigned.map((a) => a.projectId);

    const { startDate, endDate } = this.complianceService.getMonthRange(month);
    const logs = await this.prisma.worklog.findMany({
      where: {
        userId: requesterId,
        date: { gte: startDate, lt: endDate },
        ...(assignedProjectIds.length > 0 ? { projectId: { notIn: assignedProjectIds } } : {}),
      },
      select: {
        date: true,
        content: true,
        manDay: true,
        aiScore: true,
        aiFeedback: true,
        isLeave: true,
        project: { select: { name: true } },
      },
      orderBy: [{ date: 'asc' }, { projectId: 'asc' }],
    });

    const header = 'Date,Project,Tasks,Man Day,AI Score,Remarks';
    const rows = logs.map((l) => {
      const dateStr = this.complianceService.toDateKey(l.date);
      const projectName = this.escapeCsvField(l.project.name);
      const tasks = l.isLeave ? 'Leave' : this.escapeCsvField(l.content);
      const aiScore = l.aiScore != null ? String(l.aiScore) : '';
      const remarks = l.aiFeedback ? this.escapeCsvField(l.aiFeedback) : '';
      return `${dateStr},"${projectName}","${tasks}",${l.manDay},${aiScore},"${remarks}"`;
    });
    const csv = [header, ...rows].join('\n');
    const filename = `worklog-old-projects-${month}.csv`;
    return { csv, filename };
  }

  // ─── My Projects ─────────────────────────────────────────────────────────────

  async getMyProjects(userId: string): Promise<
    {
      id: string;
      assignedAt: Date;
      assignedBy: string | null;
      project: { id: string; name: string; clientName: string };
    }[]
  > {
    const assignments = await this.prisma.userProject.findMany({
      where: { userId },
      select: {
        id: true,
        assignedAt: true,
        assignedBy: true,
        project: { select: { id: true, name: true, clientName: true } },
      },
      orderBy: { assignedAt: 'desc' },
    });
    return assignments;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private parseAndValidateDate(dateStr: string): Date {
    const date = new Date(`${dateStr}T00:00:00.000Z`);
    if (isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date format. Use YYYY-MM-DD.');
    }

    // Compare using local server date string to avoid UTC offset issues for UTC+ timezones
    const now = new Date();
    const localTodayStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    if (dateStr > localTodayStr) {
      throw new BadRequestException('Cannot submit a worklog for a future date.');
    }

    return date;
  }

  private async assertManagerAccess(projectId: string, requesterId: string): Promise<void> {
    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: {
        isSystem: true,
        userRoleAssignments: { select: { role: { select: { name: true } } } },
        userProjects: { select: { projectId: true } },
      },
    });

    if (!requester) throw new NotFoundException('Requester not found');

    const roleNames = requester.userRoleAssignments.map((a) => a.role.name);
    const isSystemAdmin = requester.isSystem === true;
    const isAdmin = isSystemAdmin || roleNames.includes('ADMIN');
    const hasTeamAccess =
      isAdmin || (await this.aclService.userHasEntityAccess(requesterId, WORKLOG_VIEW_TEAM_ENTITY));

    if (!hasTeamAccess) {
      throw new ForbiddenException('Access denied. Requires worklog-team entity or ADMIN role.');
    }

    // Non-admin users must be in the project
    if (!isAdmin) {
      const inProject = requester.userProjects.some((p) => p.projectId === projectId);
      if (!inProject) {
        throw new ForbiddenException('You are not assigned to this project.');
      }
    }
  }

  private async assertExportAccess(targetUserId: string, requesterId: string): Promise<void> {
    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: {
        isSystem: true,
        userRoleAssignments: { select: { role: { select: { name: true } } } },
        userProjects: { select: { projectId: true } },
      },
    });

    if (!requester) throw new NotFoundException('Requester not found');

    const roleNames = requester.userRoleAssignments.map((a) => a.role.name);
    const isAdmin = requester.isSystem || roleNames.includes('ADMIN');
    const hasTeamAccess =
      isAdmin || (await this.aclService.userHasEntityAccess(requesterId, WORKLOG_VIEW_TEAM_ENTITY));

    if (!hasTeamAccess) {
      throw new ForbiddenException(
        "Access denied. Cannot export another user's data. Requires worklog-team entity or ADMIN role.",
      );
    }

    if (!isAdmin) {
      // Must share at least one project with the target user
      const requesterProjects = requester.userProjects.map((p) => p.projectId);
      const sharedProject = await this.prisma.userProject.findFirst({
        where: { userId: targetUserId, projectId: { in: requesterProjects } },
        select: { id: true },
      });
      if (!sharedProject) {
        throw new ForbiddenException('Target user is not in any of your projects.');
      }
    }
  }

  private formatWorklog(worklog: WorklogRow): WorklogResponseDto {
    return {
      ...worklog,
      date: this.complianceService.toDateKey(worklog.date),
    } as unknown as WorklogResponseDto;
  }

  private escapeCsvField(value: string): string {
    // Escape double-quotes and remove newlines for CSV safety
    return value.replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
  }
}
