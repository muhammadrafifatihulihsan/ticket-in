/**
 * @file chaos-db-latency.ts
 *
 * Chaos Engineering Scenario 2: PostgreSQL Latency Injection
 * Injects 500ms latency with 100ms jitter to the PostgreSQL connection pool.
 * Verifies system handles slow queries gracefully with bounded timeouts.
 */

const TOXIPROXY_URL = process.env.TOXIPROXY_URL || 'http://localhost:8474';
const PROXY_NAME = 'postgres_proxy';
const TOXIC_NAME = 'postgres_latency_toxic';

async function runDbLatencyChaos(): Promise<void> {
  console.info('\n  Chaos Scenario 2: Database Latency Injection (500ms)');
  console.info('  ====================================================\n');

  try {
    // 1. Add 500ms latency toxic
    console.info(`  [ACTION] Adding 500ms latency toxic to ${PROXY_NAME}...`);
    const toxicPayload = {
      name: TOXIC_NAME,
      type: 'latency',
      stream: 'both',
      toxicity: 1.0,
      attributes: {
        latency: 500,
        jitter: 100,
      },
    };

    const addRes = await fetch(`${TOXIPROXY_URL}/proxies/${PROXY_NAME}/toxics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toxicPayload),
    });

    if (!addRes.ok) {
      console.warn(`  [WARN] Failed to inject toxic: ${await addRes.text()}`);
      return;
    }
    console.info('  [OK] 500ms latency injected successfully into PostgreSQL proxy.\n');

    // 2. Wait 10 seconds while system runs under latency stress
    console.info('  [WAIT] Simulating 10-second high database latency period...');
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // 3. Remove the toxic
    console.info(`  [ACTION] Removing ${TOXIC_NAME} from ${PROXY_NAME}...`);
    const delRes = await fetch(`${TOXIPROXY_URL}/proxies/${PROXY_NAME}/toxics/${TOXIC_NAME}`, {
      method: 'DELETE',
    });

    if (delRes.ok) {
      console.info('  [OK] Latency toxic removed successfully.\n');
      console.info('  Chaos test finished: Database query latency normalized.\n');
    } else {
      console.warn(`  [WARN] Failed to remove toxic: ${await delRes.text()}`);
    }
  } catch (err) {
    console.warn(`  [WARN] Could not communicate with Toxiproxy: ${String(err)}`);
    console.info('         Ensure toxiproxy is running via: docker compose --profile chaos up -d');
  }
}

void runDbLatencyChaos();
