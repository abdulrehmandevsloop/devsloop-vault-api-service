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
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { AssetStatus, AssetIssueStatus } from '@prisma/client';
import { AssetsService } from './assets.service';
import {
  CreateAssetDto,
  AssignAssetDto,
  ReturnAssetDto,
  AssetResponseDto,
  AssetHistoryItemDto,
  AssetTypeResponseDto,
  EmployeeDropdownItemDto,
  UpdateAssetQuantityDto,
  UpdateAssetTypeQuantityDto,
  CreateAssetTypeDto,
  UpdateAssetTypeDto,
  AssetIssueResponseDto,
  UpdateAssetIssueDto,
  UpdateAssetDto,
} from './dto';
import { RequireEntity, CuidValidationPipe, CurrentUser } from '../common';

@ApiTags('Admin - Assets')
@ApiBearerAuth('JWT-auth')
@Controller('admin/assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post()
  @RequireEntity('asset')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new asset',
    description: 'Create a new asset. Status defaults to Available. Serial number must be unique.',
  })
  @ApiResponse({ status: 201, description: 'Asset created successfully', type: AssetResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Serial number already exists' })
  async create(
    @Body() dto: CreateAssetDto,
    @CurrentUser('id') userId: string,
  ): Promise<AssetResponseDto> {
    return this.assetsService.create(dto, userId);
  }

  @Get()
  @RequireEntity('asset')
  @ApiOperation({
    summary: 'Get all assets',
    description: 'Paginated list with search (name, serial) and filters (status, asset type).',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search by asset name or serial number',
  })
  @ApiQuery({ name: 'status', required: false, enum: AssetStatus, description: 'Filter by status' })
  @ApiQuery({ name: 'assetTypeId', required: false, description: 'Filter by asset type ID' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Paginated asset list',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/AssetListItemDto' } },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' },
        totalPages: { type: 'number' },
        hasNextPage: { type: 'boolean' },
        hasPreviousPage: { type: 'boolean' },
      },
    },
  })
  async findAll(
    @Query('search') search?: string,
    @Query('status') status?: AssetStatus,
    @Query('assetTypeId') assetTypeId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.assetsService.findAll({
      search,
      status,
      assetTypeId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('types')
  @RequireEntity('asset')
  @ApiOperation({
    summary: 'Get asset types',
    description:
      'By default returns active types only (for dropdowns). Use includeInactive=true for admin list.',
  })
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    type: Boolean,
    description: 'Include inactive types',
  })
  @ApiResponse({ status: 200, type: [AssetTypeResponseDto] })
  async getAssetTypes(
    @Query('includeInactive') includeInactive?: string,
  ): Promise<AssetTypeResponseDto[]> {
    return this.assetsService.getAssetTypes(includeInactive === 'true');
  }

  @Get('types/:id')
  @RequireEntity('asset')
  @ApiOperation({ summary: 'Get asset type by ID' })
  @ApiParam({ name: 'id', description: 'Asset type ID' })
  @ApiResponse({ status: 200, type: AssetTypeResponseDto })
  @ApiResponse({ status: 404, description: 'Asset type not found' })
  async getAssetTypeById(
    @Param('id', CuidValidationPipe) id: string,
  ): Promise<AssetTypeResponseDto> {
    return this.assetsService.getAssetTypeById(id);
  }

  @Post('types')
  @RequireEntity('asset')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create asset type' })
  @ApiResponse({ status: 201, type: AssetTypeResponseDto })
  @ApiResponse({ status: 409, description: 'Asset type name already exists' })
  async createAssetType(@Body() dto: CreateAssetTypeDto): Promise<AssetTypeResponseDto> {
    return this.assetsService.createAssetType(dto);
  }

  @Patch('types/:id')
  @RequireEntity('asset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update asset type (name, isActive)' })
  @ApiParam({ name: 'id', description: 'Asset type ID' })
  @ApiResponse({ status: 200, type: AssetTypeResponseDto })
  @ApiResponse({ status: 404, description: 'Asset type not found' })
  async updateAssetType(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: UpdateAssetTypeDto,
  ): Promise<AssetTypeResponseDto> {
    return this.assetsService.updateAssetType(id, dto);
  }

  @Patch('types/:id/quantity')
  @RequireEntity('asset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update asset type inventory count (deprecated)',
    description: 'Deprecated. Use PATCH /admin/assets/:id/quantity to update per-asset inventory.',
  })
  @ApiParam({ name: 'id', description: 'Asset type ID' })
  @ApiResponse({ status: 200, type: AssetTypeResponseDto })
  @ApiResponse({ status: 400, description: 'Quantity below assigned count or negative' })
  @ApiResponse({ status: 404, description: 'Asset type not found' })
  async updateAssetTypeQuantity(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: UpdateAssetTypeQuantityDto,
  ): Promise<AssetTypeResponseDto> {
    return this.assetsService.updateAssetTypeQuantity(id, dto);
  }

  @Delete('types/:id')
  @RequireEntity('asset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete asset type',
    description: 'Soft-delete (set isActive to false). Inactive types are hidden from dropdowns.',
  })
  @ApiParam({ name: 'id', description: 'Asset type ID' })
  @ApiResponse({ status: 200, type: AssetTypeResponseDto })
  @ApiResponse({ status: 404, description: 'Asset type not found' })
  async deleteAssetType(
    @Param('id', CuidValidationPipe) id: string,
  ): Promise<AssetTypeResponseDto> {
    return this.assetsService.removeAssetType(id);
  }

  @Get('issues')
  @RequireEntity('asset')
  @ApiOperation({
    summary: 'List asset issues (reported by employees)',
    description: 'Paginated list with optional status filter. Admin/IT view.',
  })
  @ApiQuery({ name: 'status', required: false, enum: AssetIssueStatus })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of asset issues',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/AssetIssueListItemDto' } },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' },
        totalPages: { type: 'number' },
        hasNextPage: { type: 'boolean' },
        hasPreviousPage: { type: 'boolean' },
      },
    },
  })
  async getIssues(
    @Query('status') status?: AssetIssueStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.assetsService.findAllIssues({
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('issues/:id')
  @RequireEntity('asset')
  @ApiOperation({ summary: 'Get asset issue by ID' })
  @ApiParam({ name: 'id', description: 'Asset issue ID' })
  @ApiResponse({ status: 200, type: AssetIssueResponseDto })
  @ApiResponse({ status: 404, description: 'Issue not found' })
  async getIssueById(
    @Param('id', CuidValidationPipe) id: string,
  ): Promise<AssetIssueResponseDto | null> {
    const issue = await this.assetsService.getIssueById(id);
    if (!issue) throw new NotFoundException(`Asset issue with ID ${id} not found`);
    return issue;
  }

  @Patch('issues/:id')
  @RequireEntity('asset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update asset issue status',
    description:
      'Set status to OPEN, IN_PROGRESS, or RESOLVED. When RESOLVED, asset status is set back to Assigned.',
  })
  @ApiParam({ name: 'id', description: 'Asset issue ID' })
  @ApiResponse({ status: 200, type: AssetIssueResponseDto })
  @ApiResponse({ status: 404, description: 'Issue not found' })
  async updateIssueStatus(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: UpdateAssetIssueDto,
    @CurrentUser('id') userId: string,
  ): Promise<AssetIssueResponseDto> {
    return this.assetsService.updateIssueStatus(id, dto, userId);
  }

  @Get('employees')
  @RequireEntity('asset')
  @ApiOperation({
    summary: 'Get active employees for assign dropdown',
    description: 'Optional search by name or email (case-insensitive).',
  })
  @ApiQuery({ name: 'search', required: false, description: 'Search by name or email' })
  @ApiResponse({ status: 200, type: [EmployeeDropdownItemDto] })
  async getActiveEmployees(@Query('search') search?: string): Promise<EmployeeDropdownItemDto[]> {
    return this.assetsService.getActiveEmployees(search);
  }

  @Get(':id')
  @RequireEntity('asset')
  @ApiOperation({ summary: 'Get asset by ID' })
  @ApiParam({ name: 'id', description: 'Asset ID' })
  @ApiResponse({ status: 200, type: AssetResponseDto })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async findOne(@Param('id', CuidValidationPipe) id: string): Promise<AssetResponseDto> {
    return this.assetsService.findOne(id);
  }

  @Patch(':id')
  @RequireEntity('asset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update asset details',
    description: 'Update basic asset details like name, serial number, purchase date and notes.',
  })
  @ApiParam({ name: 'id', description: 'Asset ID' })
  @ApiResponse({ status: 200, type: AssetResponseDto })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async updateAsset(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: UpdateAssetDto,
  ): Promise<AssetResponseDto> {
    return this.assetsService.updateAsset(id, dto);
  }

  @Get(':id/history')
  @RequireEntity('asset')
  @ApiOperation({ summary: 'Get asset history timeline' })
  @ApiParam({ name: 'id', description: 'Asset ID' })
  @ApiResponse({ status: 200, type: [AssetHistoryItemDto] })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async getHistory(@Param('id', CuidValidationPipe) id: string): Promise<AssetHistoryItemDto[]> {
    return this.assetsService.getHistory(id);
  }

  @Patch(':id/quantity')
  @RequireEntity('asset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update asset inventory count',
    description:
      'Admin-only. Update totalQuantity for a specific asset. Cannot set below assignedQuantity.',
  })
  @ApiParam({ name: 'id', description: 'Asset ID' })
  @ApiResponse({ status: 200, type: AssetResponseDto })
  @ApiResponse({ status: 400, description: 'Quantity below assigned count or negative' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async updateAssetQuantity(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: UpdateAssetQuantityDto,
  ): Promise<AssetResponseDto> {
    return this.assetsService.updateAssetQuantity(id, dto);
  }

  @Patch(':id/assign')
  @RequireEntity('asset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Assign asset to employee',
    description: 'Only Available assets can be assigned. Re-checks status for concurrency safety.',
  })
  @ApiParam({ name: 'id', description: 'Asset ID' })
  @ApiResponse({ status: 200, type: AssetResponseDto })
  @ApiResponse({ status: 400, description: 'Asset not available or employee invalid' })
  @ApiResponse({ status: 409, description: 'Asset already assigned by another user' })
  async assign(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: AssignAssetDto,
    @CurrentUser('id') userId: string,
  ): Promise<AssetResponseDto> {
    return this.assetsService.assign(id, dto, userId);
  }

  @Patch(':id/return')
  @RequireEntity('asset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Return asset',
    description:
      'Return one assignee from the asset. When asset has multiple assignees, pass userId in body.',
  })
  @ApiParam({ name: 'id', description: 'Asset ID' })
  @ApiResponse({ status: 200, type: AssetResponseDto })
  @ApiResponse({
    status: 400,
    description: 'No assignment or specify userId when multiple assignees',
  })
  async returnAsset(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: ReturnAssetDto,
    @CurrentUser('id') performedBy: string,
  ): Promise<AssetResponseDto> {
    return this.assetsService.returnAsset(id, performedBy, dto?.userIds);
  }
}
