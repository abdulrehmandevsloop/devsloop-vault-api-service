import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users';
import { ProjectsModule } from './projects';
import { ContributionsModule } from './contributions';
import { ReviewsModule } from './reviews';
import { NotificationsModule } from './notifications';
import { AuditModule } from './audit';
import { HealthModule } from './health/health.module';
import { QueueModule } from './queue/queue.module';
import { AclModule } from './rbac';
import { UserProjectsModule } from './user-projects';
import { VaultModule } from './vault';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { EntityAccessGuard } from './common/guards/entity-access.guard';
import { EmailVerifiedGuard } from './common/guards/email-verified.guard';
import { RequestContextModule } from './common/services/request-context.module';
import { validate } from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate,
    }),
    // Schedule Module for Cron Jobs
    ScheduleModule.forRoot(),
    // Event-Driven Architecture
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 10,
      verboseMemoryLeak: true,
      ignoreErrors: false,
    }),
    // In-Memory Caching (replaced Redis cache)
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        ttl: configService.get('CACHE_TTL', 300), // 5 minutes default
        max: 1000, // Maximum number of items in cache
      }),
      inject: [ConfigService],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute
        limit: 100, // 100 requests per minute globally
      },
    ]),
    RequestContextModule,
    PrismaModule,
    QueueModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    ContributionsModule,
    ReviewsModule,
    NotificationsModule,
    AuditModule,
    HealthModule,
    AclModule,
    UserProjectsModule,
    VaultModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // {
    //   provide: APP_GUARD,
    //   useClass: ThrottlerGuard,
    // },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: EntityAccessGuard,
    },
    {
      provide: APP_GUARD,
      useClass: EmailVerifiedGuard,
    },
  ],
})
export class AppModule {}
