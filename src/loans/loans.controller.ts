import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiResponse } from '@nestjs/swagger';
import { LoansService } from 'src/loans/loans.service';
import { CreateLoanRequestDto, UpdateLoanRequestDto, LoansQueryDto } from 'src/loans/dto';
import { CurrentUser } from 'src/common';
import { CuidValidationPipe } from 'src/common/pipes/cuid-validation.pipe';

@ApiTags('Loans')
@ApiBearerAuth('JWT-auth')
@Controller('loans')
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  @Post()
  // @RequireEntity('requests')
  @ApiOperation({ summary: 'Submit a new loan request' })
  @ApiResponse({ status: 201, description: 'Loan request created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  create(@Body() dto: CreateLoanRequestDto, @CurrentUser('id') userId: string) {
    return this.loansService.create(dto, userId);
  }

  @Get()
  // @RequireEntity('requests')
  @ApiOperation({ summary: 'Get my loan requests' })
  @ApiResponse({ status: 200, description: 'Array of loan requests' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findMyLoans(@Query() query: LoansQueryDto, @CurrentUser('id') userId: string) {
    return this.loansService.findMyLoans(userId, query);
  }

  @Get(':id')
  // @RequireEntity('requests')
  @ApiOperation({ summary: 'Get a single loan request' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  @ApiResponse({ status: 200, description: 'Loan request details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Loan request not found' })
  findOne(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.loansService.findOne(id, userId);
  }

  @Patch(':id')
  // @RequireEntity('requests')
  @ApiOperation({ summary: 'Update a pending loan request' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  @ApiResponse({ status: 200, description: 'Updated loan request' })
  @ApiResponse({ status: 400, description: 'Validation error or request not in PENDING status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Loan request not found' })
  update(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: UpdateLoanRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.loansService.update(id, dto, userId);
  }

  @Delete(':id')
  // @RequireEntity('requests')
  @ApiOperation({ summary: 'Cancel a pending loan request' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  @ApiResponse({ status: 200, description: 'Loan request cancelled' })
  @ApiResponse({ status: 400, description: 'Request not in PENDING status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Loan request not found' })
  cancel(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.loansService.cancel(id, userId);
  }

  @Get(':id/repayments')
  // @RequireEntity('requests')
  @ApiOperation({ summary: 'Get repayment schedule for a loan' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  @ApiResponse({ status: 200, description: 'Array of repayment installments' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Loan request not found' })
  getRepayments(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.loansService.getRepayments(id, userId);
  }

  @Get(':id/ledger')
  // @RequireEntity('requests')
  @ApiOperation({ summary: 'Get the transaction ledger for my loan' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  @ApiResponse({ status: 200, description: 'Chronological array of ledger entries' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Loan request not found' })
  getLedger(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.loansService.getLedger(id, userId);
  }
}
