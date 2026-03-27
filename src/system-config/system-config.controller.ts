import {
  Body,
  Controller,
  forwardRef,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireEntity } from '../common/decorators/require-entity.decorator';
import { WorklogReminderService } from '../worklogs/worklog-reminder.service';
import { WorklogNotificationConfigDto } from './dto';
import { SystemConfigService } from './system-config.service';

@ApiTags('System Config')
@Controller('system-config')
export class SystemConfigController {
  constructor(
    private readonly service: SystemConfigService,
    @Inject(forwardRef(() => WorklogReminderService))
    private readonly reminderService: WorklogReminderService,
  ) {}

  @Get('worklog-notifications')
  @RequireEntity('user')
  @ApiOperation({ summary: 'Get worklog notification settings' })
  getWorklogConfig(): Promise<WorklogNotificationConfigDto> {
    return this.service.getWorklogNotificationConfig();
  }

  @Put('worklog-notifications')
  @RequireEntity('user')
  @ApiOperation({ summary: 'Update worklog notification settings (Admin only)' })
  updateWorklogConfig(
    @Body() dto: WorklogNotificationConfigDto,
  ): Promise<WorklogNotificationConfigDto> {
    return this.service.updateWorklogNotificationConfig(dto);
  }

  @Post('worklog-notifications/run')
  @RequireEntity('user')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Manually trigger missed-worklog check and send notifications (Admin only)',
  })
  async runCheck(): Promise<void> {
    await this.reminderService.checkMissedWorklogs(true);
  }
}
