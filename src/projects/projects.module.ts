import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { ProjectAuditHandler } from './listeners';

@Module({
  imports: [PrismaModule, QueueModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectAuditHandler],
  exports: [ProjectsService],
})
export class ProjectsModule {}
