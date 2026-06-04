import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma';
import { AclService } from 'src/rbac/rbac.service';
import { WorklogAiService } from './worklog-ai.service';
import { WorklogComplianceService } from './worklog-compliance.service';
import { GoogleChatService } from './google-chat.service';
import { parse as parseCsv } from 'csv-parse/sync';
import {
  parseCsvDate,
  formatDateForCsv,
  type CsvDateFormat,
  CSV_DATE_FORMATS,
} from './utils/parse-csv-date';
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
  isPublicHoliday: true,
  isCompanyHoliday: true,
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
  isPublicHoliday: boolean;
  isCompanyHoliday: boolean;
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

  private assertExclusiveFlags(
    isLeave: boolean,
    isPublicHoliday: boolean,
    isCompanyHoliday: boolean,
  ): void {
    const flagCount = [isLeave, isPublicHoliday, isCompanyHoliday].filter(Boolean).length;
    if (flagCount > 1) {
      throw new BadRequestException(
        'A worklog can only be marked as one of: leave, public holiday, or company holiday.',
      );
    }
  }

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

    // Verify user is assigned to this project via the manage users modal
    const membership = await this.prisma.userProject.findUnique({
      where: { userId_projectId: { userId, projectId: dto.projectId } },
      select: { userId: true },
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
    const isPublicHoliday = dto.isPublicHoliday === true;
    const isCompanyHoliday = dto.isCompanyHoliday === true;
    this.assertExclusiveFlags(isLeave, isPublicHoliday, isCompanyHoliday);
    let content = '';
    let aiScore: number | null = null;
    let aiFeedback: string | null = null;
    let status: 'VALID' | 'NEEDS_REVIEW' = 'VALID';

    if (!isLeave && !isPublicHoliday && !isCompanyHoliday) {
      content = dto.content;
      const evaluation = this.aiService.evaluate(dto.content);
      aiScore = evaluation.score;
      aiFeedback = evaluation.feedback;
      status = evaluation.verdict === 'Valid' ? 'VALID' : 'NEEDS_REVIEW';
      this.logger.log(
        `Worklog AI eval for user ${userId}: score=${aiScore} verdict=${evaluation.verdict}`,
      );
    } else if (isLeave) {
      this.logger.log(`Leave entry submitted for user ${userId} on ${dto.date}`);
    } else if (isPublicHoliday) {
      this.logger.log(`Public holiday entry submitted for user ${userId} on ${dto.date}`);
    } else {
      this.logger.log(`Company holiday entry submitted for user ${userId} on ${dto.date}`);
    }

    const worklog = await this.prisma.worklog.create({
      data: {
        userId,
        projectId: dto.projectId,
        date,
        content,
        isLeave,
        isPublicHoliday,
        isCompanyHoliday,
        aiScore,
        aiFeedback,
        status,
        manDay: isLeave || isPublicHoliday || isCompanyHoliday ? 0 : 1,
      },
      select: WORKLOG_SELECT,
    });

    const formatted = this.formatWorklog(worklog as unknown as WorklogRow);
    this.notifyGoogleChat(worklog as unknown as WorklogRow, true);
    // Auto-resolve any missed-log reminder for this user+project this month
    const reminderMonthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    void this.prisma.worklogMissedReminder
      .updateMany({
        where: { userId, projectId: dto.projectId, date: reminderMonthStart, resolved: false },
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

        // Verify user is assigned to this project via the manage users modal
        const membership = await this.prisma.userProject.findUnique({
          where: { userId_projectId: { userId, projectId: entry.projectId } },
          select: { userId: true },
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
        const isPublicHoliday = entry.isPublicHoliday === true;
        const isCompanyHoliday = entry.isCompanyHoliday === true;
        this.assertExclusiveFlags(isLeave, isPublicHoliday, isCompanyHoliday);
        let content = '';
        let aiScore: number | null = null;
        let aiFeedback: string | null = null;
        let status: 'VALID' | 'NEEDS_REVIEW' = 'VALID';

        if (!isLeave && !isPublicHoliday && !isCompanyHoliday) {
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
            isPublicHoliday,
            isCompanyHoliday,
            aiScore,
            aiFeedback,
            status,
            manDay: isLeave || isPublicHoliday || isCompanyHoliday ? 0 : 1,
          },
        });

        results.push({ row, projectId: entry.projectId, date: entry.date, success: true });
        succeeded++;
        // Auto-resolve any missed-log reminder for this user+project this month
        const reminderMonthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
        void this.prisma.worklogMissedReminder
          .updateMany({
            where: {
              userId,
              projectId: entry.projectId,
              date: reminderMonthStart,
              resolved: false,
            },
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
    const isPublicHoliday = dto.isPublicHoliday ?? existing.isPublicHoliday;
    const isCompanyHoliday = dto.isCompanyHoliday ?? existing.isCompanyHoliday;
    this.assertExclusiveFlags(isLeave, isPublicHoliday, isCompanyHoliday);
    const targetProjectId = dto.projectId ?? existing.projectId;

    // If changing project, verify membership and no duplicate
    if (dto.projectId && dto.projectId !== existing.projectId) {
      const [membership, leadMembership] = await Promise.all([
        this.prisma.userProject.findFirst({
          where: { userId, projectId: dto.projectId },
          select: { projectId: true },
        }),
        this.prisma.projectStakeholder.findFirst({
          where: { userId, projectId: dto.projectId, role: 'LEAD' },
          select: { userId: true },
        }),
      ]);
      if (!membership && !leadMembership)
        throw new ForbiddenException('You are not assigned to this project.');

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

    if (!isLeave && !isPublicHoliday && !isCompanyHoliday) {
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
      isPublicHoliday,
      isCompanyHoliday,
      content,
      aiScore,
      aiFeedback,
      status,
      manDay: isLeave || isPublicHoliday || isCompanyHoliday ? 0 : 1,
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
          isPublicHoliday: worklog.isPublicHoliday,
          isCompanyHoliday: worklog.isCompanyHoliday,
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
        isPublicHoliday: true,
        isCompanyHoliday: true,
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
    isPublicHoliday: boolean;
    isCompanyHoliday: boolean;
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
        isPublicHoliday: worklog.isPublicHoliday,
        isCompanyHoliday: worklog.isCompanyHoliday,
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
      const [assigned, stakeholder] = await Promise.all([
        this.prisma.userProject.findMany({
          where: { userId: requesterId },
          select: { projectId: true },
        }),
        this.prisma.projectStakeholder.findMany({
          where: { userId: requesterId, role: { in: ['MANAGER', 'LEAD'] } },
          select: { projectId: true },
        }),
      ]);
      ids = [
        ...new Set([...assigned.map((a) => a.projectId), ...stakeholder.map((s) => s.projectId)]),
      ];
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
    eligibleOnly: boolean = false,
  ): Promise<ProjectComplianceResponseDto> {
    await this.assertManagerAccess(projectId, requesterId);

    const { year, month: monthNum } = this.complianceService.parseMonth(month);
    const { startDate, endDate } = this.complianceService.getMonthRange(month);

    // All users in project (assigned members + project leads + project managers, deduped)
    const [project, assignedMembers, stakeholderMembers] = await Promise.all([
      this.prisma.project.findUnique({
        where: { id: projectId },
        select: { name: true, clientName: true },
      }),
      this.prisma.userProject.findMany({
        where: { projectId },
        select: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      }),
      this.prisma.projectStakeholder.findMany({
        where: { projectId },
        select: {
          role: true,
          user: { select: { id: true, name: true, email: true, avatarUrl: true } },
        },
      }),
    ]);
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
    const assignedUserIds = new Set(assignedMembers.map((a) => a.user.id));
    const leadUserIds = new Set(
      stakeholderMembers.filter((s) => s.role === 'LEAD').map((s) => s.user.id),
    );
    const managerUserIds = new Set(
      stakeholderMembers.filter((s) => s.role === 'MANAGER').map((s) => s.user.id),
    );
    const seenIds = new Set<string>();
    const projectUsers: {
      user: { id: string; name: string; email: string; avatarUrl: string | null };
    }[] = [];
    for (const entry of [...assignedMembers, ...stakeholderMembers]) {
      if (!seenIds.has(entry.user.id)) {
        seenIds.add(entry.user.id);
        projectUsers.push(entry);
      }
    }

    // All worklogs for project in month
    const logs = await this.prisma.worklog.findMany({
      where: { projectId, date: { gte: startDate, lt: endDate } },
      select: {
        userId: true,
        date: true,
        isLeave: true,
        isPublicHoliday: true,
        isCompanyHoliday: true,
      },
    });

    // Group by userId
    const logsByUser = new Map<
      string,
      { date: Date; isLeave: boolean; isPublicHoliday: boolean; isCompanyHoliday: boolean }[]
    >();
    for (const log of logs) {
      if (!logsByUser.has(log.userId)) logsByUser.set(log.userId, []);
      logsByUser.get(log.userId)!.push({
        date: log.date,
        isLeave: log.isLeave,
        isPublicHoliday: log.isPublicHoliday,
        isCompanyHoliday: log.isCompanyHoliday,
      });
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

      // Separate actual work logs from leave / public holiday / company holiday entries
      const workDates = userLogs
        .filter((l) => !l.isLeave && !l.isPublicHoliday && !l.isCompanyHoliday)
        .map((l) => l.date);
      const leaveLogDates = userLogs.filter((l) => l.isLeave).map((l) => l.date);
      const publicHolidayLogDates = userLogs.filter((l) => l.isPublicHoliday).map((l) => l.date);
      const companyHolidayLogDates = userLogs.filter((l) => l.isCompanyHoliday).map((l) => l.date);

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

      const publicHolidayDays = publicHolidayLogDates.filter((d) =>
        workingDayKeys.has(this.complianceService.toDateKey(d)),
      ).length;

      const companyHolidayDays = companyHolidayLogDates.filter((d) =>
        workingDayKeys.has(this.complianceService.toDateKey(d)),
      ).length;

      // Count Saturday/Sunday work submissions (non-leave, bonus days)
      const saturdayDays = workDates.filter((d) => d.getUTCDay() === 6).length;
      const sundayDays = workDates.filter((d) => d.getUTCDay() === 0).length;

      // Missed = all working days (including today) with no log of any kind
      const missedDays = Math.max(
        0,
        totalWorkingDays - submittedDays - leaveDays - publicHolidayDays - companyHolidayDays,
      );

      // Compliance = (work + leave + public holiday + company holiday) / total
      const compliancePct =
        totalWorkingDays > 0
          ? Math.round(
              ((submittedDays + leaveDays + publicHolidayDays + companyHolidayDays) /
                totalWorkingDays) *
                100,
            )
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
        publicHolidayDays,
        companyHolidayDays,
        saturdayDays,
        sundayDays,
        compliancePct,
        isProjectLead: leadUserIds.has(user.id),
        isProjectManager: managerUserIds.has(user.id),
        isEligibleForWorklog: assignedUserIds.has(user.id),
      };
    });

    // Sort by compliance ascending (worst first) so managers see who needs attention
    allUsers.sort((a, b) => a.compliancePct - b.compliancePct);

    const displayUsers = eligibleOnly ? allUsers.filter((u) => u.isEligibleForWorklog) : allUsers;
    const total = displayUsers.length;
    const eligibleCount = eligibleOnly
      ? total
      : allUsers.filter((u) => u.isEligibleForWorklog).length;
    const totalPages = Math.ceil(total / limit) || 1;
    const users = displayUsers.slice((page - 1) * limit, page * limit);

    return {
      month,
      projectId,
      projectName: project.name,
      clientName: project.clientName,
      users,
      total,
      eligibleCount,
      page,
      limit,
      totalPages,
    };
  }

  async getProjectsCompliance(
    requesterId: string,
    month: string,
    projectIds?: string[],
  ): Promise<ProjectComplianceResponseDto[]> {
    let ids = projectIds?.length ? projectIds : undefined;
    if (!ids?.length) {
      const [assigned, stakeholder] = await Promise.all([
        this.prisma.userProject.findMany({
          where: { userId: requesterId },
          select: { projectId: true },
        }),
        this.prisma.projectStakeholder.findMany({
          where: { userId: requesterId, role: { in: ['MANAGER', 'LEAD'] } },
          select: { projectId: true },
        }),
      ]);
      ids = [
        ...new Set([...assigned.map((a) => a.projectId), ...stakeholder.map((s) => s.projectId)]),
      ];
    }
    const results: ProjectComplianceResponseDto[] = [];
    // Single fetch per project with a high limit so portal can merge full rosters (default limit is 10).
    const bulkLimit = 10_000;
    for (const projectId of ids) {
      const compliance = await this.getProjectCompliance(
        projectId,
        month,
        requesterId,
        1,
        bulkLimit,
        false,
      );
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

    const [projectAssignedUsers, projectStakeholderUsers, allLogs] = await Promise.all([
      this.prisma.userProject.findMany({
        where: { projectId, user: { isSystem: false } },
        select: { user: { select: { id: true, name: true, designation: true } } },
      }),
      this.prisma.projectStakeholder.findMany({
        where: { projectId, user: { isSystem: false } },
        select: { user: { select: { id: true, name: true, designation: true } } },
      }),
      this.prisma.worklog.findMany({
        where: { projectId, date: { gte: startDate, lt: endDate } },
        select: {
          userId: true,
          date: true,
          content: true,
          manDay: true,
          isLeave: true,
          isPublicHoliday: true,
          isCompanyHoliday: true,
        },
        orderBy: [{ userId: 'asc' }, { date: 'asc' }],
      }),
    ]);

    // Merge assigned members + stakeholders (managers, leads, observers), deduped by userId, sorted by name
    const seenUserIds = new Set<string>();
    const mergedUsers: { id: string; name: string; designation: string | null }[] = [];
    for (const { user } of [...projectAssignedUsers, ...projectStakeholderUsers]) {
      if (!seenUserIds.has(user.id)) {
        seenUserIds.add(user.id);
        mergedUsers.push(user);
      }
    }
    mergedUsers.sort((a, b) => a.name.localeCompare(b.name));

    const logsByUser = new Map<string, typeof allLogs>();
    for (const log of allLogs) {
      if (!logsByUser.has(log.userId)) logsByUser.set(log.userId, []);
      logsByUser.get(log.userId)!.push(log);
    }

    const users = mergedUsers.map((user) => {
      const logs = logsByUser.get(user.id) ?? [];
      const totalManDays = logs.reduce((sum, l) => sum + l.manDay, 0);
      const totalLeaves = logs.filter(
        (l) => l.isLeave || l.isPublicHoliday || l.isCompanyHoliday,
      ).length;
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
          isPublicHoliday: l.isPublicHoliday,
          isCompanyHoliday: l.isCompanyHoliday,
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
        isPublicHoliday: true,
        isCompanyHoliday: true,
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
      isPublicHoliday: boolean;
      isCompanyHoliday: boolean;
    };
    const logMap = new Map<string, LogRow>(
      logs.map((l) => [this.complianceService.toDateKey(l.date), l]),
    );
    const rows = weekdays.map((day) => {
      const key = this.complianceService.toDateKey(day);
      const log = logMap.get(key);
      const dateStr = key;
      const tasks = log
        ? log.isCompanyHoliday
          ? 'Company Holiday'
          : log.isPublicHoliday
            ? 'Public Holiday'
            : log.isLeave
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
        isPublicHoliday: true,
        isCompanyHoliday: true,
        project: { select: { name: true } },
      },
      orderBy: [{ date: 'asc' }, { projectId: 'asc' }],
    });

    const header = 'Date,Project,Tasks,Man Day,AI Score,Remarks';
    const rows = logs.map((l) => {
      const dateStr = this.complianceService.toDateKey(l.date);
      const projectName = this.escapeCsvField(l.project.name);
      const tasks = l.isCompanyHoliday
        ? 'Company Holiday'
        : l.isPublicHoliday
          ? 'Public Holiday'
          : l.isLeave
            ? 'Leave'
            : this.escapeCsvField(l.content);
      const aiScore = l.aiScore != null ? String(l.aiScore) : '';
      const remarks = l.aiFeedback ? this.escapeCsvField(l.aiFeedback) : '';
      return `${dateStr},"${projectName}","${tasks}",${l.manDay},${aiScore},"${remarks}"`;
    });
    const csv = [header, ...rows].join('\n');
    const filename = `worklog-old-projects-${month}.csv`;
    return { csv, filename };
  }

  // ─── CSV Import ──────────────────────────────────────────────────────────────

  getCsvTemplate(dateFormat: CsvDateFormat = 'YYYY-MM-DD', month?: string): string {
    let year: number;
    let monthIndex: number; // 0-indexed
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split('-').map(Number);
      year = y;
      monthIndex = m - 1;
    } else {
      const now = new Date();
      year = now.getUTCFullYear();
      monthIndex = now.getUTCMonth();
    }
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

    // Cycling sample tasks for workdays - includes examples with newlines
    const sampleTasks = [
      'Reviewed project requirements document\nSet up local development environment\nAttended kick-off meeting with stakeholders.',
      'Implemented UI components using React and Tailwind CSS\nIntegrated form validation\nConnected to authentication API.',
      'Developed user registration module with email verification flow\nWrote unit tests covering all validation edge cases.',
      'Fixed critical bug in password reset flow causing token expiry mismatch\nReproduced issue and deployed fix to staging.',
      'Reviewed 4 pull requests from team members\nProvided detailed feedback on API design patterns and error handling.',
      'Built dashboard analytics charts\nConnected components to live data endpoints\nAdded skeleton loading states.',
      'Attended sprint retrospective and review\nRefined product backlog for next sprint\nUpdated technical design docs.',
      'Implemented role-based access control for admin panel\nAdded entity permission guards to all protected API routes.',
      'Optimised slow database queries on report page using indexed lookups\nReduced average load time from 4s to 800ms.',
      'Integrated third-party email service\nBuilt reusable HTML email templates for transactional notifications.',
      'Conducted manual QA regression testing on new module\nDocumented 6 bugs with detailed reproduction steps.',
      'Resolved all QA bugs\nImproved mobile responsiveness of request forms across iOS and Android breakpoints.',
      'Migrated user profile endpoints to new service architecture\nUpdated API docs and Postman collection.',
      'Built CSV export feature\nHandled special characters, multi-line content encoding and large dataset streaming.',
      'Pair programming session on GraphQL schema design for reporting module\nPrototyped and compared 3 query patterns.',
      'Prepared sprint demo\nRecorded walkthrough video of new features\nCompiled release notes for upcoming deployment.',
      'Deployed new release to production\nMonitored error rates and performance metrics for 2 hours post-launch.',
      'Implemented automated end-to-end tests using Playwright covering full checkout and payment flows.',
      'Refactored authentication middleware to support OAuth 2.0 via Google and GitHub\nUpdated team documentation.',
      'Investigated and resolved intermittent CI failures caused by race conditions in async test teardown.',
      'Sprint planning session\nGroomed and estimated 12 user stories with the team\nUpdated sprint board and velocity.',
      'Wrote technical design document for the new notifications service\nReviewed with architect and incorporated feedback.',
    ];

    const rows = ['Date,Tasks,Man Day'];
    let taskIndex = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const utcDate = new Date(Date.UTC(year, monthIndex, day));
      const dateStr = formatDateForCsv(utcDate, dateFormat);
      const dayOfWeek = utcDate.getUTCDay(); // 0=Sun, 6=Sat

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
    dateFormat?: CsvDateFormat,
    overrideMonth = false,
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
    if (!keys.includes('tasks') && !keys.includes('status')) {
      throw new BadRequestException(
        'Missing required column: include "Tasks" and/or "Status" (e.g. Public Holiday in Status).',
      );
    }

    // 3. Verify user is assigned to project or is a project lead
    const [membership, leadMembership] = await Promise.all([
      this.prisma.userProject.findUnique({
        where: { userId_projectId: { userId, projectId } },
        select: { userId: true },
      }),
      this.prisma.projectStakeholder.findFirst({
        where: { userId, projectId, role: 'LEAD' },
        select: { userId: true },
      }),
    ]);
    if (!membership && !leadMembership) {
      throw new ForbiddenException('You are not assigned to this project.');
    }

    // 4. Parse and validate every row — track ALL rows in allResults so stats always add up
    type NormalisedRow = {
      rawRow: number;
      dateStr: string;
      date: Date;
      isLeave: boolean;
      isPublicHoliday: boolean;
      isCompanyHoliday: boolean;
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
      const get = (key: string): string => {
        const value =
          raw[key] ??
          raw[key.toLowerCase()] ??
          raw[Object.keys(raw).find((k) => k.toLowerCase().trim() === key) ?? ''] ??
          '';
        const strValue = typeof value === 'string' ? value : String(value);
        // Only trim leading/trailing whitespace, preserve internal newlines
        return strValue.trim();
      };

      const rawDate = get('date');
      const rawTasks = get('tasks');
      const rawStatus = get('status');
      // No default — absence of man day is meaningful (treated as 0 = skip)
      const rawManDay = get('man day') || get('man_day') || get('manday');

      // Skip fully empty rows silently (trailing blank lines)
      if (!rawDate && !rawTasks && !rawStatus) continue;

      const tasksNorm = this.normalizeCsvHolidayLabel(rawTasks);
      const statusNorm = this.normalizeCsvHolidayLabel(rawStatus);
      const isPublicHolidayCell = (s: string): boolean => s === 'public holiday';
      const isCompanyHolidayCell = (s: string): boolean => s === 'company holiday';
      const isLeave = tasksNorm === 'leave' || statusNorm === 'leave';
      const isPublicHoliday = isPublicHolidayCell(tasksNorm) || isPublicHolidayCell(statusNorm);
      const isCompanyHoliday = isCompanyHolidayCell(tasksNorm) || isCompanyHolidayCell(statusNorm);

      const flagCount = [isLeave, isPublicHoliday, isCompanyHoliday].filter(Boolean).length;
      if (flagCount > 1) {
        rowErrors.push('Row can only be one of: Leave, Public Holiday, or Company Holiday.');
      }

      // Skip rows where man day is absent or zero — except leave / public holiday / company holiday
      if (
        !isLeave &&
        !isPublicHoliday &&
        !isCompanyHoliday &&
        (!rawManDay || parseFloat(rawManDay) === 0)
      ) {
        allResults.push({ row: rowNum, date: rawDate, success: true, skipped: true });
        continue;
      }

      // Parse date — strict when dateFormat is given, auto-detect otherwise
      let dateStr = '';
      const parsed = parseCsvDate(rawDate, dateFormat);
      if (parsed) {
        dateStr = parsed;
      } else {
        const expectedFmt = dateFormat
          ? `Expected format: ${dateFormat} (e.g. "${CSV_DATE_FORMATS.find((f) => f.value === dateFormat)?.example}").`
          : 'Accepted: YYYY-MM-DD, DD-MM-YYYY, DD-MM-YY, MM-DD-YYYY, MM-DD-YY, or "27th March 2026".';
        rowErrors.push(`Invalid date "${rawDate}". ${expectedFmt} Slashes are not allowed.`);
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

      // Validate man day for work rows only — leave / public holiday / company holiday is always 0
      const manDayNum = isLeave || isPublicHoliday || isCompanyHoliday ? 0 : parseFloat(rawManDay);
      if (!isLeave && !isPublicHoliday && !isCompanyHoliday && manDayNum !== 1) {
        rowErrors.push(`"Man Day" must be 1 (got "${rawManDay}").`);
      }

      // Validate/truncate content (measure plain text, not raw HTML)
      const content = isLeave || isPublicHoliday || isCompanyHoliday ? '' : rawTasks;
      if (!isLeave && !isPublicHoliday && !isCompanyHoliday) {
        const plainLen = content
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&[a-z]+;/gi, '')
          .trim().length;
        if (plainLen > 5000) {
          rowWarnings.push('Work description exceeds 5,000 plain-text characters.');
        }
        if (plainLen < 20) {
          rowErrors.push(`Work description must be at least 20 characters (got ${plainLen}).`);
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
        isPublicHoliday,
        isCompanyHoliday,
        content,
        manDay: isLeave || isPublicHoliday || isCompanyHoliday ? 0 : manDayNum,
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

    // 6. Override-month path — runs regardless of how many valid rows exist
    //    targetMonth comes from expectedMonth, the dominant parsed month, or normalised rows.
    if (overrideMonth) {
      const targetMonth =
        expectedMonth ??
        (monthCounts.size > 0
          ? [...monthCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
          : normalised[0]?.dateStr.slice(0, 7));

      if (!targetMonth) {
        throw new BadRequestException(
          'Cannot determine target month for override. Provide expectedMonth or upload at least one valid row.',
        );
      }

      const [oYear, oMonth] = targetMonth.split('-').map(Number);
      const monthStart = new Date(Date.UTC(oYear, oMonth - 1, 1));
      const monthEnd = new Date(Date.UTC(oYear, oMonth, 1)); // exclusive upper bound

      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.worklog.deleteMany({
            where: { userId, projectId, date: { gte: monthStart, lt: monthEnd } },
          });
          for (const row of normalised) {
            const isLeave = row.isLeave;
            const isPublicHoliday = row.isPublicHoliday;
            const isCompanyHoliday = row.isCompanyHoliday;
            let aiScore: number | null = null;
            let aiFeedback: string | null = null;
            let status: 'VALID' | 'NEEDS_REVIEW' = 'VALID';
            if (!isLeave && !isPublicHoliday && !isCompanyHoliday) {
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
                isPublicHoliday,
                isCompanyHoliday,
                aiScore,
                aiFeedback,
                status,
                manDay: row.isLeave || row.isPublicHoliday || row.isCompanyHoliday ? 0 : row.manDay,
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

      this.touchMissedReminderResolutionForDates(
        userId,
        projectId,
        normalised.map((r) => r.date),
      );

      allResults.sort((a, b) => a.row - b.row);
      const succeeded = allResults.filter((r) => r.success && !r.skipped).length;
      const skipped = allResults.filter((r) => r.skipped).length;
      const failed = allResults.filter((r) => !r.success).length;
      return { total: rawRows.length, succeeded, skipped, failed, results: allResults };
    }

    // 7. Standard path (skip or row-by-row overwrite)
    if (normalised.length > 0) {
      // ── Standard path (skip or row-by-row overwrite) ─────────────────────
      const dates = normalised.map((r) => r.date);
      const existingLogs = await this.prisma.worklog.findMany({
        where: { userId, projectId, date: { in: dates } },
        select: { id: true, date: true, isLeave: true, isPublicHoliday: true },
      });
      const existingByDate = new Map(
        existingLogs.map((l) => [this.complianceService.toDateKey(l.date), l]),
      );

      // 7. Plan: skip, overwrite, or create
      const toCreate: NormalisedRow[] = [];
      const toUpdate: { id: string; row: NormalisedRow }[] = [];

      for (const row of normalised) {
        const existing = existingByDate.get(row.dateStr);
        /** Leave / public holiday / company holiday rows always apply when the file marks them — same as single-entry submit. */
        const forceTypeRow = row.isPublicHoliday || row.isLeave || row.isCompanyHoliday;

        if (existing) {
          if (skipExisting && !forceTypeRow) {
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
            const isPublicHoliday = row.isPublicHoliday;
            const isCompanyHoliday = row.isCompanyHoliday;
            let aiScore: number | null = null;
            let aiFeedback: string | null = null;
            let status: 'VALID' | 'NEEDS_REVIEW' = 'VALID';
            if (!isLeave && !isPublicHoliday && !isCompanyHoliday) {
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
                isPublicHoliday,
                isCompanyHoliday,
                aiScore,
                aiFeedback,
                status,
                manDay: row.isLeave || row.isPublicHoliday || row.isCompanyHoliday ? 0 : row.manDay,
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
            const isPublicHoliday = row.isPublicHoliday;
            const isCompanyHoliday = row.isCompanyHoliday;
            let aiScore: number | null = null;
            let aiFeedback: string | null = null;
            let status: 'VALID' | 'NEEDS_REVIEW' = 'VALID';
            if (!isLeave && !isPublicHoliday && !isCompanyHoliday) {
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
                isPublicHoliday,
                isCompanyHoliday,
                aiScore,
                aiFeedback,
                status,
                manDay: row.isLeave || row.isPublicHoliday || row.isCompanyHoliday ? 0 : row.manDay,
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

      const touchedDates = [...toCreate, ...toUpdate.map((u) => u.row)].map((r) => r.date);
      this.touchMissedReminderResolutionForDates(userId, projectId, touchedDates);
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
          // Trim column names but preserve content values (including newlines)
          const key = k.trim();
          // Only trim date field, preserve newlines in tasks/content
          const value = key.toLowerCase() === 'date' ? safeVal.trim() : safeVal;
          out[key] = value;
        }
        return out;
      });
    }

    try {
      return parseCsv<Record<string, string>>(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: false, // Don't trim - preserve newlines in content
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

  /**
   * Normalizes Tasks/Status cells so Excel/Sheets exports (NBSP, zero-width, BOM) still match
   * leave / public holiday keywords.
   */
  private normalizeCsvHolidayLabel(raw: string): string {
    // Alternation (not a char class) — avoids no-misleading-character-class on ZW* joiners
    return raw
      .trim()
      .replace(/\uFEFF|\u200B|\u200C|\u200D|\u00A0|\u2007|\u202F/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  /** Aligns with single create/bulk — marks month bucket reminders resolved after CSV writes. */
  private touchMissedReminderResolutionForDates(
    userId: string,
    projectId: string,
    dates: Date[],
  ): void {
    if (dates.length === 0) return;
    const monthKeys = new Set<string>();
    for (const d of dates) {
      monthKeys.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    for (const ym of monthKeys) {
      const [y, mo] = ym.split('-').map(Number);
      const reminderMonthStart = new Date(Date.UTC(y, mo - 1, 1));
      void this.prisma.worklogMissedReminder
        .updateMany({
          where: { userId, projectId, date: reminderMonthStart, resolved: false },
          data: { resolved: true },
        })
        .catch(() => undefined);
    }
  }

  private async assertManagerAccess(projectId: string, requesterId: string): Promise<void> {
    const [requester, stakeholderEntries] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: requesterId },
        select: {
          isSystem: true,
          userRoleAssignments: { select: { role: { select: { name: true } } } },
          userProjects: { select: { projectId: true } },
        },
      }),
      this.prisma.projectStakeholder.findMany({
        where: { projectId, userId: requesterId, role: { in: ['MANAGER', 'LEAD'] } },
        select: { role: true },
      }),
    ]);

    if (!requester) throw new NotFoundException('Requester not found');

    const roleNames = requester.userRoleAssignments.map((a) => a.role.name);
    const isSystemAdmin = requester.isSystem === true;
    const isAdmin = isSystemAdmin || roleNames.includes('ADMIN');
    const isProjectManager = stakeholderEntries.some((s) => s.role === 'MANAGER');
    const isProjectLead = stakeholderEntries.some((s) => s.role === 'LEAD');

    const hasTeamAccess =
      isAdmin ||
      isProjectManager ||
      isProjectLead ||
      (await this.aclService.userHasEntityAccess(requesterId, WORKLOG_VIEW_TEAM_ENTITY));

    if (!hasTeamAccess) {
      throw new ForbiddenException(
        'Access denied. Requires project manager, team lead, worklog-team entity, or ADMIN role.',
      );
    }

    // Non-admin, non-stakeholder users must be a member of the project via UserProject
    if (!isAdmin && !isProjectManager && !isProjectLead) {
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
