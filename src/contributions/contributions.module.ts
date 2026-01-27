import { Module } from '@nestjs/common';
import { ContributionsController } from './contributions.controller';
import { ContributionsService } from './contributions.service';
import { ContributionValidationService } from './services';
import { ContributionEmailHandler, ContributionAuditHandler } from './listeners';
import { QueueModule } from '../queue/queue.module';
import { PrismaModule } from '../prisma';

@Module({
  imports: [PrismaModule, QueueModule],
  controllers: [ContributionsController],
  providers: [
    ContributionsService,
    ContributionValidationService,
    // Event Handlers
    ContributionEmailHandler,
    ContributionAuditHandler,
  ],
  exports: [ContributionsService],
})
export class ContributionsModule {}
