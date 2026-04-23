import {
  Body,
  Controller,
  Delete,
  forwardRef,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireEntity } from '../common/decorators/require-entity.decorator';
import { WorklogReminderService } from '../worklogs/worklog-reminder.service';
import {
  LeavePolicyConfigDto,
  LunchDaysEntryDto,
  LunchDaysMonthParamDto,
  PayrollConfigDto,
  RunWorklogCheckDto,
  SystemUserDto,
  UpdateLeavePolicyConfigDto,
  UpdatePayrollConfigDto,
  UpdateSystemUserEmailDto,
  UpsertLunchDaysDto,
  WorklogNotificationConfigDto,
} from './dto';
import { SystemConfigService } from './system-config.service';

@ApiTags('System Config')
@Controller('system-config')
export class SystemConfigController {
  constructor(
    private readonly service: SystemConfigService,
    @Inject(forwardRef(() => WorklogReminderService))
    private readonly reminderService: WorklogReminderService,
  ) {}

  // ─── Worklog Notifications ───────────────────────────────────

  @Get('worklog-notifications')
  @RequireEntity('system-config')
  @ApiOperation({ summary: 'Get worklog notification settings' })
  getWorklogConfig(): Promise<WorklogNotificationConfigDto> {
    return this.service.getWorklogNotificationConfig();
  }

  @Put('worklog-notifications')
  @RequireEntity('system-config')
  @ApiOperation({ summary: 'Update worklog notification settings' })
  updateWorklogConfig(
    @Body() dto: WorklogNotificationConfigDto,
  ): Promise<WorklogNotificationConfigDto> {
    return this.service.updateWorklogNotificationConfig(dto);
  }

  @Post('worklog-notifications/run')
  @RequireEntity('system-config')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Manually trigger missed-worklog check and send notifications' })
  async runCheck(@Body() dto: RunWorklogCheckDto): Promise<void> {
    await this.reminderService.checkMissedWorklogs(true, dto.month);
  }

  // ─── Payroll Config ──────────────────────────────────────────

  @Get('payroll')
  @RequireEntity('system-config')
  @ApiOperation({ summary: 'Get payroll configuration (authorizer, company info, rates)' })
  getPayrollConfig(): Promise<PayrollConfigDto> {
    return this.service.getPayrollConfig();
  }

  @Put('payroll')
  @RequireEntity('system-config')
  @ApiOperation({ summary: 'Update payroll configuration' })
  updatePayrollConfig(@Body() dto: UpdatePayrollConfigDto): Promise<PayrollConfigDto> {
    return this.service.updatePayrollConfig(dto);
  }

  // ─── Monthly Lunch Days ──────────────────────────────────────

  @Get('lunch-days')
  @RequireEntity('system-config')
  @ApiOperation({ summary: 'List all month-specific lunch day overrides' })
  getLunchDaysList(): Promise<LunchDaysEntryDto[]> {
    return this.service.getLunchDaysList();
  }

  @Put('lunch-days/:yearMonth')
  @RequireEntity('system-config')
  @ApiOperation({ summary: 'Set lunch days for a specific month (YYYY-MM)' })
  upsertLunchDays(
    @Param() { yearMonth }: LunchDaysMonthParamDto,
    @Body() dto: UpsertLunchDaysDto,
  ): Promise<LunchDaysEntryDto> {
    return this.service.upsertLunchDaysForMonth(yearMonth, dto.days);
  }

  @Delete('lunch-days/:yearMonth')
  @RequireEntity('system-config')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove the lunch day override for a specific month' })
  deleteLunchDays(@Param() { yearMonth }: LunchDaysMonthParamDto): Promise<void> {
    return this.service.deleteLunchDaysForMonth(yearMonth);
  }

  // ─── System User ─────────────────────────────────────────────

  @Get('system-user')
  @RequireEntity('system-config')
  @ApiOperation({ summary: 'Get the system (isSystem=true) user info' })
  getSystemUser(): Promise<SystemUserDto> {
    return this.service.getSystemUser();
  }

  @Put('system-user/email')
  @RequireEntity('system-config')
  @ApiOperation({ summary: 'Update the system user email' })
  updateSystemUserEmail(@Body() dto: UpdateSystemUserEmailDto): Promise<SystemUserDto> {
    return this.service.updateSystemUserEmail(dto);
  }

  // ─── Leave Policy Config ─────────────────────────────────────

  @Get('leave-policy')
  @RequireEntity('system-config')
  @ApiOperation({ summary: 'Get leave policy configuration' })
  getLeavePolicyConfig(): Promise<LeavePolicyConfigDto> {
    return this.service.getLeavePolicyConfig();
  }

  @Put('leave-policy')
  @RequireEntity('system-config')
  @ApiOperation({ summary: 'Update leave policy configuration' })
  updateLeavePolicyConfig(@Body() dto: UpdateLeavePolicyConfigDto): Promise<LeavePolicyConfigDto> {
    return this.service.updateLeavePolicyConfig(dto);
  }
}
