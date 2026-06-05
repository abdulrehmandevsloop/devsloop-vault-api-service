import { ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { getAppEnv } from '../common/environment';
import {
  LeavePolicyConfigDto,
  LunchDaysEntryDto,
  PayrollConfigDto,
  SystemUserDto,
  UpdateLeavePolicyConfigDto,
  UpdatePayrollConfigDto,
  UpdateSystemUserEmailDto,
  WorklogNotificationConfigDto,
} from './dto';

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
  hrSignatureUrl: 'payroll_hr_signature_url',
  officialStampUrl: 'payroll_official_stamp_url',
} as const;

const LUNCH_DAYS_KEY_PREFIX = 'lunch_days_month_';

const LEAVE_POLICY_KEYS = {
  maternityMaxDays: 'leave_policy_maternity_max_days',
  wfhPerMonth: 'leave_policy_wfh_per_month',
  weddingMaxDays: 'leave_policy_wedding_max_days',
  umrahHajjMaxDays: 'leave_policy_umrah_hajj_max_days',
  umrahHajjMinServiceMonths: 'leave_policy_umrah_hajj_min_service_months',
  casualAdvanceNoticeDays: 'leave_policy_casual_advance_notice_days',
  wfhAdvanceNoticeDays: 'leave_policy_wfh_advance_notice_days',
  multiDayAdvanceNoticeDays: 'leave_policy_multi_day_advance_notice_days',
} as const;

const LEAVE_POLICY_DEFAULTS: Record<
  (typeof LEAVE_POLICY_KEYS)[keyof typeof LEAVE_POLICY_KEYS],
  string
> = {
  [LEAVE_POLICY_KEYS.maternityMaxDays]: '22',
  [LEAVE_POLICY_KEYS.wfhPerMonth]: '1',
  [LEAVE_POLICY_KEYS.weddingMaxDays]: '5',
  [LEAVE_POLICY_KEYS.umrahHajjMaxDays]: '10',
  [LEAVE_POLICY_KEYS.umrahHajjMinServiceMonths]: '12',
  [LEAVE_POLICY_KEYS.casualAdvanceNoticeDays]: '3',
  [LEAVE_POLICY_KEYS.wfhAdvanceNoticeDays]: '1',
  [LEAVE_POLICY_KEYS.multiDayAdvanceNoticeDays]: '7',
};

