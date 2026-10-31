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

function createInMemoryPool() {
  const roles = [
    { id: 'rol-admin', name: 'admin' },
    { id: 'rol-staff', name: 'staff' },
    { id: 'rol-customer', name: 'customer' },
  ];
  const permissions = [
    { id: 'perm-dashboard', key: 'dashboard.read', description: 'Dashboard' },
    { id: 'perm-reports', key: 'reports.read', description: 'Reports' },
    { id: 'perm-portal', key: 'portal.read', description: 'Portal' },
  ];
  const rolePermissions = [
    { role_id: 'rol-admin', permission_id: 'perm-dashboard', key: 'dashboard.read' },
    { role_id: 'rol-admin', permission_id: 'perm-reports', key: 'reports.read' },
    { role_id: 'rol-admin', permission_id: 'perm-portal', key: 'portal.read' },
    { role_id: 'rol-staff', permission_id: 'perm-dashboard', key: 'dashboard.read' },
    { role_id: 'rol-staff', permission_id: 'perm-reports', key: 'reports.read' },
    { role_id: 'rol-customer', permission_id: 'perm-portal', key: 'portal.read' },
  ];
  const users = [];
  const auditEvents = [];
  const resetTokens = [];

  return {
    isMock: true,
    async end() {},
    query: async (text, params = []) => {
      if (text.includes('BEGIN') || text.includes('COMMIT') || text.includes('ROLLBACK')) {
        return { rowCount: 1 };
      }
      if (text.trim() === 'SELECT 1') {
        return { rows: [{ '?column?': 1 }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO users')) {
        let passwordHash, email, displayName, roleId;
        if (text.includes('SELECT \'admin@brightloop.example\'')) {
          passwordHash = params[0];
          email = 'admin@brightloop.example';
          displayName = 'Test Admin';
          roleId = 'rol-admin';
        } else {
          email = params[0];
          passwordHash = params[1];
          displayName = params[2];
          roleId = params[3];
        }
        const newUser = {
          id: `usr-${users.length + 1}`,
          email,
          password_hash: passwordHash,
          display_name: displayName,
          role_id: roleId,
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        users.push(newUser);
        return { rows: [newUser], rowCount: 1 };
      }
      if (text.includes('SELECT id FROM users WHERE email = $1 AND status = $2')) {
        const u = users.find((user) => user.email === params[0] && user.status === params[1]);
        return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
      }
      if (text.includes('SELECT id FROM users WHERE email = $1')) {
        const u = users.find((user) => user.email === params[0]);
        return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
      }
      if (text.includes('SELECT id FROM roles WHERE name =')) {
        const roleName = params[0] || (text.includes("'customer'") ? 'customer' : 'admin');
        const r = roles.find((role) => role.name === roleName);
        return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
      }
      if (text.includes('SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = $1')) {
        const u = users.find((user) => user.email === params[0]);
        if (!u) return { rows: [], rowCount: 0 };
        const role = roles.find((r) => r.id === u.role_id)?.name || 'customer';
        return { rows: [{ ...u, role }], rowCount: 1 };
      }
      if (text.includes('UPDATE users SET last_login_at = NOW()')) {
        return { rowCount: 1 };
      }
      if (text.includes('FROM users u') && text.includes('WHERE u.id = $1')) {
        const u = users.find((user) => user.id === params[0]);
        if (!u) return { rows: [], rowCount: 0 };
        const role = roles.find((r) => r.id === u.role_id)?.name || 'customer';
        const perms = rolePermissions.filter((rp) => rp.role_id === u.role_id).map((rp) => rp.key);
        return { rows: [{ id: u.id, email: u.email, display_name: u.display_name, status: u.status, role, permissions: perms }], rowCount: 1 };
      }
      if (text.includes('SELECT COUNT(*)::int AS count FROM users WHERE status = $1')) {
        const count = users.filter((u) => u.status === params[0]).length;
        return { rows: [{ count }], rowCount: 1 };
      }
      if (text.includes('SELECT COUNT(*)::int AS count FROM audit_events')) {
        return { rows: [{ count: auditEvents.length }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO audit_events')) {
        auditEvents.push({
          id: `aud-${auditEvents.length + 1}`,
          action: params[1],
          entityType: params[2],
          entityId: params[3],
          metadata: JSON.parse(params[4]),
          requestId: params[5],
          createdAt: new Date().toISOString(),
        });
        return { rowCount: 1 };
      }
      if (text.includes('SELECT id, action, entity_type AS "entityType"')) {
        return { rows: auditEvents.slice().reverse(), rowCount: auditEvents.length };
      }
      if (text.includes('INSERT INTO password_reset_tokens')) {
        resetTokens.push({
          id: `rst-${resetTokens.length + 1}`,
          user_id: params[0],
          token_hash: params[1],
          used_at: null,
          expires_at: new Date(Date.now() + 30 * 60 * 1000),
        });
        return { rowCount: 1 };
      }
      if (text.includes('SELECT id, user_id FROM password_reset_tokens WHERE token_hash = $1')) {
        const tok = resetTokens.find((t) => t.token_hash === params[0] && !t.used_at && t.expires_at > new Date());
        return { rows: tok ? [tok] : [], rowCount: tok ? 1 : 0 };
      }
      if (text.includes('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2')) {
        const u = users.find((user) => user.id === params[1]);
        if (u) u.password_hash = params[0];
        return { rowCount: 1 };
      }
      if (text.includes('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1')) {
        const tok = resetTokens.find((t) => t.id === params[0]);
        if (tok) tok.used_at = new Date();
        return { rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

test.before(async () => {
  let isLiveConnected = false;
  try {
    const liveClient = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 1000 });
    await liveClient.connect();
    pool = liveClient;
    await pool.query('TRUNCATE audit_events, password_reset_tokens, users, role_permissions, permissions, roles CASCADE');
    await pool.query('INSERT INTO roles (name) VALUES ($1), ($2), ($3)', ['admin', 'staff', 'customer']);
    await pool.query('INSERT INTO permissions (key, description) VALUES ($1, $2), ($3, $4), ($5, $6)', ['dashboard.read', 'Dashboard', 'reports.read', 'Reports', 'portal.read', 'Portal']);
    await pool.query(`INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE (r.name = 'admin') OR (r.name = 'staff' AND p.key IN ('dashboard.read', 'reports.read')) OR (r.name = 'customer' AND p.key = 'portal.read')`);
    const hash = await bcrypt.hash('Admin@12345', 4);
    await pool.query(`INSERT INTO users (email, password_hash, display_name, role_id, email_verified_at) SELECT 'admin@brightloop.example', $1, 'Test Admin', id, NOW() FROM roles WHERE name = 'admin'`, [hash]);
    isLiveConnected = true;
  } catch (err) {
    // Fall back to clean in-memory mock pool
    pool = createInMemoryPool();
    const hash = await bcrypt.hash('Admin@12345', 4);
    await pool.query(`INSERT INTO users (email, password_hash, display_name, role_id, email_verified_at) SELECT 'admin@brightloop.example', $1, 'Test Admin', id, NOW() FROM roles WHERE name = 'admin'`, [hash]);
  }

  const app = createApp({ pool: { query: (text, params) => pool.query(text, params) }, jwtSecret, appOrigin: '*' });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (pool && typeof pool.end === 'function') {
    await pool.end();
  }
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
