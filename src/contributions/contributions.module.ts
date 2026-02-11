import { Module } from '@nestjs/common';
import { ContributionsController } from './contributions.controller';
import { PublicContributionsController } from './public-contributions.controller';
import { ContributionsService } from './contributions.service';
import { ContributionValidationService, ContentProcessingService } from './services';
import { ContributionEmailHandler, ContributionAuditHandler } from './listeners';
import { QueueModule } from '../queue/queue.module';
import { PrismaModule } from '../prisma';
import { AclModule } from '../rbac';

@Module({
  imports: [PrismaModule, QueueModule, AclModule],
  controllers: [ContributionsController, PublicContributionsController],
  providers: [
    ContributionsService,
    ContributionValidationService,
    ContentProcessingService,
    // Event Handlers
    ContributionEmailHandler,
    ContributionAuditHandler,
  ],
  exports: [ContributionsService],
})
export class ContributionsModule {}
