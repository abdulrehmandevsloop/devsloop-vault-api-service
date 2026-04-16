import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class DesignateTempAuthorizerDto {
  @ApiProperty({ description: 'User ID to designate as temporary authorizer' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  userId: string;
}
