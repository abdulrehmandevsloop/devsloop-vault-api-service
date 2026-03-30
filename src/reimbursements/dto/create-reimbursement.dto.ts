import { IsString, IsNumber, IsOptional, IsEnum, IsDateString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ReimbursementType,
  ReimbursementProcessingType,
  PatientRelationship,
  TreatmentType,
} from '@prisma/client';

export class CreateReimbursementDto {
  @ApiProperty({ enum: ReimbursementType, description: 'Type of reimbursement expense' })
  @IsEnum(ReimbursementType)
  reimbursementType: ReimbursementType;

  @ApiProperty({ description: 'Amount in PKR', example: 5000 })
  @IsNumber()
  @Type(() => Number)
  amount: number;

  @ApiProperty({ description: 'Description of the expense', maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  description: string;

  @ApiProperty({
    description: 'URL of the uploaded receipt image/PDF (required)',
    maxLength: 2048,
    required: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  receiptUrl?: string;

  @ApiPropertyOptional({ description: 'Name of the merchant/store', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  merchantName?: string;

  @ApiProperty({ description: 'Date of transaction', format: 'date', example: '2024-03-15' })
  @IsDateString()
  transactionDate: string;

  @ApiPropertyOptional({
    enum: ReimbursementProcessingType,
    default: ReimbursementProcessingType.SALARY_ADJUSTMENT,
  })
  @IsOptional()
  @IsEnum(ReimbursementProcessingType)
  processingType?: ReimbursementProcessingType = ReimbursementProcessingType.SALARY_ADJUSTMENT;

  @ApiPropertyOptional({
    description: 'Additional comments for OTHER type expenses',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  otherComments?: string;

  // Medical-specific fields
  @ApiPropertyOptional({ description: 'Patient name (for MEDICAL type only)', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  patientName?: string;

  @ApiPropertyOptional({
    enum: PatientRelationship,
    description: 'Relationship with patient (for MEDICAL type only)',
  })
  @IsOptional()
  @IsEnum(PatientRelationship)
  patientRelationship?: PatientRelationship;

  @ApiPropertyOptional({
    enum: TreatmentType,
    description: 'Type of treatment (for MEDICAL type only)',
  })
  @IsOptional()
  @IsEnum(TreatmentType)
  treatmentType?: TreatmentType;

  @ApiPropertyOptional({
    description: 'Hospital/clinic name (for MEDICAL type only)',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  hospitalName?: string;
}
