/**
 * Application environment helpers.
 *
 * The single source of truth is `NODE_ENV`, validated on startup against
 * 'development' | 'staging' | 'production' (see configuration.schema.ts).
 * Anything that is not explicitly non-production is treated as production,
 * so a missing/unknown value fails safe (locks destructive tooling down).
 */
export type AppEnv = 'development' | 'staging' | 'production';

export function getAppEnv(): AppEnv {
  const env = process.env.NODE_ENV;
  if (env === 'development' || env === 'staging' || env === 'production') {
    return env;
  }
  // Unknown / unset → fail safe as production.
  return 'production';
}

/** True only for staging / development — where destructive QA tooling is allowed. */
export function isNonProductionEnv(): boolean {
  const env = getAppEnv();
  return env === 'staging' || env === 'development';
}

export function isProductionEnv(): boolean {
  return !isNonProductionEnv();
}
