import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProjectUserItemDto {
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

  @ApiProperty({ description: 'Whether the user is assigned to this project', example: true })
  isAssigned: boolean;

  @ApiPropertyOptional({ description: 'When the user was assigned (null if not assigned)' })
  assignedAt: Date | null;

  @ApiProperty({
    description: 'Role display names assigned to this user',
    type: [String],
    example: ['QA Engineer'],
  })
  roles: string[];

  @ApiProperty({
    description: 'Entity permission names this user holds (worklog-team, contribution-review)',
    type: [String],
    example: ['worklog-team', 'contribution-review'],
  })
  entityPermissions: string[];
}

export class ProjectUsersResponseDto {
  @ApiProperty({ type: [ProjectUserItemDto], description: 'List of users' })
  data: ProjectUserItemDto[];

  @ApiProperty({ description: 'Total number of users', example: 25 })
  total: number;
}
