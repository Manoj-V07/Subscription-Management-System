const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');
const { createApp } = require('../../apps/api/src/app');

function createMockPool() {
  const users = [
    {
      id: 'usr-admin-1',
      email: 'admin@brightloop.example',
      display_name: 'Administrator',
      status: 'active',
      role: 'admin',
      permissions: ['dashboard.read', 'staff.manage', 'customers.read', 'customers.manage', 'catalog.manage', 'quotes.manage', 'subscriptions.manage', 'reports.read'],
    },
    {
      id: 'usr-staff-1',
      email: 'staff@brightloop.example',
      display_name: 'Sales Rep',
      status: 'active',
      role: 'staff',
      permissions: ['dashboard.read', 'customers.read', 'customers.manage', 'quotes.manage', 'subscriptions.manage'],
    },
  ];

  const customers = [
    {
      id: 'cus-1',
      name: 'Globex Corp',
      email: 'hank@globex.example',
      phone: '+91 98888 77777',
      billing_address: { city: 'Mumbai', country: 'IN' },
      tax_identifier: 'GSTIN27AABCU9603R1ZM',
      status: 'active',
    },
  ];

  const products = [
    {
      id: 'prod-saas',
      name: 'Brightloop Platform Core',
      sales_price_cents: 200000, // 2000.00
      cost_price_cents: 40000,
      currency: 'INR',
    },
  ];

  const variants = [
    {
      id: 'var-sla',
      product_id: 'prod-saas',
      label: '24/7 Enterprise SLA',
      adjustment_type: 'fixed',
      adjustment_value: 50000, // +500.00
    },
  ];

  const plans = [
    {
      id: 'plan-monthly',
      name: 'Monthly Scale Plan',
      code: 'SCALE-M',
      interval: 'monthly',
      interval_count: 1,
    },
  ];

  const taxRules = [
    {
      id: 'tax-gst',
      name: 'GST 18%',
      rate_percentage: 18.0,
      jurisdiction: 'IN',
      is_active: true,
    },
  ];

  const discountRules = [
    {
      id: 'disc-welcome',
      name: 'Welcome 10%',
      code: 'WELCOME10',
      type: 'percentage',
      value: 10.0,
      min_threshold_cents: 100000,
      scope: 'entire_order',
      times_used: 0,
      max_uses: 100,
      is_active: true,
    },
  ];

  const templates = [];
  const templateLines = [];
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
    templates,
    quotations,
    subscriptions,
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

      // Audit events
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

      // Lookups
      if (text.includes('SELECT id, name FROM customers WHERE id = $1')) {
        const c = customers.find((cust) => cust.id === params[0]);
        return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
      }
      if (text.includes('SELECT id, name FROM plans WHERE id = $1')) {
        const p = plans.find((pl) => pl.id === params[0]);
        return { rows: p ? [p] : [], rowCount: p ? 1 : 0 };
      }
      if (text.includes('SELECT * FROM discount_rules WHERE id = $1')) {
        const d = discountRules.find((dr) => dr.id === params[0] && dr.is_active);
        return { rows: d ? [d] : [], rowCount: d ? 1 : 0 };
      }
      if (text.includes('SELECT * FROM tax_rules WHERE id = $1')) {
        const t = taxRules.find((tr) => tr.id === params[0] && tr.is_active);
        return { rows: t ? [t] : [], rowCount: t ? 1 : 0 };
      }
      if (text.includes('SELECT id, name, sales_price_cents FROM products WHERE id = $1')) {
        const pr = products.find((prod) => prod.id === params[0]);
        return { rows: pr ? [pr] : [], rowCount: pr ? 1 : 0 };
      }
      if (text.includes('SELECT id, label, adjustment_type, adjustment_value FROM product_variants WHERE id = $1')) {
        const v = variants.find((vr) => vr.id === params[0] && vr.product_id === params[1]);
        return { rows: v ? [v] : [], rowCount: v ? 1 : 0 };
      }

      // Quotation templates
      if (text.includes('INSERT INTO quotation_templates')) {
        const id = `tmpl-${templates.length + 1}`;
        const newTmpl = { id, name: params[0], validity_days: params[1], notes: params[2], is_active: true };
        templates.push(newTmpl);
        return { rows: [newTmpl], rowCount: 1 };
      }
      if (text.includes('INSERT INTO quotation_template_lines')) {
        templateLines.push({ template_id: params[0], product_id: params[1], variant_id: params[2], default_quantity: params[3] });
        return { rowCount: 1 };
      }
      if (text.includes('FROM quotation_templates t')) {
        return { rows: templates.map((t) => ({ ...t, lines: [] })), rowCount: templates.length };
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
          expiry_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
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
        const id = `ql-${quotationLines.length + 1}`;
        const newLine = {
          id,
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
        const found = quotationLines.filter((ql) => ql.quotation_id === params[0]);
        return { rows: found, rowCount: found.length };
      }
      if (text.includes('UPDATE quotations SET status = $1') || text.includes("UPDATE quotations SET status = 'sent'") || text.includes("UPDATE quotations SET status = 'accepted'") || text.includes("UPDATE quotations SET status = 'converted'")) {
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
      if (text.includes('UPDATE discount_rules SET times_used = times_used + 1')) {
        const d = discountRules.find((dr) => dr.id === params[0]);
        if (d) d.times_used += 1;
        return { rowCount: 1 };
      }
      if (text.includes('FROM subscriptions s') && text.includes('WHERE s.id = $1')) {
        const sub = subscriptions.find((s) => s.id === params[0]);
        if (!sub) return { rows: [], rowCount: 0 };
        return {
          rows: [
            {
              ...sub,
              customer_name: 'Globex Corp',
              plan_name: 'Monthly Scale Plan',
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
            customer_name: 'Globex Corp',
            plan_name: 'Monthly Scale Plan',
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
let staffToken;
const jwtSecret = 'test-secret-phase2-task4';

test.before(async () => {
  const mockPool = createMockPool();
  const app = createApp({ pool: mockPool, jwtSecret });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  staffToken = jwt.sign({ sub: 'usr-staff-1', role: 'staff' }, jwtSecret);
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

test('sales: quotation lifecycle and atomic subscription conversion', async () => {
  // 1. Create a quotation template
  let res = await api('/api/v1/quotation-templates', {
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` },
    body: JSON.stringify({
      name: 'Standard Enterprise Bundle',
      validityDays: 14,
      lines: [{ productId: 'prod-saas', variantId: 'var-sla', defaultQuantity: 2 }],
    }),
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.data.name, 'Standard Enterprise Bundle');

  // 2. Build and calculate quotation:
  // 2 units of prod-saas (200,000 cents) + fixed SLA (50,000 cents) = 250,000 per unit
  // Line subtotal = 2 * 250,000 = 500,000 cents
  // Welcome 10% discount = 50,000 cents
  // Taxable base = 450,000 cents
  // GST 18% = 81,000 cents
  // Grand total = 531,000 cents (INR 5,310.00)
  res = await api('/api/v1/quotations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` },
    body: JSON.stringify({
      customerId: 'cus-1',
      planId: 'plan-monthly',
      discountRuleId: 'disc-welcome',
      taxRuleId: 'tax-gst',
      validityDays: 15,
      lines: [{ productId: 'prod-saas', variantId: 'var-sla', quantity: 2 }],
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

  // Verify snapshot breakdown was persisted
  assert.ok(quote.snapshotBreakdown);
  assert.equal(quote.snapshotBreakdown.totals.grandTotal.amount, 531000);

  // 3. Progress quotation status: draft -> sent -> accepted
  res = await api(`/api/v1/quotations/${quote.id}/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.data.status, 'sent');

  res = await api(`/api/v1/quotations/${quote.id}/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.data.status, 'accepted');

  // 4. ATOMIC CONVERSION: quotation -> confirmed subscription
  res = await api(`/api/v1/quotations/${quote.id}/convert`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` },
  });
  assert.equal(res.status, 201);

  const { subscription, quotation: updatedQuote } = res.data.data;
  assert.equal(updatedQuote.status, 'converted');
  assert.equal(subscription.subscriptionNumber, 'SUB-2026-000001');
  assert.equal(subscription.status, 'confirmed');
  assert.equal(subscription.grandTotalCents, 531000);
  assert.equal(subscription.balanceDueCents, 531000);
  assert.ok(subscription.snapshotBreakdown);

  // 5. Duplicate conversion attempt is rejected
  res = await api(`/api/v1/quotations/${quote.id}/convert`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` },
  });
  assert.equal(res.status, 409);
  assert.equal(res.data.error.code, 'ALREADY_CONVERTED');

  // 6. View subscription details
  res = await api(`/api/v1/subscriptions/${subscription.id}`, {
    headers: { Authorization: `Bearer ${staffToken}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.data.subscriptionNumber, 'SUB-2026-000001');
  assert.equal(res.data.data.customerName, 'Globex Corp');
});
