import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssetStatus } from '@prisma/client';

export class AssetTypeDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class AssignedEmployeeDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;
}

export class AssetResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  assetName: string;

  @ApiProperty({ type: AssetTypeDto })
  assetType: AssetTypeDto;

  @ApiProperty()
  serialNumber: string;

  @ApiPropertyOptional()
  purchaseDate: Date | null;

  @ApiProperty({ enum: AssetStatus })
  status: AssetStatus;

  @ApiProperty({ description: 'Total inventory quantity for this asset' })
  totalQuantity: number;

  @ApiProperty({ description: 'Number currently assigned' })
  assignedQuantity: number;

  @ApiProperty({ description: 'Available to assign (totalQuantity - assignedQuantity)' })
  availableQuantity: number;

  @ApiPropertyOptional({
    type: [AssignedEmployeeDto],
    description: 'Employees currently assigned to this asset (can be multiple)',
  })
  assignedEmployees: AssignedEmployeeDto[];

  @ApiPropertyOptional()
  notes: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class AssetListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  assetName: string;

  @ApiProperty()
  assetTypeName: string;

  @ApiProperty({ description: 'Asset type ID' })
  assetTypeId: string;

  @ApiProperty({ description: 'Total inventory for this asset' })
  totalQuantity: number;

  @ApiProperty({ description: 'Assigned count for this asset' })
  assignedQuantity: number;

  @ApiProperty({ description: 'Available count for this asset' })
  availableQuantity: number;

  @ApiProperty()
  serialNumber: string;

  @ApiProperty({ enum: AssetStatus })
  status: AssetStatus;

  @ApiPropertyOptional({
    description: 'Names of assignees (e.g. "John, Jane" when multiple)',
  })
  assignedToName: string | null;

  @ApiProperty()
  createdAt: Date;
}
