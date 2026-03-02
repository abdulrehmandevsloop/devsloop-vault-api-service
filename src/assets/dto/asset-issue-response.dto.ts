import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssetIssueResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  assetId: string;

  @ApiProperty()
  assetName: string;

  @ApiProperty()
  serialNumber: string;

  @ApiProperty()
  issueType: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  priority: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  reportedById: string;

  @ApiProperty()
  reportedByName: string;

  @ApiProperty()
  reportedByEmail: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional()
  resolvedAt: Date | null;

  @ApiPropertyOptional()
  resolvedById: string | null;
}

export class AssetIssueListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  assetId: string;

  @ApiProperty()
  assetName: string;

  @ApiProperty()
  serialNumber: string;

  @ApiProperty()
  issueType: string;

  @ApiProperty()
  priority: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  reportedByName: string;

  @ApiProperty()
  createdAt: Date;
}
