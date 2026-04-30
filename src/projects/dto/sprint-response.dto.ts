import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SprintStatus } from '@prisma/client';

export class SprintResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() milestoneId: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
  @ApiProperty() startDate: Date;
  @ApiPropertyOptional({ nullable: true }) endDate: Date | null;
  @ApiProperty({ enum: SprintStatus }) status: SprintStatus;
  @ApiProperty({ type: [String] }) deliverables: string[];
  @ApiProperty() order: number;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
