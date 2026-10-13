import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** demo = sandbox adapters allowed and labelled; production = live adapters required. */
  WAYLO_MODE: z.enum(['demo', 'production']).default('demo'),
  PORT: z.coerce.number().int().positive().default(4000),
  /** Managed PostgreSQL connection string. When unset, an embedded PGlite database is used (dev/test only). */
  DATABASE_URL: z.string().url().optional(),
  PGLITE_DIR: z.string().default('.data/pglite'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: bool.optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 14),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: bool.default(false),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16).optional(),
  UPLOAD_DIR: z.string().default('.data/uploads'),
});

export type Config = z.infer<typeof EnvSchema> & {
  webOrigins: string[];
  cookieSecure: boolean;
  isProduction: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const c = parsed.data;
  const isProduction = c.NODE_ENV === 'production';
  if (isProduction && !c.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when NODE_ENV=production (embedded PGlite is for development only).');
  }
  return {
    ...c,
    webOrigins: c.WEB_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
    cookieSecure: c.COOKIE_SECURE ?? isProduction,
    isProduction,
  };
}
