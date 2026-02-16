import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConfidentialityLevel } from '@prisma/client';

export class VaultProjectDto {
  @ApiProperty({ description: 'Project ID' })
  id: string;

  @ApiProperty({ description: 'Project name' })
  name: string;

  @ApiProperty({ description: 'Client name' })
  clientName: string;

  @ApiProperty({ description: 'Project domain' })
  domain: string;

  @ApiPropertyOptional({ description: 'Project description' })
  description: string;

  @ApiProperty({ enum: ConfidentialityLevel, description: 'Confidentiality level' })
  confidentialityLevel: ConfidentialityLevel;

  @ApiProperty({ description: 'Number of approved contributions in this project' })
  contributionCount: number;
}

export class VaultProjectsResponseDto {
  @ApiProperty({ type: [VaultProjectDto], description: 'Projects with approved contributions' })
  data: VaultProjectDto[];

  @ApiProperty({ description: 'Total number of projects with approved contributions' })
  total: number;
}
