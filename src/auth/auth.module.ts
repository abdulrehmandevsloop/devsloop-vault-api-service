import { Module } from '@nestjs/common';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import type { StringValue } from 'ms';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import {
  PasswordResetService,
  TokenService,
  AuditLogService,
  TokenCleanupService,
} from './services';
import { UserEmailHandler, UserAuditHandler } from './listeners';
import { QueueModule } from '../queue/queue.module';
import { PrismaModule } from '../prisma';
import { WarningsModule } from '../warnings/warnings.module';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    QueueModule,
    WarningsModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (_configService: ConfigService) => ({
        throttlers: [
          {
            ttl: 60000, // 1 minute
            limit: 1000, // 1000 requests per minute (per IP)
          },
        ],
      }),
      inject: [ConfigService],
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService): JwtModuleOptions => {
        const expiresIn = (configService.get<string>('JWT_EXPIRES_IN') || '15m') as StringValue;
        return {
          secret: configService.getOrThrow<string>('JWT_SECRET'),
          signOptions: {
            expiresIn: expiresIn,
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    GoogleStrategy,
    PasswordResetService,
    TokenService,
    AuditLogService,
    TokenCleanupService,
    // Event Handlers
    UserEmailHandler,
    UserAuditHandler,
  ],
  exports: [AuthService, TokenService, AuditLogService],
})
export class AuthModule {}
