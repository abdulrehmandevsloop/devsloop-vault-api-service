import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CuidValidationPipe } from 'src/common';
import { RequireEntity } from 'src/common/decorators';
import { EventsService } from './events.service';
import {
  CompleteEventDto,
  MyEventDetailDto,
  MyEventsListResponseDto,
  MyEventsQueryDto,
  UserEventAnalyticsDto,
} from './dto';

@ApiTags('My Events')
@ApiBearerAuth('JWT-auth')
@Controller('my-events')
@RequireEntity('event')
export class MyEventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiOperation({
    summary: 'List events assigned to me (filter: upcoming/overdue/completed/pending)',
  })
  @ApiResponse({ status: 200, type: MyEventsListResponseDto })
  listMine(@Query() query: MyEventsQueryDto, @CurrentUser('id') userId: string) {
    return this.eventsService.listMine(query, userId);
  }

  // Static path — must precede /:id
  @Get('analytics')
  @ApiOperation({ summary: 'My personal event completion analytics' })
  @ApiResponse({ status: 200, type: UserEventAnalyticsDto })
  myAnalytics(@CurrentUser('id') userId: string) {
    return this.eventsService.myAnalytics(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail of an event assigned to me' })
  @ApiParam({ name: 'id', description: 'Event ID' })
  @ApiResponse({ status: 200, type: MyEventDetailDto })
  findOneMine(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.eventsService.findOneMine(id, userId);
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Mark the event complete with optional notes & evidence' })
  @ApiParam({ name: 'id', description: 'Event ID' })
  @ApiResponse({ status: 201, type: MyEventDetailDto })
  complete(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: CompleteEventDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.eventsService.complete(id, dto, userId);
  }

  @Delete(':id/complete')
  @ApiOperation({ summary: 'Undo my completion of the event' })
  @ApiParam({ name: 'id', description: 'Event ID' })
  @ApiResponse({ status: 200, type: MyEventDetailDto })
  uncomplete(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.eventsService.uncomplete(id, userId);
  }
}
