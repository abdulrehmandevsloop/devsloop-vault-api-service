import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma';
import { QueueModule } from 'src/queue/queue.module';
import { RequestContextModule } from 'src/common/services/request-context.module';
import { AclModule } from 'src/rbac/rbac.module';
import { ReimbursementsController } from 'src/reimbursements/reimbursements.controller';
import { ReimbursementsReviewController } from 'src/reimbursements/reimbursements-review.controller';
import { ReimbursementsService } from 'src/reimbursements/reimbursements.service';
import { WorkflowsModule } from 'src/workflows/workflows.module';
import { ReimbursementWorkflowHandler } from 'src/reimbursements/listeners/reimbursement-workflow.handler';
import { ReimbursementInstallmentsService } from 'src/reimbursements/reimbursement-installments.service';
import { ReimbursementEmailHandler } from 'src/reimbursements/listeners/reimbursement-email.handler';

@Module({
  imports: [PrismaModule, QueueModule, RequestContextModule, AclModule, WorkflowsModule],
  controllers: [ReimbursementsController, ReimbursementsReviewController],
  providers: [
    ReimbursementsService,
    ReimbursementInstallmentsService,
    ReimbursementEmailHandler,
    ReimbursementWorkflowHandler,
  ],
  exports: [ReimbursementsService, ReimbursementInstallmentsService],
})
export class ReimbursementsModule {}
