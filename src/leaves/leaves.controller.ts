import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { LeavesService } from './leaves.service';
import { CurrentUser, CuidValidationPipe } from '../common';
import {
  CreateLeaveRequestDto,
  LeaveBalanceResponseDto,
  LeaveRequestResponseDto,
  MyLeavesQueryDto,
  PaginatedLeavesResponseDto,
  ReportingManagerResponseDto,
} from './dto';

@ApiTags('Leaves – Employee')
@ApiBearerAuth('JWT-auth')
@Controller('leaves')
export class LeavesController {
  constructor(private readonly leavesService: LeavesService) {}

  @Get('managers')
  @ApiOperation({
    summary: 'Get available reporting managers',
    description:
      'Returns users who have leave-review entity access. Used to populate the reporting manager dropdown on the leave request form.',
  })
  @ApiResponse({ status: 200, type: [ReportingManagerResponseDto] })
  getReportingManagers(): Promise<ReportingManagerResponseDto[]> {
    return this.leavesService.getReportingManagers();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Submit a leave or WFH request',
    description:
      'Any authenticated employee can submit a leave request. Policy rules (advance notice, quotas, eligibility) are enforced automatically.',
  })
  @ApiResponse({ status: 201, type: LeaveRequestResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error or policy violation' })
  submitLeaveRequest(
    @Body() dto: CreateLeaveRequestDto,
    @CurrentUser('id') employeeId: string,
  ): Promise<LeaveRequestResponseDto> {
    return this.leavesService.submitLeaveRequest(employeeId, dto);
  }

  @Get('my')
  @ApiOperation({
    summary: 'List my leave requests',
    description:
      "Returns a paginated list of the authenticated employee's leave requests with optional filters.",
  })
  @ApiResponse({ status: 200, type: PaginatedLeavesResponseDto })
  findMyLeaves(
    @Query() query: MyLeavesQueryDto,
    @CurrentUser('id') employeeId: string,
  ): Promise<PaginatedLeavesResponseDto> {
    return this.leavesService.findMyLeaves(employeeId, query);
  }

  @Get('my/balance')
  @ApiOperation({
    summary: 'Get my leave balance',
    description:
      "Returns the authenticated employee's leave balance for the specified year (defaults to current year).",
  })
  @ApiQuery({
    name: 'year',
    required: false,
    type: Number,
    description: 'Calendar year (default: current year)',
  })
  @ApiResponse({ status: 200, type: LeaveBalanceResponseDto })
  getMyBalance(
    @Query('year') year: string | undefined,
    @CurrentUser('id') employeeId: string,
  ): Promise<LeaveBalanceResponseDto> {
    return this.leavesService.getMyBalance(employeeId, year ? parseInt(year, 10) : undefined);
  }

  @Get('my/:id')
  @ApiOperation({ summary: 'Get a specific leave request by ID' })
  @ApiParam({ name: 'id', description: 'Leave request ID (CUID)' })
  @ApiResponse({ status: 200, type: LeaveRequestResponseDto })
  @ApiResponse({ status: 403, description: 'Not your leave request' })
  @ApiResponse({ status: 404, description: 'Leave request not found' })
  getMyLeave(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') employeeId: string,
  ): Promise<LeaveRequestResponseDto> {
    return this.leavesService.getMyLeave(id, employeeId);
  }

  @Delete('my/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Cancel a pending leave request',
    description:
      'Only the owner can cancel. Request must be in PENDING status (not yet reviewed by Team Lead).',
  })
  @ApiParam({ name: 'id', description: 'Leave request ID (CUID)' })
  @ApiResponse({ status: 204, description: 'Request cancelled successfully' })
  @ApiResponse({ status: 400, description: 'Request cannot be cancelled in its current status' })
  @ApiResponse({ status: 403, description: 'Not your leave request' })
  cancelLeaveRequest(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') employeeId: string,
  ): Promise<void> {
    return this.leavesService.cancelLeaveRequest(id, employeeId);
  }
}
