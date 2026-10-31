require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    console.log('Database schema is up to date.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Database migration failed:', error.message);
  process.exitCode = 1;
});
