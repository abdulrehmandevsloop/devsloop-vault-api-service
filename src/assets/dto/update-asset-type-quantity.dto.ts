import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class UpdateAssetTypeQuantityDto {
  @ApiProperty({
    description: 'Total inventory quantity. Must be >= assigned quantity and >= 0.',
    example: 10,
    minimum: 0,
  })
  @IsInt()
  @Min(0, { message: 'Quantity cannot be below zero' })
  totalQuantity: number;
}
