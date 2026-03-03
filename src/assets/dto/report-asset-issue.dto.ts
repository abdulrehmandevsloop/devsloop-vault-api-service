import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum, MaxLength, IsOptional } from 'class-validator';

export enum AssetIssueTypeDto {
  HARDWARE = 'HARDWARE',
  SOFTWARE = 'SOFTWARE',
  OTHER = 'OTHER',
}

export enum AssetIssuePriorityDto {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export class ReportAssetIssueDto {
  @ApiProperty({
    description: 'Type of issue',
    enum: AssetIssueTypeDto,
  })
  @IsEnum(AssetIssueTypeDto, { message: 'Invalid issue type' })
  issueType: AssetIssueTypeDto;

  @ApiProperty({
    description: 'Description of the problem',
    example: 'Screen flickers when on battery',
    maxLength: 5000,
  })
  @IsNotEmpty({ message: 'Description is required' })
  @IsString()
  @MaxLength(5000, { message: 'Description must not exceed 5000 characters' })
  description: string;

  @ApiPropertyOptional({
    description: 'Priority',
    enum: AssetIssuePriorityDto,
  })
  @IsOptional()
  @IsEnum(AssetIssuePriorityDto, { message: 'Invalid priority' })
  priority?: AssetIssuePriorityDto;
}
