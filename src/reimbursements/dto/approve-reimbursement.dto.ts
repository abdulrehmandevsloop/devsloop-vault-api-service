import {
  IsString,
  IsOptional,
  IsEnum,
  MaxLength,
  IsNumber,
  Min,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReimbursementProcessingType } from '@prisma/client';
import { InstallmentItemDto } from './create-installment-plan.dto';

export class ApproveReimbursementDto {
  @ApiPropertyOptional({ description: 'HR review comments', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  hrComment?: string;

  @ApiPropertyOptional({
    description: 'Approved amount (can be less than or equal to requested amount)',
    example: 5000,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  approvedAmount?: number;

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

  @ApiPropertyOptional({
    type: [InstallmentItemDto],
    description:
      'Optional installment plan to create atomically with approval. Sum of amounts must equal approvedAmount.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => InstallmentItemDto)
  installments?: InstallmentItemDto[];
}
