require('dotenv').config();
const path = require('node:path');
const { Pool, Client } = require('pg');
const { createApp } = require('./app');
const { createMemoryPool } = require('./domain/memory-pool');

const required = ['JWT_SECRET'];
for (const name of required) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

async function start() {
  let pool;
  const dbUrl = process.env.DATABASE_URL;

  if (dbUrl) {
    try {
      const probeClient = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 1500 });
      await probeClient.connect();
      await probeClient.end();
      pool = new Pool({ connectionString: dbUrl, max: 10 });
      console.log(`[Storage] Connected to PostgreSQL at ${dbUrl}`);
    } catch (err) {
      console.log(`[Storage] PostgreSQL connection failed (${err.message}).`);
      console.log(`[Storage] Seamlessly running with in-memory database & pre-seeded demo dataset.`);
      pool = createMemoryPool();
    }
  } else {
    console.log(`[Storage] No DATABASE_URL provided. Running with in-memory database & demo dataset.`);
    pool = createMemoryPool();
  }

  const app = createApp({
    pool,
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
    appOrigin: process.env.APP_ORIGIN || '*',
  });

  const port = Number(process.env.PORT || 4000);
  const server = app.listen(port, () => {
    console.log(`Brightloop Subscription Management running at http://localhost:${port}`);
    console.log(`Default Admin Login: admin@brightloop.example / Admin@12345`);
  });

  async function shutdown(signal) {
    console.log(`${signal} received; shutting down.`);
    server.close(async () => {
      if (pool && typeof pool.end === 'function') {
        await pool.end();
      }
      process.exit(0);
    });
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return { server, app };
}

if (require.main === module) {
  start();
}

module.exports = { start };
