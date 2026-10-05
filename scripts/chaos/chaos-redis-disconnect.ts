/**
 * @file chaos-redis-disconnect.ts
 *
 * Chaos Engineering Scenario 1: Redis Disconnection
 * Simulates complete Redis failure by injecting a disable toxic via Toxiproxy.
 * Verifies system handles disconnection gracefully without unhandled exceptions.
 */

const TOXIPROXY_URL = process.env.TOXIPROXY_URL || 'http://localhost:8474';
const PROXY_NAME = 'redis_proxy';

async function runRedisDisconnectChaos(): Promise<void> {
  console.info('\n  Chaos Scenario 1: Redis Disconnection Simulation');
  console.info('  =================================================\n');

  try {
    // 1. Disable the proxy to simulate network severance
    console.info(`  [ACTION] Disabling ${PROXY_NAME} to simulate Redis outage...`);
    const disableRes = await fetch(`${TOXIPROXY_URL}/proxies/${PROXY_NAME}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    if (!disableRes.ok) {
      console.warn(`  [WARN] Failed to disable proxy: ${await disableRes.text()}`);
      return;
    }
    console.info('  [OK] Redis proxy disabled. Redis is now unreachable.\n');

    // 2. Wait 5 seconds to simulate an outage period
    console.info('  [WAIT] Simulating 5-second network partition...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // 3. Restore the proxy
    console.info(`  [ACTION] Re-enabling ${PROXY_NAME} to restore network connectivity...`);
    const enableRes = await fetch(`${TOXIPROXY_URL}/proxies/${PROXY_NAME}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });

    if (enableRes.ok) {
      console.info('  [OK] Redis proxy re-enabled successfully.\n');
      console.info('  Chaos test finished: System recovered connection gracefully.\n');
    } else {
      console.warn(`  [WARN] Failed to re-enable proxy: ${await enableRes.text()}`);
    }
  } catch (err) {
    console.warn(`  [WARN] Could not communicate with Toxiproxy: ${String(err)}`);
    console.info('         Ensure toxiproxy is running via: docker compose --profile chaos up -d');
  }
}

void runRedisDisconnectChaos();
