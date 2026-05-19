import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { DynamicRequestStatus } from '@prisma/client';

export class AdvanceSalaryQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: DynamicRequestStatus })
  @IsOptional()
  @IsEnum(DynamicRequestStatus)
  status?: DynamicRequestStatus;
}

export class ManagementAdvanceSalaryQueryDto extends AdvanceSalaryQueryDto {
  @ApiPropertyOptional({ description: 'Search by employee name or email' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by employee ID' })
  @IsOptional()
  @IsString()
  employeeId?: string;
}
