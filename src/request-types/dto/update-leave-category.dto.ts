import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateLeaveCategoryDto {
  @ApiProperty({
    enum: ['PAID', 'UNPAID', 'AUTO'],
    description: 'AUTO recalculates from current leave balance',
  })
  @IsEnum(['PAID', 'UNPAID', 'AUTO'])
  category: 'PAID' | 'UNPAID' | 'AUTO';
}
