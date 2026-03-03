import { Controller, Get, Post, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { AssetsService } from './assets.service';
import { MyAssignedAssetDto, ReportAssetIssueDto, AssetIssueResponseDto } from './dto';
import { CurrentUser, CuidValidationPipe } from 'src/common';

/**
 * Employee-facing asset endpoints.
 * Returns assets assigned to the current user; employees can report issues.
 */
@ApiTags('Assets (Employee)')
@ApiBearerAuth('JWT-auth')
@Controller('assets')
export class AssetsUserController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get('assigned-to-me')
  @ApiOperation({
    summary: 'Get my assigned assets',
    description:
      'Returns assets assigned to the current user with assigned date. Status (Assigned, Under Repair, Lost) is shown for each asset.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of assets assigned to the current user',
    type: [MyAssignedAssetDto],
  })
  async getMyAssignedAssets(@CurrentUser('id') userId: string): Promise<MyAssignedAssetDto[]> {
    return this.assetsService.findAssignedToUser(userId);
  }

  @Post(':assetId/report-issue')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Report an issue with an asset',
    description:
      'Report a problem with an asset assigned to you. Asset status becomes Under Repair. Only one active assignment per user per asset.',
  })
  @ApiParam({ name: 'assetId', description: 'Asset ID' })
  @ApiResponse({ status: 201, type: AssetIssueResponseDto })
  @ApiResponse({ status: 400, description: 'Asset not assigned to you' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async reportIssue(
    @Param('assetId', CuidValidationPipe) assetId: string,
    @Body() dto: ReportAssetIssueDto,
    @CurrentUser('id') userId: string,
  ): Promise<AssetIssueResponseDto> {
    return this.assetsService.reportIssue(assetId, userId, dto);
  }
}
