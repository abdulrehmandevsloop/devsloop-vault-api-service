import { ApiProperty } from '@nestjs/swagger';

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
    roleId: string | null;
    role: {
      id: string;
      name: string;
      displayName: string;
    } | null;
    department?: string;
    avatarUrl?: string;
    emailVerified: boolean;
  };
}
