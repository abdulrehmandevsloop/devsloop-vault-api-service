import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApproverType, RejectionPolicy } from '@prisma/client';

export class CreateWorkflowStepDto {
  @ApiProperty({ example: 'Manager Approval' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  order: number;

  @ApiProperty({ enum: ApproverType })
  @IsEnum(ApproverType)
  approverType: ApproverType;

  @ApiPropertyOptional({ example: 'leave-review' })
  @IsString()
  @IsOptional()
  approverValue?: string;

  @ApiPropertyOptional({ enum: ApproverType })
  @IsEnum(ApproverType)
  @IsOptional()
  fallbackApproverType?: ApproverType;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  fallbackApproverValue?: string;

  @ApiProperty({ enum: RejectionPolicy, default: 'TERMINATE' })
  @IsEnum(RejectionPolicy)
  rejectionPolicy: RejectionPolicy;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  returnToStepOrder?: number;

  @ApiProperty({ default: false })
  @IsBoolean()
  isOptional: boolean;

  @ApiPropertyOptional({ description: 'Auto-approve if no action taken after N hours' })
  @IsInt()
  @Min(1)
  @IsOptional()
  autoApproveAfterHours?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  conditionField?: string;

  @ApiPropertyOptional({ example: 'gt' })
  @IsString()
  @IsOptional()
  conditionOperator?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  conditionValue?: string;
}

export class CreateWorkflowTemplateDto {
  @ApiProperty({ example: 'Leave Approval' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Request type key, e.g. LEAVE or TRAINING_REQUEST' })
  @IsString()
  @IsNotEmpty()
  requestType: string;

  @ApiPropertyOptional({ type: [String], description: 'Target department slugs; empty = all' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  departments?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Target employee types; empty = all' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  employeeTypes?: string[];

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  allowEditAfterSubmit?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  preventConsecutiveApproval?: boolean;

  @ApiPropertyOptional({ default: 3 })
  @IsInt()
  @Min(0)
  @Max(10)
  @IsOptional()
  maxReturnCount?: number;

  @ApiProperty({ type: [CreateWorkflowStepDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateWorkflowStepDto)
  steps: CreateWorkflowStepDto[];
}
