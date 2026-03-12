import { Module } from '@nestjs/common';
import { WorklogsController } from './worklogs.controller';
import { WorklogsService } from './worklogs.service';
import { WorklogAiService } from './worklog-ai.service';
import { WorklogComplianceService } from './worklog-compliance.service';
import { GoogleChatService } from './google-chat.service';
import { PrismaModule } from '../prisma';
import { AclModule } from '../rbac';

@Module({
  imports: [PrismaModule, AclModule],
  controllers: [WorklogsController],
  providers: [WorklogsService, WorklogAiService, WorklogComplianceService, GoogleChatService],
  exports: [WorklogsService],
})
export class WorklogsModule {}
