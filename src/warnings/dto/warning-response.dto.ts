import { ApiProperty } from '@nestjs/swagger';
import { WarningType } from '@prisma/client';

export class PaginatedWarningsResponseDto {
  @ApiProperty({ type: () => [WarningResponseDto] })
  data: WarningResponseDto[];

  @ApiProperty({ description: 'Total number of warnings' })
  total: number;

  @ApiProperty({ description: 'Current page' })
  page: number;

  @ApiProperty({ description: 'Items per page' })
  limit: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages: number;

  @ApiProperty()
  hasNextPage: boolean;

  @ApiProperty()
  hasPreviousPage: boolean;
}

export class WarningResponseDto {
  @ApiProperty({ description: 'Warning ID (CUID)' })
  id: string;

  @ApiProperty({ description: 'User ID this warning belongs to' })
  userId: string;

  @ApiProperty({ description: 'Warning message' })
  message: string;

  @ApiProperty({ description: 'Severity type of the warning', enum: WarningType })
  warningType: WarningType;

  @ApiProperty({ description: 'When the warning was created' })
  createdAt: string;

  @ApiProperty({ description: 'ID of the user who created this warning', required: false })
  createdById?: string;

  @ApiProperty({ description: 'Name of the user who created this warning', required: false })
  createdByName?: string;
}
