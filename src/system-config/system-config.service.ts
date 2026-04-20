import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { PayrollConfigDto, UpdatePayrollConfigDto, WorklogNotificationConfigDto } from './dto';

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

const PAYROLL_KEYS = {
  primaryAuthorizerId: 'payroll_primary_authorizer_id',
  silentReviewerIds: 'payroll_silent_reviewer_ids',
  hrEmail: 'payroll_hr_email',
  companyName: 'payroll_company_name',
  companyTagline: 'payroll_company_tagline',
  companyContactEmail: 'payroll_company_contact_email',
  consultantTaxRate: 'payroll_consultant_tax_rate',
  defaultLunchRate: 'payroll_default_lunch_rate',
} as const;

const PAYROLL_DEFAULTS: Record<(typeof PAYROLL_KEYS)[keyof typeof PAYROLL_KEYS], string> = {
  [PAYROLL_KEYS.primaryAuthorizerId]: '',
  [PAYROLL_KEYS.silentReviewerIds]: '',
  [PAYROLL_KEYS.hrEmail]: 'faiza.awan@devslooptech.com',
  [PAYROLL_KEYS.companyName]: 'DEVSLOOP',
  [PAYROLL_KEYS.companyTagline]: 'Software Development Company',
  [PAYROLL_KEYS.companyContactEmail]: 'contact@devsloop.net',
  [PAYROLL_KEYS.consultantTaxRate]: '0.04',
  [PAYROLL_KEYS.defaultLunchRate]: '200',
};

@Injectable()
export class SystemConfigService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const allKeys = [
      ...Object.entries(KEYS).map(([field, key]) => ({
        key,
        value: String(DEFAULTS[field as keyof typeof DEFAULTS]),
      })),
      ...Object.values(PAYROLL_KEYS).map((key) => ({
        key,
        value: PAYROLL_DEFAULTS[key],
      })),
    ];

    for (const { key, value } of allKeys) {
      await this.prisma.systemConfig.upsert({
        where: { key },
        create: { key, value },
        update: {},
      });
    }
  }

  // ─── Worklog Notification Config ─────────────────────────────

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

  // ─── Payroll Config ──────────────────────────────────────────

  async getPayrollConfig(): Promise<PayrollConfigDto> {
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { in: Object.values(PAYROLL_KEYS) } },
      select: { key: true, value: true },
    });

    const map = new Map(rows.map((r) => [r.key, r.value]));
    const get = (key: string, fallback: string): string => map.get(key) ?? fallback;

    const reviewerIdsRaw = get(
      PAYROLL_KEYS.silentReviewerIds,
      PAYROLL_DEFAULTS[PAYROLL_KEYS.silentReviewerIds],
    );

    const primaryAuthorizerId = get(
      PAYROLL_KEYS.primaryAuthorizerId,
      PAYROLL_DEFAULTS[PAYROLL_KEYS.primaryAuthorizerId],
    );

    let primaryAuthorizerName: string | null = null;
    if (primaryAuthorizerId) {
      const authorizer = await this.prisma.user.findUnique({
        where: { id: primaryAuthorizerId },
        select: { name: true },
      });
      primaryAuthorizerName = authorizer?.name ?? null;
    }

    return {
      primaryAuthorizerId,
      primaryAuthorizerName,
      silentReviewerIds: reviewerIdsRaw ? reviewerIdsRaw.split(',').filter(Boolean) : [],
      hrEmail: get(PAYROLL_KEYS.hrEmail, PAYROLL_DEFAULTS[PAYROLL_KEYS.hrEmail]),
      companyName: get(PAYROLL_KEYS.companyName, PAYROLL_DEFAULTS[PAYROLL_KEYS.companyName]),
      companyTagline: get(
        PAYROLL_KEYS.companyTagline,
        PAYROLL_DEFAULTS[PAYROLL_KEYS.companyTagline],
      ),
      companyContactEmail: get(
        PAYROLL_KEYS.companyContactEmail,
        PAYROLL_DEFAULTS[PAYROLL_KEYS.companyContactEmail],
      ),
      consultantTaxRate: parseFloat(
        get(PAYROLL_KEYS.consultantTaxRate, PAYROLL_DEFAULTS[PAYROLL_KEYS.consultantTaxRate]),
      ),
      defaultLunchRate: parseFloat(
        get(PAYROLL_KEYS.defaultLunchRate, PAYROLL_DEFAULTS[PAYROLL_KEYS.defaultLunchRate]),
      ),
    };
  }

  async updatePayrollConfig(dto: UpdatePayrollConfigDto): Promise<PayrollConfigDto> {
    const upserts: ReturnType<typeof this.prisma.systemConfig.upsert>[] = [];

    const addUpsert = (key: string, value: string): void => {
      upserts.push(
        this.prisma.systemConfig.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        }),
      );
    };

    if (dto.primaryAuthorizerId !== undefined)
      addUpsert(PAYROLL_KEYS.primaryAuthorizerId, dto.primaryAuthorizerId);
    if (dto.silentReviewerIds !== undefined)
      addUpsert(PAYROLL_KEYS.silentReviewerIds, dto.silentReviewerIds.join(','));
    if (dto.hrEmail !== undefined) addUpsert(PAYROLL_KEYS.hrEmail, dto.hrEmail);
    if (dto.companyName !== undefined) addUpsert(PAYROLL_KEYS.companyName, dto.companyName);
    if (dto.companyTagline !== undefined)
      addUpsert(PAYROLL_KEYS.companyTagline, dto.companyTagline);
    if (dto.companyContactEmail !== undefined)
      addUpsert(PAYROLL_KEYS.companyContactEmail, dto.companyContactEmail);
    if (dto.consultantTaxRate !== undefined)
      addUpsert(PAYROLL_KEYS.consultantTaxRate, String(dto.consultantTaxRate));
    if (dto.defaultLunchRate !== undefined)
      addUpsert(PAYROLL_KEYS.defaultLunchRate, String(dto.defaultLunchRate));

    if (upserts.length > 0) {
      await this.prisma.$transaction(upserts);
    }

    return this.getPayrollConfig();
  }
}
