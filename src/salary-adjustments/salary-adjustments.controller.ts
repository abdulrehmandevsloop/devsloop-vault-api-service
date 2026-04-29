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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  async create(@Body() dto: CreateSalaryAdjustmentDto, @CurrentUser('id') actorId: string) {
    await this.requireAction(actorId, 'write');
    return this.service.create(dto, actorId);
  }

  @Get()
  @ApiOperation({ summary: 'List salary adjustments (filter by status / month / employee)' })
  async list(@Query() query: ListSalaryAdjustmentsDto, @CurrentUser('id') _actorId: string) {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one salary adjustment' })
  async getOne(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') _actorId: string) {
    return this.service.getOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a pending salary adjustment (creator only)' })
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
  async delete(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') actorId: string,
  ): Promise<void> {
    await this.requireAction(actorId, 'write');
    await this.service.delete(id, actorId);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a pending salary adjustment (primary authorizer only)' })
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
      'Export approved adjustments as local bank CSV (Customer Ref, PAY, BA, Bank Code, Name, IBAN, Amount)',
  })
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
