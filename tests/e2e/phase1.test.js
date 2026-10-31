const assert = require('node:assert/strict');
const test = require('node:test');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createApp } = require('../../apps/api/src/app');

const databaseUrl = process.env.DATABASE_URL || 'postgres://brightloop:brightloop@localhost:5432/brightloop';
const jwtSecret = process.env.JWT_SECRET || 'e2e-secret';
let pool;
let server;
let baseUrl;

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

test.before(async () => {
  pool = new Client({ connectionString: databaseUrl });
  await pool.connect();
  await pool.query('TRUNCATE audit_events, password_reset_tokens, users, role_permissions, permissions, roles CASCADE');
  await pool.query('INSERT INTO roles (name) VALUES ($1), ($2), ($3)', ['admin', 'staff', 'customer']);
  await pool.query('INSERT INTO permissions (key, description) VALUES ($1, $2), ($3, $4), ($5, $6)', ['dashboard.read', 'Dashboard', 'reports.read', 'Reports', 'portal.read', 'Portal']);
  await pool.query(`INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE (r.name = 'admin') OR (r.name = 'staff' AND p.key IN ('dashboard.read', 'reports.read')) OR (r.name = 'customer' AND p.key = 'portal.read')`);
  const hash = await bcrypt.hash('Admin@12345', 4);
  await pool.query(`INSERT INTO users (email, password_hash, display_name, role_id, email_verified_at) SELECT 'admin@brightloop.example', $1, 'Test Admin', id, NOW() FROM roles WHERE name = 'admin'`, [hash]);
  const app = createApp({ pool: { query: (text, params) => pool.query(text, params) }, jwtSecret, appOrigin: '*' });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('phase 1 end-to-end access workflow', async () => {
  let result = await request('/health');
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, 'ok');

  result = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: 'customer@example.com', displayName: 'Demo Customer', password: 'Customer@123' }) });
  assert.equal(result.response.status, 201);

  result = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: 'bad@example.com', displayName: 'Bad', password: 'short' }) });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error.code, 'VALIDATION_ERROR');

  result = await request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@brightloop.example', password: 'Admin@12345' }) });
  assert.equal(result.response.status, 200);
  const adminToken = result.body.data.accessToken;
  assert.ok(adminToken);

  result = await request('/api/v1/auth/me', { headers: { authorization: `Bearer ${adminToken}` } });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.role, 'admin');
  assert.ok(result.body.data.permissions.includes('dashboard.read'));

  result = await request('/api/v1/dashboard', { headers: { authorization: `Bearer ${adminToken}` } });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.activeUsers, 2);

  result = await request('/api/v1/audit-events', { headers: { authorization: `Bearer ${adminToken}` } });
  assert.equal(result.response.status, 200);
  assert.ok(result.body.data.some((event) => event.action === 'auth.login'));

  result = await request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'customer@example.com', password: 'Customer@123' }) });
  const customerToken = result.body.data.accessToken;
  result = await request('/api/v1/dashboard', { headers: { authorization: `Bearer ${customerToken}` } });
  assert.equal(result.response.status, 403);

  result = await request('/api/v1/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: 'customer@example.com' }) });
  assert.equal(result.response.status, 200);
  const resetToken = result.response.headers.get('x-development-reset-token');
  assert.ok(resetToken);

  result = await request('/api/v1/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: resetToken, password: 'NewPassword@123' }) });
  assert.equal(result.response.status, 200);
  result = await request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'customer@example.com', password: 'NewPassword@123' }) });
  assert.equal(result.response.status, 200);
});
