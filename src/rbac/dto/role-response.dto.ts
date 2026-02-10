import { ApiProperty } from '@nestjs/swagger';

export class EntityResponseDto {
  @ApiProperty({ example: 'cmkxwe4s20000lqvshjgp9iv1' })
  id: string;

  @ApiProperty({ example: 'project' })
  name: string;

  @ApiProperty({ example: 'Project' })
  displayName: string;

  @ApiProperty({ nullable: true, example: 'Project management entity' })
  description: string | null;

  @ApiProperty({ example: true })
  isActive: boolean;
}

export class RoleResponseDto {
  @ApiProperty({ example: 'cmkxwe4s20000lqvshjgp9iv1' })
  id: string;

  @ApiProperty({ example: 'team-lead' })
  name: string;

  @ApiProperty({ example: 'Team Lead' })
  displayName: string;

  @ApiProperty({ nullable: true, example: 'Can manage projects and tasks' })
  description: string | null;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({
    example: false,
    description: 'Whether this is a system role (only visible to system users)',
  })
  systemRole: boolean;

  @ApiProperty({ type: [EntityResponseDto] })
  entities: EntityResponseDto[];

  @ApiProperty({ example: 5, description: 'Number of users with this role' })
  userCount: number;

  @ApiProperty({ example: '2026-01-28T12:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-01-28T12:00:00.000Z' })
  updatedAt: Date;
}

export class PaginatedRoleResponseDto {
  @ApiProperty({ type: [RoleResponseDto] })
  data: RoleResponseDto[];

  @ApiProperty({ example: 10 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ example: 1 })
  totalPages: number;

  @ApiProperty({ example: false })
  hasNextPage: boolean;

  @ApiProperty({ example: false })
  hasPreviousPage: boolean;
}
