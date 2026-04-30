import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, CuidValidationPipe, RequireEntity } from 'src/common';
import { AclService } from 'src/rbac/rbac.service';
import { SalaryAdjustmentsService } from './salary-adjustments.service';
import {
  CreateSalaryAdjustmentDto,
  DecideSalaryAdjustmentDto,
  ListSalaryAdjustmentsDto,
  UpdateSalaryAdjustmentDto,
} from './dto';

@ApiTags('Admin - Salary Adjustments')
@ApiBearerAuth('JWT-auth')
@Controller('admin/salary-adjustments')
@RequireEntity('payroll')
export class SalaryAdjustmentsController {
  constructor(
    private readonly service: SalaryAdjustmentsService,
    private readonly acl: AclService,
  ) {}

  private async requireAction(userId: string, action: string): Promise<void> {
    const ok = await this.acl.userHasEntityAction(userId, 'payroll', action);
    if (!ok) throw new ForbiddenException(`Payroll '${action}' permission required`);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'HR creates a salary adjustment request' })
  @ApiResponse({ status: 201, description: 'Salary adjustment created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'payroll:write permission required' })
  async create(@Body() dto: CreateSalaryAdjustmentDto, @CurrentUser('id') actorId: string) {
    await this.requireAction(actorId, 'write');
    return this.service.create(dto, actorId);
  }

  @Get()
  @ApiOperation({ summary: 'List salary adjustments (filter by status / month / employee)' })
  @ApiResponse({ status: 200, description: 'Paginated list of salary adjustments' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async list(@Query() query: ListSalaryAdjustmentsDto, @CurrentUser('id') _actorId: string) {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one salary adjustment' })
  @ApiParam({ name: 'id', description: 'CUID of the salary adjustment' })
  @ApiResponse({ status: 200, description: 'Salary adjustment details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Salary adjustment not found' })
  async getOne(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') _actorId: string) {
    return this.service.getOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a pending salary adjustment (creator only)' })
  @ApiParam({ name: 'id', description: 'CUID of the salary adjustment' })
  @ApiResponse({ status: 200, description: 'Updated salary adjustment' })
  @ApiResponse({ status: 400, description: 'Validation error or not in PENDING status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'payroll:write permission required' })
  @ApiResponse({ status: 404, description: 'Salary adjustment not found' })
  async update(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: UpdateSalaryAdjustmentDto,
    @CurrentUser('id') actorId: string,
  ) {
    await this.requireAction(actorId, 'write');
    return this.service.update(id, dto, actorId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a pending salary adjustment (creator only)' })
  @ApiParam({ name: 'id', description: 'CUID of the salary adjustment' })
  @ApiResponse({ status: 204, description: 'Salary adjustment deleted' })
  @ApiResponse({ status: 400, description: 'Not in PENDING status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'payroll:write permission required' })
  @ApiResponse({ status: 404, description: 'Salary adjustment not found' })
  async delete(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') actorId: string,
  ): Promise<void> {
    await this.requireAction(actorId, 'write');
    await this.service.delete(id, actorId);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a pending salary adjustment (primary authorizer only)' })
  @ApiParam({ name: 'id', description: 'CUID of the salary adjustment' })
  @ApiResponse({ status: 201, description: 'Salary adjustment approved' })
  @ApiResponse({ status: 400, description: 'Not in PENDING status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'payroll:authorize permission required' })
  @ApiResponse({ status: 404, description: 'Salary adjustment not found' })
  async approve(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: DecideSalaryAdjustmentDto,
    @CurrentUser('id') actorId: string,
  ) {
    await this.requireAction(actorId, 'authorize');
    return this.service.approve(id, dto, actorId);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a pending salary adjustment (primary authorizer only)' })
  @ApiParam({ name: 'id', description: 'CUID of the salary adjustment' })
  @ApiResponse({ status: 201, description: 'Salary adjustment rejected' })
  @ApiResponse({ status: 400, description: 'Not in PENDING status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'payroll:authorize permission required' })
  @ApiResponse({ status: 404, description: 'Salary adjustment not found' })
  async reject(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: DecideSalaryAdjustmentDto,
    @CurrentUser('id') actorId: string,
  ) {
    await this.requireAction(actorId, 'authorize');
    return this.service.reject(id, dto, actorId);
  }

  // ── Adjustment exports ─────────────────────────────────────────────────────

  @Get('export/standard-csv')
  @ApiOperation({
    summary: 'Export approved adjustments as standard bank CSV (Employee Name, IBAN, Net Salary)',
  })
  @ApiQuery({
    name: 'yearMonth',
    required: true,
    description: 'Month in YYYY-MM format',
    example: '2026-04',
  })
  @ApiProduces('text/csv')
  @ApiResponse({ status: 200, description: 'CSV file download' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'payroll:export permission required' })
  async exportStandardCsv(
    @Query('yearMonth') yearMonth: string,
    @CurrentUser('id') actorId: string,
    @Res({ passthrough: false }) res: Response,
  ) {
    await this.requireAction(actorId, 'export');
    const { csvBody, filename } = await this.service.exportAdjustmentsStandardCsv(yearMonth);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvBody);
  }

  @Get('export/local-bank-csv')
  @ApiOperation({
    summary:
      'Export approved adjustments as local bank CSV (Customer Ref · PAY · BA · Bank Code · Name · IBAN · Amount)',
  })
  @ApiQuery({
    name: 'yearMonth',
    required: true,
    description: 'Month in YYYY-MM format',
    example: '2026-04',
  })
  @ApiProduces('text/csv')
  @ApiResponse({ status: 200, description: 'CSV file download' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'payroll:export permission required' })
  async exportLocalBankCsv(
    @Query('yearMonth') yearMonth: string,
    @CurrentUser('id') actorId: string,
    @Res({ passthrough: false }) res: Response,
  ) {
    await this.requireAction(actorId, 'export');
    const { csvBody, filename } = await this.service.exportAdjustmentsLocalBankCsv(yearMonth);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvBody);
  }

  @Get('export/remittance-xlsx')
  @ApiOperation({
    summary: 'Export approved adjustments as remittance XLSX (UAE / SIMPLE_REMITTANCE employees)',
  })
  @ApiQuery({
    name: 'yearMonth',
    required: true,
    description: 'Month in YYYY-MM format',
    example: '2026-04',
  })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiResponse({ status: 200, description: 'XLSX file download' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'payroll:export permission required' })
  async exportRemittanceXlsx(
    @Query('yearMonth') yearMonth: string,
    @CurrentUser('id') actorId: string,
    @Res({ passthrough: false }) res: Response,
  ) {
    await this.requireAction(actorId, 'export');
    const { buffer, filename } = await this.service.exportAdjustmentsRemittanceXlsx(yearMonth);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
