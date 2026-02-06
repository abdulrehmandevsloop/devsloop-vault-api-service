import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { EnvironmentVariables } from './configuration.schema';

/**
 * Validates environment variables against the schema
 * Throws error if validation fails
 */
export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
    whitelist: true,
    forbidNonWhitelisted: false, // Allow unknown env vars (they might be from other services)
  });

  if (errors.length > 0) {
    const errorMessages = errors
      .map((error) => {
        if (error.constraints) {
          return Object.values(error.constraints).join(', ');
        }
        return `${error.property}: validation failed`;
      })
      .join('\n');

    throw new Error(`Environment variable validation failed:\n${errorMessages}`);
  }

  return validatedConfig;
}
