import {
  IsArray,
  IsInt,
  IsNumber,
  IsString,
  Matches,
  Min,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class InstallmentItemDto {
  @ApiProperty({ description: '1-based installment sequence number', example: 1 })
  @IsInt()
  @Min(1)
  installmentNo: number;

  @ApiProperty({
    description: 'Month this installment is scheduled for (YYYY-MM)',
    example: '2026-04',
  })
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'scheduledMonth must be in YYYY-MM format' })
  scheduledMonth: string;

  @ApiProperty({ description: 'Amount for this installment (PKR)', example: 3333.33 })
  @IsNumber()
  @Min(0.01)
  amount: number;
}

export class CreateInstallmentPlanDto {
  @ApiProperty({
    type: [InstallmentItemDto],
    description: 'List of installments. Sum of all amounts must equal the approved amount.',
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => InstallmentItemDto)
  installments: InstallmentItemDto[];
}
