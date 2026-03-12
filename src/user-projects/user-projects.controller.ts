import { Controller, Get, Post, Delete, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { UserProjectsService } from './user-projects.service';
import { AssignProjectsDto, UserProjectAssignmentDto } from './dto';
import { RequireEntity, CurrentUser, CuidValidationPipe } from '../common';

@ApiTags('Admin - User Project Assignments')
@ApiBearerAuth('JWT-auth')
@Controller('admin/users/:userId/projects')
export class UserProjectsController {
  constructor(private readonly userProjectsService: UserProjectsService) {}

  //in contribution review role, we need to get the projects assigned to the user
  @Get()
  @RequireEntity('project', 'contribution-review', 'worklog')
  @ApiOperation({
    summary: 'Get projects assigned to a user',
    description: 'Returns all projects assigned to the given user.',
  })
  @ApiParam({ name: 'userId', description: 'User ID (CUID format)' })
  @ApiResponse({
    status: 200,
    description: 'List of assigned projects',
    type: [UserProjectAssignmentDto],
  })
  @ApiResponse({ status: 400, description: 'Invalid ID format' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getAssignedProjects(
    @Param('userId', CuidValidationPipe) userId: string,
  ): Promise<UserProjectAssignmentDto[]> {
    return this.userProjectsService.getAssignedProjects(userId);
  }

  @Post()
  @RequireEntity('project')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set user assigned projects (add/update)',
    description:
      "Replaces the user's assigned projects with the given array. Send full list to add, update, or remove. Empty array clears all assignments.",
  })
  @ApiParam({ name: 'userId', description: 'User ID (CUID format)' })
  @ApiResponse({
    status: 200,
    description: 'Projects updated successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        assignedProjects: { type: 'number', example: 2 },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid ID format or invalid/missing project IDs' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async assignProjects(
    @Param('userId', CuidValidationPipe) userId: string,
    @Body() dto: AssignProjectsDto,
    @CurrentUser('id') adminId: string,
  ): Promise<{ message: string; assignedProjects: number }> {
    return this.userProjectsService.assignProjects(userId, dto, adminId);
  }

  @Delete(':projectId')
  @RequireEntity('project')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a project assignment from a user',
    description: 'Removes the assignment of the specified project from the user.',
  })
  @ApiParam({ name: 'userId', description: 'User ID (CUID format)' })
  @ApiParam({ name: 'projectId', description: 'Project ID to unassign (CUID format)' })
  @ApiResponse({
    status: 204,
    description: 'Project assignment removed successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid ID format' })
  @ApiResponse({ status: 404, description: 'User not found or project not assigned' })
  async removeProject(
    @Param('userId', CuidValidationPipe) userId: string,
    @Param('projectId', CuidValidationPipe) projectId: string,
  ): Promise<void> {
    return this.userProjectsService.removeProject(userId, projectId);
  }
}
