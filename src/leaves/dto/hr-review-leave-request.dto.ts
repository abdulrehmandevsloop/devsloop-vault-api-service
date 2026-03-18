import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { LeaveCategory } from '@prisma/client';

export class HrReviewLeaveRequestDto {
  @ApiProperty({
    description: 'HR review comment (required for both approve and reject)',
    maxLength: 2000,
    example: 'Approved. Leave balance updated accordingly.',
  })
  @IsString()
  @IsNotEmpty({ message: 'A comment is required when making the final HR decision' })
  @MaxLength(2000)
  comment: string;

  @ApiPropertyOptional({
    enum: LeaveCategory,
    description:
      'Override the computed PAID/UNPAID category. If omitted, the system auto-computes it.',
  })
  @IsOptional()
  @IsEnum(LeaveCategory)
  category?: LeaveCategory;
}
