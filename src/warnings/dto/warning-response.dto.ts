import { ApiProperty } from '@nestjs/swagger';

export class WarningResponseDto {
  @ApiProperty({ description: 'Warning ID (CUID)' })
  id: string;

  @ApiProperty({ description: 'User ID this warning belongs to' })
  userId: string;

  @ApiProperty({ description: 'Warning message' })
  message: string;

  @ApiProperty({ description: 'When the warning was created' })
  createdAt: string;

  @ApiProperty({ description: 'ID of the user who created this warning', required: false })
  createdById?: string;

  @ApiProperty({ description: 'Name of the user who created this warning', required: false })
  createdByName?: string;
}
