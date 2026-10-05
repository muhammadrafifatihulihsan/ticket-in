import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

declare module 'fastify' {
  interface FastifyRequest {
    metricsStartTime?: [number, number];
  }
}

export class MetricsService {
  public readonly register: Registry;
  public readonly httpRequestDuration: Histogram<string>;
  public readonly httpRequestsTotal: Counter<string>;

  constructor(register?: Registry) {
    this.register = register ?? new Registry();

    collectDefaultMetrics({
      register: this.register,
      prefix: 'ticket_in_',
    });

    this.httpRequestDuration = new Histogram({
      name: 'ticket_in_http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.register],
    });

    this.httpRequestsTotal = new Counter({
      name: 'ticket_in_http_requests_total',
      help: 'Total count of HTTP requests processed',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.register],
    });
  }

  registerHooks(fastify: FastifyInstance): void {
    fastify.addHook('onRequest', async (req) => {
      req.metricsStartTime = process.hrtime();
    });

    fastify.addHook('onResponse', async (req, reply) => {
      if (!req.metricsStartTime) {
        return;
      }

      const diff = process.hrtime(req.metricsStartTime);
      const durationSeconds = diff[0] + diff[1] / 1e9;

      const route = req.routeOptions?.url ?? req.url.split('?')[0] ?? 'unknown';
      const method = req.method;
      const statusCode = String(reply.statusCode);

      this.httpRequestDuration.labels(method, route, statusCode).observe(durationSeconds);
      this.httpRequestsTotal.labels(method, route, statusCode).inc();
    });
  }

  createFastifyPlugin(): FastifyPluginAsync {
    return async (fastify) => {
      this.registerHooks(fastify);
    };
  }

  async getMetrics(): Promise<string> {
    return this.register.metrics();
  }

  getContentType(): string {
    return this.register.contentType;
  }
}

export const defaultMetricsService = new MetricsService();
