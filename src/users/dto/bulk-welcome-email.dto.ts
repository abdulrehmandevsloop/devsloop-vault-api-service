import { IsArray, IsString, IsNotEmpty, ArrayMinSize, ArrayMaxSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BulkWelcomeEmailDto {
  @ApiProperty({
    description: 'Array of user IDs to send welcome / credentials email to',
    type: [String],
    example: ['clxxxxx1', 'clxxxxx2'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  userIds: string[];
}
