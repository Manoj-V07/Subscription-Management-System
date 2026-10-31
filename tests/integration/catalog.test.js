const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');
const { createApp } = require('../../apps/api/src/app');

// In-memory mock database for unit/integration testing catalog routes without live PG
function createMockPool() {
  const users = [
    {
      id: 'usr-admin-1',
      email: 'admin@brightloop.example',
      display_name: 'Admin User',
      status: 'active',
      role: 'admin',
      permissions: ['dashboard.read', 'catalog.manage', 'reports.read'],
    },
    {
      id: 'usr-customer-1',
      email: 'customer@example.com',
      display_name: 'Customer User',
      status: 'active',
      role: 'customer',
      permissions: ['portal.read'],
    },
  ];

  const products = [];
  const variants = [];
  const plans = [];
  const taxRules = [];
  const discountRules = [];
  const auditEvents = [];

  return {
    users,
    products,
    variants,
    plans,
    taxRules,
    discountRules,
    auditEvents,
    query: async (text, params = []) => {
      // 1. Load User
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

      // 2. Audit Events Insert
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

      // 3. Products
      if (text.includes('SELECT p.*') && text.includes('FROM products p')) {
        if (text.includes('WHERE p.id = $1')) {
          const prod = products.find((p) => p.id === params[0]);
          if (!prod) return { rows: [], rowCount: 0 };
          const prodVariants = variants
            .filter((v) => v.product_id === prod.id)
            .map((v) => ({
              id: v.id,
              label: v.label,
              adjustmentType: v.adjustment_type,
              adjustmentValue: v.adjustment_value,
              isActive: v.is_active,
            }));
          return { rows: [{ ...prod, variants: prodVariants }], rowCount: 1 };
        }
        const includeArchived = params[0] === true;
        const filtered = products.filter((p) => includeArchived || !p.is_archived);
        const rows = filtered.map((prod) => ({
          ...prod,
          variants: variants
            .filter((v) => v.product_id === prod.id)
            .map((v) => ({
              id: v.id,
              label: v.label,
              adjustmentType: v.adjustment_type,
              adjustmentValue: v.adjustment_value,
              isActive: v.is_active,
            })),
        }));
        return { rows, rowCount: rows.length };
      }

      if (text.includes('INSERT INTO products')) {
        const id = `prod-${products.length + 1}`;
        const newProduct = {
          id,
          name: params[0],
          product_type: params[1],
          sales_price_cents: params[2],
          cost_price_cents: params[3],
          currency: params[4],
          notes: params[5],
          is_archived: false,
          archived_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        products.push(newProduct);
        return { rows: [newProduct], rowCount: 1 };
      }

      if (text.includes('SELECT * FROM products WHERE id = $1')) {
        const found = products.find((p) => p.id === params[0]);
        return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
      }

      if (text.includes('SELECT id FROM products WHERE id = $1')) {
        const found = products.find((p) => p.id === params[0]);
        return { rows: found ? [{ id: found.id }] : [], rowCount: found ? 1 : 0 };
      }

      if (text.includes('UPDATE products') && text.includes('is_archived = true')) {
        const found = products.find((p) => p.id === params[0]);
        if (!found) return { rows: [], rowCount: 0 };
        found.is_archived = true;
        found.archived_at = new Date().toISOString();
        return { rows: [found], rowCount: 1 };
      }

      if (text.includes('UPDATE products')) {
        const found = products.find((p) => p.id === params[5]);
        if (!found) return { rows: [], rowCount: 0 };
        found.name = params[0];
        found.product_type = params[1];
        found.sales_price_cents = params[2];
        found.cost_price_cents = params[3];
        found.notes = params[4];
        found.updated_at = new Date().toISOString();
        return { rows: [found], rowCount: 1 };
      }

      // 4. Variants
      if (text.includes('INSERT INTO product_variants')) {
        const id = `var-${variants.length + 1}`;
        const newVariant = {
          id,
          product_id: params[0],
          label: params[1],
          adjustment_type: params[2],
          adjustment_value: params[3],
          is_active: true,
          created_at: new Date().toISOString(),
        };
        variants.push(newVariant);
        return { rows: [newVariant], rowCount: 1 };
      }

      if (text.includes('FROM product_variants WHERE product_id = $1')) {
        const matched = variants.filter((v) => v.product_id === params[0]);
        return {
          rows: matched.map((v) => ({
            id: v.id,
            productId: v.product_id,
            label: v.label,
            adjustmentType: v.adjustment_type,
            adjustmentValue: v.adjustment_value,
            isActive: v.is_active,
            createdAt: v.created_at,
          })),
          rowCount: matched.length,
        };
      }

      // 5. Plans
      if (text.includes('SELECT * FROM plans WHERE id = $1')) {
        const found = plans.find((p) => p.id === params[0]);
        return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
      }

      if (text.includes('SELECT * FROM plans')) {
        const includeArchived = params[0] === true;
        const rows = plans.filter((p) => includeArchived || !p.is_archived);
        return { rows, rowCount: rows.length };
      }

      if (text.includes('INSERT INTO plans')) {
        const id = `plan-${plans.length + 1}`;
        const newPlan = {
          id,
          name: params[0],
          code: params[1],
          interval: params[2],
          interval_count: params[3],
          min_quantity: params[4],
          trial_days: params[5],
          auto_renew: params[6],
          allow_pause: params[7],
          allow_early_close: params[8],
          start_date: params[9],
          end_date: params[10],
          is_active: true,
          is_archived: false,
          archived_at: null,
          created_at: new Date().toISOString(),
        };
        plans.push(newPlan);
        return { rows: [newPlan], rowCount: 1 };
      }

      if (text.includes('UPDATE plans') && text.includes('is_archived = true')) {
        const found = plans.find((p) => p.id === params[0]);
        if (!found) return { rows: [], rowCount: 0 };
        found.is_archived = true;
        found.archived_at = new Date().toISOString();
        return { rows: [found], rowCount: 1 };
      }

      // 6. Tax Rules
      if (text.includes('SELECT * FROM tax_rules')) {
        return { rows: taxRules, rowCount: taxRules.length };
      }

      if (text.includes('INSERT INTO tax_rules')) {
        const id = `tax-${taxRules.length + 1}`;
        const newTax = {
          id,
          name: params[0],
          rate_percentage: params[1],
          jurisdiction: params[2],
          effective_from: params[3] || new Date().toISOString(),
          effective_to: params[4],
          is_active: true,
          created_at: new Date().toISOString(),
        };
        taxRules.push(newTax);
        return { rows: [newTax], rowCount: 1 };
      }

      // 7. Discount Rules
      if (text.includes('SELECT * FROM discount_rules')) {
        return { rows: discountRules, rowCount: discountRules.length };
      }

      if (text.includes('INSERT INTO discount_rules')) {
        const id = `disc-${discountRules.length + 1}`;
        const newDiscount = {
          id,
          name: params[0],
          code: params[1],
          type: params[2],
          value: params[3],
          min_threshold_cents: params[4],
          scope: params[5],
          product_id: params[6],
          max_uses: params[7],
          times_used: 0,
          start_date: params[8],
          end_date: params[9],
          is_active: true,
          created_at: new Date().toISOString(),
        };
        discountRules.push(newDiscount);
        return { rows: [newDiscount], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

let server;
let baseUrl;
let adminToken;
let customerToken;
const jwtSecret = 'test-secret-key-12345';

test.before(async () => {
  const mockPool = createMockPool();
  const app = createApp({ pool: mockPool, jwtSecret });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  adminToken = jwt.sign({ sub: 'usr-admin-1', role: 'admin' }, jwtSecret);
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

test('catalog api: products and variants lifecycle', async () => {
  // 1. Non-admin without catalog.manage cannot create products
  let res = await api('/api/v1/products', {
    method: 'POST',
    headers: { Authorization: `Bearer ${customerToken}` },
    body: JSON.stringify({ name: 'Unauthorized Product', salesPriceCents: 1000 }),
  });
  assert.equal(res.status, 403);

  // 2. Admin creates a product
  res = await api('/api/v1/products', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      name: 'Brightloop Analytics',
      productType: 'service',
      salesPriceCents: 150000,
      costPriceCents: 30000,
      notes: 'Realtime dashboard telemetry',
    }),
  });
  assert.equal(res.status, 201);
  const product = res.data.data;
  assert.equal(product.name, 'Brightloop Analytics');
  assert.equal(product.salesPriceCents, 150000);

  // 3. Add a variant to the product
  res = await api(`/api/v1/products/${product.id}/variants`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      label: 'Dedicated Ingestion Engine',
      adjustmentType: 'fixed',
      adjustmentValue: 45000,
    }),
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.data.label, 'Dedicated Ingestion Engine');

  // 4. Retrieve single product and verify variant is attached
  res = await api(`/api/v1/products/${product.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.data.variants.length, 1);
  assert.equal(res.data.data.variants[0].label, 'Dedicated Ingestion Engine');

  // 5. Archive product
  res = await api(`/api/v1/products/${product.id}/archive`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.data.isArchived, true);
});

test('catalog api: plans lifecycle', async () => {
  // 1. Create a plan
  let res = await api('/api/v1/plans', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      name: 'Scale Quarterly',
      code: 'PLAN-SCALE-Q',
      interval: 'monthly',
      intervalCount: 3,
      minQuantity: 2,
    }),
  });
  assert.equal(res.status, 201);
  const plan = res.data.data;
  assert.equal(plan.name, 'Scale Quarterly');
  assert.equal(plan.interval, 'monthly');
  assert.equal(plan.intervalCount, 3);

  // 2. Archive plan
  res = await api(`/api/v1/plans/${plan.id}/archive`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.data.isArchived, true);
});

test('catalog api: tax rules', async () => {
  // 1. Create Tax Rule
  let res = await api('/api/v1/tax-rules', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      name: 'GST 18%',
      ratePercentage: 18.0,
      jurisdiction: 'IN',
    }),
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.data.ratePercentage, 18);

  // 2. Fetch Tax Rules list
  res = await api('/api/v1/tax-rules', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 200);
  assert.ok(res.data.data.some((t) => t.name === 'GST 18%'));
});

test('catalog api: discount rules (admin-only)', async () => {
  // 1. Customer cannot view or create discount rules
  let res = await api('/api/v1/discount-rules', {
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  assert.equal(res.status, 403);

  // 2. Admin creates a discount rule
  res = await api('/api/v1/discount-rules', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      name: 'Early Adopter 15%',
      code: 'EARLY15',
      type: 'percentage',
      value: 15.0,
      minThresholdCents: 50000,
      scope: 'entire_order',
    }),
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.data.code, 'EARLY15');

  // 3. Admin lists discount rules
  res = await api('/api/v1/discount-rules', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 200);
  assert.ok(res.data.data.length >= 1);
});
