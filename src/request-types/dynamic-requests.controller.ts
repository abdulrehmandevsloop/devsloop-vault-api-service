import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common';
import { SubmitDynamicRequestDto } from './dto';
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
  findMyRequests(
    @CurrentUser('id') requesterId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findMyRequests(
      requesterId,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }
}
