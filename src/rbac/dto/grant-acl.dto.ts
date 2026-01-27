import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsArray } from 'class-validator';

export class GrantAclDto {
  @ApiProperty({
    description: 'Array of entity IDs to grant access to',
    example: ['entity-id-1', 'entity-id-2'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  entityIds: string[];
}
