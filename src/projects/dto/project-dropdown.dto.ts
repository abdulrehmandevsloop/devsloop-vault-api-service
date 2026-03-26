import { ApiProperty } from '@nestjs/swagger';

export class ProjectDropdownDto {
  @ApiProperty({
    description: 'Project ID',
    example: 'clx1234567890',
  })
  id: string;

  @ApiProperty({
    description: 'Project name',
    example: 'DevsLoop Platform v2',
  })
  name: string;

  @ApiProperty({
    description: 'Whether the project is assigned to the user',
    example: true,
    required: false,
  })
  assigned?: boolean;
}
