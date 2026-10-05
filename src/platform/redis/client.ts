import { Redis } from 'ioredis';
import { config } from '../config/env.js';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy(times: number) {
        if (times > 5) {
          return null;
        }
        return Math.min(times * 100, 2000);
      },
    });

    redisClient.on('error', (err: Error) => {
      // Log connection error without crashing the process
      if (process.env.NODE_ENV !== 'test') {
        console.error('[Redis] Connection error:', err.message);
      }
    });
  }

  return redisClient;
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit().catch(() => {
      redisClient?.disconnect();
    });
    redisClient = null;
  }
}
