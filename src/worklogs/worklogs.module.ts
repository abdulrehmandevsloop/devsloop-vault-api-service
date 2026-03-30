import { Module, forwardRef } from '@nestjs/common';
import { WorklogsController } from './worklogs.controller';
import { WorklogsService } from './worklogs.service';
import { WorklogAiService } from './worklog-ai.service';
import { WorklogComplianceService } from './worklog-compliance.service';
import { WorklogReminderService } from './worklog-reminder.service';
import { GoogleChatService } from './google-chat.service';
import { PrismaModule } from '../prisma';
import { AclModule } from '../rbac';
import { PublicHolidaysModule } from '../public-holidays';
import { SystemConfigModule } from '../system-config';

@Module({
  imports: [PrismaModule, AclModule, PublicHolidaysModule, forwardRef(() => SystemConfigModule)],
  controllers: [WorklogsController],
  providers: [
    WorklogsService,
    WorklogAiService,
    WorklogComplianceService,
    GoogleChatService,
    WorklogReminderService,
  ],
  exports: [WorklogsService, WorklogReminderService],
})
export class WorklogsModule {}
