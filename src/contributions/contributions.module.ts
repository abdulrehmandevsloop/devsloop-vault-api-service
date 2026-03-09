import { Module } from '@nestjs/common';
import { ContributionsController } from './contributions.controller';
import { PublicContributionsController } from './public-contributions.controller';
import { ContributionsService } from './contributions.service';
import {
  ContributionValidationService,
  ContentProcessingService,
  ContributionSearchService,
} from './services';
import { ContributionEmailHandler, ContributionAuditHandler } from './listeners';
import { QueueModule } from '../queue/queue.module';
import { PrismaModule } from '../prisma';
import { AclModule } from '../rbac';
import { ResponseService } from 'src/common';

@Module({
  imports: [PrismaModule, QueueModule, AclModule],
  controllers: [ContributionsController, PublicContributionsController],
  providers: [
    ContributionsService,
    ContributionValidationService,
    ContentProcessingService,
    ContributionSearchService,
    // Event Handlers
    ContributionEmailHandler,
    ContributionAuditHandler,
    ResponseService,
  ],
  exports: [ContributionsService],
})
export class ContributionsModule {}
