import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { ContributionsService } from './contributions.service';
import { Public, CuidValidationPipe } from '../common';

@ApiTags('Public Contributions')
@Controller('public/contributions')
export class PublicContributionsController {
  constructor(private readonly contributionsService: ContributionsService) {}

  @Get(':id')
  @Public()
  @ApiOperation({
    summary: 'Get a public contribution by ID',
    description: 'Returns a single approved contribution. No authentication required.',
  })
  @ApiParam({ name: 'id', description: 'Contribution ID (CUID format)' })
  @ApiResponse({ status: 200, description: 'Public contribution details' })
  @ApiResponse({ status: 404, description: 'Contribution not found' })
  async findPublicContribution(@Param('id', CuidValidationPipe) id: string) {
    return this.contributionsService.findPublicById(id);
  }
}
