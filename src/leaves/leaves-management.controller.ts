import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { LeavesService } from './leaves.service';
import { CurrentUser, CuidValidationPipe, RequireEntity } from '../common';
import {
  HrLeavesQueryDto,
  HrReviewLeaveRequestDto,
  HrStatsResponseDto,
  LeaveBalanceResponseDto,
  LeaveRequestResponseDto,
  PaginatedLeavesResponseDto,
} from './dto';

@ApiTags('Leaves – HR Management')
@ApiBearerAuth('JWT-auth')
@RequireEntity('user')
@Controller('leaves/management')
export class LeavesManagementController {
  constructor(private readonly leavesService: LeavesService) {}

  @Get('stats')
  @ApiOperation({
    summary: 'Get leave statistics summary',
    description:
      'Returns aggregate leave stats for a given year, optionally filtered by department.',
  })
  @ApiQuery({
    name: 'year',
    required: false,
    type: Number,
    description: 'Calendar year (default: current year)',
  })
  @ApiQuery({
    name: 'department',
    required: false,
    type: String,
    description: 'Filter by department name',
  })
  @ApiResponse({ status: 200, type: HrStatsResponseDto })
  getStats(
    @Query('year') year: string | undefined,
    @Query('department') department: string | undefined,
  ): Promise<HrStatsResponseDto> {
    return this.leavesService.getHrStats(year ? parseInt(year, 10) : undefined, department);
  }

  @Get('employees/:userId/balance')
  @ApiOperation({
    summary: "View any employee's leave balance",
    description: "Returns the specified employee's leave balance for the given year.",
  })
  @ApiParam({ name: 'userId', description: 'Employee user ID (CUID)' })
  @ApiQuery({
    name: 'year',
    required: false,
    type: Number,
    description: 'Calendar year (default: current year)',
  })
  @ApiResponse({ status: 200, type: LeaveBalanceResponseDto })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  getEmployeeBalance(
    @Param('userId', CuidValidationPipe) userId: string,
    @Query('year') year: string | undefined,
  ): Promise<LeaveBalanceResponseDto> {
    return this.leavesService.getEmployeeBalance(userId, year ? parseInt(year, 10) : undefined);
  }

  @Get()
  @ApiOperation({
    summary: 'List all leave requests',
    description:
      'Returns a paginated list of all leave requests across the organisation with full filter support.',
  })
  @ApiResponse({ status: 200, type: PaginatedLeavesResponseDto })
  findLeaves(@Query() query: HrLeavesQueryDto): Promise<PaginatedLeavesResponseDto> {
    return this.leavesService.findHrLeaves(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific leave request' })
  @ApiParam({ name: 'id', description: 'Leave request ID (CUID)' })
  @ApiResponse({ status: 200, type: LeaveRequestResponseDto })
  @ApiResponse({ status: 404, description: 'Leave request not found' })
  getLeave(@Param('id', CuidValidationPipe) id: string): Promise<LeaveRequestResponseDto> {
    return this.leavesService.getLeaveForManagement(id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Final HR approval of a leave request',
    description:
      'Approves a request after Team Lead review (TEAM_LEAD_APPROVED or TEAM_LEAD_REJECTED). ' +
      'HR cannot approve PENDING requests — Team Lead review is mandatory first. ' +
      'Leave balance is atomically deducted upon approval. A mandatory HR comment is required.',
  })
  @ApiParam({ name: 'id', description: 'Leave request ID (CUID)' })
  @ApiResponse({ status: 200, type: LeaveRequestResponseDto })
  @ApiResponse({ status: 400, description: 'Request has not yet been reviewed by a Team Lead' })
  @ApiResponse({ status: 404, description: 'Leave request not found' })
  approveLeave(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: HrReviewLeaveRequestDto,
    @CurrentUser('id') hrId: string,
  ): Promise<LeaveRequestResponseDto> {
    return this.leavesService.hrApprove(id, hrId, dto);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Final HR rejection of a leave request',
    description:
      'Rejects a request after Team Lead review (TEAM_LEAD_APPROVED or TEAM_LEAD_REJECTED). ' +
      'HR cannot reject PENDING requests — Team Lead review is mandatory first. ' +
      'No balance deduction occurs. A mandatory HR comment is required.',
  })
  @ApiParam({ name: 'id', description: 'Leave request ID (CUID)' })
  @ApiResponse({ status: 200, type: LeaveRequestResponseDto })
  @ApiResponse({ status: 400, description: 'Request has not yet been reviewed by a Team Lead' })
  @ApiResponse({ status: 404, description: 'Leave request not found' })
  rejectLeave(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: HrReviewLeaveRequestDto,
    @CurrentUser('id') hrId: string,
  ): Promise<LeaveRequestResponseDto> {
    return this.leavesService.hrReject(id, hrId, dto);
  }
}
