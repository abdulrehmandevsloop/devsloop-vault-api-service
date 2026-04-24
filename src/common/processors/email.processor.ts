import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { PgBossService } from '../../queue/pg-boss.service';

interface EmailJob {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

@Injectable()
export class EmailProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailProcessor.name);
  private workerIds: string[] = [];
  private resend: Resend | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly pgBossService: PgBossService,
  ) {
    this.initializeClient();
  }

  private initializeClient(): void {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';

    if (!apiKey) {
      if (isProd) {
        throw new Error(
          'RESEND_API_KEY is required in production but was not provided. Refusing to start.',
        );
      }
      this.logger.warn(
        'RESEND_API_KEY not configured. Email sends will be skipped (no-op) until set.',
      );
      this.resend = null;
      return;
    }

    try {
      this.resend = new Resend(apiKey);
      this.logger.log('Resend client initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Resend client', error);
      if (isProd) {
        throw error;
      }
      this.resend = null;
    }
  }

  async onModuleInit() {
    await this.pgBossService.ensureQueuesCreated();

    const boss = this.pgBossService.getBoss();

    const verificationId = await boss.work('email-verification', async (job) => {
      await this.processEmailJob(job, 'verification');
    });
    this.workerIds.push(verificationId);

    const passwordResetId = await boss.work('email-password-reset', async (job) => {
      await this.processEmailJob(job, 'password reset');
    });
    this.workerIds.push(passwordResetId);

    const welcomeId = await boss.work('email-welcome', async (job) => {
      await this.processEmailJob(job, 'welcome');
    });
    this.workerIds.push(welcomeId);

    const notificationId = await boss.work('email-notification', async (job) => {
      await this.processEmailJob(job, 'notification');
    });
    this.workerIds.push(notificationId);

    this.logger.log('Email processor workers registered');
  }

  async onModuleDestroy() {
    if (this.workerIds.length === 0) return;
    const boss = this.pgBossService.getBoss();
    await Promise.all(
      this.workerIds.map((id) =>
        boss.offWork(id).catch((err) => this.logger.error('Error stopping email worker:', err)),
      ),
    );
    this.logger.log('All email workers stopped');
  }

  private async processEmailJob(job: unknown, label: string): Promise<void> {
    const jobId = this.getJobId(job);

    if (!job) {
      this.logger.error(`Received undefined ${label} job`);
      return;
    }

    const emailData = this.extractEmailData(job);
    if (!emailData) return;

    if (!emailData.to) {
      this.logger.error(`Job ${jobId} (${label}) has no recipient: ${JSON.stringify(emailData)}`);
      throw new Error('Invalid email data: missing recipient email address');
    }

    this.logger.log(`Processing ${label} email for ${emailData.to} (job ${jobId})`);
    try {
      await this.sendEmail(emailData);
      this.logger.log(`${label} email sent to ${emailData.to} (job ${jobId})`);
    } catch (error) {
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to send ${label} email to ${emailData.to} (job ${jobId})`, stack);
      throw error;
    }
  }

  private extractEmailData(job: unknown): EmailJob | null {
    const actualJob = this.normalizeJob(job);
    const jobId = this.getJobId(actualJob);

    this.logger.debug(`Received email job: ${jobId}`);

    const result =
      this.tryExtractFromData(actualJob, 'to') ??
      this.tryExtractFromArrayData(actualJob, 'to') ??
      this.tryExtractDirectly(actualJob, ['to']);

    if (!result) {
      this.logger.error(`Job ${jobId} has invalid data structure - cannot extract email data`, {
        jobId,
        jobDataType: typeof actualJob.data,
        jobData: JSON.stringify(actualJob.data),
      });
    }
    return result as EmailJob | null;
  }

  private getJobId(job: unknown): string {
    if (!job || typeof job !== 'object') return 'unknown';
    const id = (job as Record<string, unknown>).id;
    return typeof id === 'string' ? id : 'unknown';
  }

  private normalizeJob(job: unknown): Record<string, unknown> {
    if (Array.isArray(job) && job.length > 0) {
      this.logger.warn('Job received as array, extracting first element');
      return job[0] as Record<string, unknown>;
    }
    return (job ?? {}) as Record<string, unknown>;
  }

  private tryExtractFromData(
    job: Record<string, unknown>,
    requiredKey: string,
  ): Record<string, unknown> | null {
    const data = job.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (requiredKey in (data as Record<string, unknown>)) return data as Record<string, unknown>;
    return null;
  }

  private tryExtractFromArrayData(
    job: Record<string, unknown>,
    requiredKey: string,
  ): Record<string, unknown> | null {
    const data = job.data;
    if (!Array.isArray(data) || data.length === 0) return null;

    const first = data[0] as Record<string, unknown>;
    if (
      first?.data &&
      typeof first.data === 'object' &&
      requiredKey in (first.data as Record<string, unknown>)
    ) {
      return first.data as Record<string, unknown>;
    }
    if (first && typeof first === 'object' && requiredKey in first) {
      return first;
    }
    return null;
  }

  private tryExtractDirectly(
    job: Record<string, unknown>,
    requiredKeys: string[],
  ): Record<string, unknown> | null {
    if (requiredKeys.every((k) => k in job)) return job;
    return null;
  }

  private async sendEmail(emailData: EmailJob): Promise<void> {
    if (!emailData.html && !emailData.text) {
      throw new Error('Email must include either html or text content');
    }

    if (!this.resend) {
      const isProd = this.configService.get<string>('NODE_ENV') === 'production';
      if (isProd) {
        throw new Error('Resend client not initialized — cannot send email in production');
      }
      this.logger.warn(
        `Skipping email to ${emailData.to} — Resend client not initialized (RESEND_API_KEY missing).`,
      );
      return;
    }

    const fromEmail = this.configService.get<string>('FROM_EMAIL', 'noreply@devsloop.com');
    const fromName = this.configService.get<string>('FROM_NAME', 'DevsLoop Vault');
    const from = fromName ? `"${fromName.replace(/"/g, '\\"')}" <${fromEmail}>` : fromEmail;

    const payload = {
      from,
      to: emailData.to,
      subject: emailData.subject,
      ...(emailData.html ? { html: emailData.html } : {}),
      ...(emailData.text ? { text: emailData.text } : {}),
    } as Parameters<Resend['emails']['send']>[0];

    const { data, error } = await this.resend.emails.send(payload);

    if (error) {
      this.logger.error(`Resend send failed: ${error.message}`, error);
      throw new Error(`Resend: ${error.message}`);
    }

    this.logger.log(`Email sent successfully. Resend ID: ${data?.id ?? 'unknown'}`);
  }
}
