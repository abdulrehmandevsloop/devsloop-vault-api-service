import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { EmployeeStatus } from '@prisma/client';

export class ToggleStatusDto {
  @ApiProperty({
    description: 'Set the employee status to ACTIVE, FREEZE, or DEACTIVATED.',
    enum: EmployeeStatus,
    example: 'ACTIVE',
  })
  @IsNotEmpty()
  @IsEnum(EmployeeStatus, {
    message: `Employee status must be one of: ${Object.values(EmployeeStatus).join(', ')}`,
  })
  employeeStatus!: EmployeeStatus;
}