const PAYROLL_DEFAULTS: Record<(typeof PAYROLL_KEYS)[keyof typeof PAYROLL_KEYS], string> = {
  [PAYROLL_KEYS.primaryAuthorizerId]: '',
  [PAYROLL_KEYS.silentReviewerIds]: '',
  [PAYROLL_KEYS.hrEmail]: 'faiza.awan@devslooptech.com',
  [PAYROLL_KEYS.companyName]: 'DEVSLOOP',
  [PAYROLL_KEYS.companyTagline]: 'Software Development Company',
  [PAYROLL_KEYS.companyContactEmail]: 'contact@devsloop.net',
  [PAYROLL_KEYS.consultantTaxRate]: '0.04',
  [PAYROLL_KEYS.defaultLunchRate]: '200',
  [PAYROLL_KEYS.hrSignatureUrl]: '',
  [PAYROLL_KEYS.officialStampUrl]: '',
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
      ...Object.values(LEAVE_POLICY_KEYS).map((key) => ({
        key,
        value: LEAVE_POLICY_DEFAULTS[key],
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
      hrSignatureUrl: get(PAYROLL_KEYS.hrSignatureUrl, '') || null,
      officialStampUrl: get(PAYROLL_KEYS.officialStampUrl, '') || null,
      appEnv: getAppEnv(),
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
    if (dto.hrSignatureUrl !== undefined)
      addUpsert(PAYROLL_KEYS.hrSignatureUrl, dto.hrSignatureUrl ?? '');
    if (dto.officialStampUrl !== undefined)
      addUpsert(PAYROLL_KEYS.officialStampUrl, dto.officialStampUrl ?? '');

    if (upserts.length > 0) {
      await this.prisma.$transaction(upserts);
    }

    return this.getPayrollConfig();
  }

  // ─── Monthly Lunch Days ──────────────────────────────────────

  async getLunchDaysList(): Promise<LunchDaysEntryDto[]> {
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { startsWith: LUNCH_DAYS_KEY_PREFIX } },
      select: { key: true, value: true },
      orderBy: { key: 'asc' },
    });
    return rows.map((r) => ({
      yearMonth: r.key.slice(LUNCH_DAYS_KEY_PREFIX.length),
      days: parseInt(r.value, 10),
    }));
  }

  async getLunchDaysForMonth(yearMonth: string): Promise<number | null> {
    const row = await this.prisma.systemConfig.findUnique({
      where: { key: `${LUNCH_DAYS_KEY_PREFIX}${yearMonth}` },
      select: { value: true },
    });
    if (!row) return null;
    const parsed = parseInt(row.value, 10);
    return isNaN(parsed) ? null : parsed;
  }

  async upsertLunchDaysForMonth(yearMonth: string, days: number): Promise<LunchDaysEntryDto> {
    const key = `${LUNCH_DAYS_KEY_PREFIX}${yearMonth}`;
    await this.prisma.systemConfig.upsert({
      where: { key },
      create: { key, value: String(days) },
      update: { value: String(days) },
    });
    return { yearMonth, days };
  }

  async deleteLunchDaysForMonth(yearMonth: string): Promise<void> {
    await this.prisma.systemConfig.deleteMany({
      where: { key: `${LUNCH_DAYS_KEY_PREFIX}${yearMonth}` },
    });
  }

  // ─── Leave Policy Config ─────────────────────────────────────

  async getLeavePolicyConfig(): Promise<LeavePolicyConfigDto> {
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { in: Object.values(LEAVE_POLICY_KEYS) } },
      select: { key: true, value: true },
    });

    const map = new Map(rows.map((r) => [r.key, r.value]));
    const getInt = (key: string, fallback: string): number =>
      parseInt(map.get(key) ?? fallback, 10);

    return {
      maternityMaxDays: getInt(
        LEAVE_POLICY_KEYS.maternityMaxDays,
        LEAVE_POLICY_DEFAULTS[LEAVE_POLICY_KEYS.maternityMaxDays],
      ),
      wfhPerMonth: getInt(
        LEAVE_POLICY_KEYS.wfhPerMonth,
        LEAVE_POLICY_DEFAULTS[LEAVE_POLICY_KEYS.wfhPerMonth],
      ),
      weddingMaxDays: getInt(
        LEAVE_POLICY_KEYS.weddingMaxDays,
        LEAVE_POLICY_DEFAULTS[LEAVE_POLICY_KEYS.weddingMaxDays],
      ),
      umrahHajjMaxDays: getInt(
        LEAVE_POLICY_KEYS.umrahHajjMaxDays,
        LEAVE_POLICY_DEFAULTS[LEAVE_POLICY_KEYS.umrahHajjMaxDays],
      ),
      umrahHajjMinServiceMonths: getInt(
        LEAVE_POLICY_KEYS.umrahHajjMinServiceMonths,
        LEAVE_POLICY_DEFAULTS[LEAVE_POLICY_KEYS.umrahHajjMinServiceMonths],
      ),
      casualAdvanceNoticeDays: getInt(
        LEAVE_POLICY_KEYS.casualAdvanceNoticeDays,
        LEAVE_POLICY_DEFAULTS[LEAVE_POLICY_KEYS.casualAdvanceNoticeDays],
      ),
      wfhAdvanceNoticeDays: getInt(
        LEAVE_POLICY_KEYS.wfhAdvanceNoticeDays,
        LEAVE_POLICY_DEFAULTS[LEAVE_POLICY_KEYS.wfhAdvanceNoticeDays],
      ),
      multiDayAdvanceNoticeDays: getInt(
        LEAVE_POLICY_KEYS.multiDayAdvanceNoticeDays,
        LEAVE_POLICY_DEFAULTS[LEAVE_POLICY_KEYS.multiDayAdvanceNoticeDays],
      ),
    };
  }

  // ─── System User ─────────────────────────────────────────────

  async getSystemUser(): Promise<SystemUserDto> {
    const user = await this.prisma.user.findFirst({
      where: { isSystem: true },
      select: { id: true, name: true, email: true },
    });
    if (!user) throw new NotFoundException('System user not found');
    return user;
  }

  async updateSystemUserEmail(dto: UpdateSystemUserEmailDto): Promise<SystemUserDto> {
    const systemUser = await this.prisma.user.findFirst({
      where: { isSystem: true },
      select: { id: true },
    });
    if (!systemUser) throw new NotFoundException('System user not found');

    const normalized = dto.email.trim().toLowerCase();

    const conflict = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true },
    });
    if (conflict && conflict.id !== systemUser.id) {
      throw new ConflictException('A user with this email already exists');
    }

    return this.prisma.user.update({
      where: { id: systemUser.id },
      data: { email: normalized },
      select: { id: true, name: true, email: true },
    });
  }

  async updateLeavePolicyConfig(dto: UpdateLeavePolicyConfigDto): Promise<LeavePolicyConfigDto> {
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

    if (dto.maternityMaxDays !== undefined)
      addUpsert(LEAVE_POLICY_KEYS.maternityMaxDays, String(dto.maternityMaxDays));
    if (dto.wfhPerMonth !== undefined)
      addUpsert(LEAVE_POLICY_KEYS.wfhPerMonth, String(dto.wfhPerMonth));
    if (dto.weddingMaxDays !== undefined)
      addUpsert(LEAVE_POLICY_KEYS.weddingMaxDays, String(dto.weddingMaxDays));
    if (dto.umrahHajjMaxDays !== undefined)
      addUpsert(LEAVE_POLICY_KEYS.umrahHajjMaxDays, String(dto.umrahHajjMaxDays));
    if (dto.umrahHajjMinServiceMonths !== undefined)
      addUpsert(LEAVE_POLICY_KEYS.umrahHajjMinServiceMonths, String(dto.umrahHajjMinServiceMonths));
    if (dto.casualAdvanceNoticeDays !== undefined)
      addUpsert(LEAVE_POLICY_KEYS.casualAdvanceNoticeDays, String(dto.casualAdvanceNoticeDays));
    if (dto.wfhAdvanceNoticeDays !== undefined)
      addUpsert(LEAVE_POLICY_KEYS.wfhAdvanceNoticeDays, String(dto.wfhAdvanceNoticeDays));
    if (dto.multiDayAdvanceNoticeDays !== undefined)
      addUpsert(LEAVE_POLICY_KEYS.multiDayAdvanceNoticeDays, String(dto.multiDayAdvanceNoticeDays));

    if (upserts.length > 0) {
      await this.prisma.$transaction(upserts);
    }

    return this.getLeavePolicyConfig();
  }
}
