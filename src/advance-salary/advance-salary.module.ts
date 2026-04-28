import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma';
import { RequestContextModule } from 'src/common/services/request-context.module';
import { AclModule } from 'src/rbac/rbac.module';
import { AdvanceSalaryController } from 'src/advance-salary/advance-salary.controller';
import { AdvanceSalaryReviewController } from 'src/advance-salary/advance-salary-review.controller';
import { AdvanceSalaryService } from 'src/advance-salary/advance-salary.service';
import { WorkflowsModule } from 'src/workflows/workflows.module';
import { AdvanceSalaryWorkflowHandler } from 'src/advance-salary/listeners/advance-salary-workflow.handler';

@Module({
  imports: [PrismaModule, RequestContextModule, AclModule, WorkflowsModule],
  controllers: [AdvanceSalaryController, AdvanceSalaryReviewController],
  providers: [AdvanceSalaryService, AdvanceSalaryWorkflowHandler],
  exports: [AdvanceSalaryService],
})
export class AdvanceSalaryModule {}
