import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAssetDto {
  @ApiPropertyOptional()
  assetName?: string;

  @ApiPropertyOptional()
  serialNumber?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  purchaseDate?: string | null;

  @ApiPropertyOptional()
  notes?: string | null;
}
