import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PgBossService } from '../../queue/pg-boss.service';

interface AuditJob {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  changes?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditProcessor.name);
  private workerIds: string[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly pgBossService: PgBossService,
  ) {}

  async onModuleInit() {
    // Ensure queues are created before registering workers
    await this.pgBossService.ensureQueuesCreated();

    const boss = this.pgBossService.getBoss();

    // Subscribe to audit queue jobs and store worker ID for cleanup
    const auditLogId = await boss.work('audit-log', async (job) => {
      try {
        if (!job) {
          this.logger.error('Received undefined job');
          return;
        }

        const auditData = this.extractAuditData(job);
        if (!auditData) return; // error already logged

        // Validate required fields
        if (!this.validateAuditData(auditData)) return;

        await this.handleAuditLog(auditData);
      } catch (error) {
        const jobId = this.getJobId(job);
        this.logger.error(`Job ${jobId} failed:`, error);
        throw error; // Let pg-boss handle retry logic
      }
    });
    this.workerIds.push(auditLogId);

    this.logger.log('Audit processor workers registered');
  }

  /**
   * Extract AuditJob data from various pg-boss job structures.
   * Handles direct objects, nested data, arrays, and fallback shapes.
   */
  private extractAuditData(job: unknown): AuditJob | null {
    const actualJob = this.normalizeJob(job);
    const jobId = this.getJobId(actualJob);

    this.logger.debug(`Received audit job: ${jobId}`);

    // Try each extraction strategy in priority order
    const result =
      this.tryExtractFromData(actualJob, 'action') ??
      this.tryExtractFromArrayData(actualJob, 'action') ??
      this.tryExtractDirectly(actualJob, ['action', 'userId']);

    if (!result) {
      this.logger.error(`Job ${jobId} has invalid data structure - cannot extract audit data`, {
        jobId,
        jobDataType: typeof actualJob.data,
        jobData: JSON.stringify(actualJob.data),
      });
    }
    return result as AuditJob | null;
  }

  /** Validate that all required audit fields are present */
  private validateAuditData(auditData: AuditJob): boolean {
    if (!auditData.action || !auditData.userId || !auditData.entityType || !auditData.entityId) {
      this.logger.error('Audit job has missing required fields', {
        hasAction: !!auditData.action,
        hasUserId: !!auditData.userId,
        hasEntityType: !!auditData.entityType,
        hasEntityId: !!auditData.entityId,
        auditData: JSON.stringify(auditData),
      });
      return false;
    }
    return true;
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

  /** Try to extract data from job.data (direct object or nested data.data) */
  private tryExtractFromData(
    job: Record<string, unknown>,
    requiredKey: string,
  ): Record<string, unknown> | null {
    const data = job.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

    const obj = data as Record<string, unknown>;
    if (requiredKey in obj) return obj;

    // Check nested: job.data.data
    const nested = obj.data;
    if (
      nested &&
      typeof nested === 'object' &&
      requiredKey in (nested as Record<string, unknown>)
    ) {
      return nested as Record<string, unknown>;
    }
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
          boss.offWork(id).catch((err) => this.logger.error('Error stopping audit worker:', err)),
        ),
      );
      this.logger.log('All audit workers stopped');
    }
  }

  async handleAuditLog(auditData: AuditJob) {
    // Validate required fields before processing
    if (!auditData.action) {
      throw new Error('Audit log action is required');
    }
    if (!auditData.userId || auditData.userId === 'system') {
      this.logger.warn(
        `Skipping audit log — invalid userId "${auditData.userId}" for action ${auditData.action}`,
      );
      return;
    }
    if (!auditData.entityType) {
      throw new Error('Audit log entityType is required');
    }
    if (!auditData.entityId) {
      throw new Error('Audit log entityId is required');
    }

    this.logger.log(
      `Processing audit log for user ${auditData.userId}, action: ${auditData.action}`,
    );
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: auditData.userId,
          action: auditData.action,
          entityType: auditData.entityType,
          entityId: auditData.entityId,
          changes: auditData.changes || {},
          ipAddress: auditData.ipAddress,
          userAgent: auditData.userAgent,
        },
      });
      this.logger.log(`Audit log created successfully for action ${auditData.action}`);
    } catch (error) {
      this.logger.error(`Failed to create audit log`, error.stack);
      throw error;
    }
  }
}
