import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LeavesService } from './leaves.service';
import { CurrentUser, CuidValidationPipe, RequireEntity } from '../common';
import {
  LeaveBalanceResponseDto,
  LeaveRequestResponseDto,
  PaginatedLeavesResponseDto,
  ReviewLeaveRequestDto,
  TeamLeadLeavesQueryDto,
} from './dto';

@ApiTags('Leaves – Team Lead Review')
@ApiBearerAuth('JWT-auth')
@RequireEntity('leave-review')
@Controller('leaves/review')
export class LeavesReviewController {
  constructor(private readonly leavesService: LeavesService) {}

  @Get()
  @ApiOperation({
    summary: 'List leave requests for review',
    description:
      'Returns a paginated list of leave requests assigned to the current team lead. Defaults to PENDING status when no status filter is supplied. Supports filtering by leave type, department, date range, and text search.',
  })
  @ApiResponse({ status: 200, type: PaginatedLeavesResponseDto })
  findLeaves(
    @CurrentUser('id') teamLeadId: string,
    @Query() query: TeamLeadLeavesQueryDto,
  ): Promise<PaginatedLeavesResponseDto> {
    return this.leavesService.findTeamLeadLeaves(teamLeadId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific leave request detail' })
  @ApiParam({ name: 'id', description: 'Leave request ID (CUID)' })
  @ApiResponse({ status: 200, type: LeaveRequestResponseDto })
  @ApiResponse({ status: 404, description: 'Leave request not found' })
  getLeave(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') teamLeadId: string,
  ): Promise<LeaveRequestResponseDto> {
    return this.leavesService.getLeaveForReview(id, teamLeadId);
  }

  @Get('employees/:userId/balance')
  @ApiOperation({
    summary: 'Get employee leave balance (team lead)',
    description:
      'Returns the leave balance for an employee who has at least one leave request assigned to this team lead.',
  })
  @ApiParam({ name: 'userId', description: 'Employee user ID (CUID)' })
  @ApiResponse({ status: 200, type: LeaveBalanceResponseDto })
  getEmployeeBalance(
    @Param('userId', CuidValidationPipe) userId: string,
    @CurrentUser('id') teamLeadId: string,
    @Query('year') year?: string,
  ): Promise<LeaveBalanceResponseDto> {
    return this.leavesService.getEmployeeBalanceForTeamLead(
      userId,
      teamLeadId,
      year ? parseInt(year, 10) : undefined,
    );
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stage-1 approve a leave request',
    description:
      'Approves a PENDING leave request. A mandatory comment must be provided. Request moves to TEAM_LEAD_APPROVED status and is forwarded to HR.',
  })
  @ApiParam({ name: 'id', description: 'Leave request ID (CUID)' })
  @ApiResponse({ status: 200, type: LeaveRequestResponseDto })
  @ApiResponse({ status: 400, description: 'Request is not in PENDING status or invalid body' })
  @ApiResponse({ status: 404, description: 'Leave request not found' })
  approveLeave(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: ReviewLeaveRequestDto,
    @CurrentUser('id') teamLeadId: string,
  ): Promise<LeaveRequestResponseDto> {
    return this.leavesService.teamLeadApprove(id, teamLeadId, dto);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stage-1 reject a leave request',
    description:
      'Rejects a PENDING leave request. A mandatory comment must be provided explaining the rejection reason.',
  })
  @ApiParam({ name: 'id', description: 'Leave request ID (CUID)' })
  @ApiResponse({ status: 200, type: LeaveRequestResponseDto })
  @ApiResponse({ status: 400, description: 'Request is not in PENDING status or invalid body' })
  @ApiResponse({ status: 404, description: 'Leave request not found' })
  rejectLeave(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: ReviewLeaveRequestDto,
    @CurrentUser('id') teamLeadId: string,
  ): Promise<LeaveRequestResponseDto> {
    return this.leavesService.teamLeadReject(id, teamLeadId, dto);
  }
}
