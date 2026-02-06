import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ApproveContributionDto {
  @ApiProperty({
    description: 'Reviewer comment when approving the contribution (required)',
    example: 'Great work! Clear solution and good learnings.',
    minLength: 1,
  })
  @IsNotEmpty({ message: 'Reviewer comment is required when approving a contribution' })
  @IsString({ message: 'Reviewer comment must be a string' })
  @MinLength(1, { message: 'Reviewer comment must not be empty' })
  @MaxLength(2000, { message: 'Reviewer comment must not exceed 2000 characters' })
  reviewerComment: string;
}
