import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsBoolean } from 'class-validator';

export class ToggleStatusDto {
  @ApiPropertyOptional({
    description:
      'Optional: explicitly set access status (true = ACTIVE, false = FREEZE). If not provided, status will be toggled between ACTIVE and FREEZE.',
    example: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'Active status must be a boolean' })
  active?: boolean;
}
