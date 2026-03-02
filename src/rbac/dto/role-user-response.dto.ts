import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RoleUserItemDto {
  @ApiProperty({ description: 'User ID', example: 'clx1234567890' })
  id: string;

  @ApiProperty({ description: 'User name', example: 'John Doe' })
  name: string;

  @ApiProperty({ description: 'User email', example: 'john@example.com' })
  email: string;

  @ApiProperty({
    description: 'Departments',
    example: ['Software Engineering'],
    type: [String],
    default: [],
  })
  departments: string[];

  @ApiPropertyOptional({ description: 'Avatar URL' })
  avatarUrl: string | null;

  @ApiProperty({ description: 'Whether the user is assigned to this role', example: true })
  isAssigned: boolean;

  @ApiPropertyOptional({ description: 'When the user was assigned (null if not assigned)' })
  assignedAt: Date | null;
}

export class RoleUsersResponseDto {
  @ApiProperty({ type: [RoleUserItemDto], description: 'List of users' })
  data: RoleUserItemDto[];

  @ApiProperty({ description: 'Total number of users', example: 25 })
  total: number;
}
