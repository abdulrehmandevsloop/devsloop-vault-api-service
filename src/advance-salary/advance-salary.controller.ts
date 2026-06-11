import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiResponse } from '@nestjs/swagger';
import { AdvanceSalaryService } from 'src/advance-salary/advance-salary.service';
import {
  CreateAdvanceSalaryRequestDto,
  UpdateAdvanceSalaryRequestDto,
  AdvanceSalaryQueryDto,
} from 'src/advance-salary/dto';
import { CurrentUser } from 'src/common';
import { CuidValidationPipe } from 'src/common/pipes/cuid-validation.pipe';

@ApiTags('Advance Salary')
@ApiBearerAuth('JWT-auth')
@Controller('advance-salary')
export class AdvanceSalaryController {
  constructor(private readonly advanceSalaryService: AdvanceSalaryService) {}

  @Post()
  // @RequireEntity('requests')
  @ApiOperation({ summary: 'Create an advance salary request' })
  @ApiResponse({ status: 201, description: 'Advance salary request created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  create(@Body() dto: CreateAdvanceSalaryRequestDto, @CurrentUser('id') userId: string) {
    return this.advanceSalaryService.create(dto, userId);
  }

  @Get()
  // @RequireEntity('requests')
  @ApiOperation({ summary: 'List my advance salary requests' })
  @ApiResponse({ status: 200, description: 'Array of advance salary requests' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findMyRequests(@Query() query: AdvanceSalaryQueryDto, @CurrentUser('id') userId: string) {
    return this.advanceSalaryService.findMyRequests(userId, query);
  }

  @Get(':id')
  // @RequireEntity('requests')
  @ApiOperation({ summary: 'Get single advance salary request' })
  @ApiParam({ name: 'id', description: 'Advance salary request ID' })
  @ApiResponse({ status: 200, description: 'Advance salary request details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  findOne(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.advanceSalaryService.findOne(id, userId);
  }

  @Patch(':id')
  // @RequireEntity('requests')
  @ApiOperation({ summary: 'Update a PENDING advance salary request' })
  @ApiParam({ name: 'id', description: 'Advance salary request ID' })
  @ApiResponse({ status: 200, description: 'Updated advance salary request' })
  @ApiResponse({ status: 400, description: 'Validation error or request not in PENDING status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  update(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: UpdateAdvanceSalaryRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.advanceSalaryService.update(id, dto, userId);
  }

  @Delete(':id')
  // @RequireEntity('requests')
  @ApiOperation({ summary: 'Cancel a PENDING advance salary request' })
  @ApiParam({ name: 'id', description: 'Advance salary request ID' })
  @ApiResponse({ status: 200, description: 'Request cancelled' })
  @ApiResponse({ status: 400, description: 'Request not in PENDING status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  cancel(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.advanceSalaryService.cancel(id, userId);
  }

  @Get(':id/repayments')
  // @RequireEntity('requests')
  @ApiOperation({ summary: 'Get repayment schedule for a request' })
  @ApiParam({ name: 'id', description: 'Advance salary request ID' })
  @ApiResponse({ status: 200, description: 'Array of repayment installments' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  getRepayments(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.advanceSalaryService.getRepayments(id, userId);
  }
}
