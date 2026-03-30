import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma';
import { PublicHolidaysService } from '../public-holidays';
import { SystemConfigService } from '../system-config';
import { GoogleChatService } from './google-chat.service';

interface UserMissedEntry {
  userId: string;
  userName: string;
  userEmail: string;
  missedDates: Date[];
  reminderCount: number;
}

@Injectable()
export class WorklogReminderService {
  private readonly logger = new Logger(WorklogReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleChatService: GoogleChatService,
    private readonly systemConfigService: SystemConfigService,
    private readonly publicHolidaysService: PublicHolidaysService,
    private readonly configService: ConfigService,
  ) {}

  @Cron('*/30 * * * *')
  async checkMissedWorklogs(force = false, month?: string): Promise<void> {
    const config = await this.systemConfigService.getWorklogNotificationConfig();
    const now = new Date();
    const currentHour = now.getHours();

    if (!force && (currentHour < config.gracePeriodHour || currentHour >= config.quietHoursStart)) {
      return;
    }

    // Determine the month window to check
    let monthStart: Date;
    let upperBound: Date; // exclusive upper bound for the date range

    if (month) {
      const [yr, mo] = month.split('-').map(Number);
      monthStart = new Date(Date.UTC(yr, mo - 1, 1));
      const firstOfNextMonth = new Date(Date.UTC(yr, mo, 1));
      const todayMidnight = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      // For a past month include all days; for current/future cap at today
      upperBound = firstOfNextMonth <= todayMidnight ? firstOfNextMonth : todayMidnight;
    } else {
      const todayMidnight = new Date(now);
      todayMidnight.setUTCHours(0, 0, 0, 0);
      monthStart = new Date(
        Date.UTC(todayMidnight.getUTCFullYear(), todayMidnight.getUTCMonth(), 1),
      );
      upperBound = todayMidnight;
    }

    // Load all active user-project assignments grouped by project
    const assignments = await this.prisma.userProject.findMany({
      select: {
        userId: true,
        projectId: true,
        project: { select: { id: true, channelUrl: true, name: true } },
        user: {
          select: {
            name: true,
            email: true,
            employeeStatus: true,
            isSystem: true,
            joiningDate: true,
          },
        },
      },
    });

    // Group by projectId
    const byProject = new Map<
      string,
      { channelUrl: string | null; projectName: string; members: typeof assignments }
    >();
    for (const a of assignments) {
      if (!byProject.has(a.projectId)) {
        byProject.set(a.projectId, {
          channelUrl: a.project.channelUrl,
          projectName: a.project.name,
          members: [],
        });
      }
      byProject.get(a.projectId)!.members.push(a);
    }

    const vaultUrl = this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';

    for (const [projectId, { channelUrl, projectName, members }] of byProject) {
      if (!this.resolveChannelUrl(channelUrl, projectName)) continue;

      const usersToNotify: UserMissedEntry[] = [];
      for (const member of members) {
        const entry = await this.resolveUserEntry(
          member,
          projectId,
          monthStart,
          upperBound,
          now,
          config,
          force,
        );
        if (entry) usersToNotify.push(entry);
      }

      if (usersToNotify.length === 0) continue;

      const sent = await this.googleChatService.sendMissedWorklogAlert(channelUrl as string, {
        projectName,
        users: usersToNotify,
        vaultUrl: `${vaultUrl}/worklogs`,
      });

      if (!sent) continue;

      for (const entry of usersToNotify) {
        await this.prisma.worklogMissedReminder.update({
          where: { userId_projectId_date: { userId: entry.userId, projectId, date: monthStart } },
          data: { lastSentAt: now, sentCount: { increment: 1 } },
        });
      }
    }
  }

  private resolveChannelUrl(channelUrl: string | null, projectName: string): boolean {
    if (!channelUrl?.trim()) {
      this.logger.warn(`No Google Chat channel for project "${projectName}" — skipping`);
      return false;
    }
    try {
      new URL(channelUrl);
      return true;
    } catch {
      this.logger.warn(`Invalid channel URL for project "${projectName}" — skipping`);
      return false;
    }
  }

  private async resolveUserEntry(
    member: {
      userId: string;
      projectId: string;
      user: {
        name: string;
        email: string;
        employeeStatus: string;
        isSystem: boolean;
        joiningDate: Date | null;
      };
    },
    projectId: string,
    monthStart: Date,
    upperBound: Date,
    now: Date,
    config: { frequencyHours: number },
    force: boolean,
  ): Promise<UserMissedEntry | null> {
    if (member.user.employeeStatus !== 'ACTIVE' || member.user.isSystem) return null;

    const { userId } = member;
    const missedDates = await this.getMissedDaysThisMonth(
      userId,
      projectId,
      monthStart,
      upperBound,
      member.user.joiningDate ?? undefined,
    );
    if (missedDates.length === 0) return null;

    const reminder = await this.prisma.worklogMissedReminder.upsert({
      where: { userId_projectId_date: { userId, projectId, date: monthStart } },
      create: { userId, projectId, date: monthStart, lastSentAt: new Date(0), sentCount: 0 },
      update: {},
      select: { lastSentAt: true, sentCount: true },
    });

    if (!force) {
      const hoursSinceLastSend = (now.getTime() - reminder.lastSentAt.getTime()) / (1000 * 60 * 60);
      if (reminder.sentCount > 0 && hoursSinceLastSend < config.frequencyHours) return null;
    }

    return {
      userId,
      userName: member.user.name,
      userEmail: member.user.email,
      missedDates,
      reminderCount: reminder.sentCount + 1,
    };
  }

  /**
   * Returns all working days in [monthStart, upperBound) that have no submitted
   * worklog for the given user+project, excluding public holidays and approved leave.
   */
  private async getMissedDaysThisMonth(
    userId: string,
    projectId: string,
    monthStart: Date,
    upperBound: Date,
    joiningDate?: Date,
  ): Promise<Date[]> {
    const todayUtc = upperBound;

    // Never count days before the user's joining date
    const effectiveStart =
      joiningDate && joiningDate > monthStart
        ? new Date(
            Date.UTC(
              joiningDate.getUTCFullYear(),
              joiningDate.getUTCMonth(),
              joiningDate.getUTCDate(),
            ),
          )
        : monthStart;

    const holidayKeys = await this.publicHolidaysService.getHolidayKeys(monthStart, todayUtc);

    const leaves = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId: userId,
        status: 'APPROVED',
        startDate: { lte: todayUtc },
        endDate: { gte: monthStart },
      },
      select: { startDate: true, endDate: true },
    });

    const leaveDayKeys = new Set<string>();
    for (const leave of leaves) {
      const cursor = new Date(leave.startDate);
      cursor.setUTCHours(0, 0, 0, 0);
      const end = new Date(leave.endDate);
      end.setUTCHours(0, 0, 0, 0);
      while (cursor <= end) {
        leaveDayKeys.add(this.toDateKey(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }

    const submitted = await this.prisma.worklog.findMany({
      where: { userId, projectId, date: { gte: effectiveStart, lt: todayUtc } },
      select: { date: true },
    });
    const submittedKeys = new Set(submitted.map((w) => this.toDateKey(w.date)));

    const missed: Date[] = [];
    const cursor = new Date(effectiveStart);
    while (cursor < todayUtc) {
      const dow = cursor.getUTCDay();
      const key = this.toDateKey(cursor);
      if (
        dow !== 0 &&
        dow !== 6 &&
        !holidayKeys.has(key) &&
        !leaveDayKeys.has(key) &&
        !submittedKeys.has(key)
      ) {
        missed.push(new Date(cursor));
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return missed;
  }

  private toDateKey(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
