import { loadRootEnv } from '@nfc/db';
import {
  SESSION_ABSOLUTE_HOURS_DEFAULT,
  SESSION_IDLE_MINUTES_DEFAULT,
} from '@nfc/shared';
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

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  PGPASSWORD: z.string().min(1, 'PGPASSWORD is required. See .env.example.'),
  APP_DB_PASSWORD: z.string().min(1, 'APP_DB_PASSWORD is required. See .env.example.'),

  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters.'),
  MFA_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'MFA_ENCRYPTION_KEY must be 64 hex characters (32 bytes).'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(SESSION_IDLE_MINUTES_DEFAULT),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(72).default(SESSION_ABSOLUTE_HOURS_DEFAULT),
  HIBP_ENABLED: booleanish.default(true),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  JOBS_ENABLED: booleanish.default(true),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  S3_ENDPOINT: z.string().min(1).default('http://127.0.0.1:9000'),
  S3_BUCKET: z.string().min(1).default('nfc-documents'),
  S3_ACCESS_KEY: z.string().min(1).default('minioadmin'),
  S3_SECRET_KEY: z.string().min(1).default('minioadmin'),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_FORCE_PATH_STYLE: booleanish.default(true),
  DOCUMENT_STORAGE: z.enum(['minio', 'fs']).default('minio'),
  DOCUMENT_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'DOCUMENT_ENCRYPTION_KEY must be 64 hex characters (32 bytes).'),
  SEAL_SIGNING_KEYS: z.string().min(10),
  SEAL_ACTIVE_KID: z.string().min(1).default('v1'),
  DOCUMENT_DOWNLOAD_TTL_SECONDS: z.coerce.number().int().min(15).max(600).default(90),
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
