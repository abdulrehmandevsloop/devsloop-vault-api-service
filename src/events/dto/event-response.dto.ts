import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EventPriority, EventStatus } from '@prisma/client';

export class EventAttachmentDto {
  @ApiProperty() id: string;
  @ApiProperty() fileName: string;
  @ApiProperty() fileUrl: string;
  @ApiPropertyOptional() fileSize?: number | null;
  @ApiProperty() createdAt: string;
}

export class EventRoleAssigneeDto {
  @ApiProperty() roleId: string;
  @ApiProperty() roleName: string;
  @ApiProperty() roleDisplayName: string;
}

/** Per-assignee resolved status used in admin views. */
export type AssigneeStatus = 'completed' | 'pending' | 'overdue';

export class EventAssigneeStatusDto {
  @ApiProperty() userId: string;
  @ApiProperty() userName: string;
  @ApiPropertyOptional() userEmail?: string | null;
  @ApiPropertyOptional() avatarUrl?: string | null;
  @ApiProperty({ enum: ['completed', 'pending', 'overdue'] }) status: AssigneeStatus;
  @ApiProperty({ description: 'Whether the user was reached via a role assignment' })
  viaRole: boolean;
  @ApiPropertyOptional({
    type: [String],
    description: 'Role display names that assigned this user',
  })
  roleNames?: string[];
  @ApiPropertyOptional() completedAt?: string | null;
  @ApiPropertyOptional() notes?: string | null;
}

/** Summary counts for an event. */
export class EventStatsDto {
  @ApiProperty() totalAssigned: number;
  @ApiProperty() completed: number;
  @ApiProperty() pending: number;
  @ApiProperty() overdue: number;
  @ApiProperty({ description: 'Completion percentage 0-100' }) completionRate: number;
}

/** List-row shape — lightweight, includes completion progress. */
export class EventListItemDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional() description?: string | null;
  @ApiPropertyOptional() startDate?: string | null;
  @ApiProperty() dueDate: string;
  @ApiProperty({ enum: EventPriority }) priority: EventPriority;
  @ApiProperty({ enum: EventStatus }) status: EventStatus;
  @ApiProperty() createdById: string;
  @ApiPropertyOptional() createdByName?: string;
  @ApiProperty() createdAt: string;
  @ApiProperty({ type: EventStatsDto }) stats: EventStatsDto;
  @ApiProperty({ type: [EventAttachmentDto] }) attachments: EventAttachmentDto[];
}

/** Full detail shape. */
export class EventDetailDto extends EventListItemDto {
  @ApiProperty({ type: [EventRoleAssigneeDto] }) roleAssignees: EventRoleAssigneeDto[];
  @ApiProperty({ type: [String], description: 'Directly-assigned user IDs' })
  directUserIds: string[];
  @ApiProperty({ type: [EventAssigneeStatusDto] }) assignees: EventAssigneeStatusDto[];
}

export class EventListResponseDto {
  @ApiProperty({ type: [EventListItemDto] }) data: EventListItemDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}

/** The assignee-facing shape ("My Events"). */
export class MyEventItemDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional() description?: string | null;
  @ApiPropertyOptional() startDate?: string | null;
  @ApiProperty() dueDate: string;
  @ApiProperty({ enum: EventPriority }) priority: EventPriority;
  @ApiProperty({ enum: EventStatus }) status: EventStatus;
  @ApiProperty({ enum: ['completed', 'pending', 'overdue'] }) myStatus: AssigneeStatus;
  @ApiPropertyOptional() completedAt?: string | null;
  @ApiPropertyOptional() notes?: string | null;
  @ApiPropertyOptional() createdByName?: string;
  @ApiProperty({ type: [EventAttachmentDto] }) attachments: EventAttachmentDto[];
}

export class MyEventDetailDto extends MyEventItemDto {
  @ApiProperty({ type: [EventAttachmentDto], description: 'My completion evidence' })
  myEvidence: EventAttachmentDto[];
}

export class MyEventsListResponseDto {
  @ApiProperty({ type: [MyEventItemDto] }) data: MyEventItemDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}

/** User-level analytics. */
export class UserEventAnalyticsDto {
  @ApiProperty() assigned: number;
  @ApiProperty() completed: number;
  @ApiProperty() pending: number;
  @ApiProperty() overdue: number;
  @ApiProperty({ description: 'Average completion rate 0-100 (completed / assigned)' })
  completionRate: number;
}
