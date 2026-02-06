import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [], // Controller removed - empty placeholder
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
