import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssetStatus } from '@prisma/client';

export class MyAssignedAssetTypeDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class MyAssignedAssetDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  assetName: string;

  @ApiProperty({ type: MyAssignedAssetTypeDto })
  assetType: MyAssignedAssetTypeDto;

  @ApiProperty()
  serialNumber: string;

  @ApiPropertyOptional()
  purchaseDate: Date | null;

  @ApiProperty({ enum: AssetStatus })
  status: AssetStatus;

  @ApiProperty({ description: 'Date this asset was assigned to you' })
  assignedAt: Date;

  @ApiPropertyOptional()
  notes: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
