import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { PgBossService } from '../../queue/pg-boss.service';

interface EmailJob {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  templateId?: string;
  dynamicTemplateData?: Record<string, unknown>;
}

@Injectable()
export class EmailProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailProcessor.name);
  private workerIds: string[] = [];
  private transporter: Transporter | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly pgBossService: PgBossService,
  ) {
    // Initialize transporter asynchronously
    this.initializeTransporter().catch((error) => {
      this.logger.error('Failed to initialize transporter in constructor:', error);
    });
  }

  private async initializeTransporter(): Promise<void> {
    try {
      const smtpHost = this.configService.get<string>('SMTP_HOST');
      const smtpPort = parseInt(this.configService.get<string>('SMTP_PORT') || '587', 10);
      const smtpSecureEnv = this.configService.get<string>('SMTP_SECURE', 'false');
      // Parse boolean from string (handle 'true', 'false', '1', '0')
      const smtpSecure =
        smtpSecureEnv === 'true' ||
        smtpSecureEnv === '1' ||
        smtpSecureEnv === 'yes' ||
        smtpPort === 465; // Port 465 always requires secure connection
      const smtpUser = this.configService.get<string>('SMTP_USER');
      const smtpPassword = this.configService.get<string>('SMTP_PASSWORD');

      // If SMTP is not configured, use test account for development
      if (!smtpHost || !smtpUser || !smtpPassword) {
        this.logger.warn(
          'SMTP configuration not found. Using test account. Emails will not be sent in production.',
        );
        // Create test account (only for development)
        try {
          const account = await nodemailer.createTestAccount();
          this.transporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false,
            auth: {
              user: account.user,
              pass: account.pass,
            },
          });
          this.logger.log('Nodemailer test account created successfully');
          this.logger.log(`Test account user: ${account.user}`);
          this.logger.log(`Test account pass: ${account.pass}`);
        } catch (err) {
          this.logger.error('Failed to create test account:', err);
          // Create a dummy transporter that will fail gracefully
          this.transporter = null;
        }
        return;
      }

      // Auto-detect secure setting based on port if not explicitly set
      // Port 465 = SSL/TLS (secure: true)
      // Port 587 = STARTTLS (secure: false)
      const isSecure = smtpPort === 465 ? true : smtpSecure;

      // Create production transporter with SMTP configuration
      const transporterConfig: nodemailer.TransportOptions & {
        host: string;
        port: number;
        secure: boolean;
        auth: { user: string; pass: string };
        tls: { rejectUnauthorized: boolean };
        requireTLS?: boolean;
      } = {
        host: smtpHost,
        port: smtpPort,
        secure: isSecure,
        auth: {
          user: smtpUser,
          pass: smtpPassword,
        },
        // Additional options for better compatibility
        tls: {
          rejectUnauthorized:
            this.configService.get<string>('SMTP_REJECT_UNAUTHORIZED', 'true') !== 'false',
        },
      };

      // For port 587 (STARTTLS), ensure requireTLS is set
      if (smtpPort === 587 && !isSecure) {
        transporterConfig.requireTLS = true;
      }

      this.transporter = nodemailer.createTransport(
        transporterConfig as nodemailer.TransportOptions,
      );

      // Prevent unhandled 'error' events on the underlying TLS socket from crashing Node.js
      // (e.g. ECONNRESET after verify() completes and the server closes the connection)
      this.transporter.on('error', (err: Error) => {
        this.logger.error('SMTP transporter error (non-fatal):', err.message);
      });

      this.logger.log(
        `Nodemailer transporter initialized: ${smtpHost}:${smtpPort} (secure: ${isSecure})`,
      );

      // Verify transporter connection
      try {
        await this.transporter.verify();
        this.logger.log('SMTP connection verified successfully');
      } catch (verifyError) {
        this.logger.warn(
          `SMTP connection verification failed: ${verifyError instanceof Error ? verifyError.message : String(verifyError)}. Transporter will still attempt to send.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to initialize Nodemailer transporter: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.transporter = null;
    }
  }

  async onModuleInit() {
    // Ensure queues are created before registering workers
    await this.pgBossService.ensureQueuesCreated();

    const boss = this.pgBossService.getBoss();

    // Register all email workers using the shared handler pattern
    const verificationId = await boss.work('email-verification', async (job) => {
      await this.processEmailJob(job, 'verification', (data) => this.handleVerificationEmail(data));
    });
    this.workerIds.push(verificationId);

    const passwordResetId = await boss.work('email-password-reset', async (job) => {
      await this.processEmailJob(job, 'password-reset', (data) =>
        this.handlePasswordResetEmail(data),
      );
    });
    this.workerIds.push(passwordResetId);

    const welcomeId = await boss.work('email-welcome', async (job) => {
      await this.processEmailJob(job, 'welcome', (data) => this.handleWelcomeEmail(data));
    });
    this.workerIds.push(welcomeId);

    const notificationId = await boss.work('email-notification', async (job) => {
      await this.processEmailJob(job, 'notification', (data) => this.handleNotificationEmail(data));
    });
    this.workerIds.push(notificationId);

    this.logger.log('Email processor workers registered');
  }

  /**
   * Shared job processing: extracts email data, validates, and delegates to the handler.
   * Reduces duplication across all 4 queue workers.
   */
  private async processEmailJob(
    job: unknown,
    queueLabel: string,
    handler: (data: EmailJob) => Promise<void>,
  ): Promise<void> {
    try {
      if (!job) {
        this.logger.error(`Received undefined ${queueLabel} job`);
        return;
      }

      const emailData = this.extractEmailData(job);
      if (!emailData) return; // error already logged

      await handler(emailData);
    } catch (error) {
      const jobId = this.getJobId(job);
      this.logger.error(`Job ${jobId} (${queueLabel}) failed:`, error);
      throw error; // Let pg-boss handle retry logic
    }
  }

  /**
   * Extract EmailJob data from various pg-boss job structures.
   * Handles direct objects, nested data, arrays, and fallback shapes.
   */
  private extractEmailData(job: unknown): EmailJob | null {
    const actualJob = this.normalizeJob(job);
    const jobId = this.getJobId(actualJob);

    this.logger.debug(`Received email job: ${jobId}`);

    // Try each extraction strategy in priority order
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

  /** Safely extract job ID from unknown job shape */
  private getJobId(job: unknown): string {
    if (!job || typeof job !== 'object') return 'unknown';
    const id = (job as Record<string, unknown>).id;
    return typeof id === 'string' ? id : 'unknown';
  }

  /** Normalize array-wrapped jobs into a plain object */
  private normalizeJob(job: unknown): Record<string, unknown> {
    if (Array.isArray(job) && job.length > 0) {
      this.logger.warn('Job received as array, extracting first element');
      return job[0] as Record<string, unknown>;
    }
    return (job ?? {}) as Record<string, unknown>;
  }

  /** Try to extract data from job.data (direct object) */
  private tryExtractFromData(
    job: Record<string, unknown>,
    requiredKey: string,
  ): Record<string, unknown> | null {
    const data = job.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (requiredKey in (data as Record<string, unknown>)) return data as Record<string, unknown>;
    return null;
  }

  /** Try to extract data from job.data when it's an array */
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

  /** Try to extract data directly from the job object itself */
  private tryExtractDirectly(
    job: Record<string, unknown>,
    requiredKeys: string[],
  ): Record<string, unknown> | null {
    if (requiredKeys.every((k) => k in job)) return job;
    return null;
  }

  async onModuleDestroy() {
    // Gracefully stop all workers via offWork
    if (this.workerIds.length > 0) {
      const boss = this.pgBossService.getBoss();
      await Promise.all(
        this.workerIds.map((id) =>
          boss.offWork(id).catch((err) => this.logger.error('Error stopping email worker:', err)),
        ),
      );
      this.logger.log('All email workers stopped');
    }
  }

  async handleVerificationEmail(emailData: EmailJob) {
    // Validate email data
    if (!emailData || !emailData.to) {
      this.logger.error(`Invalid email data received: ${JSON.stringify(emailData)}`);
      throw new Error('Invalid email data: missing recipient email address');
    }

    this.logger.log(`Processing verification email for ${emailData.to}`);
    try {
      await this.sendEmail(emailData);
      this.logger.log(`Verification email sent successfully to ${emailData.to}`);
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${emailData.to}`, error.stack);
      throw error; // Will trigger retry
    }
  }

  async handlePasswordResetEmail(emailData: EmailJob) {
    // Validate email data
    if (!emailData || !emailData.to) {
      this.logger.error(`Invalid email data received: ${JSON.stringify(emailData)}`);
      throw new Error('Invalid email data: missing recipient email address');
    }

    this.logger.log(`Processing password reset email for ${emailData.to}`);
    try {
      await this.sendEmail(emailData);
      this.logger.log(`Password reset email sent successfully to ${emailData.to}`);
    } catch (error) {
      this.logger.error(`Failed to send password reset email to ${emailData.to}`, error.stack);
      throw error;
    }
  }

  async handleWelcomeEmail(emailData: EmailJob) {
    // Validate email data
    if (!emailData || !emailData.to) {
      this.logger.error(`Invalid email data received: ${JSON.stringify(emailData)}`);
      throw new Error('Invalid email data: missing recipient email address');
    }

    this.logger.log(`Processing welcome email for ${emailData.to}`);
    try {
      await this.sendEmail(emailData);
      this.logger.log(`Welcome email sent successfully to ${emailData.to}`);
    } catch (error) {
      this.logger.error(`Failed to send welcome email to ${emailData.to}`, error.stack);
      throw error;
    }
  }

  async handleNotificationEmail(emailData: EmailJob) {
    // Validate email data
    if (!emailData || !emailData.to) {
      this.logger.error(`Invalid email data received: ${JSON.stringify(emailData)}`);
      throw new Error('Invalid email data: missing recipient email address');
    }

    this.logger.log(`Processing notification email for ${emailData.to}`);
    try {
      await this.sendEmail(emailData);
      this.logger.log(`Notification email sent successfully to ${emailData.to}`);
    } catch (error) {
      this.logger.error(`Failed to send notification email to ${emailData.to}`, error.stack);
      throw error;
    }
  }

  private async sendEmail(emailData: EmailJob): Promise<void> {
    // Validate required fields
    if (!emailData.to) {
      throw new Error('Email recipient (to) is required');
    }
    if (!emailData.subject) {
      throw new Error('Email subject is required');
    }

    if (!this.transporter) {
      throw new Error('Email transporter is not initialized. Please check SMTP configuration.');
    }

    const fromEmail = this.configService.get<string>('FROM_EMAIL', 'noreply@devsloop.com');
    const fromName = this.configService.get<string>('FROM_NAME', 'DevsLoop Vault');
    const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

    // Prepare mail options
    const mailOptions: nodemailer.SendMailOptions = {
      from,
      to: emailData.to,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html,
    };

    // Note: Nodemailer doesn't support templateId like SendGrid
    // If you need templates, use a template engine (e.g., handlebars, ejs) or pre-render HTML
    if (emailData.templateId) {
      this.logger.warn(
        `Template ID ${emailData.templateId} provided but Nodemailer doesn't support templates directly. Use a template engine or pre-render HTML.`,
      );
    }

    try {
      const info: nodemailer.SentMessageInfo = await this.transporter.sendMail(mailOptions);

      // In development with test account, log the preview URL
      if (process.env.NODE_ENV === 'development' && info.messageId) {
        try {
          const testAccountUrl = nodemailer.getTestMessageUrl(info);
          if (testAccountUrl) {
            this.logger.log(`Preview URL: ${testAccountUrl}`);
          }
        } catch (_err) {
          // Ignore errors getting test URL (not a test account)
        }
      }

      this.logger.log(`Email sent successfully. Message ID: ${info.messageId}`);
    } catch (error) {
      this.logger.error('Nodemailer error:', error);
      if (error instanceof Error) {
        this.logger.error(`Error message: ${error.message}`);
        this.logger.error(`Error stack: ${error.stack}`);
      }
      throw error;
    }
  }
}
