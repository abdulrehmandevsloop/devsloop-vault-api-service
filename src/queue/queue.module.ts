import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailProcessor, AuditProcessor } from '../common/processors';
import { PrismaModule } from '../prisma';
import { PgBossModule } from './pg-boss.module';

@Module({
  imports: [ConfigModule, PrismaModule, PgBossModule],
  providers: [EmailProcessor, AuditProcessor],
  exports: [PgBossModule],
})
export class QueueModule {}
