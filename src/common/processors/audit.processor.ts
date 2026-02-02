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
  private workerStopFunctions: Array<() => Promise<void>> = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly pgBossService: PgBossService,
  ) {}

  async onModuleInit() {
    // Ensure queues are created before registering workers
    await this.pgBossService.ensureQueuesCreated();

    const boss = this.pgBossService.getBoss();

    // Subscribe to audit queue jobs and store stop function for cleanup
    const stopAuditLog = await boss.work('audit-log', async (job) => {
      try {
        if (!job) {
          this.logger.error('Received undefined job');
          return;
        }

        // Handle case where job itself might be an array or malformed
        let actualJob = job;
        if (Array.isArray(job) && job.length > 0) {
          this.logger.warn('Job received as array, extracting first element');
          actualJob = job[0];
        }

        // Log job structure for debugging
        const jobId = actualJob?.id || 'unknown';
        const jobName = actualJob?.name || 'unknown';
        this.logger.debug(
          `Received job: ${JSON.stringify({ id: jobId, name: jobName, hasData: !!actualJob?.data })}`,
        );

        // Robust job data extraction - handle various pg-boss data structures
        let auditData: AuditJob | undefined;

        // Case 1: job.data is a direct object with audit fields
        if (
          actualJob?.data &&
          typeof actualJob.data === 'object' &&
          !Array.isArray(actualJob.data)
        ) {
          // Direct object structure: job.data = { userId, action, ... }
          if ('action' in actualJob.data && 'userId' in actualJob.data) {
            auditData = actualJob.data as AuditJob;
          }
          // Nested structure: job.data = { data: { userId, action, ... } }
          else if (
            'data' in actualJob.data &&
            typeof actualJob.data.data === 'object' &&
            'action' in actualJob.data.data
          ) {
            auditData = actualJob.data.data as AuditJob;
          }
        }
        // Case 2: job.data is an array
        else if (actualJob?.data && Array.isArray(actualJob.data) && actualJob.data.length > 0) {
          const firstItem = actualJob.data[0];
          if (firstItem?.data && typeof firstItem.data === 'object' && 'action' in firstItem.data) {
            auditData = firstItem.data as AuditJob;
          } else if (firstItem && typeof firstItem === 'object' && 'action' in firstItem) {
            auditData = firstItem as AuditJob;
          }
        }
        // Case 3: job itself might be the data (fallback)
        else if (
          actualJob &&
          typeof actualJob === 'object' &&
          'action' in actualJob &&
          'userId' in actualJob
        ) {
          auditData = actualJob as unknown as AuditJob;
        }

        // Validate extracted data
        if (!auditData) {
          this.logger.error(`Job ${jobId} has invalid data structure - cannot extract audit data`, {
            jobId,
            jobName,
            jobDataType: typeof actualJob?.data,
            jobDataIsArray: Array.isArray(actualJob?.data),
            jobData: JSON.stringify(actualJob?.data),
            jobKeys: actualJob ? Object.keys(actualJob) : [],
            actualJobType: typeof actualJob,
            actualJobIsArray: Array.isArray(actualJob),
          });
          return;
        }

        // Validate required fields
        if (
          !auditData.action ||
          !auditData.userId ||
          !auditData.entityType ||
          !auditData.entityId
        ) {
          this.logger.error(`Job ${jobId} has missing required fields`, {
            jobId,
            hasAction: !!auditData.action,
            hasUserId: !!auditData.userId,
            hasEntityType: !!auditData.entityType,
            hasEntityId: !!auditData.entityId,
            auditData: JSON.stringify(auditData),
          });
          return;
        }

        await this.handleAuditLog(auditData);
      } catch (error) {
        this.logger.error(`Job ${(job as any)?.id || 'unknown'} failed:`, error);
        throw error; // Let pg-boss handle retry logic
      }
    });
    this.workerStopFunctions.push(stopAuditLog);

    this.logger.log('Audit processor workers registered');
  }

  async onModuleDestroy() {
    // Gracefully stop all workers
    if (this.workerStopFunctions.length > 0) {
      await Promise.all(
        this.workerStopFunctions.map((stop) =>
          stop().catch((err) => this.logger.error('Error stopping audit worker:', err)),
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
    if (!auditData.userId) {
      throw new Error('Audit log userId is required');
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
