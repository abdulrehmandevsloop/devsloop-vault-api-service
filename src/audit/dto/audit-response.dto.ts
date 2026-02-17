import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuditLogUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional()
  avatarUrl: string | null;
}

export class EntityDetailsDto {
  @ApiPropertyOptional({
    description: 'Display label for the entity (e.g. user name, contribution problem)',
  })
  label?: string;

  @ApiPropertyOptional({ description: 'Secondary info (e.g. user email, project name)' })
  description?: string;
}

export class AuditLogResponseDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({ type: AuditLogUserDto })
  user: AuditLogUserDto | null;

  @ApiProperty()
  action: string;

  @ApiProperty()
  entityType: string;

  @ApiProperty()
  entityId: string;

  @ApiPropertyOptional({
    type: EntityDetailsDto,
    description: 'Resolved entity details for entityId',
  })
  entityDetails: EntityDetailsDto | null;

  @ApiPropertyOptional({ description: 'JSON changes object with resolved names' })
  changes: Record<string, any> | null;

  @ApiPropertyOptional()
  ipAddress: string | null;

  @ApiPropertyOptional()
  userAgent: string | null;

  @ApiProperty()
  timestamp: Date;
}

export class PaginatedAuditLogsResponseDto {
  @ApiProperty({ type: [AuditLogResponseDto] })
  data: AuditLogResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;

  @ApiProperty()
  hasNextPage: boolean;

  @ApiProperty()
  hasPreviousPage: boolean;
}

export class AuditFilterOptionsDto {
  @ApiProperty({ type: [String] })
  actions: string[];

  @ApiProperty({ type: [String] })
  entityTypes: string[];
}
