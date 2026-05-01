import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { WorkflowInstanceStatus } from '@prisma/client';

export class QueryWorkflowInstancesDto {
  @ApiPropertyOptional({ description: 'Filter by request type key' })
  @IsString()
  @IsOptional()
  requestType?: string;

  @ApiPropertyOptional({ enum: WorkflowInstanceStatus })
  @IsEnum(WorkflowInstanceStatus)
  @IsOptional()
  status?: WorkflowInstanceStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  @IsOptional()
  limit?: number = 20;
}
