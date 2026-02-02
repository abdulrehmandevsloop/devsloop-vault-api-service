import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsBoolean } from 'class-validator';

export class ToggleStatusDto {
  @ApiPropertyOptional({
    description:
      'Optional: explicitly set access status (true = has access/hasAccess=1, false = no access/hasAccess=0). If not provided, status will be toggled.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
