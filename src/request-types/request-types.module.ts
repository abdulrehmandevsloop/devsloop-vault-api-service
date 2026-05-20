import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma';
import { WorkflowsModule } from 'src/workflows/workflows.module';
import { RequestTypesController } from './request-types.controller';
import { RequestTypesService } from './request-types.service';
import { DynamicRequestsController } from './dynamic-requests.controller';
import { DynamicRequestsService } from './dynamic-requests.service';
import { ReimbursementsModule } from 'src/reimbursements/reimbursements.module';

@Module({
  imports: [PrismaModule, WorkflowsModule, ReimbursementsModule],
  controllers: [RequestTypesController, DynamicRequestsController],
  providers: [RequestTypesService, DynamicRequestsService],
  exports: [RequestTypesService],
})
export class RequestTypesModule {}
