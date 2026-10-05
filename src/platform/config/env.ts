import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url().default('postgresql://ticketin:ticketin_dev_password@localhost:5432/ticketin_db'),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().positive().default(20),

  REDIS_URL: z.string().url().default('redis://:redis_dev_password@localhost:6379/0'),

  KAFKA_BROKERS: z.string().default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().default('ticket-in-service'),

  JWT_ACCESS_SECRET: z.string().min(32).default('dev_jwt_access_secret_key_minimum_32_chars_12345'),
  JWT_REFRESH_SECRET: z.string().min(32).default('dev_jwt_refresh_secret_key_minimum_32_chars_12345'),
  WAITING_ROOM_SECRET: z.string().min(32).default('dev_waiting_room_hmac_secret_key_minimum_32_chars'),
  WEBHOOK_HMAC_SECRET: z.string().min(32).default('dev_webhook_signature_hmac_secret_minimum_32_chars'),

  PAYMENT_SIMULATOR_PORT: z.coerce.number().int().positive().default(3001),
  PAYMENT_SIMULATOR_URL: z.string().url().default('http://localhost:3001'),
  PAYMENT_SIMULATOR_LATENCY_MS: z.coerce.number().int().nonnegative().default(300),
  PAYMENT_SIMULATOR_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.05),

  ADMISSION_RATE_PER_INTERVAL: z.coerce.number().int().positive().default(50),
  ADMISSION_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  HEARTBEAT_TTL_SECONDS: z.coerce.number().int().positive().default(30),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function loadConfig(source: Record<string, string | undefined> = process.env): EnvConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const formatted = result.error.format();
    throw new Error(`Invalid environment configuration: ${JSON.stringify(formatted)}`);
  }
  return result.data;
}

export const config: EnvConfig = loadConfig();
