import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma';
import { RequestContextModule } from 'src/common/services/request-context.module';
import { AclModule } from 'src/rbac/rbac.module';
import { LoansController } from 'src/loans/loans.controller';
import { LoansReviewController } from 'src/loans/loans-review.controller';
import { LoansService } from 'src/loans/loans.service';
import { WorkflowsModule } from 'src/workflows/workflows.module';
import { LoanWorkflowHandler } from 'src/loans/listeners/loan-workflow.handler';
import { SchedulerModule } from 'src/scheduler/scheduler.module';

@Module({
  imports: [PrismaModule, RequestContextModule, AclModule, WorkflowsModule, SchedulerModule],
  controllers: [LoansController, LoansReviewController],
  providers: [LoansService, LoanWorkflowHandler],
  exports: [LoansService],
})
export class LoansModule {}
