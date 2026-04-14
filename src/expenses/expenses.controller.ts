import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CuidValidationPipe } from 'src/common';
import { RequireEntity } from 'src/common/decorators';
import {
  CreateExpenseDto,
  ExpenseResponseDto,
  ExpensesListResponseDto,
  ExpensesQueryDto,
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
}
