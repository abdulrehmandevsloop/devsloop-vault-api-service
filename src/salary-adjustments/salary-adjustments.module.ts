import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma';
import { SystemConfigModule } from 'src/system-config';
import { QueueModule } from 'src/queue/queue.module';
import { AclModule } from 'src/rbac/rbac.module';
import { SalaryAdjustmentsController } from './salary-adjustments.controller';
import { SalaryAdjustmentsService } from './salary-adjustments.service';
import { SalaryAdjustmentEmailHandler } from './listeners/salary-adjustment-email.handler';

@Module({
  imports: [PrismaModule, SystemConfigModule, QueueModule, AclModule],
  controllers: [SalaryAdjustmentsController],
  providers: [SalaryAdjustmentsService, SalaryAdjustmentEmailHandler],
  exports: [SalaryAdjustmentsService],
})
export class SalaryAdjustmentsModule {}
