import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class UpdateAssetQuantityDto {
  @ApiProperty({
    description: 'Total inventory quantity for this asset. Must be >= assigned quantity and >= 0.',
    example: 10,
    minimum: 0,
  })
  @IsInt()
  @Min(0, { message: 'Quantity cannot be below zero' })
  totalQuantity: number;
}
