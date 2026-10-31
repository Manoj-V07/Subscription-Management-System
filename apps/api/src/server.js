require('dotenv').config();
const path = require('node:path');
const { Pool } = require('pg');
const { createApp } = require('./app');

const required = ['DATABASE_URL', 'JWT_SECRET'];
for (const name of required) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const app = createApp({
  pool,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  appOrigin: process.env.APP_ORIGIN || '*',
});
const port = Number(process.env.PORT || 4000);
const server = app.listen(port, () => console.log(`Brightloop API listening on http://localhost:${port}`));

async function shutdown(signal) {
  console.log(`${signal} received; shutting down.`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
