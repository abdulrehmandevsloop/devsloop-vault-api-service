import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { LoansService } from 'src/loans/loans.service';
import { CreateLoanRequestDto, UpdateLoanRequestDto, LoansQueryDto } from 'src/loans/dto';
import { RequireEntity } from 'src/common/decorators';
import { CurrentUser } from 'src/common';
import { CuidValidationPipe } from 'src/common/pipes/cuid-validation.pipe';

@ApiTags('Loans')
@ApiBearerAuth('JWT-auth')
@Controller('loans')
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  @Post()
  @RequireEntity('requests')
  @ApiOperation({ summary: 'Submit a new loan request' })
  create(@Body() dto: CreateLoanRequestDto, @CurrentUser('id') userId: string) {
    return this.loansService.create(dto, userId);
  }

  @Get()
  @RequireEntity('requests')
  @ApiOperation({ summary: 'Get my loan requests' })
  findMyLoans(@Query() query: LoansQueryDto, @CurrentUser('id') userId: string) {
    return this.loansService.findMyLoans(userId, query);
  }

  @Get(':id')
  @RequireEntity('requests')
  @ApiOperation({ summary: 'Get a single loan request' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  findOne(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.loansService.findOne(id, userId);
  }

  @Patch(':id')
  @RequireEntity('requests')
  @ApiOperation({ summary: 'Update a pending loan request' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  update(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: UpdateLoanRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.loansService.update(id, dto, userId);
  }

  @Delete(':id')
  @RequireEntity('requests')
  @ApiOperation({ summary: 'Cancel a pending loan request' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  cancel(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.loansService.cancel(id, userId);
  }

  @Get(':id/repayments')
  @RequireEntity('requests')
  @ApiOperation({ summary: 'Get repayment schedule for a loan' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  getRepayments(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.loansService.getRepayments(id, userId);
  }
}
