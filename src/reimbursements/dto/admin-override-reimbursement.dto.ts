import { IsString, IsOptional, IsEnum, MaxLength, IsNumber, Min, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReimbursementStatus } from '@prisma/client';

export class AdminOverrideReimbursementDto {
  @ApiPropertyOptional({
    description: 'New approved amount (optional, only if updating amount)',
    example: 5000,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  approvedAmount?: number;

  @ApiPropertyOptional({
    description: 'New status (optional, only if changing status)',
    enum: ReimbursementStatus,
  })
  @IsOptional()
  @IsEnum(ReimbursementStatus)
  status?: ReimbursementStatus;

  @ApiProperty({
    description: 'Mandatory reason for the administrative override (will be saved as hrComment)',
    example: 'Employee provided missing receipt after initial approval',
  })
  @IsString()
  @MaxLength(2000)
  hrComment: string;

  @ApiPropertyOptional({
    description: 'Whether to recalculate remaining installments if amount changed (for future use)',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  recalculateInstallments?: boolean;
}
