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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
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
@ApiBearerAuth('JWT-auth')
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
  @ApiResponse({ status: 200, description: 'Worklog notification configuration' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  getWorklogConfig(): Promise<WorklogNotificationConfigDto> {
    return this.service.getWorklogNotificationConfig();
  }

  @Put('worklog-notifications')
  @RequireEntity('system-config')
  @ApiOperation({ summary: 'Update worklog notification settings' })
  @ApiResponse({ status: 200, description: 'Updated worklog notification configuration' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  updateWorklogConfig(
    @Body() dto: WorklogNotificationConfigDto,
  ): Promise<WorklogNotificationConfigDto> {
    return this.service.updateWorklogNotificationConfig(dto);
  }

  @Post('worklog-notifications/run')
  @RequireEntity('system-config')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Manually trigger missed-worklog check and send notifications' })
  @ApiResponse({ status: 204, description: 'Check triggered' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async runCheck(@Body() dto: RunWorklogCheckDto): Promise<void> {
    await this.reminderService.checkMissedWorklogs(true, dto.month);
  }

  // ─── Payroll Config ──────────────────────────────────────────

  @Get('payroll')
  @RequireEntity('system-config', 'payroll')
  @ApiOperation({ summary: 'Get payroll configuration (authorizer, company info, rates)' })
  @ApiResponse({ status: 200, description: 'Payroll configuration' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  getPayrollConfig(): Promise<PayrollConfigDto> {
    return this.service.getPayrollConfig();
  }

  @Put('payroll')
  @RequireEntity('system-config')
  @ApiOperation({ summary: 'Update payroll configuration' })
  @ApiResponse({ status: 200, description: 'Updated payroll configuration' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  updatePayrollConfig(@Body() dto: UpdatePayrollConfigDto): Promise<PayrollConfigDto> {
    return this.service.updatePayrollConfig(dto);
  }

  // ─── Monthly Lunch Days ──────────────────────────────────────

  @Get('lunch-days')
  @RequireEntity('system-config', 'payroll')
  @ApiOperation({ summary: 'List all month-specific lunch day overrides' })
  @ApiResponse({ status: 200, description: 'Array of month lunch day overrides' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  getLunchDaysList(): Promise<LunchDaysEntryDto[]> {
    return this.service.getLunchDaysList();
  }

  @Put('lunch-days/:yearMonth')
  @RequireEntity('system-config')
  @ApiOperation({ summary: 'Set lunch days for a specific month (YYYY-MM)' })
  @ApiParam({ name: 'yearMonth', description: 'Month in YYYY-MM format', example: '2026-04' })
  @ApiResponse({ status: 200, description: 'Updated lunch day override' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
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
  @ApiParam({ name: 'yearMonth', description: 'Month in YYYY-MM format', example: '2026-04' })
  @ApiResponse({ status: 204, description: 'Override removed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'No override found for this month' })
  deleteLunchDays(@Param() { yearMonth }: LunchDaysMonthParamDto): Promise<void> {
    return this.service.deleteLunchDaysForMonth(yearMonth);
  }

  // ─── System User ─────────────────────────────────────────────

  @Get('system-user')
  @RequireEntity('system-config')
  @ApiOperation({ summary: 'Get the system (isSystem=true) user info' })
  @ApiResponse({ status: 200, description: 'System user details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  getSystemUser(): Promise<SystemUserDto> {
    return this.service.getSystemUser();
  }

  @Put('system-user/email')
  @RequireEntity('system-config')
  @ApiOperation({ summary: 'Update the system user email' })
  @ApiResponse({ status: 200, description: 'Updated system user' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  updateSystemUserEmail(@Body() dto: UpdateSystemUserEmailDto): Promise<SystemUserDto> {
    return this.service.updateSystemUserEmail(dto);
  }

  // ─── Leave Policy Config ─────────────────────────────────────

  @Get('leave-policy')
  @RequireEntity('system-config')
  @ApiOperation({ summary: 'Get leave policy configuration' })
  @ApiResponse({ status: 200, description: 'Leave policy configuration' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  getLeavePolicyConfig(): Promise<LeavePolicyConfigDto> {
    return this.service.getLeavePolicyConfig();
  }

  @Put('leave-policy')
  @RequireEntity('system-config')
  @ApiOperation({ summary: 'Update leave policy configuration' })
  @ApiResponse({ status: 200, description: 'Updated leave policy configuration' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  updateLeavePolicyConfig(@Body() dto: UpdateLeavePolicyConfigDto): Promise<LeavePolicyConfigDto> {
    return this.service.updateLeavePolicyConfig(dto);
  }
}
