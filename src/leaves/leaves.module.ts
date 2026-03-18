import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { QueueModule } from '../queue/queue.module';
import { RequestContextModule } from '../common/services/request-context.module';
import { LeavesController } from './leaves.controller';
import { LeavesReviewController } from './leaves-review.controller';
import { LeavesManagementController } from './leaves-management.controller';
import { LeavesService } from './leaves.service';
import { LeaveBalanceBulkImportService } from './services/leave-balance-bulk-import.service';
import { LeaveAuditHandler } from './listeners/leave-audit.handler';
import { LeaveEmailHandler } from './listeners/leave-email.handler';

@Module({
  imports: [PrismaModule, QueueModule, RequestContextModule],
  controllers: [LeavesController, LeavesReviewController, LeavesManagementController],
  providers: [LeavesService, LeaveBalanceBulkImportService, LeaveAuditHandler, LeaveEmailHandler],
  exports: [LeavesService],
})
export class LeavesModule {}
