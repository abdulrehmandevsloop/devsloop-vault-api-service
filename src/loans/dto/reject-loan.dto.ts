import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectLoanDto {
  @ApiProperty({ description: 'Reason for rejection', maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  reviewComment: string;
}
