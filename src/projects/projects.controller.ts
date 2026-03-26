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
} from './dto';
import {
  ApiResponseDto,
  RequireEntity,
  CuidValidationPipe,
  CurrentUser,
  ResponseService,
} from 'src/common';

@ApiTags('Admin - Projects')
@ApiBearerAuth('JWT-auth')
@Controller('admin/projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly responseService: ResponseService,
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
  @RequireEntity('project')
  @ApiOperation({
    summary: 'Get all projects',
    description:
      'Admin only. Get paginated list of projects with optional filters (search, client name, domain, confidentiality level).',
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
    @Query('search') search?: string,
    @Query('clientName') clientName?: string,
    @Query('domain') domain?: string,
    @Query('confidentialityLevel') confidentialityLevel?: ConfidentialityLevel,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.projectsService.findAll({
      search,
      clientName,
      domain,
      confidentialityLevel,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
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
  @RequireEntity('project')
  @ApiOperation({
    summary: 'Get a project by ID',
    description: 'Admin only. Get detailed information about a specific project.',
  })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiResponse({
    status: 200,
    description: 'Project details',
    type: ProjectResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  async findOne(@Param('id', CuidValidationPipe) id: string): Promise<ProjectResponseDto> {
    return this.projectsService.findOne(id);
  }

  @Patch(':id')
  @RequireEntity('project')
  @ApiOperation({
    summary: 'Update a project',
    description:
      'Admin only. Update project details including client name, domain, dates, tech stack, and confidentiality level.',
  })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiResponse({
    status: 200,
    description: 'Project updated successfully',
    type: ProjectResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation error or invalid date range' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 409, description: 'Project with this name already exists' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  async update(
    @Param('id', CuidValidationPipe) id: string,
    @Body() updateProjectDto: UpdateProjectDto,
    @CurrentUser('id') adminId: string,
  ): Promise<ProjectResponseDto> {
    return this.projectsService.update(id, updateProjectDto, adminId);
  }

  @Delete(':id')
  @RequireEntity('project')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a project',
    description: 'Admin only. Delete a project. Cannot delete if project has contributions.',
  })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiResponse({
    status: 204,
    description: 'The project has been deleted successfully.',
    type: ApiResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Cannot delete project with contributions' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  async remove(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') adminId: string,
  ): Promise<ApiResponseDto<null | undefined>> {
    await this.projectsService.remove(id, adminId);
    return this.responseService.success(undefined, 'The project has been deleted successfully.');
  }

  @Get(':id/users')
  @RequireEntity('project')
  @ApiOperation({
    summary: 'Get all users with assignment status for a project',
    description:
      'Returns all non-system users with a flag indicating whether they are assigned to this project. Useful for project user management.',
  })
  @ApiParam({ name: 'id', description: 'Project ID (CUID format)' })
  @ApiResponse({
    status: 200,
    description: 'List of users with assignment status',
    type: ProjectUsersResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async getProjectUsers(
    @Param('id', CuidValidationPipe) id: string,
  ): Promise<ProjectUsersResponseDto> {
    return this.projectsService.getProjectUsers(id);
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
    return this.projectsService.assignUsersToProject(id, dto, adminId);
  }
}
