import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveUserDto {
  @ApiProperty({
    description: 'Role ID to assign to the user',
    example: 'clx1234567890',
  })
  @IsNotEmpty()
  @IsString()
  roleId: string;

  @ApiPropertyOptional({ description: 'Department to assign' })
  @IsOptional()
  @IsString({ message: 'Department must be a string' })
  @MaxLength(100, { message: 'Department must not exceed 100 characters' })
  department?: string;
}
