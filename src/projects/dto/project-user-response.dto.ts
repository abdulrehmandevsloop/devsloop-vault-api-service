import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProjectUserItemDto {
  @ApiProperty({ description: 'User ID', example: 'clx1234567890' })
  id: string;

  @ApiProperty({ description: 'User name', example: 'John Doe' })
  name: string;

  @ApiProperty({ description: 'User email', example: 'john@example.com' })
  email: string;

  @ApiPropertyOptional({ description: 'Department', example: 'Engineering' })
  department: string | null;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  avatarUrl: string | null;

  @ApiProperty({ description: 'Whether the user is assigned to this project', example: true })
  isAssigned: boolean;

  @ApiPropertyOptional({ description: 'When the user was assigned (null if not assigned)' })
  assignedAt: Date | null;
}

export class ProjectUsersResponseDto {
  @ApiProperty({ type: [ProjectUserItemDto], description: 'List of users' })
  data: ProjectUserItemDto[];

  @ApiProperty({ description: 'Total number of users', example: 25 })
  total: number;
}
