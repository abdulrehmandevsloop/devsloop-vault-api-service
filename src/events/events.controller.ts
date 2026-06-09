import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CuidValidationPipe } from 'src/common';
import { RequireEntity } from 'src/common/decorators';
import { EventsService } from './events.service';
import {
  CreateEventDto,
  EventAttachmentInputDto,
  EventDetailDto,
  EventListResponseDto,
  EventQueryDto,
  SetAssigneesDto,
  UpdateEventDto,
  UserEventAnalyticsDto,
} from './dto';

@ApiTags('Events (Admin)')
@ApiBearerAuth('JWT-auth')
@Controller('admin/events')
@RequireEntity('event')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an event (requires write)' })
  @ApiResponse({ status: 201, type: EventDetailDto })
  create(@Body() dto: CreateEventDto, @CurrentUser('id') userId: string) {
    return this.eventsService.create(dto, userId);
  }

  @Get()
  @ApiOperation({ summary: 'List all events with completion stats (requires read_all)' })
  @ApiResponse({ status: 200, type: EventListResponseDto })
  findAll(@Query() query: EventQueryDto, @CurrentUser('id') userId: string) {
    return this.eventsService.findAll(query, userId);
  }

  // Static paths — must precede /:id

  @Get('meta/users')
  @ApiOperation({ summary: 'Users for event pickers and the assignee filter (read_all)' })
  metaUsers(@CurrentUser('id') userId: string) {
    return this.eventsService.metaUsers(userId);
  }

  @Get('meta/roles')
  @ApiOperation({ summary: 'Roles for event pickers (read_all)' })
  metaRoles(@CurrentUser('id') userId: string) {
    return this.eventsService.metaRoles(userId);
  }

  @Get('analytics/users/:userId')
  @ApiOperation({ summary: 'User-level event analytics (requires read_all)' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiResponse({ status: 200, type: UserEventAnalyticsDto })
  userAnalytics(
    @Param('userId', CuidValidationPipe) targetUserId: string,
    @CurrentUser('id') requesterId: string,
  ) {
    return this.eventsService.getUserAnalytics(targetUserId, requesterId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Event detail incl. resolved assignees & stats (read_all/write)' })
  @ApiParam({ name: 'id', description: 'Event ID' })
  @ApiResponse({ status: 200, type: EventDetailDto })
  findOne(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.eventsService.findOne(id, userId);
  }

  @Get(':id/analytics')
  @ApiOperation({ summary: 'Event-level analytics & per-user breakdown (read_all/write)' })
  @ApiParam({ name: 'id', description: 'Event ID' })
  @ApiResponse({ status: 200, type: EventDetailDto })
  analytics(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.eventsService.getAnalytics(id, userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an event (requires write)' })
  @ApiParam({ name: 'id', description: 'Event ID' })
  @ApiResponse({ status: 200, type: EventDetailDto })
  update(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: UpdateEventDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.eventsService.update(id, dto, userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an event (requires write)' })
  @ApiParam({ name: 'id', description: 'Event ID' })
  @ApiResponse({ status: 204 })
  remove(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.eventsService.remove(id, userId);
  }

  @Put(':id/assignees')
  @ApiOperation({ summary: 'Replace the event assignees (users + roles) (requires write)' })
  @ApiParam({ name: 'id', description: 'Event ID' })
  @ApiResponse({ status: 200, type: EventDetailDto })
  setAssignees(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: SetAssigneesDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.eventsService.setAssignees(id, dto, userId);
  }

  @Post(':id/attachments')
  @ApiOperation({ summary: 'Attach a file to an event (requires write)' })
  @ApiParam({ name: 'id', description: 'Event ID' })
  addAttachment(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: EventAttachmentInputDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.eventsService.addAttachment(id, dto, userId);
  }

  @Delete(':id/attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an event attachment (requires write)' })
  @ApiParam({ name: 'id', description: 'Event ID' })
  @ApiParam({ name: 'attachmentId', description: 'Attachment ID' })
  @ApiResponse({ status: 204 })
  removeAttachment(
    @Param('id', CuidValidationPipe) id: string,
    @Param('attachmentId', CuidValidationPipe) attachmentId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.eventsService.removeAttachment(id, attachmentId, userId);
  }
}
