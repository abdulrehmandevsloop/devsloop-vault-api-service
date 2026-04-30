import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, CuidValidationPipe } from 'src/common';
import { RequireEntity } from 'src/common/decorators';
import {
  ComparisonQueryDto,
  CreateExpenseDto,
  ExportQueryDto,
  ExpenseResponseDto,
  ExpensesListResponseDto,
  ExpensesQueryDto,
  MonthlyComparisonResponseDto,
  MonthlyReportQueryDto,
  MonthlyReportResponseDto,
  UpdateExpenseDto,
} from 'src/expenses/dto';
import { ExpensesService } from 'src/expenses/expenses.service';

@ApiTags('Expenses')
@ApiBearerAuth('JWT-auth')
@Controller('expenses')
@RequireEntity('manage-expense')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new expense entry' })
  @ApiResponse({ status: 201, type: ExpenseResponseDto })
  create(@Body() dto: CreateExpenseDto, @CurrentUser('id') userId: string) {
    return this.expensesService.create(dto, userId);
  }

  @Get()
  @ApiOperation({ summary: 'Get company expenses' })
  @ApiResponse({ status: 200, type: ExpensesListResponseDto })
  findAll(@Query() query: ExpensesQueryDto, @CurrentUser('id') userId: string) {
    return this.expensesService.findAll(query, userId);
  }

  // ── Reports & export — must come before /:id to avoid route shadowing ────────

  @Get('reports/monthly')
  @ApiOperation({ summary: 'Get expense report for a specific month' })
  @ApiResponse({ status: 200, type: MonthlyReportResponseDto })
  getMonthlyReport(@Query() query: MonthlyReportQueryDto, @CurrentUser('id') userId: string) {
    return this.expensesService.getMonthlyReport(query.year, query.month, userId);
  }

  @Get('reports/comparison')
  @ApiOperation({ summary: 'Get month-over-month expense comparison' })
  @ApiQuery({ name: 'months', required: false, example: 6 })
  @ApiResponse({ status: 200, type: MonthlyComparisonResponseDto })
  getComparison(@Query() query: ComparisonQueryDto, @CurrentUser('id') userId: string) {
    return this.expensesService.getComparison(query.months ?? 6, userId);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export expenses as CSV for a given month' })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportCsv(
    @Query() query: ExportQueryDto,
    @CurrentUser('id') userId: string,
  ): Promise<StreamableFile> {
    const csv = await this.expensesService.exportCsv(query.year, query.month, userId);
    const month = String(query.month).padStart(2, '0');
    return new StreamableFile(Buffer.from(csv, 'utf-8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="expenses-${query.year}-${month}.csv"`,
    });
  }

  // ── Single-resource routes — keep after all static paths ────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get expense detail' })
  @ApiParam({ name: 'id', description: 'Expense ID' })
  @ApiResponse({ status: 200, type: ExpenseResponseDto })
  findOne(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.expensesService.findOne(id, userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an expense entry' })
  @ApiParam({ name: 'id', description: 'Expense ID' })
  @ApiResponse({ status: 200, type: ExpenseResponseDto })
  update(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: UpdateExpenseDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.expensesService.update(id, dto, userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an expense entry' })
  @ApiParam({ name: 'id', description: 'Expense ID' })
  @ApiResponse({ status: 204 })
  remove(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.expensesService.remove(id, userId);
  }
}
