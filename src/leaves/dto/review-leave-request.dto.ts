import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewLeaveRequestDto {
  @ApiProperty({
    description: 'Review comment (required for both approve and reject)',
    maxLength: 2000,
    example: 'Approved. Coverage has been arranged with the team.',
  })
  @IsString()
  @IsNotEmpty({ message: 'A comment is required when reviewing a leave request' })
  @MaxLength(2000)
  comment: string;

  @ApiPropertyOptional({
    description:
      'When true, HR will be informed that the leave must be communicated to the client.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  requiresClientApproval?: boolean;
}
