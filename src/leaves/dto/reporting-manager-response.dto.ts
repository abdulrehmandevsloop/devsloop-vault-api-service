import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReportingManagerResponseDto {
  @ApiProperty({ description: 'User ID' })
  id: string;

  @ApiProperty({ description: 'Full name' })
  name: string;

  @ApiProperty({ description: 'Work email' })
  email: string;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  avatarUrl: string | null;

  @ApiProperty({ type: [String], description: 'Departments' })
  departments: string[];

  @ApiPropertyOptional({ description: 'Job designation' })
  designation: string | null;
}
