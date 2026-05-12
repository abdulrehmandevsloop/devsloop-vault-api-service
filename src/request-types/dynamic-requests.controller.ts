import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequireEntity, CuidValidationPipe } from 'src/common';
import { SubmitDynamicRequestDto } from './dto';
import { HrSplitLeaveRequestDto } from 'src/leaves/dto';
import { DynamicRequestsService } from './dynamic-requests.service';

@ApiTags('Dynamic Requests')
@ApiBearerAuth('JWT-auth')
@Controller('dynamic-requests')
export class DynamicRequestsController {
  constructor(private readonly service: DynamicRequestsService) {}

  @Post()
  submit(@CurrentUser('id') requesterId: string, @Body() dto: SubmitDynamicRequestDto) {
    return this.service.submit(requesterId, dto);
  }

  @Get('my-requests')
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'typeKey', required: false, type: String })
  findMyRequests(
    @CurrentUser('id') requesterId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('typeKey') typeKey?: string,
  ) {
    return this.service.findMyRequests(
      requesterId,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
      typeKey,
    );
  }

  @Get('for-review')
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'typeKey', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  findForReview(
    @CurrentUser('id') actorId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('typeKey') typeKey?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findForReview(
      actorId,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
      typeKey,
      status,
    );
  }

  @Get(':id')
  findOne(@Param('id', CuidValidationPipe) id: string) {
    return this.service.findOneForReview(id);
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
}
