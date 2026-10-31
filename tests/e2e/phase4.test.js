/**
 * Phase 4 Complete End-to-End Certification Test Suite
 * Formally certifies Phase 4 Exit Criterion:
 * "Finance can answer active, collected, owed, and overdue questions from the application."
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');
const { createApp } = require('../../apps/api/src/app');

function createPhase4MockPool() {
  const users = [
    {
      id: 'usr-admin-p4',
      email: 'finance-head@brightloop.example',
      display_name: 'Brightloop Finance Controller',
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
        'billing.read',
        'billing.manage',
        'payments.read',
        'payments.manage',
        'reports.read',
      ],
    },
    {
      id: 'usr-client-alpha',
      email: 'billing@alpha-enterprise.example',
      display_name: 'Alpha CFO',
      status: 'active',
      role: 'customer',
      permissions: ['portal.read'],
    },
    {
      id: 'usr-client-beta',
      email: 'billing@beta-solutions.example',
      display_name: 'Beta CFO',
      status: 'active',
      role: 'customer',
      permissions: ['portal.read'],
    },
  ];

  const customers = [
    {
      id: 'cus-alpha',
      user_id: 'usr-client-alpha',
      name: 'Alpha Enterprise Ltd',
      email: 'billing@alpha-enterprise.example',
      phone: '+91 98888 11111',
      billing_address: { city: 'Bengaluru', country: 'IN' },
      tax_identifier: 'GSTIN29AAACA1111Z',
      status: 'active',
    },
    {
      id: 'cus-beta',
      user_id: 'usr-client-beta',
      name: 'Beta Solutions Corp',
      email: 'billing@beta-solutions.example',
      phone: '+91 98888 22222',
      billing_address: { city: 'Pune', country: 'IN' },
      tax_identifier: 'GSTIN27AAACB2222Z',
      status: 'active',
    },
  ];

  const products = [
    {
      id: 'prod-saas',
      name: 'Brightloop Platform Enterprise',
      sales_price_cents: 500000,
      currency: 'INR',
    },
  ];

  const plans = [
    {
      id: 'plan-monthly',
      name: 'Scale Monthly Tier',
      interval: 'monthly',
      interval_count: 1,
    },
  ];

  const subscriptions = [];
  const subscriptionLines = [];
  const quotations = [];
  const quotationLines = [];
  const billingRuns = [];
  const billingOccurrences = [];
  const invoices = [];
  const invoiceLines = [];
  const payments = [];
  const paymentAllocations = [];
  const auditEvents = [];

  return {
    users,
    customers,
    products,
    plans,
    subscriptions,
    subscriptionLines,
    quotations,
    quotationLines,
    billingRuns,
    billingOccurrences,
    invoices,
    invoiceLines,
    payments,
    paymentAllocations,
    auditEvents,
    query: async (text, params = []) => {
      if (text.includes('BEGIN') || text.includes('COMMIT') || text.includes('ROLLBACK')) {
        return { rowCount: 1 };
      }

      // User lookup
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
          metadata: params[4],
        });
        return { rowCount: 1 };
      }

      // Customer by id
      if (text.includes('FROM customers') && text.includes('WHERE id = $1')) {
        const c = customers.find((cust) => cust.id === params[0]);
        return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
      }

      // Plan by id
      if (text.includes('FROM plans') && text.includes('WHERE id = $1')) {
        const p = plans.find((pl) => pl.id === params[0]);
        return { rows: p ? [p] : [], rowCount: p ? 1 : 0 };
      }

      // Product by id
      if (text.includes('FROM products') && text.includes('WHERE id = $1')) {
        const pr = products.find((prod) => prod.id === params[0]);
        return { rows: pr ? [pr] : [], rowCount: pr ? 1 : 0 };
      }

      // Subscriptions by status (active for billing)
      if (text.includes('FROM subscriptions s') && text.includes("WHERE s.status = 'active'")) {
        const matched = subscriptions.filter((s) => s.status === 'active');
        return {
          rows: matched.map((s) => {
            const cust = customers.find((c) => c.id === s.customer_id);
            const plan = plans.find((p) => p.id === s.plan_id);
            const lines = subscriptionLines.filter((l) => l.subscription_id === s.id);
            return {
              ...s,
              customer_name: cust?.name,
              customer_email: cust?.email,
              plan_name: plan?.name,
              plan_interval: plan?.interval,
              plan_interval_count: plan?.interval_count,
              lines: lines.map((l) => ({
                id: l.id,
                productId: l.product_id,
                description: l.description,
                quantity: l.quantity,
                unitPriceCents: l.unit_price_cents,
                lineSubtotalCents: l.line_subtotal_cents,
              })),
            };
          }),
          rowCount: matched.length,
        };
      }

      // Subscriptions lookup by ID
      if (text.includes('FROM subscriptions') && (text.includes('WHERE s.id = $1') || text.includes('WHERE id = $1')) && !text.includes("WHERE s.status = 'active'")) {
        const s = subscriptions.find((sub) => sub.id === params[0]);
        if (!s) return { rows: [], rowCount: 0 };
        const cust = customers.find((c) => c.id === s.customer_id);
        const plan = plans.find((p) => p.id === s.plan_id);
        return {
          rows: [
            {
              ...s,
              customer_name: cust?.name,
              customer_email: cust?.email,
              plan_name: plan?.name,
              plan_interval: plan?.interval,
              plan_interval_count: plan?.interval_count,
              lines: subscriptionLines.filter((l) => l.subscription_id === s.id),
            },
          ],
          rowCount: 1,
        };
      }

      // Update subscription
      if (text.includes('UPDATE subscriptions')) {
        const subId = params[params.length - 1];
        const sub = subscriptions.find((s) => s.id === subId);
        if (sub) {
          if (text.includes("SET status = 'active'")) sub.status = 'active';
          if (text.includes('next_billing_at = $1')) sub.next_billing_at = params[0];
          if (text.includes('balance_due_cents = GREATEST(0, balance_due_cents - $1)')) {
            sub.balance_due_cents = Math.max(0, sub.balance_due_cents - params[0]);
          }
          return { rows: [sub], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // Invoices count
      if (text.includes('SELECT COUNT(*)::int AS count FROM invoices')) {
        return { rows: [{ count: invoices.length }], rowCount: 1 };
      }

      // Insert invoice
      if (text.includes('INSERT INTO invoices')) {
        const inv = {
          id: `inv-${invoices.length + 1}`,
          invoice_number: params[0],
          customer_id: params[1],
          subscription_id: params[2],
          billing_occurrence_id: params[3],
          status: 'confirmed',
          issue_date: params[4],
          due_date: params[5],
          currency: params[6],
          subtotal_cents: params[7],
          discount_cents: params[8],
          tax_cents: params[9],
          grand_total_cents: params[10],
          balance_due_cents: params[11],
          payment_terms_days: params[12],
          snapshot_breakdown: typeof params[13] === 'string' ? JSON.parse(params[13]) : params[13],
          created_by: params[14],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        invoices.push(inv);
        return { rows: [inv], rowCount: 1 };
      }

      // Insert invoice lines
      if (text.includes('INSERT INTO invoice_lines')) {
        const line = {
          id: `il-${invoiceLines.length + 1}`,
          invoice_id: params[0],
          product_id: params[1],
          description: params[3],
          quantity: params[4],
          unit_price_cents: params[5],
          line_subtotal_cents: params[7],
        };
        invoiceLines.push(line);
        return { rows: [line], rowCount: 1 };
      }

      // Single invoice query by id
      if (text.includes('FROM invoices') && (text.includes('WHERE i.id = $1') || text.includes('WHERE id = $1'))) {
        const inv = invoices.find((i) => i.id === params[0]);
        if (!inv) return { rows: [], rowCount: 0 };
        const cust = customers.find((c) => c.id === inv.customer_id);
        const sub = subscriptions.find((s) => s.id === inv.subscription_id);
        return {
          rows: [
            {
              ...inv,
              customer_name: cust?.name,
              customer_email: cust?.email,
              user_id: cust?.user_id,
              subscription_number: sub?.subscription_number,
              lines: invoiceLines.filter((l) => l.invoice_id === inv.id),
              notifications: [],
            },
          ],
          rowCount: 1,
        };
      }

      // Overdue invoices query
      if (text.includes('FROM invoices i') && text.includes('WHERE i.balance_due_cents > 0') && text.includes('i.due_date < CURRENT_DATE')) {
        const today = new Date();
        const overdue = invoices.filter((i) => i.balance_due_cents > 0 && new Date(i.due_date) < today && i.status !== 'paid' && i.status !== 'cancelled');
        return {
          rows: overdue.map((i) => {
            const cust = customers.find((c) => c.id === i.customer_id);
            const sub = subscriptions.find((s) => s.id === i.subscription_id);
            return {
              ...i,
              customer_name: cust?.name,
              customer_email: cust?.email,
              customer_phone: cust?.phone,
              subscription_number: sub?.subscription_number,
            };
          }),
          rowCount: overdue.length,
        };
      }

      // Invoices list query
      if (text.includes('FROM invoices i') && !text.includes('WHERE i.id = $1')) {
        let list = [...invoices];
        if (text.includes('c.user_id = $')) {
          const cust = customers.find((c) => c.user_id === params[0]);
          list = list.filter((i) => i.customer_id === cust?.id);
        }
        return {
          rows: list.map((inv) => {
            const cust = customers.find((c) => c.id === inv.customer_id);
            return {
              ...inv,
              customer_name: cust?.name,
              lines: invoiceLines.filter((l) => l.invoice_id === inv.id),
            };
          }),
          rowCount: list.length,
        };
      }

      // Update invoice
      if (text.includes('UPDATE invoices')) {
        const invId = params[params.length - 1];
        const inv = invoices.find((i) => i.id === invId);
        if (inv) {
          if (text.includes('balance_due_cents = $1') && text.includes('status = $2')) {
            inv.balance_due_cents = params[0];
            inv.status = params[1];
          }
          inv.updated_at = new Date().toISOString();
          return { rows: [inv], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // Payments count
      if (text.includes('SELECT COUNT(*)::int AS count FROM payments')) {
        return { rows: [{ count: payments.length }], rowCount: 1 };
      }

      // Insert payment
      if (text.includes('INSERT INTO payments')) {
        const pay = {
          id: `pay-${payments.length + 1}`,
          payment_number: params[0],
          customer_id: params[1],
          invoice_id: params[2],
          method: params[3],
          amount_cents: params[4],
          currency: params[5],
          received_date: params[6],
          external_reference: params[7],
          notes: params[8],
          created_by: params[9],
          created_at: new Date().toISOString(),
        };
        payments.push(pay);
        return { rows: [pay], rowCount: 1 };
      }

      // Insert payment allocation
      if (text.includes('INSERT INTO payment_allocations')) {
        const alloc = {
          id: `pa-${paymentAllocations.length + 1}`,
          payment_id: params[0],
          invoice_id: params[1],
          amount_cents: params[2],
          allocated_at: new Date().toISOString(),
        };
        paymentAllocations.push(alloc);
        return { rows: [alloc], rowCount: 1 };
      }

      // Payments list
      if (text.includes('FROM payments p') && !text.includes('WHERE p.id = $1')) {
        let list = [...payments];
        if (text.includes('c.user_id = $')) {
          const cust = customers.find((c) => c.user_id === params[0]);
          list = list.filter((p) => p.customer_id === cust?.id);
        }
        return {
          rows: list.map((p) => {
            const cust = customers.find((c) => c.id === p.customer_id);
            const inv = invoices.find((i) => i.id === p.invoice_id);
            return {
              ...p,
              customer_name: cust?.name,
              customer_email: cust?.email,
              invoice_number: inv?.invoice_number,
              allocations: paymentAllocations.filter((a) => a.payment_id === p.id),
            };
          }),
          rowCount: list.length,
        };
      }

      // Report Summary queries:
      if (text.includes('FROM invoices') && text.includes('SELECT id, status, due_date, grand_total_cents')) {
        return { rows: invoices, rowCount: invoices.length };
      }
      if (text.includes('FROM payments') && text.includes('SELECT id, amount_cents, currency, received_date')) {
        return { rows: payments, rowCount: payments.length };
      }
      if (text.includes('FROM subscriptions') && text.includes('SELECT id, status, grand_total_cents')) {
        return { rows: subscriptions, rowCount: subscriptions.length };
      }

      // Overdue invoices query
      if (text.includes('FROM invoices i') && text.includes('WHERE i.balance_due_cents > 0') && text.includes('i.due_date < CURRENT_DATE')) {
        const today = new Date();
        const overdue = invoices.filter((i) => i.balance_due_cents > 0 && new Date(i.due_date) < today && i.status !== 'paid' && i.status !== 'cancelled');
        return {
          rows: overdue.map((i) => {
            const cust = customers.find((c) => c.id === i.customer_id);
            const sub = subscriptions.find((s) => s.id === i.subscription_id);
            return {
              ...i,
              customer_name: cust?.name,
              customer_email: cust?.email,
              customer_phone: cust?.phone,
              subscription_number: sub?.subscription_number,
            };
          }),
          rowCount: overdue.length,
        };
      }

      // Revenue breakdown queries
      if (text.includes('GROUP BY method')) {
        const methodCounts = {};
        for (const p of payments) {
          methodCounts[p.method] = (methodCounts[p.method] || 0) + p.amount_cents;
        }
        return {
          rows: Object.entries(methodCounts).map(([method, total]) => ({
            method,
            count: 1,
            total_cents: total,
          })),
          rowCount: Object.keys(methodCounts).length,
        };
      }
      if (text.includes("GROUP BY TO_CHAR(received_date, 'YYYY-MM')")) {
        return {
          rows: [
            {
              month: '2026-11',
              count: payments.length,
              total_cents: payments.reduce((sum, p) => sum + p.amount_cents, 0),
            },
          ],
          rowCount: 1,
        };
      }

      // Export queries
      if (text.includes('SELECT i.invoice_number, c.name AS customer_name')) {
        return {
          rows: invoices.map((i) => {
            const cust = customers.find((c) => c.id === i.customer_id);
            return { ...i, customer_name: cust?.name };
          }),
          rowCount: invoices.length,
        };
      }
      if (text.includes('SELECT p.payment_number, c.name AS customer_name')) {
        return {
          rows: payments.map((p) => {
            const cust = customers.find((c) => c.id === p.customer_id);
            const inv = invoices.find((i) => i.id === p.invoice_id);
            return { ...p, customer_name: cust?.name, invoice_number: inv?.invoice_number };
          }),
          rowCount: payments.length,
        };
      }
      if (text.includes('SELECT i.invoice_number, c.name AS customer_name, c.email AS customer_email')) {
        const today = new Date();
        const overdue = invoices.filter((i) => i.balance_due_cents > 0 && new Date(i.due_date) < today && i.status !== 'paid' && i.status !== 'cancelled');
        return {
          rows: overdue.map((i) => {
            const cust = customers.find((c) => c.id === i.customer_id);
            return { ...i, customer_name: cust?.name, customer_email: cust?.email };
          }),
          rowCount: overdue.length,
        };
      }

      // Billing runs count
      if (text.includes('SELECT COUNT(*)::int AS count FROM billing_runs')) {
        return { rows: [{ count: billingRuns.length }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO billing_runs')) {
        const run = { id: `br-${billingRuns.length + 1}`, run_number: params[0], target_date: params[1], status: 'completed' };
        billingRuns.push(run);
        return { rows: [run], rowCount: 1 };
      }
      if (text.includes('UPDATE billing_runs')) return { rows: [billingRuns[0] || {}], rowCount: 1 };
      if (text.includes('FROM billing_occurrences WHERE idempotency_key = $1')) return { rows: [], rowCount: 0 };
      if (text.includes('INSERT INTO billing_occurrences')) {
        const occ = { id: `occ-${billingOccurrences.length + 1}`, status: 'pending' };
        billingOccurrences.push(occ);
        return { rows: [occ], rowCount: 1 };
      }
      if (text.includes('UPDATE billing_occurrences')) return { rows: [{ id: 'occ-1', status: 'succeeded' }], rowCount: 1 };

      return { rows: [], rowCount: 0 };
    },
  };
}

test('phase 4 complete e2e certification: payment recording, allocation, overdue reporting, and finance dashboard', async () => {
  const pool = createPhase4MockPool();
  const jwtSecret = 'phase4-e2e-secret';
  const app = createApp({ pool, jwtSecret });

  let server;
  let baseUrl;

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  const adminToken = jwt.sign({ sub: 'usr-admin-p4', role: 'admin' }, jwtSecret);
  const clientAlphaToken = jwt.sign({ sub: 'usr-client-alpha', role: 'customer' }, jwtSecret);
  const clientBetaToken = jwt.sign({ sub: 'usr-client-beta', role: 'customer' }, jwtSecret);

  async function request(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const data = res.status === 204 ? null : await res.json();
    return { status: res.status, data, headers: res.headers };
  }

  try {
    // -------------------------------------------------------------------------
    // STEP 1: ESTABLISH INITIAL STATE (1 ACTIVE SUBSCRIPTION & 2 INVOICES)
    // -------------------------------------------------------------------------
    // Active Subscription for Customer Alpha
    pool.subscriptions.push({
      id: 'sub-alpha',
      subscription_number: 'SUB-2026-000001',
      customer_id: 'cus-alpha',
      plan_id: 'plan-monthly',
      status: 'active',
      starts_at: '2026-11-01T00:00:00.000Z',
      next_billing_at: '2026-12-01T00:00:00.000Z',
      payment_terms_days: 15,
      currency: 'INR',
      grand_total_cents: 500000,
      balance_due_cents: 500000,
      snapshot_breakdown: {},
    });

    pool.subscriptionLines.push({
      id: 'sl-1',
      subscription_id: 'sub-alpha',
      product_id: 'prod-saas',
      description: 'Platform Enterprise',
      quantity: 1,
      unit_price_cents: 500000,
      line_subtotal_cents: 500000,
    });

    // Invoice 1: Customer Alpha (Current invoice, due date in future)
    pool.invoices.push({
      id: 'inv-alpha-1',
      invoice_number: 'INV-2026-000001',
      customer_id: 'cus-alpha',
      subscription_id: 'sub-alpha',
      status: 'confirmed',
      issue_date: '2026-11-01',
      due_date: '2026-11-25', // Future due date
      currency: 'INR',
      subtotal_cents: 500000,
      discount_cents: 0,
      tax_cents: 0,
      grand_total_cents: 500000, // 5000.00 INR
      balance_due_cents: 500000,
      payment_terms_days: 15,
      created_at: '2026-11-01T00:00:00.000Z',
    });

    // Invoice 2: Customer Beta (Overdue invoice, past due date)
    pool.invoices.push({
      id: 'inv-beta-overdue',
      invoice_number: 'INV-2026-000002',
      customer_id: 'cus-beta',
      subscription_id: null,
      status: 'sent',
      issue_date: '2026-10-01',
      due_date: '2026-10-15', // Past due date (OVERDUE!)
      currency: 'INR',
      subtotal_cents: 200000,
      discount_cents: 0,
      tax_cents: 0,
      grand_total_cents: 200000, // 2000.00 INR
      balance_due_cents: 200000,
      payment_terms_days: 15,
      created_at: '2026-10-01T00:00:00.000Z',
    });

    // -------------------------------------------------------------------------
    // STEP 2: VERIFY INITIAL FINANCE DASHBOARD (BEFORE PAYMENTS)
    // (Answers: Active, Collected, Owed, Overdue)
    // -------------------------------------------------------------------------
    let res = await request('/api/v1/reports/summary', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    let summary = res.data.data;

    assert.equal(summary.activeSubscriptions.count, 1);
    assert.equal(summary.activeSubscriptions.totalValueCents, 500000);
    assert.equal(summary.revenueCollected.totalCollectedCents, 0); // 0 collected yet
    assert.equal(summary.amountOutstanding.totalOutstandingCents, 700000); // 5000 + 2000
    assert.equal(summary.overdueInvoices.count, 1); // 1 overdue invoice
    assert.equal(summary.overdueInvoices.totalOverdueCents, 200000);
    assert.equal(summary.reconciliation.isReconciled, true); // Equation holds: 700000 = 0 + 700000

    // Check Overdue Invoices List
    res = await request('/api/v1/reports/overdue-invoices', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.length, 1);
    const overdueItem = res.data.data[0];
    assert.equal(overdueItem.invoiceNumber, 'INV-2026-000002');
    assert.equal(overdueItem.customerName, 'Beta Solutions Corp');
    assert.ok(overdueItem.daysOverdue > 0, 'Must compute positive days overdue');

    // -------------------------------------------------------------------------
    // STEP 3: RECORD PARTIAL PAYMENT ON INVOICE 1
    // (Customer Alpha pays 2000.00 of 5000.00)
    // -------------------------------------------------------------------------
    res = await request('/api/v1/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        invoiceId: 'inv-alpha-1',
        method: 'bank_transfer',
        amountCents: 200000,
        receivedDate: '2026-11-05',
        externalReference: 'HDFC-REF-7711',
        notes: 'Partial milestone invoice payment',
      }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.data.payment.paymentNumber, 'PAY-2026-000001');
    assert.equal(res.data.data.invoice.status, 'partially_paid');
    assert.equal(res.data.data.invoice.balanceDueCents, 300000); // 5000 - 2000 = 3000 remaining
    assert.equal(pool.subscriptions[0].balance_due_cents, 300000);

    // -------------------------------------------------------------------------
    // STEP 4: OVERPAYMENT REJECTION INVARIANT CHECK
    // (Attempting to pay 3500.00 when balance is 3000.00)
    // -------------------------------------------------------------------------
    res = await request('/api/v1/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        invoiceId: 'inv-alpha-1',
        method: 'upi',
        amountCents: 350000,
      }),
    });
    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, 'OVERPAYMENT_REJECTED');

    // -------------------------------------------------------------------------
    // STEP 5: FULL PAYMENT ON OVERDUE INVOICE 2
    // (Customer Beta pays 2000.00 in full)
    // -------------------------------------------------------------------------
    res = await request('/api/v1/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        invoiceId: 'inv-beta-overdue',
        method: 'upi',
        amountCents: 200000,
        receivedDate: '2026-11-06',
        externalReference: 'UPI-REF-9922',
      }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.data.invoice.status, 'paid');
    assert.equal(res.data.data.invoice.balanceDueCents, 0);

    // -------------------------------------------------------------------------
    // STEP 6: VERIFY FINANCE DASHBOARD UPDATES
    // (Certifies that collected, owed, and overdue numbers dynamically update)
    // -------------------------------------------------------------------------
    res = await request('/api/v1/reports/summary', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    summary = res.data.data;

    // Total collected: 2000 (Alpha) + 2000 (Beta) = 4000.00 INR
    assert.equal(summary.revenueCollected.totalCollectedCents, 400000);
    // Total outstanding: 3000.00 INR (Alpha remaining)
    assert.equal(summary.amountOutstanding.totalOutstandingCents, 300000);
    // Overdue count: 0 (Overdue invoice was paid!)
    assert.equal(summary.overdueInvoices.count, 0);
    assert.equal(summary.overdueInvoices.totalOverdueCents, 0);
    // Reconciliation: 700000 total invoiced = 400000 collected + 300000 outstanding!
    assert.equal(summary.reconciliation.isReconciled, true);
    assert.equal(summary.reconciliation.equationDelta, 0);

    // -------------------------------------------------------------------------
    // STEP 7: REVENUE BREAKDOWN & CSV EXPORT CERTIFICATION
    // -------------------------------------------------------------------------
    res = await request('/api/v1/reports/revenue', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.byMethod.length, 2); // bank_transfer and upi

    // Export Invoices CSV
    let exportRes = await fetch(`${baseUrl}/api/v1/reports/exports`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'invoices' }),
    });
    assert.equal(exportRes.status, 200);
    assert.ok(exportRes.headers.get('content-type').includes('text/csv'));
    let csv = await exportRes.text();
    assert.ok(csv.includes('Invoice Number,Customer,Issue Date,Due Date'));
    assert.ok(csv.includes('INV-2026-000001'));
    assert.ok(csv.includes('INV-2026-000002'));

    // Export Payments CSV
    exportRes = await fetch(`${baseUrl}/api/v1/reports/exports`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'payments' }),
    });
    assert.equal(exportRes.status, 200);
    csv = await exportRes.text();
    assert.ok(csv.includes('Payment Number,Customer,Invoice Number,Payment Method'));
    assert.ok(csv.includes('PAY-2026-000001'));
    assert.ok(csv.includes('PAY-2026-000002'));

    // -------------------------------------------------------------------------
    // STEP 8: CUSTOMER PORTAL DATA ISOLATION (FINANCIAL PRIVACY)
    // -------------------------------------------------------------------------
    // Customer Alpha views their payments -> sees only their payment
    res = await request('/api/v1/payments', {
      headers: { Authorization: `Bearer ${clientAlphaToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.length, 1);
    assert.equal(res.data.data[0].paymentNumber, 'PAY-2026-000001');
    assert.equal(res.data.data[0].customerName, 'Alpha Enterprise Ltd');

    // Customer Beta views their payments -> sees only their payment
    res = await request('/api/v1/payments', {
      headers: { Authorization: `Bearer ${clientBetaToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.length, 1);
    assert.equal(res.data.data[0].paymentNumber, 'PAY-2026-000002');
    assert.equal(res.data.data[0].customerName, 'Beta Solutions Corp');

    // Customer is forbidden from viewing finance dashboard summary
    res = await request('/api/v1/reports/summary', {
      headers: { Authorization: `Bearer ${clientAlphaToken}` },
    });
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});
