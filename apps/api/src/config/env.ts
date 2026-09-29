import { loadRootEnv } from '@nfc/db';
import { DEFAULT_DEV_ACTOR_KEY, devActorKeys } from '@nfc/shared';
import { z } from 'zod';

/**
 * Environment configuration, validated on boot.
 *
 * The process refuses to start on a bad or missing value rather than failing
 * later with a confusing error in the middle of a request.
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['true', '1', 'yes', 'on'].includes(value.toLowerCase()),
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),

    // Database connection details are validated by @nfc/db, which both the API
    // and the migration tooling share. These two are required here so a missing
    // password surfaces at boot rather than on the first query.
    PGPASSWORD: z.string().min(1, 'PGPASSWORD is required. See .env.example.'),
    APP_DB_PASSWORD: z.string().min(1, 'APP_DB_PASSWORD is required. See .env.example.'),

    DEV_ACTOR_ENABLED: booleanish.default(true),
    DEV_ACTOR_DEFAULT: z.string().default(DEFAULT_DEV_ACTOR_KEY),
  })
  .superRefine((value, ctx) => {
    // The dev-actor bridge stands in for authentication until M2. It must never
    // be reachable in production.
    if (value.NODE_ENV === 'production' && value.DEV_ACTOR_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_ACTOR_ENABLED'],
        message:
          'DEV_ACTOR_ENABLED must be false when NODE_ENV=production. ' +
          'The dev-actor bridge is a development stand-in for authentication and is removed in M2.',
      });
    }
    if (!devActorKeys().includes(value.DEV_ACTOR_DEFAULT)) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_ACTOR_DEFAULT'],
        message: `Unknown dev actor "${value.DEV_ACTOR_DEFAULT}". Known actors: ${devActorKeys().join(', ')}`,
      });
    }
  });

export type ApiEnv = z.infer<typeof envSchema> & { corsOrigins: string[] };

export const API_ENV = 'API_ENV';

let cached: ApiEnv | null = null;

export function loadApiEnv(): ApiEnv {
  if (cached) return cached;
  loadRootEnv();

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}\n`);
  }

  cached = {
    ...parsed.data,
    corsOrigins: parsed.data.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ''),
  };
  return cached;
}

/** Test helper: forces the next `loadApiEnv()` to re-read `process.env`. */
export function resetApiEnvCache(): void {
  cached = null;
}
