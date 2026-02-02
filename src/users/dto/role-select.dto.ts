import { ApiProperty } from '@nestjs/swagger';

export class RoleSelectDto {
  @ApiProperty({ example: 'cmkxwe4s20000lqvshjgp9iv1', description: 'Role ID' })
  id: string;

  @ApiProperty({ example: 'Team Lead', description: 'Role display name' })
  displayName: string;

  @ApiProperty({ example: true, description: 'Whether the role is active' })
  isActive: boolean;

  @ApiProperty({ example: false, description: 'Whether the role is a system role' })
  isSystem: boolean;
}
