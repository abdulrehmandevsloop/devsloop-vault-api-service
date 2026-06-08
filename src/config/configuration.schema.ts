import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUrl,
  IsEnum,
  Min,
  Max,
  IsInt,
  Matches,
  MinLength,
  IsEmail,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Environment configuration schema with validation
 * Validates all environment variables on application startup
 */
export class EnvironmentVariables {
  // ===========================================
  // DATABASE
  // ===========================================
  @IsString({ message: 'DATABASE_URL must be a string' })
  @IsNotEmpty({ message: 'DATABASE_URL is required' })
  @Matches(/^postgresql:\/\//, {
    message: 'DATABASE_URL must be a valid PostgreSQL connection string',
  })
  DATABASE_URL!: string;

  // ===========================================
  // APPLICATION
  // ===========================================
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'PORT must be an integer' })
  @Min(1, { message: 'PORT must be at least 1' })
  @Max(65535, { message: 'PORT must not exceed 65535' })
  PORT?: number = 3001;

  @IsOptional()
  @IsEnum(['development', 'staging', 'production'], {
    message: 'NODE_ENV must be one of: development, staging, production',
  })
  NODE_ENV?: 'development' | 'staging' | 'production' = 'development';

  // ===========================================
  // JWT / AUTHENTICATION
  // ===========================================
  @IsString({ message: 'JWT_SECRET must be a string' })
  @IsNotEmpty({ message: 'JWT_SECRET is required' })
  @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters long for security' })
  JWT_SECRET!: string;

  @IsOptional()
  @IsString({ message: 'JWT_EXPIRES_IN must be a string' })
  @Matches(/^\d+[smhd]$/, {
    message: 'JWT_EXPIRES_IN must be in format: number + unit (s/m/h/d), e.g., 15m',
  })
  JWT_EXPIRES_IN?: string = '15m';

  @IsString({ message: 'JWT_REFRESH_SECRET must be a string' })
  @IsNotEmpty({ message: 'JWT_REFRESH_SECRET is required' })
  @MinLength(32, { message: 'JWT_REFRESH_SECRET must be at least 32 characters long for security' })
  JWT_REFRESH_SECRET!: string;

  @IsOptional()
  @IsString({ message: 'JWT_REFRESH_EXPIRES_IN must be a string' })
  @Matches(/^\d+[smhd]$/, {
    message: 'JWT_REFRESH_EXPIRES_IN must be in format: number + unit (s/m/h/d), e.g., 7d',
  })
  JWT_REFRESH_EXPIRES_IN?: string = '7d';

  // ===========================================
  // CORS
  // ===========================================
  @IsOptional()
  @IsString({ message: 'CORS_ORIGIN must be a string' })
  @IsUrl(
    { require_protocol: true, require_tld: false },
    { message: 'CORS_ORIGIN must be a valid URL with protocol (e.g. http://localhost:3000)' },
  )
  CORS_ORIGIN?: string = 'http://localhost:3000';

  // ===========================================
  // FILE UPLOAD
  // ===========================================
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'UPLOAD_MAX_SIZE must be an integer' })
  @Min(1024, { message: 'UPLOAD_MAX_SIZE must be at least 1024 bytes (1KB)' })
  UPLOAD_MAX_SIZE?: number = 10485760;

  @IsOptional()
  @IsString({ message: 'UPLOAD_DEST must be a string' })
  UPLOAD_DEST?: string = './uploads';

  // ===========================================
  // PASSWORD RESET
  // ===========================================
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'PASSWORD_RESET_EXPIRES_HOURS must be an integer' })
  @Min(1, { message: 'PASSWORD_RESET_EXPIRES_HOURS must be at least 1 hour' })
  @Max(24, { message: 'PASSWORD_RESET_EXPIRES_HOURS must not exceed 24 hours' })
  PASSWORD_RESET_EXPIRES_HOURS?: number = 1;

  @IsOptional()
  @IsString({ message: 'FRONTEND_URL must be a string' })
  @IsUrl(
    { require_protocol: true, require_tld: false },
    { message: 'FRONTEND_URL must be a valid URL with protocol (e.g. http://localhost:3000)' },
  )
  FRONTEND_URL?: string = 'http://localhost:3000';

  // ===========================================
  // LOGGING
  // ===========================================
  @IsOptional()
  @IsEnum(['error', 'warn', 'info', 'debug', 'verbose'], {
    message: 'LOG_LEVEL must be one of: error, warn, info, debug, verbose',
  })
  LOG_LEVEL?: 'error' | 'warn' | 'info' | 'debug' | 'verbose' = 'debug';

  // ===========================================
  // CACHE (In-Memory)
  // ===========================================
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'CACHE_TTL must be an integer' })
  @Min(60, { message: 'CACHE_TTL must be at least 60 seconds' })
  @Max(3600, { message: 'CACHE_TTL must not exceed 3600 seconds (1 hour)' })
  CACHE_TTL?: number = 300;

  // ===========================================
  // QUEUE / BACKGROUND JOBS (pg-boss)
  // ===========================================
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'QUEUE_RETRY_LIMIT must be an integer' })
  @Min(0, { message: 'QUEUE_RETRY_LIMIT must be at least 0' })
  @Max(10, { message: 'QUEUE_RETRY_LIMIT must not exceed 10' })
  QUEUE_RETRY_LIMIT?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'QUEUE_RETRY_DELAY must be an integer' })
  @Min(1000, { message: 'QUEUE_RETRY_DELAY must be at least 1000 milliseconds' })
  @Max(60000, { message: 'QUEUE_RETRY_DELAY must not exceed 60000 milliseconds (1 minute)' })
  QUEUE_RETRY_DELAY?: number = 2000;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'QUEUE_EXPIRE_SECONDS must be an integer' })
  @Min(60, { message: 'QUEUE_EXPIRE_SECONDS must be at least 60 seconds' })
  @Max(86400, { message: 'QUEUE_EXPIRE_SECONDS must not exceed 86400 seconds (24 hours)' })
  QUEUE_EXPIRE_SECONDS?: number = 3600;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'JOB_RETRY_LIMIT must be an integer' })
  @Min(0, { message: 'JOB_RETRY_LIMIT must be at least 0' })
  @Max(10, { message: 'JOB_RETRY_LIMIT must not exceed 10' })
  JOB_RETRY_LIMIT?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'JOB_RETRY_DELAY must be an integer' })
  @Min(1000, { message: 'JOB_RETRY_DELAY must be at least 1000 milliseconds' })
  @Max(60000, { message: 'JOB_RETRY_DELAY must not exceed 60000 milliseconds (1 minute)' })
  JOB_RETRY_DELAY?: number = 2000;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'JOB_EXPIRE_SECONDS must be an integer' })
  @Min(60, { message: 'JOB_EXPIRE_SECONDS must be at least 60 seconds' })
  @Max(86400, { message: 'JOB_EXPIRE_SECONDS must not exceed 86400 seconds (24 hours)' })
  JOB_EXPIRE_SECONDS?: number = 3600;

  // ===========================================
  // EMAIL / RESEND
  // ===========================================
  @IsOptional()
  @IsString({ message: 'RESEND_API_KEY must be a string' })
  RESEND_API_KEY?: string;

  @IsOptional()
  @IsString({ message: 'FROM_EMAIL must be a string' })
  @IsEmail({}, { message: 'FROM_EMAIL must be a valid email address' })
  FROM_EMAIL?: string = 'noreply@devsloop.com';

  @IsOptional()
  @IsString({ message: 'FROM_NAME must be a string' })
  @MaxLength(100, { message: 'FROM_NAME must not exceed 100 characters' })
  FROM_NAME?: string = 'DevsLoop Vault';

  // ===========================================
  // AI / GROQ
  // ===========================================
  @IsOptional()
  @IsString({ message: 'GROQ_API_KEY must be a string' })
  GROQ_API_KEY?: string;

  // GOOGLE OAUTH
  // ===========================================
  @IsOptional()
  @IsString({ message: 'GOOGLE_CLIENT_ID must be a string' })
  GOOGLE_CLIENT_ID?: string;

  @IsOptional()
  @IsString({ message: 'GOOGLE_CLIENT_SECRET must be a string' })
  GOOGLE_CLIENT_SECRET?: string;

  @IsOptional()
  @IsString({ message: 'GOOGLE_CALLBACK_URL must be a string' })
  GOOGLE_CALLBACK_URL?: string;
}
