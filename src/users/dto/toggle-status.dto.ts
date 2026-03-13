import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsBoolean, IsEnum } from 'class-validator';
import { EmployeeStatus } from '@prisma/client';

export class ToggleStatusDto {
  @ApiPropertyOptional({
    description:
      'Optional: explicitly set access status (true = ACTIVE, false = FREEZE). If not provided, status will be toggled between ACTIVE and FREEZE.',
    example: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'Active status must be a boolean' })
  active?: boolean;

  @ApiPropertyOptional({
    description:
      'Directly set employee status to ACTIVE, FREEZE, or DEACTIVATED. Takes precedence over the active flag when provided.',
    enum: EmployeeStatus,
    example: 'DEACTIVATED',
  })
  @IsOptional()
  @IsEnum(EmployeeStatus, {
    message: `Employee status must be one of: ${Object.values(EmployeeStatus).join(', ')}`,
  })
  employeeStatus?: EmployeeStatus;
}
