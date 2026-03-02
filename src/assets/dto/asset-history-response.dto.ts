import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssetEventType } from '@prisma/client';

export class AssetHistoryItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: AssetEventType })
  eventType: AssetEventType;

  @ApiProperty({ description: 'User ID who performed the action' })
  performedBy: string;

  @ApiPropertyOptional({ description: 'Employee ID if relevant (e.g. assigned to)' })
  employeeId: string | null;

  @ApiPropertyOptional({ description: 'Additional event metadata (e.g. employee name)' })
  metadata: Record<string, unknown> | null;

  @ApiProperty()
  createdAt: Date;
}
