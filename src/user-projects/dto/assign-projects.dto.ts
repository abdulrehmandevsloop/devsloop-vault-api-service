import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class AssignProjectsDto {
  @ApiProperty({
    description:
      'Full list of project IDs assigned to the user. Replaces existing assignments. Use empty array to clear all.',
    example: ['clx1234567890', 'clx0987654321'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  projectIds: string[];
}
