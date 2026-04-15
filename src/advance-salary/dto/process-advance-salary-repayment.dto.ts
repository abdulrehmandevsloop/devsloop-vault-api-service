import { IsOptional, IsString, MaxLength, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProcessAdvanceSalaryRepaymentDto {
  @ApiProperty({ description: 'Installment number to process', example: 1 })
  @IsInt()
  @Min(1)
  installmentNo: number;

  @ApiPropertyOptional({ description: 'Optional processing note', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  processingNote?: string;
}
