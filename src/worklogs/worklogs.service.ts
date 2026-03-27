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
import { parse as parseCsv } from 'csv-parse/sync';
import {
  CreateWorklogDto,
  UpdateWorklogDto,
  WorklogResponseDto,
  ProjectComplianceResponseDto,
  ExportWorklogResponseDto,
  ComplianceSummaryDto,
  ProjectWorklogExportResponseDto,
  BulkCreateWorklogDto,
  BulkWorklogResultDto,
  BulkWorklogRowResultDto,
  WorklogCsvImportResultDto,
  WorklogCsvRowResultDto,
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
    // Auto-resolve any missed-log reminder for this user+project+date
    void this.prisma.worklogMissedReminder
      .updateMany({
        where: { userId, projectId: dto.projectId, date, resolved: false },
        data: { resolved: true },
      })
      .catch(() => undefined);
    return formatted;
  }

  // ─── Bulk Create ─────────────────────────────────────────────────────────────

  async bulkCreate(userId: string, dto: BulkCreateWorklogDto): Promise<BulkWorklogResultDto> {
    const results: BulkWorklogRowResultDto[] = [];
    let succeeded = 0;
    let failed = 0;

    // Track (date|projectId) pairs within this batch to catch intra-batch duplicates
    const seenKeys = new Set<string>();

    for (let i = 0; i < dto.entries.length; i++) {
      const entry = dto.entries[i];
      const row = i + 1;

      try {
        // Validate date
        const date = this.parseAndValidateDate(entry.date);

        // Check intra-batch duplicate
        const batchKey = `${entry.date}|${entry.projectId}`;
        if (seenKeys.has(batchKey)) {
          throw new Error(
            `Duplicate entry: another row in this batch already has the same date and project.`,
          );
        }
        seenKeys.add(batchKey);

        // Verify user is assigned to this project
        const membership = await this.prisma.userProject.findUnique({
          where: { userId_projectId: { userId, projectId: entry.projectId } },
        });
        if (!membership) {
          throw new Error('You are not assigned to this project.');
        }

        // Guard duplicate in database
        const existing = await this.prisma.worklog.findUnique({
          where: { userId_date_projectId: { userId, date, projectId: entry.projectId } },
          select: { id: true },
        });
        if (existing) {
          throw new Error('You have already submitted a worklog for this date and project.');
        }

        const isLeave = entry.isLeave === true;
        let content = '';
        let aiScore: number | null = null;
        let aiFeedback: string | null = null;
        let status: 'VALID' | 'NEEDS_REVIEW' = 'VALID';

        if (!isLeave) {
          content = entry.content;
          const evaluation = this.aiService.evaluate(entry.content);
          aiScore = evaluation.score;
          aiFeedback = evaluation.feedback;
          status = evaluation.verdict === 'Valid' ? 'VALID' : 'NEEDS_REVIEW';
        }

        await this.prisma.worklog.create({
          data: {
            userId,
            projectId: entry.projectId,
            date,
            content,
            isLeave,
            aiScore,
            aiFeedback,
            status,
            manDay: isLeave ? 0 : 1,
          },
        });

        results.push({ row, projectId: entry.projectId, date: entry.date, success: true });
        succeeded++;
        // Auto-resolve any missed-log reminder for this user+project+date
        void this.prisma.worklogMissedReminder
          .updateMany({
            where: { userId, projectId: entry.projectId, date, resolved: false },
            data: { resolved: true },
          })
          .catch(() => undefined);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unexpected error occurred.';
        results.push({
          row,
          projectId: entry.projectId,
          date: entry.date,
          success: false,
          errors: [message],
        });
        failed++;
      }
    }

    return { total: dto.entries.length, succeeded, failed, results };
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
          isEdit: !isCreate,
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
      select: {
        id: true,
        userId: true,
        date: true,
        content: true,
        isLeave: true,
        user: { select: { name: true, email: true } },
        project: { select: { name: true, channelUrl: true } },
      },
    });
    if (!worklog) throw new NotFoundException(`Worklog ${id} not found`);
    if (worklog.userId !== userId)
      throw new ForbiddenException('You can only delete your own worklogs.');
    await this.prisma.worklog.delete({ where: { id } });
    this.logger.log(`Worklog ${id} deleted by user ${userId}`);
    this.notifyGoogleChatDeleted(worklog);
  }

  private notifyGoogleChatDeleted(worklog: {
    date: Date;
    content: string | null;
    isLeave: boolean;
    user: { name: string; email: string };
    project: { name: string; channelUrl: string | null };
  }): void {
    if (!worklog.project.channelUrl) return;
    const contentSnippet = worklog.content
      ? worklog.content
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .trim()
          .slice(0, 200)
      : '';
    this.googleChatService
      .sendWorklogDeletedNotification(worklog.project.channelUrl, {
        userName: worklog.user.name,
        userEmail: worklog.user.email,
        projectName: worklog.project.name,
        date: worklog.date,
        contentSnippet,
        isLeave: worklog.isLeave,
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `Google Chat delete notification failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
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
      select: { userId: true, date: true, isLeave: true },
    });

    // Group by userId
    const logsByUser = new Map<string, { date: Date; isLeave: boolean }[]>();
    for (const log of logs) {
      if (!logsByUser.has(log.userId)) logsByUser.set(log.userId, []);
      logsByUser.get(log.userId)!.push({ date: log.date, isLeave: log.isLeave });
    }

    // Compute working day keys (Mon–Fri, including today) for leave validation
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const workingDayKeys = new Set(
      this.complianceService
        .getWeekdaysInMonth(year, monthNum, tomorrow)
        .map((d) => this.complianceService.toDateKey(d)),
    );

    const allUsers = projectUsers.map(({ user }) => {
      const userLogs = logsByUser.get(user.id) ?? [];

      // Separate actual work logs from leave entries
      const workDates = userLogs.filter((l) => !l.isLeave).map((l) => l.date);
      const leaveLogDates = userLogs.filter((l) => l.isLeave).map((l) => l.date);

      // submittedDays = working days with actual work entries (leaves excluded)
      const { totalWorkingDays, submittedDays } = this.complianceService.buildCompliance(
        workDates,
        year,
        monthNum,
      );

      // Count only leave entries that fall on Mon–Fri working days (including today)
      const leaveDays = leaveLogDates.filter((d) =>
        workingDayKeys.has(this.complianceService.toDateKey(d)),
      ).length;

      // Count Saturday/Sunday work submissions (non-leave, bonus days)
      const saturdayDays = workDates.filter((d) => d.getUTCDay() === 6).length;
      const sundayDays = workDates.filter((d) => d.getUTCDay() === 0).length;

      // Missed = all working days (including today) with no log of any kind
      const missedDays = Math.max(0, totalWorkingDays - submittedDays - leaveDays);

      // Compliance = (work + leave) / total — leaves count as compliant
      const compliancePct =
        totalWorkingDays > 0
          ? Math.round(((submittedDays + leaveDays) / totalWorkingDays) * 100)
          : 100;

      return {
        userId: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl ?? null,
        totalWorkingDays,
        submittedDays,
        missedDays,
        leaveDays,
        saturdayDays,
        sundayDays,
        compliancePct,
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

  // ─── Project Worklog Export (Manager/Admin) ───────────────────────────────────

  async exportProjectWorklogs(
    projectId: string,
    month: string,
    requesterId: string,
  ): Promise<ProjectWorklogExportResponseDto> {
    await this.assertManagerAccess(projectId, requesterId);

    const { startDate, endDate } = this.complianceService.getMonthRange(month);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, clientName: true },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const projectUsers = await this.prisma.userProject.findMany({
      where: { projectId },
      select: { user: { select: { id: true, name: true, designation: true } } },
      orderBy: { user: { name: 'asc' } },
    });

    const allLogs = await this.prisma.worklog.findMany({
      where: { projectId, date: { gte: startDate, lt: endDate } },
      select: {
        userId: true,
        date: true,
        content: true,
        manDay: true,
        isLeave: true,
      },
      orderBy: [{ userId: 'asc' }, { date: 'asc' }],
    });

    const logsByUser = new Map<string, typeof allLogs>();
    for (const log of allLogs) {
      if (!logsByUser.has(log.userId)) logsByUser.set(log.userId, []);
      logsByUser.get(log.userId)!.push(log);
    }

    const users = projectUsers.map(({ user }) => {
      const logs = logsByUser.get(user.id) ?? [];
      const totalManDays = logs.reduce((sum, l) => sum + l.manDay, 0);
      const totalLeaves = logs.filter((l) => l.isLeave).length;
      return {
        userId: user.id,
        name: user.name,
        designation: user.designation ?? null,
        totalManDays,
        totalLeaves,
        entries: logs.map((l) => ({
          date: this.complianceService.toDateKey(l.date),
          content: l.content,
          manDay: l.manDay,
          isLeave: l.isLeave,
        })),
      };
    });

    this.logger.log(
      `Project worklog export: projectId=${projectId} month=${month} users=${users.length}`,
    );
    return { projectName: project.name, clientName: project.clientName, month, users };
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

  // ─── CSV Import ──────────────────────────────────────────────────────────────

  getCsvTemplate(): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth(); // 0-indexed
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const mm = String(month + 1).padStart(2, '0');

    // Cycling sample tasks for workdays
    const sampleTasks = [
      'Reviewed project requirements document, set up local development environment, attended kick-off meeting with stakeholders.',
      'Implemented UI components using React and Tailwind CSS, integrated form validation and connected to authentication API.',
      'Developed user registration module with email verification flow, wrote unit tests covering all validation edge cases.',
      'Fixed critical bug in password reset flow causing token expiry mismatch, reproduced issue and deployed fix to staging.',
      'Reviewed 4 pull requests from team members, provided detailed feedback on API design patterns and error handling.',
      'Built dashboard analytics charts, connected components to live data endpoints and added skeleton loading states.',
      'Attended sprint retrospective and review, refined product backlog for next sprint, updated technical design docs.',
      'Implemented role-based access control for admin panel, added entity permission guards to all protected API routes.',
      'Optimised slow database queries on report page using indexed lookups, reduced average load time from 4s to 800ms.',
      'Integrated third-party email service, built reusable HTML email templates for transactional notifications.',
      'Conducted manual QA regression testing on new module, documented 6 bugs with detailed reproduction steps.',
      'Resolved all QA bugs, improved mobile responsiveness of request forms across iOS and Android breakpoints.',
      'Migrated user profile endpoints to new service architecture, updated API docs and Postman collection.',
      'Built CSV export feature, handled special characters, multi-line content encoding and large dataset streaming.',
      'Pair programming session on GraphQL schema design for reporting module, prototyped and compared 3 query patterns.',
      'Prepared sprint demo, recorded walkthrough video of new features, compiled release notes for upcoming deployment.',
      'Deployed new release to production, monitored error rates and performance metrics for 2 hours post-launch.',
      'Implemented automated end-to-end tests using Playwright covering full checkout and payment flows.',
      'Refactored authentication middleware to support OAuth 2.0 via Google and GitHub, updated team documentation.',
      'Investigated and resolved intermittent CI failures caused by race conditions in async test teardown.',
      'Sprint planning session, groomed and estimated 12 user stories with the team, updated sprint board and velocity.',
      'Wrote technical design document for the new notifications service, reviewed with architect and incorporated feedback.',
    ];

    const rows = ['Date,Tasks,Man Day'];
    let taskIndex = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const dd = String(day).padStart(2, '0');
      const dateStr = `${year}-${mm}-${dd}`;
      const dayOfWeek = new Date(Date.UTC(year, month, day)).getUTCDay(); // 0=Sun, 6=Sat

      if (dayOfWeek === 0 || dayOfWeek === 6) {
        const dayName = dayOfWeek === 0 ? 'Sunday' : 'Saturday';
        rows.push(`${dateStr},"${dayName}",0`);
      } else {
        const task = sampleTasks[taskIndex % sampleTasks.length];
        taskIndex++;
        rows.push(`${dateStr},"${task}",1`);
      }
    }

    return rows.join('\n');
  }

  async importFromCsv(
    userId: string,
    projectId: string,
    file: Express.Multer.File,
    skipExisting = false,
    expectedMonth?: string,
  ): Promise<WorklogCsvImportResultDto> {
    // 1. Parse file
    const rawRows = this.parseCsvBuffer(file.buffer, file.mimetype, file.originalname);

    if (rawRows.length === 0) {
      throw new BadRequestException('No data found in the uploaded file.');
    }
    if (rawRows.length > 31) {
      throw new BadRequestException('Maximum 31 rows allowed (one month of worklogs).');
    }

    // 2. Validate required columns exist
    const firstRow = rawRows[0];
    const keys = Object.keys(firstRow).map((k) => k.toLowerCase().trim());
    if (!keys.includes('date')) throw new BadRequestException('Missing required column: "Date"');
    if (!keys.includes('tasks')) throw new BadRequestException('Missing required column: "Tasks"');

    // 3. Verify user is assigned to project
    const membership = await this.prisma.userProject.findUnique({
      where: { userId_projectId: { userId, projectId } },
    });
    if (!membership) {
      throw new ForbiddenException('You are not assigned to this project.');
    }

    // 4. Parse and validate every row — track ALL rows in allResults so stats always add up
    type NormalisedRow = {
      rawRow: number;
      dateStr: string;
      date: Date;
      isLeave: boolean;
      content: string;
      manDay: number;
      warnings: string[];
    };

    const normalised: NormalisedRow[] = [];
    const allResults: WorklogCsvRowResultDto[] = [];
    const seenDates = new Set<string>();
    const monthCounts = new Map<string, number>(); // YYYY-MM → row count

    const now = new Date();
    const localTodayStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');

    for (let i = 0; i < rawRows.length; i++) {
      const raw = rawRows[i];
      const rowNum = i + 1;
      const rowErrors: string[] = [];
      const rowWarnings: string[] = [];

      // Normalize keys (case-insensitive)
      const get = (key: string): string =>
        (
          raw[key] ??
          raw[key.toLowerCase()] ??
          raw[Object.keys(raw).find((k) => k.toLowerCase().trim() === key) ?? ''] ??
          ''
        )
          .toString()
          .trim();

      const rawDate = get('date');
      const rawTasks = get('tasks');
      // No default — absence of man day is meaningful (treated as 0 = skip)
      const rawManDay = get('man day') || get('man_day') || get('manday');

      // Skip fully empty rows silently (trailing blank lines)
      if (!rawDate && !rawTasks) continue;

      // Detect leave first — leave rows bypass all Man Day requirements
      const isLeave = rawTasks.toLowerCase().trim() === 'leave';

      // Skip non-leave rows where man day is absent or zero — user didn't work this day.
      if (!isLeave && (!rawManDay || parseFloat(rawManDay) === 0)) {
        allResults.push({ row: rowNum, date: rawDate, success: true, skipped: true });
        continue;
      }

      // Parse date (YYYY-MM-DD or DD/MM/YYYY)
      let dateStr = '';
      const yyyymmdd = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const ddmmyyyy = rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (yyyymmdd) {
        dateStr = rawDate;
      } else if (ddmmyyyy) {
        dateStr = `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
      } else {
        rowErrors.push(`Invalid date format "${rawDate}". Use YYYY-MM-DD or DD/MM/YYYY.`);
      }

      if (dateStr && dateStr > localTodayStr) {
        rowErrors.push(`Date ${dateStr} is in the future.`);
      }

      if (dateStr) {
        const ym = dateStr.slice(0, 7);
        monthCounts.set(ym, (monthCounts.get(ym) ?? 0) + 1);
      }

      // Intra-file duplicate
      if (dateStr && seenDates.has(dateStr)) {
        rowErrors.push(`Duplicate date ${dateStr} within this file.`);
      }
      if (dateStr) seenDates.add(dateStr);

      // Validate man day for non-leave rows only — leave is always 0
      const manDayNum = isLeave ? 0 : parseFloat(rawManDay);
      if (!isLeave && manDayNum !== 1) {
        rowErrors.push(`"Man Day" must be 1 (got "${rawManDay}").`);
      }

      // Validate/truncate content
      let content = isLeave ? '' : rawTasks;
      if (!isLeave) {
        if (content.length > 5000) {
          content = content.slice(0, 5000);
          rowWarnings.push('Work description truncated to 5,000 characters.');
        }
        if (content.length < 20) {
          rowErrors.push(
            `Work description must be at least 20 characters (got ${content.length}).`,
          );
        }
      }

      if (rowErrors.length > 0) {
        allResults.push({
          row: rowNum,
          date: rawDate || dateStr,
          success: false,
          errors: rowErrors,
        });
        continue;
      }

      const date = new Date(`${dateStr}T00:00:00.000Z`);
      normalised.push({
        rawRow: rowNum,
        dateStr,
        date,
        isLeave,
        content,
        manDay: isLeave ? 0 : manDayNum,
        warnings: rowWarnings,
      });
    }

    // 5. Validate months — reject rows outside the expected month
    if (monthCounts.size > 0) {
      // If caller specified an expected month, enforce it strictly
      const targetMonth =
        expectedMonth ??
        // Otherwise pick the dominant month (most rows; ties → earliest)
        [...monthCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];

      if (expectedMonth && monthCounts.size > 0 && !monthCounts.has(expectedMonth)) {
        // Every row is from the wrong month — reject all with a clear message
        const detectedMonths = [...monthCounts.keys()].sort().join(', ');
        throw new BadRequestException(
          `This file contains dates for ${detectedMonths}, but you are importing for ${expectedMonth}. Please upload a file with ${expectedMonth} dates.`,
        );
      }

      const outliers = normalised.filter((r) => r.dateStr.slice(0, 7) !== targetMonth);
      outliers.forEach((r) => {
        allResults.push({
          row: r.rawRow,
          date: r.dateStr,
          success: false,
          errors: [`Date ${r.dateStr} does not belong to the expected month (${targetMonth}).`],
        });
      });
      normalised.splice(
        0,
        normalised.length,
        ...normalised.filter((r) => r.dateStr.slice(0, 7) === targetMonth),
      );
    }

    // 6. Check existing worklogs in DB for valid rows
    if (normalised.length > 0) {
      const dates = normalised.map((r) => r.date);
      const existingLogs = await this.prisma.worklog.findMany({
        where: { userId, projectId, date: { in: dates } },
        select: { id: true, date: true },
      });
      const existingByDate = new Map(
        existingLogs.map((l) => [this.complianceService.toDateKey(l.date), l]),
      );

      // 7. Plan: skip, overwrite, or create
      const toCreate: NormalisedRow[] = [];
      const toUpdate: { id: string; row: NormalisedRow }[] = [];

      for (const row of normalised) {
        const existing = existingByDate.get(row.dateStr);
        if (existing) {
          if (skipExisting) {
            allResults.push({ row: row.rawRow, date: row.dateStr, success: true, skipped: true });
          } else {
            toUpdate.push({ id: existing.id, row });
          }
        } else {
          toCreate.push(row);
        }
      }

      // 8. Execute valid rows in a single $transaction (atomic for DB writes)
      try {
        await this.prisma.$transaction(async (tx) => {
          for (const row of toCreate) {
            const isLeave = row.isLeave;
            let aiScore: number | null = null;
            let aiFeedback: string | null = null;
            let status: 'VALID' | 'NEEDS_REVIEW' = 'VALID';
            if (!isLeave) {
              const evaluation = this.aiService.evaluate(row.content);
              aiScore = evaluation.score;
              aiFeedback = evaluation.feedback;
              status = evaluation.verdict === 'Valid' ? 'VALID' : 'NEEDS_REVIEW';
            }
            await tx.worklog.create({
              data: {
                userId,
                projectId,
                date: row.date,
                content: row.content,
                isLeave,
                aiScore,
                aiFeedback,
                status,
                manDay: row.isLeave ? 0 : row.manDay,
              },
            });
            allResults.push({
              row: row.rawRow,
              date: row.dateStr,
              success: true,
              warnings: row.warnings.length ? row.warnings : undefined,
            });
          }

          for (const { id, row } of toUpdate) {
            const isLeave = row.isLeave;
            let aiScore: number | null = null;
            let aiFeedback: string | null = null;
            let status: 'VALID' | 'NEEDS_REVIEW' = 'VALID';
            if (!isLeave) {
              const evaluation = this.aiService.evaluate(row.content);
              aiScore = evaluation.score;
              aiFeedback = evaluation.feedback;
              status = evaluation.verdict === 'Valid' ? 'VALID' : 'NEEDS_REVIEW';
            }
            await tx.worklog.update({
              where: { id },
              data: {
                content: row.content,
                isLeave,
                aiScore,
                aiFeedback,
                status,
                manDay: row.isLeave ? 0 : row.manDay,
              },
            });
            allResults.push({
              row: row.rawRow,
              date: row.dateStr,
              success: true,
              overwritten: true,
              warnings: row.warnings.length ? row.warnings : undefined,
            });
          }
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Transaction failed.';
        throw new BadRequestException(`Import failed: ${message}`);
      }
    }

    allResults.sort((a, b) => a.row - b.row);

    const succeeded = allResults.filter((r) => r.success && !r.skipped).length;
    const skipped = allResults.filter((r) => r.skipped).length;
    const failed = allResults.filter((r) => !r.success).length;

    return { total: rawRows.length, succeeded, skipped, failed, results: allResults };
  }

  private parseCsvBuffer(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
  ): Record<string, string>[] {
    const ext = originalName.split('.').pop()?.toLowerCase();
    const isExcel =
      ext === 'xlsx' ||
      ext === 'xls' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.ms-excel';

    if (isExcel) {
      // Dynamic import to avoid circular dep with xlsx already used elsewhere
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const XLSX = require('xlsx') as typeof import('xlsx');
      const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new BadRequestException('No sheets found in the Excel file.');
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      return rows.map((r) => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(r)) {
          const safeVal =
            typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
              ? String(v)
              : '';
          out[k.trim()] = safeVal.trim();
        }
        return out;
      });
    }

    try {
      return parseCsv<Record<string, string>>(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
      });
    } catch (err) {
      throw new BadRequestException(`Failed to parse CSV: ${(err as Error).message}`);
    }
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
