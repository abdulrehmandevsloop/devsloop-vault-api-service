import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { WorklogNotificationConfigDto } from './dto';

const KEYS = {
  gracePeriodHour: 'worklog_grace_period_hour',
  quietHoursStart: 'worklog_quiet_hours_start',
  frequencyHours: 'worklog_notification_frequency_hours',
} as const;

const DEFAULTS: WorklogNotificationConfigDto = {
  gracePeriodHour: 9,
  quietHoursStart: 22,
  frequencyHours: 2,
};

@Injectable()
export class SystemConfigService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // Seed defaults if not yet present
    for (const [field, key] of Object.entries(KEYS) as [keyof typeof KEYS, string][]) {
      await this.prisma.systemConfig.upsert({
        where: { key },
        create: { key, value: String(DEFAULTS[field]) },
        update: {},
      });
    }
  }

  async getWorklogNotificationConfig(): Promise<WorklogNotificationConfigDto> {
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { in: Object.values(KEYS) } },
      select: { key: true, value: true },
    });

    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      gracePeriodHour: parseInt(
        map.get(KEYS.gracePeriodHour) ?? String(DEFAULTS.gracePeriodHour),
        10,
      ),
      quietHoursStart: parseInt(
        map.get(KEYS.quietHoursStart) ?? String(DEFAULTS.quietHoursStart),
        10,
      ),
      frequencyHours: parseInt(map.get(KEYS.frequencyHours) ?? String(DEFAULTS.frequencyHours), 10),
    };
  }

  async updateWorklogNotificationConfig(
    dto: WorklogNotificationConfigDto,
  ): Promise<WorklogNotificationConfigDto> {
    await this.prisma.$transaction([
      this.prisma.systemConfig.upsert({
        where: { key: KEYS.gracePeriodHour },
        create: { key: KEYS.gracePeriodHour, value: String(dto.gracePeriodHour) },
        update: { value: String(dto.gracePeriodHour) },
      }),
      this.prisma.systemConfig.upsert({
        where: { key: KEYS.quietHoursStart },
        create: { key: KEYS.quietHoursStart, value: String(dto.quietHoursStart) },
        update: { value: String(dto.quietHoursStart) },
      }),
      this.prisma.systemConfig.upsert({
        where: { key: KEYS.frequencyHours },
        create: { key: KEYS.frequencyHours, value: String(dto.frequencyHours) },
        update: { value: String(dto.frequencyHours) },
      }),
    ]);
    return dto;
  }
}
