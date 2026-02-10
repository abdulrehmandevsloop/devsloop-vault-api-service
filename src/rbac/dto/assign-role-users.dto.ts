import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, ArrayUnique, ArrayMaxSize } from 'class-validator';

export class AssignRoleUsersDto {
  @ApiProperty({
    description:
      'Array of user IDs to assign this role to. Replaces all existing assignments for this role. Empty array removes all. Max 500.',
    example: ['clx1234567890', 'clx0987654321'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  @ArrayMaxSize(500, { message: 'Cannot assign more than 500 users at once' })
  userIds: string[];
}
