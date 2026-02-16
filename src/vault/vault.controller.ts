import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { VaultService } from './vault.service';
import {
  VaultProjectsResponseDto,
  VaultContributionQueryDto,
  VaultContributionsResponseDto,
} from './dto';
import { RequireEntity, CuidValidationPipe } from '../common';

@ApiTags('Vault')
@ApiBearerAuth('JWT-auth')
@Controller('vault')
export class VaultController {
  constructor(private readonly vaultService: VaultService) {}

  @Get('projects')
  @RequireEntity('vault')
  @ApiOperation({
    summary: 'Get all projects with approved contributions',
    description:
      'Returns a list of projects that have at least one approved contribution, ' +
      'along with the count of approved contributions per project. Sorted alphabetically by name.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of projects with approved contribution counts',
    type: VaultProjectsResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — missing vault entity access' })
  async getProjects(): Promise<VaultProjectsResponseDto> {
    return this.vaultService.getProjects();
  }

  @Get('projects/:projectId/contributions')
  @RequireEntity('vault')
  @ApiOperation({
    summary: 'Get approved contributions for a project',
    description:
      'Returns a paginated list of approved contributions for a specific project. ' +
      'Ordered by creation date (newest first).',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of approved contributions',
    type: VaultContributionsResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — missing vault entity access' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async getContributions(
    @Param('projectId', CuidValidationPipe) projectId: string,
    @Query() query: VaultContributionQueryDto,
  ): Promise<VaultContributionsResponseDto> {
    return this.vaultService.getContributions(projectId, query);
  }
}
