import { Module } from '@nestjs/common';
import { WarningsController } from './warnings.controller';
import { WarningsService } from './warnings.service';
import { PrismaModule } from '../prisma';
import { AuditLogService } from '../auth/services/audit-log.service';

@Module({
  imports: [PrismaModule],
  controllers: [WarningsController],
  providers: [WarningsService, AuditLogService],
  exports: [WarningsService],
})
export class WarningsModule {}
