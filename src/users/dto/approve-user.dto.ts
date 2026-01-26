import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { UserRole } from '@prisma/client';

export class ApproveUserDto {
  @ApiProperty({
    enum: UserRole,
    description: 'Role to assign to the user',
    example: 'EMPLOYEE',
  })
  @IsNotEmpty()
  @IsEnum(UserRole)
  role: UserRole;

  @ApiPropertyOptional({ description: 'Department to assign' })
  @IsOptional()
  @IsString()
  department?: string;
}
