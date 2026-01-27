import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class AssignRoleDto {
  @ApiProperty({
    description: 'Role ID to assign to the user',
    example: 'cmkxwe4s20000lqvshjgp9iv1',
  })
  @IsString()
  @IsNotEmpty()
  roleId: string;
}
