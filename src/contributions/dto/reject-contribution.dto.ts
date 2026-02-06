import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';

export class RejectContributionDto {
  @ApiProperty({
    description: 'Comment from the reviewer explaining the rejection (required)',
    example: 'Please add more detail to the solution section.',
    minLength: 1,
  })
  @IsNotEmpty({ message: 'Reviewer comment is required when rejecting a contribution' })
  @IsString({ message: 'Reviewer comment must be a string' })
  @MinLength(1, { message: 'Reviewer comment must not be empty' })
  @MaxLength(2000, { message: 'Reviewer comment must not exceed 2000 characters' })
  reviewerComment: string;
}
