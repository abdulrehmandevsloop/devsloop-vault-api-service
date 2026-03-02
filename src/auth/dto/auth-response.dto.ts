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
    departments?: string[];
    avatarUrl?: string;
    emailVerified: boolean;
    /** When true, user must be redirected to change-password (e.g. after first login with temp password). */
    mustChangePassword: boolean;
  };
}
