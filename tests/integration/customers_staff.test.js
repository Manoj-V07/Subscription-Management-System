const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');
const { createApp } = require('../../apps/api/src/app');

function createMockPool() {
  const roles = [
    { id: 'role-admin', name: 'admin' },
    { id: 'role-staff', name: 'staff' },
    { id: 'role-customer', name: 'customer' },
  ];

  const users = [
    {
      id: 'usr-admin-1',
      email: 'admin@brightloop.example',
      display_name: 'Administrator',
      password_hash: '$2a$12$test',
      status: 'active',
      role: 'admin',
      role_id: 'role-admin',
      permissions: ['dashboard.read', 'staff.manage', 'customers.read', 'customers.manage', 'catalog.manage', 'reports.read'],
      last_login_at: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'usr-staff-1',
      email: 'staff@brightloop.example',
      display_name: 'Sales Rep',
      password_hash: '$2a$12$test',
      status: 'active',
      role: 'staff',
      role_id: 'role-staff',
      permissions: ['dashboard.read', 'customers.read', 'customers.manage', 'reports.read'],
      last_login_at: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'usr-customer-1',
      email: 'alice@client.example',
      display_name: 'Alice Client',
      password_hash: '$2a$12$test',
      status: 'active',
      role: 'customer',
      role_id: 'role-customer',
      permissions: ['portal.read'],
      last_login_at: null,
      created_at: new Date().toISOString(),
    },
  ];

  const customers = [
    {
      id: 'cus-1',
      user_id: 'usr-customer-1',
      name: 'Alice Ventures',
      email: 'alice@client.example',
      phone: '+91 99999 11111',
      billing_address: { city: 'Bengaluru', country: 'IN' },
      tax_identifier: 'GSTIN29ABCDE1234F1Z1',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const auditEvents = [];

  return {
    users,
    customers,
    auditEvents,
    query: async (text, params = []) => {
      // Load user for auth middleware
      if (text.includes('FROM users u') && text.includes('WHERE u.id = $1')) {
        const user = users.find((u) => u.id === params[0]);
        if (!user) return { rows: [], rowCount: 0 };
        return {
          rows: [
            {
              id: user.id,
              email: user.email,
              display_name: user.display_name,
              status: user.status,
              role: user.role,
              permissions: user.permissions,
            },
          ],
          rowCount: 1,
        };
      }

      // Audit event insert
      if (text.includes('INSERT INTO audit_events')) {
        auditEvents.push({
          actorUserId: params[0],
          action: params[1],
          entityType: params[2],
          entityId: params[3],
          metadata: JSON.parse(params[4]),
          requestId: params[5],
        });
        return { rowCount: 1 };
      }

      // Roles lookup
      if (text.includes('SELECT id FROM roles WHERE name = $1')) {
        const found = roles.find((r) => r.name === params[0]);
        return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
      }

      // Staff endpoints
      if (text.includes('FROM users u') && text.includes("WHERE r.name IN ('staff', 'admin')")) {
        const rows = users
          .filter((u) => ['staff', 'admin'].includes(u.role))
          .map((u) => ({
            id: u.id,
            email: u.email,
            display_name: u.display_name,
            status: u.status,
            last_login_at: u.last_login_at,
            created_at: u.created_at,
            role: u.role,
          }));
        return { rows, rowCount: rows.length };
      }

      if (text.includes('SELECT id FROM users WHERE email = $1')) {
        const found = users.find((u) => u.email === params[0]);
        return { rows: found ? [{ id: found.id }] : [], rowCount: found ? 1 : 0 };
      }

      if (text.includes('INSERT INTO users')) {
        const id = `usr-${users.length + 1}`;
        const newUser = {
          id,
          email: params[0],
          password_hash: params[1],
          display_name: params[2],
          role_id: params[3],
          role: roles.find((r) => r.id === params[3])?.name || 'staff',
          status: 'active',
          permissions: ['dashboard.read', 'customers.read', 'customers.manage'],
          last_login_at: null,
          created_at: new Date().toISOString(),
        };
        users.push(newUser);
        return { rows: [newUser], rowCount: 1 };
      }

      if (text.includes('UPDATE users u') && text.includes('SET status = $1')) {
        const found = users.find((u) => u.id === params[1]);
        if (!found) return { rows: [], rowCount: 0 };
        found.status = params[0];
        return {
          rows: [
            {
              id: found.id,
              email: found.email,
              display_name: found.display_name,
              status: found.status,
              last_login_at: found.last_login_at,
              created_at: found.created_at,
              role: found.role,
            },
          ],
          rowCount: 1,
        };
      }

      // Customers endpoints
      if (text.includes('SELECT * FROM customers WHERE user_id = $1')) {
        const filtered = customers.filter((c) => c.user_id === params[0]);
        return { rows: filtered, rowCount: filtered.length };
      }

      if (text.includes('SELECT * FROM customers WHERE 1=1')) {
        return { rows: customers, rowCount: customers.length };
      }

      if (text.includes('SELECT id FROM customers WHERE email = $1')) {
        const found = customers.find((c) => c.email === params[0]);
        return { rows: found ? [{ id: found.id }] : [], rowCount: found ? 1 : 0 };
      }

      if (text.includes('INSERT INTO customers')) {
        const id = `cus-${customers.length + 1}`;
        const newCustomer = {
          id,
          name: params[0],
          email: params[1],
          phone: params[2],
          billing_address: JSON.parse(params[3]),
          tax_identifier: params[4],
          user_id: params[5],
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        customers.push(newCustomer);
        return { rows: [newCustomer], rowCount: 1 };
      }

      if (text.includes('SELECT * FROM customers WHERE id = $1')) {
        const found = customers.find((c) => c.id === params[0]);
        return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
      }

      if (text.includes('UPDATE customers')) {
        const found = customers.find((c) => c.id === params[5]);
        if (!found) return { rows: [], rowCount: 0 };
        found.name = params[0];
        found.phone = params[1];
        found.billing_address = JSON.parse(params[2]);
        found.tax_identifier = params[3];
        found.status = params[4];
        found.updated_at = new Date().toISOString();
        return { rows: [found], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

let server;
let baseUrl;
let adminToken;
let staffToken;
let customerToken;
const jwtSecret = 'test-secret-phase2-task3';

test.before(async () => {
  const mockPool = createMockPool();
  const app = createApp({ pool: mockPool, jwtSecret });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  adminToken = jwt.sign({ sub: 'usr-admin-1', role: 'admin' }, jwtSecret);
  staffToken = jwt.sign({ sub: 'usr-staff-1', role: 'staff' }, jwtSecret);
  customerToken = jwt.sign({ sub: 'usr-customer-1', role: 'customer' }, jwtSecret);
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function api(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, data };
}

test('staff administration: admin-only privileges', async () => {
  // 1. Staff and Customer cannot create staff accounts
  let res = await api('/api/v1/staff', {
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` },
    body: JSON.stringify({ email: 'newstaff@example.com', displayName: 'Bob', password: 'Password@123' }),
  });
  assert.equal(res.status, 403);

  res = await api('/api/v1/staff', {
    method: 'POST',
    headers: { Authorization: `Bearer ${customerToken}` },
    body: JSON.stringify({ email: 'newstaff@example.com', displayName: 'Bob', password: 'Password@123' }),
  });
  assert.equal(res.status, 403);

  // 2. Admin cannot create staff with invalid password
  res = await api('/api/v1/staff', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ email: 'badpass@example.com', displayName: 'Bob', password: 'short' }),
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.error.code, 'VALIDATION_ERROR');

  // 3. Admin successfully creates staff account
  res = await api('/api/v1/staff', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      email: 'ops.specialist@brightloop.example',
      displayName: 'Operations Specialist',
      password: 'Specialist@2026',
      role: 'staff',
    }),
  });
  assert.equal(res.status, 201);
  const newStaff = res.data.data;
  assert.equal(newStaff.email, 'ops.specialist@brightloop.example');
  assert.equal(newStaff.role, 'staff');

  // 4. Admin lists all staff accounts
  res = await api('/api/v1/staff', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 200);
  assert.ok(res.data.data.some((s) => s.email === 'ops.specialist@brightloop.example'));

  // 5. Admin updates staff status to disabled
  res = await api(`/api/v1/staff/${newStaff.id}/status`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'disabled' }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.data.status, 'disabled');

  // 6. Admin cannot disable self
  res = await api('/api/v1/staff/usr-admin-1/status', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'disabled' }),
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.error.code, 'ACTION_FORBIDDEN');
});

test('customer directory: staff management & portal isolation', async () => {
  // 1. Staff creates customer
  let res = await api('/api/v1/customers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` },
    body: JSON.stringify({
      name: 'Stark Enterprises',
      email: 'tony@stark.example',
      phone: '+91 91234 56789',
      billingAddress: { street: '10880 Malibu Point', city: 'Malibu', country: 'US' },
      taxIdentifier: 'EIN-12-3456789',
    }),
  });
  assert.equal(res.status, 201);
  const createdCustomer = res.data.data;
  assert.equal(createdCustomer.name, 'Stark Enterprises');

  // 2. Customer role cannot create customers
  res = await api('/api/v1/customers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${customerToken}` },
    body: JSON.stringify({ name: 'Hacker Corp', email: 'hack@example.com' }),
  });
  assert.equal(res.status, 403);

  // 3. Staff can view all customers
  res = await api('/api/v1/customers', {
    headers: { Authorization: `Bearer ${staffToken}` },
  });
  assert.equal(res.status, 200);
  assert.ok(res.data.data.length >= 2);

  // 4. Customer Alice views customers list -> scoped to only their own record
  res = await api('/api/v1/customers', {
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.data.length, 1);
  assert.equal(res.data.data[0].id, 'cus-1');

  // 5. Customer Alice attempts to view Stark Enterprises (cus-2) directly -> Forbidden
  res = await api(`/api/v1/customers/${createdCustomer.id}`, {
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  assert.equal(res.status, 403);

  // 6. Customer Alice views their own customer record (cus-1) -> Allowed
  res = await api('/api/v1/customers/cus-1', {
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.data.name, 'Alice Ventures');

  // 7. Staff updates customer phone & address
  res = await api(`/api/v1/customers/${createdCustomer.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${staffToken}` },
    body: JSON.stringify({ phone: '+91 99999 88888' }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.data.phone, '+91 99999 88888');
});
