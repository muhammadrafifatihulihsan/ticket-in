/**
 * @file toxiproxy-setup.ts
 *
 * Toxiproxy Initialization Script – ticket-in platform
 * Configures network proxies for PostgreSQL, Redis, and Kafka to facilitate chaos testing.
 */

const TOXIPROXY_URL = process.env.TOXIPROXY_URL || 'http://localhost:8474';

interface ProxyDefinition {
  name: string;
  listen: string;
  upstream: string;
  enabled: boolean;
}

const PROXIES: ProxyDefinition[] = [
  {
    name: 'postgres_proxy',
    listen: '0.0.0.0:25432',
    upstream: 'postgres:5432',
    enabled: true,
  },
  {
    name: 'redis_proxy',
    listen: '0.0.0.0:26379',
    upstream: 'redis:6379',
    enabled: true,
  },
  {
    name: 'kafka_proxy',
    listen: '0.0.0.0:29092',
    upstream: 'kafka:9092',
    enabled: true,
  },
];

async function setupToxiproxy(): Promise<void> {
  console.info('\n  ticket-in Toxiproxy Configuration');
  console.info('  =================================\n');

  for (const proxy of PROXIES) {
    try {
      // 1. Delete existing proxy if present
      await fetch(`${TOXIPROXY_URL}/proxies/${proxy.name}`, {
        method: 'DELETE',
      }).catch(() => {});

      // 2. Create proxy
      const res = await fetch(`${TOXIPROXY_URL}/proxies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proxy),
      });

      if (res.ok) {
        console.info(
          `  [OK] Proxy '${proxy.name}' configured: ${proxy.listen} -> ${proxy.upstream}`,
        );
      } else {
        const errorText = await res.text();
        console.warn(`  [WARN] Failed to configure '${proxy.name}': ${errorText}`);
      }
    } catch (err) {
      console.warn(`  [WARN] Could not reach Toxiproxy daemon at ${TOXIPROXY_URL}: ${String(err)}`);
      console.info(
        '         Ensure toxiproxy is running via: docker compose --profile chaos up -d',
      );
      return;
    }
  }

  console.info('\n  Toxiproxy setup complete.\n');
}

void setupToxiproxy();
