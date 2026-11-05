import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

// The server can be started from the monorepo root or from apps/server.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

/**
 * Central, validated configuration. Failing fast at boot is much safer than
 * discovering a missing JWT secret after the first login.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  PUBLIC_WEB_URL: z.string().default('http://localhost:5173'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),

  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  WELCOME_BONUS: z.coerce.bigint().positive().default(10_000n),

  UPLOAD_DIR: z.string().default('./uploads'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('Chips Poker <no-reply@example.com>'),

  ALLOW_MULTI_ACCOUNT: z
    .string()
    .default('false')
    .transform((value) => value.toLowerCase() === 'true'),
  ALLOWED_ACCOUNTS_PER_IP_24H: z.coerce.number().int().positive().default(3),
  DEVICE_COOKIE_SECRET: z.string().min(16).default('dev-device-cookie-secret-change-me'),

  TURN_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(20_000),
  NEXT_HAND_DELAY_MS: z.coerce.number().int().min(1_000).max(30_000).default(5_000),
  CHAT_HISTORY_LIMIT: z.coerce.number().int().min(0).max(200).default(50),
  // Return table stakes that were debited but never cashed out (crash/restart).
  // Must stay false on a multi-node cluster, where another node may still own a
  // live table; only the node performing full startup should run this.
  RECOVER_TABLE_STAKES: z
    .string()
    .default('true')
    .transform((value) => value.toLowerCase() === 'true')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  ...env,
  isProduction: env.NODE_ENV === 'production',
  uploadDir: path.resolve(process.cwd(), env.UPLOAD_DIR),
  // Socket.IO and Express share the same origin, but this list lets the Vite
  // dev server talk to the API directly if desired.
  corsOrigins: env.WEB_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
} as const;

export type AppConfig = typeof config;
