/**
 * Brightloop Scheduled Background Billing Worker
 * Periodically discovers due subscriptions, evaluates idempotency keys,
 * generates invoices, and logs operational metrics.
 */

require('dotenv').config();
const { Client } = require('pg');
const { executeBillingRun } = require('../api/src/domain/billing-worker');
const { createMemoryPool } = require('../api/src/domain/memory-pool');

const databaseUrl = process.env.DATABASE_URL || 'postgres://brightloop:brightloop@localhost:5432/brightloop';
const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS) || 60000;

let isRunning = false;

async function runWorkerOnce(client) {
  if (isRunning) return;
  isRunning = true;
  const requestId = `worker_${Date.now()}`;
  try {
    const audit = async ({ action, entityType, entityId, metadata }) => {
      await client.query(
        `INSERT INTO audit_events (action, entity_type, entity_id, metadata, request_id)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [action, entityType, entityId, JSON.stringify(metadata), requestId],
      );
    };

    const result = await executeBillingRun({
      pool: client,
      targetDate: new Date(),
      createdByUserId: null,
      audit,
      requestId,
    });

    if (result.totalProcessed > 0) {
      console.log(`[Worker] Billing run ${result.billingRun.run_number} completed: ${result.successfulCount} succeeded, ${result.failedCount} failed.`);
    }
  } catch (error) {
    console.error('[Worker] Error executing scheduled billing sweep:', error.message);
  } finally {
    isRunning = false;
  }
}

async function startWorker() {
  let client;
  if (databaseUrl) {
    try {
      const probe = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 1500 });
      await probe.connect();
      client = probe;
      console.log('[Worker] Brightloop Billing Worker connected to PostgreSQL.');
    } catch (err) {
      console.log(`[Worker] PostgreSQL unavailable (${err.message}). Running with in-memory worker engine.`);
      client = createMemoryPool();
    }
  } else {
    client = createMemoryPool();
  }

  // Immediate first run
  await runWorkerOnce(client);

  // Scheduled interval
  const timer = setInterval(() => runWorkerOnce(client), pollIntervalMs);

  const shutdown = async () => {
    console.log('[Worker] Shutting down billing worker...');
    clearInterval(timer);
    if (client && typeof client.end === 'function') {
      await client.end();
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  startWorker().catch((err) => {
    console.error('[Worker] Fatal error starting worker:', err);
    process.exit(1);
  });
}

module.exports = { runWorkerOnce };
