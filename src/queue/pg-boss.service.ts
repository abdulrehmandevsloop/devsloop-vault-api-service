import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Dynamic import for pg-boss to handle ESM compatibility
let PgBossConstructor: any;

// pg-boss type definitions
interface PgBossInstance {
  start(): Promise<void>;
  stop(): Promise<void>;
  createQueue(queue: string, options?: QueueOptions): Promise<void>;
  send(queue: string, data: any, options?: JobOptions): Promise<string | null>;
  work(queue: string, handler: (job: Job) => Promise<void>): Promise<string>;
  offWork(value: string | { id: string }): Promise<void>;
  on(event: 'error', handler: (error: Error) => void): void;
  on(event: 'monitor-states', handler: (states: any) => void): void;
}

interface Job {
  id: string;
  name: string;
  data: any;
  [key: string]: any;
}

interface QueueOptions {
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  expireInSeconds?: number;
}

interface JobOptions {
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  expireInSeconds?: number;
  startAfter?: Date | string | number;
  singletonKey?: string;
  priority?: number;
}

@Injectable()
export class PgBossService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PgBossService.name);
  private boss: PgBossInstance | null = null;
  private queuesCreated = false;
  private readonly requiredQueues = [
    'email-verification',
    'email-password-reset',
    'email-welcome',
    'email-notification',
    'audit-log',
  ];

  // Centralized queue configuration (initialized in constructor)
  private queueOptions!: QueueOptions;

  // Centralized default job options (initialized in constructor)
  private defaultJobOptions!: JobOptions;

  constructor(private readonly configService: ConfigService) {
    // Helper function to safely get integer config values
    const getIntConfig = (key: string, defaultValue: number): number => {
      const value = this.configService.get<string | number>(key);
      if (value === undefined || value === null) {
        return defaultValue;
      }
      const parsed = typeof value === 'string' ? parseInt(value, 10) : value;
      return isNaN(parsed) || parsed < 0 ? defaultValue : parsed;
    };

    // Initialize queue configuration
    this.queueOptions = {
      retryLimit: getIntConfig('QUEUE_RETRY_LIMIT', 1),
      retryDelay: getIntConfig('QUEUE_RETRY_DELAY', 2000),
      retryBackoff: true,
      expireInSeconds: getIntConfig('QUEUE_EXPIRE_SECONDS', 3600), // 1 hour
    };

    // Initialize default job options
    this.defaultJobOptions = {
      retryLimit: getIntConfig('JOB_RETRY_LIMIT', 1),
      retryDelay: getIntConfig('JOB_RETRY_DELAY', 2000),
      retryBackoff: true,
      expireInSeconds: getIntConfig('JOB_EXPIRE_SECONDS', 3600),
    };
  }

  async onModuleInit() {
    // Dynamic import pg-boss
    if (!PgBossConstructor) {
      const pgBossModule = await import('pg-boss');

      // pg-boss v10 uses default export, v12+ uses named export
      // Try default export first (v10), then fall back to named export (v12+)
      const PgBossClass = (pgBossModule as any).default || (pgBossModule as any).PgBoss;

      // Check if it's a function/class that can be instantiated
      if (typeof PgBossClass !== 'function') {
        this.logger.error('Failed to import PgBoss constructor', {
          hasPgBoss: 'PgBoss' in pgBossModule,
          hasDefault: 'default' in pgBossModule,
          moduleKeys: Object.keys(pgBossModule),
          type: typeof PgBossClass,
        });
        throw new Error(
          'Failed to import PgBoss constructor. pg-boss v10 uses default export, v12+ uses named export.',
        );
      }

      PgBossConstructor = PgBossClass;
    }

    const databaseUrl = this.configService.get<string>('DATABASE_URL');

    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not configured');
    }

    // Create instance - pg-boss constructor accepts options object
    this.boss = new PgBossConstructor({
      connectionString: databaseUrl,
      schema: 'pgboss', // Schema for pg-boss tables
    }) as PgBossInstance;

    await this.boss.start();
    this.logger.log('PgBoss started successfully');

    // Add error event listeners for monitoring
    this.boss.on('error', (error: Error) => {
      this.logger.error('PgBoss error:', error);

      // Check for schema-related errors and provide helpful guidance
      const errorMessage = error.message || String(error);
      if (errorMessage.includes('does not exist') || errorMessage.includes('column')) {
        this.logger.error(
          'PgBoss schema error detected. This usually means the pg-boss schema is outdated or corrupted.',
        );
        this.logger.error('To fix this, drop and recreate the pg-boss schema:');
        this.logger.error('  DROP SCHEMA IF EXISTS pgboss CASCADE;');
        this.logger.error(
          '  Then restart the application to let pg-boss recreate the schema automatically.',
        );
      }
      // Error is logged, could also emit to monitoring service here
    });

    // Monitor queue states for debugging (optional, can be disabled in production)
    if (this.configService.get('NODE_ENV') === 'development') {
      this.boss.on('monitor-states', (states: any) => {
        this.logger.debug('Queue states:', states);
      });
    }

    // Create all required queues before workers can process them
    await this.ensureQueuesCreated();
  }

  /**
   * Ensure all required queues are created
   * This must be called before sending jobs or registering workers
   */
  async ensureQueuesCreated(): Promise<void> {
    if (this.queuesCreated) {
      return;
    }

    if (!this.boss) {
      throw new Error('PgBoss is not initialized. Cannot create queues before boss is started.');
    }

    for (const queueName of this.requiredQueues) {
      try {
        // Create queue with explicit retry configuration
        await this.boss.createQueue(queueName, this.queueOptions);
        this.logger.log(`Queue created: ${queueName} with retry config`);
      } catch (error) {
        // Queue might already exist, which is fine
        const errorMessage =
          error && typeof error === 'object' && 'message' in error
            ? String(error.message)
            : String(error);
        if (!errorMessage.includes('already exists')) {
          this.logger.warn(`Queue ${queueName} creation warning:`, error);
        }
      }
    }

    this.queuesCreated = true;
    this.logger.log('All required queues created');
  }

  async onModuleDestroy() {
    if (this.boss) {
      await this.boss.stop();
      this.logger.log('PgBoss stopped');
    }
  }

  getBoss(): PgBossInstance {
    if (!this.boss) {
      throw new Error(
        'PgBoss is not initialized. Make sure PgBossService is properly initialized.',
      );
    }
    return this.boss;
  }

  /**
   * Send a job to a queue, ensuring the queue exists first
   * Uses centralized default job options with override capability
   */
  async sendToQueue(
    queueName: string,
    data: any,
    options?: Partial<JobOptions>,
  ): Promise<string | null> {
    if (!this.boss) {
      throw new Error('PgBoss is not initialized');
    }

    // Ensure queue exists before sending
    await this.ensureQueuesCreated();

    // Helper function to validate and sanitize integer options
    const sanitizeIntOption = (value: number | undefined | null, defaultValue: number): number => {
      if (value === undefined || value === null) {
        return defaultValue;
      }
      const parsed = typeof value === 'string' ? parseInt(value, 10) : value;
      return isNaN(parsed) || parsed < 0 ? defaultValue : parsed;
    };

    // Merge default options with provided options and validate
    const jobOptions: JobOptions = {
      ...this.defaultJobOptions,
      ...options,
      // Ensure retryDelay is always a valid integer >= 0
      retryDelay: sanitizeIntOption(options?.retryDelay, this.defaultJobOptions.retryDelay ?? 2000),
      // Ensure retryLimit is always a valid integer >= 0
      retryLimit: sanitizeIntOption(options?.retryLimit, this.defaultJobOptions.retryLimit ?? 3),
      // Ensure expireInSeconds is always a valid integer >= 0
      expireInSeconds: sanitizeIntOption(
        options?.expireInSeconds,
        this.defaultJobOptions.expireInSeconds ?? 3600,
      ),
    };

    return this.boss.send(queueName, data, jobOptions);
  }

  /**
   * Get default job options (useful for handlers that need to customize)
   */
  getDefaultJobOptions(): Readonly<JobOptions> {
    return { ...this.defaultJobOptions };
  }

  // Helper method to get a queue by name
  getQueue(_queueName: string): PgBossInstance {
    if (!this.boss) {
      throw new Error(
        'PgBoss is not initialized. Make sure PgBossService is properly initialized.',
      );
    }
    return this.boss;
  }
}
