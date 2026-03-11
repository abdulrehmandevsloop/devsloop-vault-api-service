import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { WorklogsService } from './worklogs.service';
import {
  CreateWorklogDto,
  UpdateWorklogDto,
  WorklogResponseDto,
  WorklogMonthQueryDto,
  ProjectWorklogsQueryDto,
  ExportWorklogQueryDto,
  ProjectsComplianceQueryDto,
  UserWorklogsQueryDto,
  ProjectComplianceQueryDto,
  ComplianceSummaryDto,
  ProjectComplianceResponseDto,
} from './dto';
import { CurrentUser, CuidValidationPipe, RequireEntity } from '../common';

@ApiTags('Worklogs')
@ApiBearerAuth('JWT-auth')
@RequireEntity('worklog', 'worklog-team')
@Controller('worklogs')
export class WorklogsController {
  constructor(private readonly worklogsService: WorklogsService) {}

  // ── POST /worklogs ─────────────────────────────────────────────────────────
  @Post()
  @RequireEntity('worklog')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Submit daily worklog',
    description:
      'Submit a worklog for a specific date. One submission per user per day. Future dates are rejected. AI evaluates quality and sets status.',
  })
  @ApiResponse({ status: 201, type: WorklogResponseDto })
  @ApiResponse({ status: 400, description: 'Future date or invalid input' })
  @ApiResponse({ status: 403, description: 'User not assigned to project' })
  @ApiResponse({ status: 409, description: 'Worklog already submitted for this date' })
  async create(
    @Body() dto: CreateWorklogDto,
    @CurrentUser('id') userId: string,
  ): Promise<WorklogResponseDto> {
    return this.worklogsService.create(userId, dto);
  }

  // ── GET /worklogs/my ──────────────────────────────────────────────────────
  @Get('my')
  @RequireEntity('worklog')
  @ApiOperation({ summary: 'Get own worklogs for a month' })
  @ApiQuery({ name: 'month', required: true, example: '2025-02' })
  @ApiResponse({ status: 200, type: [WorklogResponseDto] })
  async getMyLogs(
    @Query() query: WorklogMonthQueryDto,
    @CurrentUser('id') userId: string,
  ): Promise<WorklogResponseDto[]> {
    return this.worklogsService.findMyLogs(userId, query.month);
  }

  // ── GET /worklogs/compliance/me ────────────────────────────────────────────
  @Get('compliance/me')
  @RequireEntity('worklog')
  @ApiOperation({ summary: 'Get own compliance summary for a month' })
  @ApiQuery({ name: 'month', required: true, example: '2025-02' })
  @ApiResponse({ status: 200, type: ComplianceSummaryDto })
  async getMyCompliance(
    @Query() query: WorklogMonthQueryDto,
    @CurrentUser('id') userId: string,
  ): Promise<ComplianceSummaryDto> {
    return this.worklogsService.getMyCompliance(userId, query.month);
  }

  // ── GET /worklogs/projects/compliance ───────────────────────────────────────
  @Get('projects/compliance')
  @ApiOperation({
    summary: 'Get compliance for multiple projects (MANAGER/QA/ADMIN)',
    description:
      'Returns compliance data for each requested project. If projectIds is omitted, returns compliance for all projects the current user has access to.',
  })
  @ApiQuery({ name: 'month', required: true, example: '2025-02' })
  @ApiQuery({
    name: 'projectIds',
    required: false,
    description: 'Comma-separated project IDs',
    example: 'clx...,clx...',
  })
  @ApiResponse({ status: 200, description: 'Array of project compliance responses' })
  async getProjectsCompliance(
    @Query() query: ProjectsComplianceQueryDto,
    @CurrentUser('id') requesterId: string,
  ): Promise<ProjectComplianceResponseDto[]> {
    return this.worklogsService.getProjectsCompliance(requesterId, query.month, query.projectIds);
  }

  // ── GET /worklogs/user/:userId ─────────────────────────────────────────────
  @Get('user/:userId')
  @ApiOperation({
    summary: 'Get worklogs for a user across multiple projects (MANAGER/QA/ADMIN)',
    description:
      'Returns worklogs for the given user in the given projects for the month. Used for team member worklog view.',
  })
  @ApiParam({ name: 'userId', description: 'User CUID' })
  @ApiQuery({ name: 'month', required: true, example: '2025-02' })
  @ApiQuery({
    name: 'projectIds',
    required: false,
    description:
      'Comma-separated project IDs. If omitted, uses all projects the requester has access to.',
    example: 'clx...,clx...',
  })
  @ApiResponse({ status: 200, type: [WorklogResponseDto] })
  async getUserWorklogs(
    @Param('userId', CuidValidationPipe) userId: string,
    @Query() query: UserWorklogsQueryDto,
    @CurrentUser('id') requesterId: string,
  ): Promise<WorklogResponseDto[]> {
    return this.worklogsService.findUserWorklogsForProjects(
      requesterId,
      userId,
      query.month,
      query.projectIds,
    );
  }

  // ── GET /worklogs/project/:projectId ──────────────────────────────────────
  @Get('project/:projectId')
  // @Roles('MANAGER', 'QA', 'ADMIN')
  @ApiOperation({ summary: 'Get project worklogs (MANAGER/QA/ADMIN)' })
  @ApiParam({ name: 'projectId', description: 'Project CUID' })
  @ApiQuery({ name: 'month', required: true, example: '2025-02' })
  @ApiQuery({ name: 'userId', required: false, description: 'Filter by specific user' })
  @ApiResponse({ status: 200, type: [WorklogResponseDto] })
  async getProjectLogs(
    @Param('projectId', CuidValidationPipe) projectId: string,
    @Query() query: ProjectWorklogsQueryDto,
    @CurrentUser('id') requesterId: string,
  ): Promise<WorklogResponseDto[]> {
    return this.worklogsService.findProjectLogs(projectId, query.month, requesterId, query.userId);
  }

  // ── GET /worklogs/project/:projectId/compliance ───────────────────────────
  @Get('project/:projectId/compliance')
  // @Roles('MANAGER', 'QA', 'ADMIN')
  @ApiOperation({ summary: 'Get per-user compliance for a project (MANAGER/QA/ADMIN)' })
  @ApiParam({ name: 'projectId', description: 'Project CUID' })
  @ApiQuery({ name: 'month', required: true, example: '2025-02' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({ status: 200, type: ProjectComplianceResponseDto })
  async getProjectCompliance(
    @Param('projectId', CuidValidationPipe) projectId: string,
    @Query() query: ProjectComplianceQueryDto,
    @CurrentUser('id') requesterId: string,
  ): Promise<ProjectComplianceResponseDto> {
    return this.worklogsService.getProjectCompliance(
      projectId,
      query.month,
      requesterId,
      query.page ?? 1,
      query.limit ?? 10,
    );
  }

  // ── GET /worklogs/my-projects ─────────────────────────────────────────────
  @Get('my-projects')
  @ApiOperation({ summary: "Get current user's assigned projects" })
  @ApiResponse({ status: 200, description: 'List of projects the current user is assigned to' })
  async getMyProjects(@CurrentUser('id') userId: string): Promise<
    {
      id: string;
      assignedAt: Date;
      assignedBy: string | null;
      project: { id: string; name: string; clientName: string };
    }[]
  > {
    return this.worklogsService.getMyProjects(userId);
  }

  // ── GET /worklogs/export (must be before :id so "export" is not matched as id)
  @Get('export')
  @ApiOperation({
    summary: 'Export worklogs as CSV',
    description:
      'Export worklogs as CSV. projectScope=present: user worklogs for selected (assigned) projects; projectId optional. projectScope=old: worklogs from projects the user is not currently assigned to.',
  })
  @ApiQuery({ name: 'userId', required: false, example: 'clx...' })
  @ApiQuery({ name: 'month', required: true, example: '2025-02' })
  @ApiQuery({ name: 'projectId', required: false, example: 'clx...' })
  @ApiQuery({ name: 'projectScope', required: false, enum: ['present', 'old'] })
  async exportCsv(
    @Query() query: ExportWorklogQueryDto,
    @CurrentUser('id') requesterId: string,
    @Res() res: Response,
  ): Promise<void> {
    const projectScope = query.projectScope ?? 'present';
    const result = await this.worklogsService.exportCsv(requesterId, {
      month: query.month,
      userId: query.userId,
      projectId: query.projectId,
      projectScope,
    });
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
    });
    res.send(result.csv);
  }

  // ── GET /worklogs/:id ─────────────────────────────────────────────────────
  @Get(':id')
  @ApiOperation({ summary: 'Get single worklog by ID' })
  @ApiParam({ name: 'id', description: 'Worklog CUID' })
  @ApiResponse({ status: 200, type: WorklogResponseDto })
  @ApiResponse({ status: 403, description: 'Not owner or not manager of this project' })
  @ApiResponse({ status: 404, description: 'Worklog not found' })
  async getById(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') requesterId: string,
  ): Promise<WorklogResponseDto> {
    return this.worklogsService.findById(id, requesterId);
  }

  // ── PATCH /worklogs/:id ───────────────────────────────────────────────────
  @Patch(':id')
  @RequireEntity('worklog')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update own worklog content (re-runs AI scoring)' })
  @ApiParam({ name: 'id', description: 'Worklog CUID' })
  @ApiResponse({ status: 200, type: WorklogResponseDto })
  @ApiResponse({ status: 400, description: 'Leave entries cannot be edited' })
  @ApiResponse({ status: 403, description: 'Not the owner of this worklog' })
  @ApiResponse({ status: 404, description: 'Worklog not found' })
  async update(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: UpdateWorklogDto,
    @CurrentUser('id') userId: string,
  ): Promise<WorklogResponseDto> {
    return this.worklogsService.update(id, userId, dto);
  }

  // ── DELETE /worklogs/:id ──────────────────────────────────────────────────
  @Delete(':id')
  @RequireEntity('worklog')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete own worklog' })
  @ApiParam({ name: 'id', description: 'Worklog CUID' })
  @ApiResponse({ status: 204, description: 'Worklog deleted' })
  @ApiResponse({ status: 403, description: 'Not the owner of this worklog' })
  @ApiResponse({ status: 404, description: 'Worklog not found' })
  async remove(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.worklogsService.delete(id, userId);
  }
}
