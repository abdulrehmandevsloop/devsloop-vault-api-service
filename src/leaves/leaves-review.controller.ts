// =============================================================================
// LEGACY — kept only for reference.
//
// Team-lead review controller for the old three-page Leaves module. Approval
// and rejection now flow through the dynamic-requests workflow engine
// (`/workflows/...` endpoints). The corresponding frontend page
// (`app/(dashboard)/leave-review/page.tsx`) has been commented out. Endpoints
// here are no longer driven by the UI; do not extend them.
// =============================================================================

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
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
import { WorkflowEngineService } from 'src/workflows/workflow-engine.service';

@ApiTags('Leaves – Team Lead Review')
@ApiBearerAuth('JWT-auth')
@RequireEntity('leave-review')
@Controller('leaves/review')
export class LeavesReviewController {
  constructor(
    private readonly leavesService: LeavesService,
    private readonly workflowEngine: WorkflowEngineService,
  ) {}

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
  @ApiOperation({ summary: 'Approve a leave request via workflow engine' })
  @ApiParam({ name: 'id', description: 'Leave request ID (CUID)' })
  @ApiResponse({ status: 200 })
  async approveLeave(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: ReviewLeaveRequestDto,
    @CurrentUser('id') teamLeadId: string,
  ) {
    const instance = await this.workflowEngine.findInstanceByRequest('LEAVE', id);
    if (!instance)
      throw new NotFoundException('No active workflow instance found for this leave request');
    return this.workflowEngine.resolveStep(
      instance.id,
      instance.currentStepOrder,
      teamLeadId,
      'APPROVED',
      dto.comment,
    );
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a leave request via workflow engine' })
  @ApiParam({ name: 'id', description: 'Leave request ID (CUID)' })
  @ApiResponse({ status: 200 })
  async rejectLeave(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: ReviewLeaveRequestDto,
    @CurrentUser('id') teamLeadId: string,
  ) {
    const instance = await this.workflowEngine.findInstanceByRequest('LEAVE', id);
    if (!instance)
      throw new NotFoundException('No active workflow instance found for this leave request');
    return this.workflowEngine.resolveStep(
      instance.id,
      instance.currentStepOrder,
      teamLeadId,
      'REJECTED',
      dto.comment,
    );
  }
}
