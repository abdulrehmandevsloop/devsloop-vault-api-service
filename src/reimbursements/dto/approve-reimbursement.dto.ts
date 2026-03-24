import { IsString, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReimbursementProcessingType } from '@prisma/client';

export class ApproveReimbursementDto {
  @ApiPropertyOptional({ description: 'HR review comments', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  hrComment?: string;

  @ApiProperty({
    enum: ReimbursementProcessingType,
    description: 'How the reimbursement will be processed',
  })
  @IsEnum(ReimbursementProcessingType)
  processingType: ReimbursementProcessingType;

  @ApiPropertyOptional({
    description: 'Salary month for salary adjustment (YYYY-MM format)',
    example: '2024-03',
  })
  @IsOptional()
  @IsString()
  @MaxLength(7)
  salaryMonth?: string; // YYYY-MM format
}
