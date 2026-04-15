import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class RejectAdvanceSalaryDto {
  @ApiProperty({ description: 'Reason for rejection', maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  reviewComment: string;
}
