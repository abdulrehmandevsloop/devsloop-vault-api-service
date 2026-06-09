import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateEventDto } from './create-event.dto';

/**
 * Update accepts the same fields as create (all optional). Assignees and
 * attachments are managed through their dedicated endpoints, so they are
 * omitted here to keep update focused on the event's own fields.
 */
export class UpdateEventDto extends PartialType(
  OmitType(CreateEventDto, ['userIds', 'roleIds', 'attachments'] as const),
) {}
