import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from 'src/app.controller';
import { AppService } from 'src/app.service';
import { PrismaModule } from 'src/prisma';
import { AuthModule } from 'src/auth/auth.module';
import { UsersModule } from 'src/users';
import { ProjectsModule } from 'src/projects';
import { ContributionsModule } from 'src/contributions';
import { ReviewsModule } from 'src/reviews';
import { NotificationsModule } from 'src/notifications';
import { AuditModule } from 'src/audit';
import { HealthModule } from 'src/health/health.module';
import { QueueModule } from 'src/queue/queue.module';
import { AclModule } from 'src/rbac';
import { UserProjectsModule } from 'src/user-projects';
import { WarningsModule } from 'src/warnings';
import { VaultModule } from 'src/vault';
import { AssetsModule } from 'src/assets';
import { LeavesModule } from 'src/leaves';
import { WorklogsModule } from 'src/worklogs';
import { ReimbursementsModule } from 'src/reimbursements/reimbursements.module';
import { LoansModule } from 'src/loans/loans.module';
import { AdvanceSalaryModule } from 'src/advance-salary/advance-salary.module';
import { PublicHolidaysModule } from 'src/public-holidays';
import { SystemConfigModule } from 'src/system-config';
import { PayrollModule } from 'src/payroll';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { EntityAccessGuard } from 'src/common/guards/entity-access.guard';
import { EmailVerifiedGuard } from 'src/common/guards/email-verified.guard';
import { RequestContextModule } from 'src/common/services/request-context.module';
import { validate } from 'src/config/configuration';

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
    WarningsModule,
    VaultModule,
    AssetsModule,
    LeavesModule,
    WorklogsModule,
    ReimbursementsModule,
    LoansModule,
    AdvanceSalaryModule,
    PublicHolidaysModule,
    SystemConfigModule,
    PayrollModule,
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
