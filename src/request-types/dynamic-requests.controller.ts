import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequireEntity, CuidValidationPipe } from 'src/common';
import { HrModifyDynamicLeaveDto, SubmitDynamicRequestDto, UpdateLeaveCategoryDto } from './dto';
import { HrSplitLeaveRequestDto } from 'src/leaves/dto';
import { DynamicRequestsService } from './dynamic-requests.service';
import { ReimbursementInstallmentsService } from 'src/reimbursements/reimbursement-installments.service';
import { CreateInstallmentPlanDto } from 'src/reimbursements/dto';

@ApiTags('Dynamic Requests')
@ApiBearerAuth('JWT-auth')
@Controller('dynamic-requests')
export class DynamicRequestsController {
  constructor(
    private readonly service: DynamicRequestsService,
    private readonly installmentsService: ReimbursementInstallmentsService,
  ) {}

  @Post()
  submit(@CurrentUser('id') requesterId: string, @Body() dto: SubmitDynamicRequestDto) {
    return this.service.submit(requesterId, dto);
  }

  @Get('my-requests')
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'typeKey', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  findMyRequests(
    @CurrentUser('id') requesterId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('typeKey') typeKey?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findMyRequests(
      requesterId,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
      typeKey,
      status,
    );
  }

  @Get('for-review')
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'typeKey', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'reviewerStatus', required: false, type: String })
  findForReview(
    @CurrentUser('id') actorId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('typeKey') typeKey?: string,
    @Query('status') status?: string,
    @Query('reviewerStatus') reviewerStatus?: string,
  ) {
    return this.service.findForReview(
      actorId,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
      typeKey,
      status,
      reviewerStatus,
    );
  }

  @Get(':id')
  findOne(@Param('id', CuidValidationPipe) id: string) {
    return this.service.findOneForReview(id);
  }

  @Post(':id/cancel')
  cancelRequest(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') requesterId: string,
  ) {
    return this.service.cancelRequest(id, requesterId);
  }

  @Delete(':id')
  @RequireEntity('user')
  @ApiOperation({ summary: 'Permanently delete a dynamic request (HR only)' })
  @ApiParam({ name: 'id', description: 'Dynamic request ID' })
  hrDeleteRequest(@Param('id', CuidValidationPipe) id: string) {
    return this.service.hrDeleteRequest(id);
  }

  @Patch(':id/modify-leave')
  @RequireEntity('user')
  @ApiOperation({ summary: 'Modify a dynamic leave request (HR only)' })
  @ApiParam({ name: 'id', description: 'Dynamic request ID' })
  hrModifyLeave(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') hrId: string,
    @Body() dto: HrModifyDynamicLeaveDto,
  ) {
    return this.service.hrModifyDynamicLeave(id, hrId, dto);
  }

  @Patch(':id/leave-category')
  @RequireEntity('user')
  @ApiOperation({ summary: 'Override leave pay category (HR only)' })
  @ApiParam({ name: 'id', description: 'Dynamic request ID' })
  updateLeaveCategory(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: UpdateLeaveCategoryDto,
  ) {
    return this.service.updateLeaveCategory(id, dto);
  }

  @Post(':id/split-leave')
  @RequireEntity('user')
  @ApiOperation({ summary: 'Split an approved leave request into multiple parts (HR only)' })
  @ApiParam({ name: 'id', description: 'Dynamic request ID' })
  splitLeave(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') hrId: string,
    @Body() dto: HrSplitLeaveRequestDto,
  ) {
    return this.service.splitLeave(id, hrId, dto);
  }

  @Post(':id/installment-plan')
  @RequireEntity('user')
  @ApiOperation({
    summary: 'Create installment plan for an approved reimbursement dynamic request (HR only)',
  })
  @ApiParam({ name: 'id', description: 'Dynamic request ID' })
  createInstallmentPlan(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') hrId: string,
    @Body() dto: CreateInstallmentPlanDto & { approvedAmount: number },
  ) {
    return this.installmentsService.createPlanForDynamicRequest(id, dto, hrId);
  }

  @Get(':id/installment-plan')
  @ApiOperation({ summary: 'Get installment plan for a dynamic reimbursement request' })
  @ApiParam({ name: 'id', description: 'Dynamic request ID' })
  getInstallmentPlan(@Param('id', CuidValidationPipe) id: string) {
    return this.installmentsService.getInstallmentsForDynamicRequest(id);
  }

  @Delete(':id/installment-plan')
  @RequireEntity('user')
  @ApiOperation({
    summary: 'Delete installment plan for a dynamic reimbursement request (HR only)',
  })
  @ApiParam({ name: 'id', description: 'Dynamic request ID' })
  deleteInstallmentPlan(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') hrId: string,
  ) {
    return this.installmentsService.deletePlanForDynamicRequest(id, hrId);
  }
}
