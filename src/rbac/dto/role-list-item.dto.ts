import { ApiProperty } from '@nestjs/swagger';

export class RoleListItemDto {
  @ApiProperty({ example: 'cmkxwe4s20000lqvshjgp9iv1', description: 'Role ID' })
  id: string;

  @ApiProperty({ example: 'team-lead', description: 'Role name' })
  name: string;

  @ApiProperty({ example: 'Team Lead', description: 'Role display name' })
  displayName: string;

  @ApiProperty({ example: true, description: 'Whether the role is active' })
  isActive: boolean;
}
