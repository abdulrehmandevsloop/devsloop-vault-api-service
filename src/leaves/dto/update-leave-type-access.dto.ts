import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateLeaveTypeAccessDto {
  @ApiPropertyOptional({ description: 'Allow employee to request Maternity leave' })
  @IsOptional()
  @IsBoolean()
  allowMaternityLeave?: boolean;

  @ApiPropertyOptional({ description: 'Allow employee to request Wedding leave' })
  @IsOptional()
  @IsBoolean()
  allowWeddingLeave?: boolean;

  @ApiPropertyOptional({ description: 'Allow employee to request Umrah / Hajj leave' })
  @IsOptional()
  @IsBoolean()
  allowUmrahHajjLeave?: boolean;

  @ApiPropertyOptional({ description: 'Allow employee to request Other leave' })
  @IsOptional()
  @IsBoolean()
  allowOtherLeave?: boolean;

  @ApiPropertyOptional({ description: 'Exempt employee from the monthly WFH cap (HR override)' })
  @IsOptional()
  @IsBoolean()
  allowExtraWfh?: boolean;
}
