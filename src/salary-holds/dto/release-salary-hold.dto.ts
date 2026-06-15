import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';

export class ReleaseSalaryHoldDto {
  @ApiProperty({ description: 'Amount to release (PKR)', example: 100000 })
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiPropertyOptional({
    description:
      'Target payroll month (YYYY-MM) the released amount is added to. Defaults to the current open period.',
    example: '2026-09',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'yearMonth must be a valid YYYY-MM month' })
  yearMonth?: string;

  @ApiPropertyOptional({ description: 'Optional note recorded on the release' })
  @IsOptional()
  @IsString()
  remarks?: string;
}
