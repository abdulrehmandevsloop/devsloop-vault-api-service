import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { EncryptionLevel } from '@prisma/client';

export class SecurityProtocolsDto {
  @ApiPropertyOptional({ description: 'Multi-factor authentication enabled', example: true })
  @IsOptional()
  @IsBoolean()
  mfa?: boolean;

  @ApiPropertyOptional({
    description: 'Encryption level',
    enum: EncryptionLevel,
    example: EncryptionLevel.ADVANCED,
  })
  @IsOptional()
  @IsEnum(EncryptionLevel)
  encryptionLevel?: EncryptionLevel;

  @ApiPropertyOptional({ description: 'SSL/TLS enabled', example: true })
  @IsOptional()
  @IsBoolean()
  ssl?: boolean;

  @ApiPropertyOptional({
    description: 'Additional security, encryption, and compliance notes',
    example: 'Data at rest: AES-256. Key rotation quarterly.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'securityDetails must be at most 2000 characters' })
  securityDetails?: string;
}
