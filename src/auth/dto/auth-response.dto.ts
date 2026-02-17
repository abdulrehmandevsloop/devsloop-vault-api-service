import { ApiProperty } from '@nestjs/swagger';

export class AuthUserRoleDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty()
  isPrimary: boolean;
}

export class AuthResponseDto {
  @ApiProperty({ description: 'JWT access token (short-lived)' })
  accessToken: string;

  @ApiProperty({ description: 'JWT refresh token (long-lived)' })
  refreshToken: string;

  @ApiProperty()
  user: {
    id: string;
    email: string;
    name: string;
    roles: AuthUserRoleDto[];
    department?: string;
    avatarUrl?: string;
    emailVerified: boolean;
  };
}
