import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ConfidentialityLevel } from '@prisma/client';
import { ProjectsService } from './projects.service';
import {
  CreateProjectDto,
  UpdateProjectDto,
  ProjectResponseDto,
  ProjectDropdownDto,
  AssignUsersToProjectDto,
  ProjectUsersResponseDto,
  ProjectUsersQueryDto,
  CreateMilestoneDto,
  UpdateMilestoneDto,
  MilestoneResponseDto,
  CreateSprintDto,
  UpdateSprintDto,
  SprintResponseDto,
  ProjectHubResponseDto,
} from './dto';
import {
  ApiResponseDto,
  RequireEntity,
  CuidValidationPipe,
  CurrentUser,
  ResponseService,
} from 'src/common';
import { AclService } from 'src/rbac/rbac.service';

@ApiTags('Admin - Projects')
@ApiBearerAuth('JWT-auth')
@Controller('admin/projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly responseService: ResponseService,
    private readonly aclService: AclService,
  ) {}

  @Post()
  @RequireEntity('project')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new project',
    description:
      'Admin only. Create a new project with client name, domain, dates, tech stack, and confidentiality level.',
  })
  @ApiResponse({
    status: 201,
    description: 'Project created successfully',
    type: ProjectResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation error or invalid date range' })
  @ApiResponse({ status: 409, description: 'Project with this name already exists' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  async create(
    @Body() createProjectDto: CreateProjectDto,
    @CurrentUser('id') adminId: string,
  ): Promise<ProjectResponseDto> {
    return this.projectsService.create(createProjectDto, adminId);
  }

  @Get()
  @RequireEntity('project', 'user')
  @ApiOperation({
    summary: 'Get all projects',
    description:
      'Users with "user" entity see all projects; users with only "project" entity see their managed projects. Supports optional filters (search, client name, domain, confidentiality level).',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search in name, client name, domain, or description',
  })
  @ApiQuery({ name: 'clientName', required: false, description: 'Filter by client name' })
  @ApiQuery({ name: 'domain', required: false, description: 'Filter by domain/industry' })
  @ApiQuery({
    name: 'confidentialityLevel',
    required: false,
    enum: ConfidentialityLevel,
    description: 'Filter by confidentiality level',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 10)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of projects',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/ProjectResponseDto' },
        },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' },
        totalPages: { type: 'number' },
        hasNextPage: { type: 'boolean' },
        hasPreviousPage: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  async findAll(
    @CurrentUser('id') userId: string,
    @Query('search') search?: string,
    @Query('clientName') clientName?: string,
    @Query('domain') domain?: string,
    @Query('confidentialityLevel') confidentialityLevel?: ConfidentialityLevel,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('bookmarked') bookmarked?: string,
    @Query('sortBy') sortBy?: string,
    @Query('pinBookmarks') pinBookmarks?: string,
    @Query('unassigned') unassigned?: string,
  ) {
    const hasUserEntity = await this.aclService.userHasEntityAccess(userId, 'user');
    const validSortBy = ['createdAt', 'startDate', 'endDate', 'activity'].includes(sortBy ?? '')
      ? (sortBy as 'createdAt' | 'startDate' | 'endDate' | 'activity')
      : undefined;
    return this.projectsService.findAll({
      search,
      clientName,
      domain,
      confidentialityLevel,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      bookmarked: bookmarked === 'true',
      userId,
      projectEntityOnly: !hasUserEntity,
      sortBy: validSortBy,
      pinBookmarks: pinBookmarks === 'true',
      unassigned: hasUserEntity && unassigned === 'true',
    });
  }

  @Get('list')
  @RequireEntity('project', 'contribution', 'vault')
  @ApiOperation({
    summary: 'Get all projects for dropdown',
    description:
      'Get a list of all projects with only ID and name for dropdown selection. Available to users with project entity access (Admin or users with project role). Pass userId to include assigned status for that user.',
  })
  @ApiQuery({ name: 'userId', required: false, description: 'User ID to check assignment status' })
  @ApiResponse({
    status: 200,
    description: 'List of projects (id and name only)',
    type: [ProjectDropdownDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin or Employee role required' })
  async findAllForDropdown(@Query('userId') userId?: string): Promise<ProjectDropdownDto[]> {
    return this.projectsService.findAllForDropdown(userId);
  }

  @Get(':id')
  @RequireEntity('project', 'user')
  @ApiOperation({
    summary: 'Get a project by ID',
    description: 'Get detailed information about a specific project.',
  })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiResponse({
    status: 200,
    description: 'Project details',
    type: ProjectResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findOne(@Param('id', CuidValidationPipe) id: string): Promise<ProjectResponseDto> {
    return this.projectsService.findOne(id);
  }

  @Patch(':id')
  @RequireEntity('project', 'user')
  @ApiOperation({ summary: 'Update a project' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiResponse({
    status: 200,
    description: 'Project updated successfully',
    type: ProjectResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation error or invalid date range' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - must be project manager or have user entity',
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 409, description: 'Project with this name already exists' })
  async update(
    @Param('id', CuidValidationPipe) id: string,
    @Body() updateProjectDto: UpdateProjectDto,
    @CurrentUser('id') adminId: string,
  ): Promise<ProjectResponseDto> {
    const hasUserEntity = await this.aclService.userHasEntityAccess(adminId, 'user');
    return this.projectsService.update(id, updateProjectDto, adminId, !hasUserEntity);
  }

  @Delete(':id')
  @RequireEntity('project', 'user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a project' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiResponse({
    status: 200,
    description: 'The project has been deleted successfully.',
    type: ApiResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Cannot delete project with contributions' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - must be project manager or have user entity',
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async remove(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') adminId: string,
  ): Promise<ApiResponseDto<null | undefined>> {
    const hasUserEntity = await this.aclService.userHasEntityAccess(adminId, 'user');
    await this.projectsService.remove(id, adminId, !hasUserEntity);
    return this.responseService.success(undefined, 'The project has been deleted successfully.');
  }

  @Get(':id/users')
  @RequireEntity('project')
  @ApiOperation({
    summary: 'Get all users with assignment status for a project',
    description:
      'Returns all non-system users with a flag indicating whether they are assigned to this project. Useful for project user management. Optionally filter by role and include role counts.',
  })
  @ApiParam({ name: 'id', description: 'Project ID (CUID format)' })
  @ApiQuery({
    name: 'roleId',
    required: false,
    description: 'Filter users by role ID',
  })
  @ApiQuery({
    name: 'includeRoleCounts',
    required: false,
    description: 'Include counts per role in response (default: false)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of users with assignment status',
    type: ProjectUsersResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async getProjectUsers(
    @Param('id', CuidValidationPipe) id: string,
    @Query() query: ProjectUsersQueryDto,
  ): Promise<ProjectUsersResponseDto> {
    return this.projectsService.getProjectUsers(id, query);
  }

  @Patch(':id/users')
  @RequireEntity('project')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Assign or reassign users to a project',
    description:
      'Replaces all user assignments for the project with the given list. Send full list of user IDs to set. Empty array removes all users.',
  })
  @ApiParam({ name: 'id', description: 'Project ID (CUID format)' })
  @ApiResponse({
    status: 200,
    description: 'Users assigned successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        assignedUsers: { type: 'number', example: 3 },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid user IDs or system users' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async assignUsersToProject(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: AssignUsersToProjectDto,
    @CurrentUser('id') adminId: string,
  ): Promise<{ message: string; assignedUsers: number }> {
    const hasUserEntity = await this.aclService.userHasEntityAccess(adminId, 'user');
    return this.projectsService.assignUsersToProject(id, dto, adminId, !hasUserEntity);
  }

  // ===========================================================================
  // Project Hub
  // ===========================================================================

  @Get(':id/hub')
  @RequireEntity('project', 'user')
  @ApiOperation({
    summary: 'Get full project hub data',
    description:
      'Returns narrative, stakeholders, security, resource links, roadmap (milestones + sprints), and team.',
  })
  @ApiParam({ name: 'id', description: 'Project ID (CUID)' })
  @ApiResponse({ status: 200, type: ProjectHubResponseDto })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async getProjectHub(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<ProjectHubResponseDto> {
    const hasUserEntity = await this.aclService.userHasEntityAccess(userId, 'user');
    return this.projectsService.getProjectHub(id, userId, !hasUserEntity);
  }

  // ===========================================================================
  // Bookmarks
  // ===========================================================================

  @Post(':id/bookmark')
  @RequireEntity('project', 'user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Toggle bookmark on a project',
    description: 'Adds a bookmark if not present, removes it if already bookmarked.',
  })
  @ApiParam({ name: 'id', description: 'Project ID (CUID)' })
  @ApiResponse({ status: 200, description: 'Bookmark toggled' })
  async toggleBookmark(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<{ bookmarked: boolean }> {
    return this.projectsService.toggleBookmark(id, userId);
  }

  // ===========================================================================
  // Milestones
  // ===========================================================================

  @Post(':id/milestones')
  @RequireEntity('project')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a milestone for a project' })
  @ApiParam({ name: 'id', description: 'Project ID (CUID)' })
  @ApiResponse({ status: 201, type: MilestoneResponseDto })
  async createMilestone(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: CreateMilestoneDto,
    @CurrentUser('id') adminId: string,
  ): Promise<MilestoneResponseDto> {
    const hasUserEntity = await this.aclService.userHasEntityAccess(adminId, 'user');
    return this.projectsService.createMilestone(id, dto, adminId, !hasUserEntity);
  }

  @Patch(':id/milestones/:milestoneId')
  @RequireEntity('project')
  @ApiOperation({ summary: 'Update a milestone' })
  @ApiParam({ name: 'id', description: 'Project ID (CUID)' })
  @ApiParam({ name: 'milestoneId', description: 'Milestone ID (CUID)' })
  @ApiResponse({ status: 200, type: MilestoneResponseDto })
  async updateMilestone(
    @Param('id', CuidValidationPipe) id: string,
    @Param('milestoneId', CuidValidationPipe) milestoneId: string,
    @Body() dto: UpdateMilestoneDto,
    @CurrentUser('id') adminId: string,
  ): Promise<MilestoneResponseDto> {
    const hasUserEntity = await this.aclService.userHasEntityAccess(adminId, 'user');
    return this.projectsService.updateMilestone(id, milestoneId, dto, adminId, !hasUserEntity);
  }

  @Delete(':id/milestones/:milestoneId')
  @RequireEntity('project')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a milestone (cascades to sprints)' })
  @ApiParam({ name: 'id', description: 'Project ID (CUID)' })
  @ApiParam({ name: 'milestoneId', description: 'Milestone ID (CUID)' })
  @ApiResponse({ status: 200, type: ApiResponseDto })
  async deleteMilestone(
    @Param('id', CuidValidationPipe) id: string,
    @Param('milestoneId', CuidValidationPipe) milestoneId: string,
    @CurrentUser('id') adminId: string,
  ): Promise<ApiResponseDto<null | undefined>> {
    const hasUserEntity = await this.aclService.userHasEntityAccess(adminId, 'user');
    await this.projectsService.deleteMilestone(id, milestoneId, adminId, !hasUserEntity);
    return this.responseService.success(undefined, 'Milestone deleted successfully.');
  }

  // ===========================================================================
  // Sprints
  // ===========================================================================

  @Post(':id/milestones/:milestoneId/sprints')
  @RequireEntity('project')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a sprint within a milestone' })
  @ApiParam({ name: 'id', description: 'Project ID (CUID)' })
  @ApiParam({ name: 'milestoneId', description: 'Milestone ID (CUID)' })
  @ApiResponse({ status: 201, type: SprintResponseDto })
  async createSprint(
    @Param('id', CuidValidationPipe) id: string,
    @Param('milestoneId', CuidValidationPipe) milestoneId: string,
    @Body() dto: CreateSprintDto,
    @CurrentUser('id') adminId: string,
  ): Promise<SprintResponseDto> {
    const hasUserEntity = await this.aclService.userHasEntityAccess(adminId, 'user');
    return this.projectsService.createSprint(id, milestoneId, dto, adminId, !hasUserEntity);
  }

  @Patch(':id/milestones/:milestoneId/sprints/:sprintId')
  @RequireEntity('project')
  @ApiOperation({ summary: 'Update a sprint' })
  @ApiParam({ name: 'id', description: 'Project ID (CUID)' })
  @ApiParam({ name: 'milestoneId', description: 'Milestone ID (CUID)' })
  @ApiParam({ name: 'sprintId', description: 'Sprint ID (CUID)' })
  @ApiResponse({ status: 200, type: SprintResponseDto })
  async updateSprint(
    @Param('id', CuidValidationPipe) id: string,
    @Param('milestoneId', CuidValidationPipe) milestoneId: string,
    @Param('sprintId', CuidValidationPipe) sprintId: string,
    @Body() dto: UpdateSprintDto,
    @CurrentUser('id') adminId: string,
  ): Promise<SprintResponseDto> {
    const hasUserEntity = await this.aclService.userHasEntityAccess(adminId, 'user');
    return this.projectsService.updateSprint(
      id,
      milestoneId,
      sprintId,
      dto,
      adminId,
      !hasUserEntity,
    );
  }

  @Delete(':id/milestones/:milestoneId/sprints/:sprintId')
  @RequireEntity('project')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a sprint' })
  @ApiParam({ name: 'id', description: 'Project ID (CUID)' })
  @ApiParam({ name: 'milestoneId', description: 'Milestone ID (CUID)' })
  @ApiParam({ name: 'sprintId', description: 'Sprint ID (CUID)' })
  @ApiResponse({ status: 200, type: ApiResponseDto })
  async deleteSprint(
    @Param('id', CuidValidationPipe) id: string,
    @Param('milestoneId', CuidValidationPipe) milestoneId: string,
    @Param('sprintId', CuidValidationPipe) sprintId: string,
    @CurrentUser('id') adminId: string,
  ): Promise<ApiResponseDto<null | undefined>> {
    const hasUserEntity = await this.aclService.userHasEntityAccess(adminId, 'user');
    await this.projectsService.deleteSprint(id, milestoneId, sprintId, adminId, !hasUserEntity);
    return this.responseService.success(undefined, 'Sprint deleted successfully.');
  }
}
