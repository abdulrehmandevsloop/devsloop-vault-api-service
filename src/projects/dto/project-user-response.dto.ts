import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

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

export class RoleCountDto {
  @ApiProperty({ description: 'Role ID', example: 'clx1234567890' })
  id: string;

  @ApiProperty({ description: 'Role display name', example: 'Developer' })
  displayName: string;

  @ApiProperty({ description: 'Number of users with this role', example: 5 })
  count: number;
}

export class ProjectUsersQueryDto {
  @ApiPropertyOptional({
    description: 'Filter users by role ID',
    example: 'clx1234567890',
  })
  @IsOptional()
  @IsString()
  roleId?: string;

  @ApiPropertyOptional({
    description: 'Include role counts in response',
    example: true,
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeRoleCounts?: boolean;
}

export class ProjectUsersResponseDto {
  @ApiProperty({ type: [ProjectUserItemDto], description: 'List of users' })
  data: ProjectUserItemDto[];

  @ApiProperty({ description: 'Total number of users', example: 25 })
  total: number;

  @ApiPropertyOptional({
    type: [RoleCountDto],
    description: 'Counts per role (only included when includeRoleCounts=true)',
  })
  roleCounts?: RoleCountDto[];
}
