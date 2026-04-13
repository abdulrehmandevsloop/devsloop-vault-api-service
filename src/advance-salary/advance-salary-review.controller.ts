import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { AdvanceSalaryService } from 'src/advance-salary/advance-salary.service';
import {
  ApproveAdvanceSalaryDto,
  RejectAdvanceSalaryDto,
  DisburseAdvanceSalaryDto,
  ManagementAdvanceSalaryQueryDto,
} from 'src/advance-salary/dto';
import { RequireEntity } from 'src/common/decorators';
import { CurrentUser } from 'src/common';
import { CuidValidationPipe } from 'src/common/pipes/cuid-validation.pipe';

@ApiTags('Advance Salary Review')
@ApiBearerAuth('JWT-auth')
@Controller('advance-salary-review')
export class AdvanceSalaryReviewController {
  constructor(private readonly advanceSalaryService: AdvanceSalaryService) {}

  @Get()
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Get all advance salary requests (management)' })
  findAll(@Query() query: ManagementAdvanceSalaryQueryDto) {
    return this.advanceSalaryService.findAll(query);
  }

  @Get(':id')
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Get advance salary request details (management)' })
  @ApiParam({ name: 'id', description: 'Advance salary request ID' })
  findOne(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.advanceSalaryService.findOne(id, userId, true);
  }

  @Get(':id/repayments')
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Get repayment schedule (management)' })
  @ApiParam({ name: 'id', description: 'Advance salary request ID' })
  getRepayments(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.advanceSalaryService.getRepayments(id, userId, true);
  }

  @Post(':id/approve')
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Approve an advance salary request' })
  @ApiParam({ name: 'id', description: 'Advance salary request ID' })
  approve(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: ApproveAdvanceSalaryDto,
    @CurrentUser('id') reviewerId: string,
  ) {
    return this.advanceSalaryService.approve(id, dto, reviewerId);
  }

  @Post(':id/reject')
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Reject an advance salary request' })
  @ApiParam({ name: 'id', description: 'Advance salary request ID' })
  reject(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: RejectAdvanceSalaryDto,
    @CurrentUser('id') reviewerId: string,
  ) {
    return this.advanceSalaryService.reject(id, dto, reviewerId);
  }

  @Post(':id/disburse')
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Mark an advance salary request as disbursed' })
  @ApiParam({ name: 'id', description: 'Advance salary request ID' })
  disburse(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: DisburseAdvanceSalaryDto,
    @CurrentUser('id') disburserId: string,
  ) {
    return this.advanceSalaryService.disburse(id, dto, disburserId);
  }
}
