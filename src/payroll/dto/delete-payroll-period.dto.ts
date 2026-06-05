import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Confirmation payload for the staging-only payroll period purge.
 * The caller must echo back either the literal word "DELETE" or the
 * period's month token (e.g. "MAY-2026") to prove the action is intentional.
 */
export class DeletePayrollPeriodDto {
  @ApiProperty({
    description: 'Typed confirmation — either "DELETE" or the period month token (e.g. "MAY-2026")',
    example: 'DELETE',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  confirmation: string;
}
