import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RoleSelectDto {
  @ApiProperty({ example: 'cmkxwe4s20000lqvshjgp9iv1', description: 'Role ID' })
  id: string;

  @ApiProperty({ example: 'Team Lead', description: 'Role display name' })
  displayName: string;

  @ApiProperty({ example: true, description: 'Whether the role is active' })
  isActive: boolean;

  @ApiProperty({ example: false, description: 'Whether this is a system role' })
  systemRole: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'Whether this role is assigned to the queried user (only present when userId query param is provided)',
  })
  isAssigned?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'Whether this is the primary role for the queried user (only present when userId query param is provided)',
  })
  isPrimary?: boolean;
}
