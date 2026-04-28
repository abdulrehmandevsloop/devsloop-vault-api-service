import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma';
import { RequestContextModule } from 'src/common/services/request-context.module';
import { AclModule } from 'src/rbac/rbac.module';
import { WorkflowsController } from './workflows.controller';
import { WorkflowActionsController } from './workflow-actions.controller';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowTemplateService } from './workflow-template.service';
import { WorkflowResolverService } from './workflow-resolver.service';
import { WorkflowApproverService } from './workflow-approver.service';
import { WorkflowSchedulerService } from './workflow-scheduler.service';
import { WorkflowAuditHandler } from './listeners/workflow-audit.handler';
import { WorkflowNotificationHandler } from './listeners/workflow-notification.handler';

@Module({
  imports: [PrismaModule, RequestContextModule, AclModule],
  controllers: [WorkflowsController, WorkflowActionsController],
  providers: [
    WorkflowEngineService,
    WorkflowTemplateService,
    WorkflowResolverService,
    WorkflowApproverService,
    WorkflowSchedulerService,
    WorkflowAuditHandler,
    WorkflowNotificationHandler,
  ],
  exports: [WorkflowEngineService],
})
export class WorkflowsModule {}
