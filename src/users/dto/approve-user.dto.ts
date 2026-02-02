import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
  @IsString()
  department?: string;
}
