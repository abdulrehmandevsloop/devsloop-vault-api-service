import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma';
import { QueueModule } from 'src/queue/queue.module';
import { RequestContextModule } from 'src/common/services/request-context.module';
import { ReimbursementsController } from 'src/reimbursements/reimbursements.controller';
import { ReimbursementsReviewController } from 'src/reimbursements/reimbursements-review.controller';
import { ReimbursementsService } from 'src/reimbursements/reimbursements.service';
import { ReimbursementEmailHandler } from 'src/reimbursements/listeners/reimbursement-email.handler';

@Module({
  imports: [PrismaModule, QueueModule, RequestContextModule],
  controllers: [ReimbursementsController, ReimbursementsReviewController],
  providers: [ReimbursementsService, ReimbursementEmailHandler],
  exports: [ReimbursementsService],
})
export class ReimbursementsModule {}
