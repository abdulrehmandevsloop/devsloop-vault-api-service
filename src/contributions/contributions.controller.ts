import { Controller, Post, Get, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ContributionsService } from './contributions.service';
import { CreateContributionDto, ContributionResponseDto } from './dto';
import { CurrentUser, RequireEntity } from '../common';

@ApiTags('Contributions')
@ApiBearerAuth('JWT-auth')
@Controller('contributions')
@RequireEntity('contribution')
export class ContributionsController {
  constructor(private readonly contributionsService: ContributionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new contribution',
    description:
      'Create a new contribution as DRAFT. Employee can later submit it for review. ' +
      'The action, outcome, and keyLearnings fields support rich text (HTML).',
  })
  @ApiResponse({
    status: 201,
    description: 'Contribution created successfully',
    type: ContributionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Project or tags not found' })
  async create(
    @Body() dto: CreateContributionDto,
    @CurrentUser('id') userId: string,
  ): Promise<ContributionResponseDto> {
    return this.contributionsService.create(userId, dto);
  }

  @Get('my')
  @ApiOperation({
    summary: 'Get my contributions',
    description: 'Get all contributions created by the current user.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of user contributions',
    type: [ContributionResponseDto],
  })
  async findMyContributions(@CurrentUser('id') userId: string): Promise<ContributionResponseDto[]> {
    return this.contributionsService.findMyContributions(userId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get contribution by ID',
    description: 'Get a specific contribution. Access depends on visibility level.',
  })
  @ApiParam({ name: 'id', description: 'Contribution ID' })
  @ApiResponse({
    status: 200,
    description: 'Contribution details',
    type: ContributionResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Contribution not found' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<ContributionResponseDto> {
    return this.contributionsService.findOne(id, userId);
  }
}
