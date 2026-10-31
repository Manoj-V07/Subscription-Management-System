const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');
const { createApp } = require('../../apps/api/src/app');

function createPhase2MockPool() {
  const users = [
    {
      id: 'usr-admin',
      email: 'admin@brightloop.example',
      display_name: 'Brightloop Admin',
      status: 'active',
      role: 'admin',
      permissions: [
        'dashboard.read',
        'staff.manage',
        'customers.read',
        'customers.manage',
        'catalog.manage',
        'quotes.manage',
        'subscriptions.manage',
        'reports.read',
      ],
    },
    {
      id: 'usr-client',
      email: 'client@vertex.example',
      display_name: 'Vertex Systems Client',
      status: 'active',
      role: 'customer',
      permissions: ['portal.read'],
    },
  ];

  const customers = [];
  const products = [];
  const variants = [];
  const plans = [];
  const taxRules = [];
  const discountRules = [];
  const quotations = [];
  const quotationLines = [];
  const subscriptions = [];
  const subscriptionLines = [];
  const auditEvents = [];

  return {
    users,
    customers,
    products,
    variants,
    plans,
    taxRules,
    discountRules,
    quotations,
    quotationLines,
    subscriptions,
    subscriptionLines,
    auditEvents,
    query: async (text, params = []) => {
      if (text.includes('BEGIN') || text.includes('COMMIT') || text.includes('ROLLBACK')) {
        return { rowCount: 1 };
      }

      // Load user
      if (text.includes('FROM users u') && text.includes('WHERE u.id = $1')) {
        const u = users.find((user) => user.id === params[0]);
        if (!u) return { rows: [], rowCount: 0 };
        return { rows: [u], rowCount: 1 };
      }

      // Audit insert
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

      // Products
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
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        products.push(newProduct);
        return { rows: [newProduct], rowCount: 1 };
      }
      if (text.includes('SELECT id, name, sales_price_cents FROM products WHERE id = $1')) {
        const p = products.find((pr) => pr.id === params[0]);
        return { rows: p ? [p] : [], rowCount: p ? 1 : 0 };
      }
      if (text.includes('SELECT id FROM products WHERE id = $1')) {
        const p = products.find((pr) => pr.id === params[0]);
        return { rows: p ? [{ id: p.id }] : [], rowCount: p ? 1 : 0 };
      }
      if (text.includes('SELECT p.*') && text.includes('FROM products p')) {
        const rows = products.map((prod) => ({
          ...prod,
          variants: variants.filter((v) => v.product_id === prod.id),
        }));
        return { rows, rowCount: rows.length };
      }

      // Variants
      if (text.includes('INSERT INTO product_variants')) {
        const id = `var-${variants.length + 1}`;
        const newVar = {
          id,
          product_id: params[0],
          label: params[1],
          adjustment_type: params[2],
          adjustment_value: params[3],
          is_active: true,
        };
        variants.push(newVar);
        return { rows: [newVar], rowCount: 1 };
      }
      if (text.includes('SELECT id, label, adjustment_type, adjustment_value FROM product_variants WHERE id = $1')) {
        const v = variants.find((vr) => vr.id === params[0] && vr.product_id === params[1]);
        return { rows: v ? [v] : [], rowCount: v ? 1 : 0 };
      }

      // Plans
      if (text.includes('INSERT INTO plans')) {
        const id = `plan-${plans.length + 1}`;
        const newPlan = {
          id,
          name: params[0],
          code: params[1],
          interval: params[2],
          interval_count: params[3],
          min_quantity: params[4],
          is_archived: false,
        };
        plans.push(newPlan);
        return { rows: [newPlan], rowCount: 1 };
      }
      if (text.includes('SELECT id, name FROM plans WHERE id = $1')) {
        const pl = plans.find((p) => p.id === params[0]);
        return { rows: pl ? [pl] : [], rowCount: pl ? 1 : 0 };
      }

      // Tax rules
      if (text.includes('INSERT INTO tax_rules')) {
        const id = `tax-${taxRules.length + 1}`;
        const newTax = {
          id,
          name: params[0],
          rate_percentage: params[1],
          jurisdiction: params[2],
          is_active: true,
        };
        taxRules.push(newTax);
        return { rows: [newTax], rowCount: 1 };
      }
      if (text.includes('SELECT * FROM tax_rules WHERE id = $1')) {
        const t = taxRules.find((tr) => tr.id === params[0] && tr.is_active);
        return { rows: t ? [t] : [], rowCount: t ? 1 : 0 };
      }

      // Discount rules
      if (text.includes('INSERT INTO discount_rules')) {
        const id = `disc-${discountRules.length + 1}`;
        const newDisc = {
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
          is_active: true,
        };
        discountRules.push(newDisc);
        return { rows: [newDisc], rowCount: 1 };
      }
      if (text.includes('SELECT * FROM discount_rules WHERE id = $1')) {
        const d = discountRules.find((dr) => dr.id === params[0] && dr.is_active);
        return { rows: d ? [d] : [], rowCount: d ? 1 : 0 };
      }
      if (text.includes('UPDATE discount_rules SET times_used = times_used + 1')) {
        const d = discountRules.find((dr) => dr.id === params[0]);
        if (d) d.times_used += 1;
        return { rowCount: 1 };
      }

      // Customers
      if (text.includes('SELECT id FROM customers WHERE email = $1')) {
        const found = customers.find((c) => c.email === params[0]);
        return { rows: found ? [{ id: found.id }] : [], rowCount: found ? 1 : 0 };
      }
      if (text.includes('INSERT INTO customers')) {
        const id = `cus-${customers.length + 1}`;
        const newCust = {
          id,
          name: params[0],
          email: params[1],
          phone: params[2],
          billing_address: JSON.parse(params[3]),
          tax_identifier: params[4],
          user_id: params[5],
          status: 'active',
          created_at: new Date().toISOString(),
        };
        customers.push(newCust);
        return { rows: [newCust], rowCount: 1 };
      }
      if (text.includes('SELECT id, name FROM customers WHERE id = $1')) {
        const c = customers.find((cust) => cust.id === params[0]);
        return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
      }
      if (text.includes('SELECT * FROM customers WHERE user_id = $1')) {
        const filtered = customers.filter((c) => c.user_id === params[0]);
        return { rows: filtered, rowCount: filtered.length };
      }

      // Quotations
      if (text.includes('SELECT COUNT(*)::int AS count FROM quotations')) {
        return { rows: [{ count: quotations.length }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO quotations')) {
        const id = `quote-${quotations.length + 1}`;
        const newQuote = {
          id,
          quotation_number: params[0],
          customer_id: params[1],
          plan_id: params[2],
          status: 'draft',
          issue_date: new Date().toISOString().split('T')[0],
          expiry_date: new Date().toISOString().split('T')[0],
          currency: 'INR',
          subtotal_cents: params[4],
          discount_cents: params[5],
          tax_cents: params[6],
          grand_total_cents: params[7],
          applied_discount_rule_id: params[8],
          applied_tax_rule_id: params[9],
          snapshot_breakdown: JSON.parse(params[10]),
          created_by: params[11],
          created_at: new Date().toISOString(),
        };
        quotations.push(newQuote);
        return { rows: [newQuote], rowCount: 1 };
      }
      if (text.includes('INSERT INTO quotation_lines')) {
        const newLine = {
          id: `ql-${quotationLines.length + 1}`,
          quotation_id: params[0],
          product_id: params[1],
          variant_id: params[2],
          description: params[3],
          quantity: params[4],
          unit_price_cents: params[5],
          variant_adjustment_cents: params[6],
          line_subtotal_cents: params[7],
        };
        quotationLines.push(newLine);
        return { rows: [newLine], rowCount: 1 };
      }
      if (text.includes('SELECT * FROM quotations WHERE id = $1')) {
        const found = quotations.find((q) => q.id === params[0]);
        return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
      }
      if (text.includes('SELECT * FROM quotation_lines WHERE quotation_id = $1')) {
        const matched = quotationLines.filter((ql) => ql.quotation_id === params[0]);
        return { rows: matched, rowCount: matched.length };
      }
      if (text.includes('UPDATE quotations SET status =')) {
        const found = quotations.find((q) => q.id === params[0]);
        if (!found) return { rows: [], rowCount: 0 };
        if (text.includes("'sent'")) found.status = 'sent';
        else if (text.includes("'accepted'")) found.status = 'accepted';
        else if (text.includes("'converted'")) found.status = 'converted';
        return { rows: [found], rowCount: 1 };
      }

      // Subscriptions
      if (text.includes('SELECT COUNT(*)::int AS count FROM subscriptions')) {
        return { rows: [{ count: subscriptions.length }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO subscriptions')) {
        const id = `sub-${subscriptions.length + 1}`;
        const newSub = {
          id,
          subscription_number: params[0],
          quotation_id: params[1],
          customer_id: params[2],
          plan_id: params[3],
          status: 'confirmed',
          starts_at: new Date().toISOString(),
          payment_terms_days: 15,
          currency: params[4],
          subtotal_cents: params[5],
          discount_cents: params[6],
          tax_cents: params[7],
          grand_total_cents: params[8],
          balance_due_cents: params[9],
          applied_discount_rule_id: params[10],
          applied_tax_rule_id: params[11],
          snapshot_breakdown: JSON.parse(params[12]),
          created_by: params[13],
          created_at: new Date().toISOString(),
        };
        subscriptions.push(newSub);
        return { rows: [newSub], rowCount: 1 };
      }
      if (text.includes('INSERT INTO subscription_lines')) {
        subscriptionLines.push({
          subscription_id: params[0],
          product_id: params[1],
          variant_id: params[2],
          description: params[3],
          quantity: params[4],
          unit_price_cents: params[5],
          variant_adjustment_cents: params[6],
          line_subtotal_cents: params[7],
        });
        return { rowCount: 1 };
      }
      if (text.includes('FROM subscriptions s') && text.includes('WHERE s.id = $1')) {
        const sub = subscriptions.find((s) => s.id === params[0]);
        if (!sub) return { rows: [], rowCount: 0 };
        return {
          rows: [
            {
              ...sub,
              customer_name: 'Vertex Systems Inc',
              plan_name: 'Monthly Growth Plan',
              lines: subscriptionLines.filter((sl) => sl.subscription_id === sub.id),
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes('FROM subscriptions s')) {
        return {
          rows: subscriptions.map((s) => ({
            ...s,
            customer_name: 'Vertex Systems Inc',
            plan_name: 'Monthly Growth Plan',
            lines: subscriptionLines.filter((sl) => sl.subscription_id === s.id),
          })),
          rowCount: subscriptions.length,
        };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

let server;
let baseUrl;
let adminToken;
let clientToken;
const jwtSecret = 'e2e-phase2-secret-key';

test.before(async () => {
  const mockPool = createPhase2MockPool();
  const app = createApp({ pool: mockPool, jwtSecret });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  adminToken = jwt.sign({ sub: 'usr-admin', role: 'admin' }, jwtSecret);
  clientToken = jwt.sign({ sub: 'usr-client', role: 'customer' }, jwtSecret);
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = response.status === 204 ? null : await response.json();
  return { status: response.status, data };
}

test('phase 2 complete e2e certification: quotation to confirmed subscription lifecycle', async () => {
  // Step 1: Admin configures Product with Variant
  let res = await request('/api/v1/products', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      name: 'Brightloop Business Engine',
      productType: 'service',
      salesPriceCents: 200000, // INR 2,000.00
      currency: 'INR',
    }),
  });
  assert.equal(res.status, 201);
  const product = res.data.data;

  res = await request(`/api/v1/products/${product.id}/variants`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      label: '24/7 SLA Add-on',
      adjustmentType: 'fixed',
      adjustmentValue: 50000, // +INR 500.00
    }),
  });
  assert.equal(res.status, 201);
  const variant = res.data.data;

  // Step 2: Admin configures Plan
  res = await request('/api/v1/plans', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      name: 'Monthly Growth Plan',
      code: 'GROWTH-M',
      interval: 'monthly',
      intervalCount: 1,
    }),
  });
  assert.equal(res.status, 201);
  const plan = res.data.data;

  // Step 3: Admin configures Tax Rule (GST 18%)
  res = await request('/api/v1/tax-rules', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      name: 'GST 18%',
      ratePercentage: 18.0,
      jurisdiction: 'IN',
    }),
  });
  assert.equal(res.status, 201);
  const taxRule = res.data.data;

  // Step 4: Admin configures Discount Rule (10% on orders >= 100,000 cents)
  res = await request('/api/v1/discount-rules', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      name: 'Welcome 10%',
      code: 'WELCOME10',
      type: 'percentage',
      value: 10.0,
      minThresholdCents: 100000,
      scope: 'entire_order',
    }),
  });
  assert.equal(res.status, 201);
  const discountRule = res.data.data;

  // Step 5: Admin creates Customer profile linked to user account
  res = await request('/api/v1/customers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      name: 'Vertex Systems Inc',
      email: 'client@vertex.example',
      phone: '+91 99999 00000',
      billingAddress: { city: 'Bengaluru', country: 'IN' },
      taxIdentifier: 'GSTIN29AABCU9603R1ZM',
      userId: 'usr-client',
    }),
  });
  assert.equal(res.status, 201);
  const customer = res.data.data;

  // Step 6: Create Quotation with Mathematical Calculation Breakdown
  // Math:
  // 2 units * (200,000 + 50,000) = 500,000 cents (₹5,000.00)
  // Discount: 10% of 500,000 = 50,000 cents (₹500.00)
  // Taxable Base: 450,000 cents (₹4,500.00)
  // Tax (GST 18%): 450,000 * 0.18 = 81,000 cents (₹810.00)
  // Grand Total: 450,000 + 81,000 = 531,000 cents (₹5,310.00)
  res = await request('/api/v1/quotations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      customerId: customer.id,
      planId: plan.id,
      discountRuleId: discountRule.id,
      taxRuleId: taxRule.id,
      lines: [
        {
          productId: product.id,
          variantId: variant.id,
          quantity: 2,
        },
      ],
    }),
  });
  assert.equal(res.status, 201);
  const quote = res.data.data;

  assert.equal(quote.quotationNumber, 'QT-2026-000001');
  assert.equal(quote.subtotalCents, 500000);
  assert.equal(quote.discountCents, 50000);
  assert.equal(quote.taxCents, 81000);
  assert.equal(quote.grandTotalCents, 531000);
  assert.equal(quote.status, 'draft');

  // Verify Snapshot Breakdown
  const snapshot = quote.snapshotBreakdown;
  assert.ok(snapshot);
  assert.equal(snapshot.totals.subtotal.amount, 500000);
  assert.equal(snapshot.totals.discount.amount, 50000);
  assert.equal(snapshot.totals.taxableBase.amount, 450000);
  assert.equal(snapshot.totals.tax.amount, 81000);
  assert.equal(snapshot.totals.grandTotal.amount, 531000);

  // Step 7: Progress Quotation Lifecycle: draft -> sent -> accepted
  res = await request(`/api/v1/quotations/${quote.id}/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.data.status, 'sent');

  res = await request(`/api/v1/quotations/${quote.id}/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.data.status, 'accepted');

  // Step 8: ATOMIC CONVERSION TO CONFIRMED SUBSCRIPTION
  // (Formally Certifies Phase 2 Exit Criterion)
  res = await request(`/api/v1/quotations/${quote.id}/convert`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 201);

  const { subscription, quotation: convertedQuote } = res.data.data;
  assert.equal(convertedQuote.status, 'converted');
  assert.equal(subscription.subscriptionNumber, 'SUB-2026-000001');
  assert.equal(subscription.status, 'confirmed');
  assert.equal(subscription.grandTotalCents, 531000);
  assert.equal(subscription.balanceDueCents, 531000);
  assert.deepEqual(subscription.snapshotBreakdown, quote.snapshotBreakdown);

  // Step 9: Re-conversion rejected (Idempotency / State lock)
  res = await request(`/api/v1/quotations/${quote.id}/convert`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 409);
  assert.equal(res.data.error.code, 'ALREADY_CONVERTED');

  // Step 10: Customer retrieves own subscriptions via portal
  res = await request('/api/v1/subscriptions', {
    headers: { Authorization: `Bearer ${clientToken}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.data.length, 1);
  assert.equal(res.data.data[0].subscriptionNumber, 'SUB-2026-000001');
  assert.equal(res.data.data[0].status, 'confirmed');
});
