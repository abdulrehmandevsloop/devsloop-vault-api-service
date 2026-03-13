import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConfidentialityLevel } from '@prisma/client';

export class UserProjectAssignmentDto {
  @ApiProperty({ description: 'User-project assignment ID' })
  id: string;

  @ApiProperty({ description: 'When the project was assigned' })
  assignedAt: Date;

  @ApiPropertyOptional({ description: 'Admin user ID who assigned the project' })
  assignedBy?: string | null;

  @ApiProperty({
    description: 'Assigned project details',
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      clientName: { type: 'string' },
      domain: { type: 'string', nullable: true },
      description: { type: 'string', nullable: true },
      startDate: { type: 'string', format: 'date-time' },
      endDate: { type: 'string', format: 'date-time', nullable: true },
      techStack: { type: 'array', items: { type: 'string' } },
      confidentialityLevel: { enum: Object.values(ConfidentialityLevel) },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  })
  project: {
    id: string;
    name: string;
    clientName: string;
    domain: string | null;
    description: string | null;
    startDate: Date;
    endDate: Date | null;
    techStack: string[];
    confidentialityLevel: ConfidentialityLevel;
    createdAt: Date;
    updatedAt: Date;
  };
}
