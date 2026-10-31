const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');
const { createApp } = require('../../apps/api/src/app');

function createMockPool() {
  const users = [
    {
      id: 'usr-admin-fin',
      email: 'admin@brightloop.example',
      display_name: 'Admin Finance',
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
      id: 'usr-cust-a',
      email: 'finance@cust-a.example',
      display_name: 'Customer A',
      status: 'active',
      role: 'customer',
      permissions: ['portal.read'],
    },
    {
      id: 'usr-cust-b',
      email: 'finance@cust-b.example',
      display_name: 'Customer B',
      status: 'active',
      role: 'customer',
      permissions: ['portal.read'],
    },
  ];

  const customers = [
    {
      id: 'cus-a',
      user_id: 'usr-cust-a',
      name: 'Alpha Systems',
      email: 'finance@cust-a.example',
      phone: '+91 99000 11111',
      billing_address: { city: 'Bengaluru' },
      tax_identifier: 'GSTIN29AAACA1111Z',
      status: 'active',
    },
    {
      id: 'cus-b',
      user_id: 'usr-cust-b',
      name: 'Beta Global',
      email: 'finance@cust-b.example',
      phone: '+91 99000 22222',
      billing_address: { city: 'Mumbai' },
      tax_identifier: 'GSTIN27AAACB2222Z',
      status: 'active',
    },
  ];

  const subscriptions = [
    {
      id: 'sub-a',
      subscription_number: 'SUB-2026-000001',
      customer_id: 'cus-a',
      plan_id: 'plan-1',
      status: 'active',
      grand_total_cents: 300000,
      balance_due_cents: 300000,
    },
  ];

  const invoices = [
    {
      id: 'inv-a-1',
      invoice_number: 'INV-2026-000001',
      customer_id: 'cus-a',
      subscription_id: 'sub-a',
      status: 'sent',
      issue_date: '2026-10-01',
      due_date: '2026-10-15', // Past date -> overdue!
      currency: 'INR',
      subtotal_cents: 300000,
      discount_cents: 0,
      tax_cents: 0,
      grand_total_cents: 300000,
      balance_due_cents: 300000,
      created_at: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'inv-b-1',
      invoice_number: 'INV-2026-000002',
      customer_id: 'cus-b',
      subscription_id: null,
      status: 'confirmed',
      issue_date: '2026-11-01',
      due_date: '2026-11-20', // Future
      currency: 'INR',
      subtotal_cents: 200000,
      discount_cents: 0,
      tax_cents: 0,
      grand_total_cents: 200000,
      balance_due_cents: 200000,
      created_at: '2026-11-01T00:00:00.000Z',
    },
  ];

  const payments = [];
  const paymentAllocations = [];
  const auditEvents = [];

  return {
    users,
    customers,
    subscriptions,
    invoices,
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

      // Invoice lookup by ID
      if (text.includes('FROM invoices WHERE id = $1')) {
        const inv = invoices.find((i) => i.id === params[0]);
        if (!inv) return { rows: [], rowCount: 0 };
        return { rows: [inv], rowCount: 1 };
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
          return { rows: [inv], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // Update subscription
      if (text.includes('UPDATE subscriptions')) {
        const subId = params[params.length - 1];
        const sub = subscriptions.find((s) => s.id === subId);
        if (sub) {
          sub.balance_due_cents = Math.max(0, sub.balance_due_cents - params[0]);
          return { rows: [sub], rowCount: 1 };
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
            const allocs = paymentAllocations.filter((a) => a.payment_id === p.id);
            return {
              ...p,
              customer_name: cust?.name,
              customer_email: cust?.email,
              invoice_number: inv?.invoice_number,
              allocations: allocs,
            };
          }),
          rowCount: list.length,
        };
      }

      // Single payment by id
      if (text.includes('FROM payments p') && text.includes('WHERE p.id = $1')) {
        const pay = payments.find((p) => p.id === params[0]);
        if (!pay) return { rows: [], rowCount: 0 };
        const cust = customers.find((c) => c.id === pay.customer_id);
        const inv = invoices.find((i) => i.id === pay.invoice_id);
        const allocs = paymentAllocations.filter((a) => a.payment_id === pay.id);
        return {
          rows: [
            {
              ...pay,
              customer_name: cust?.name,
              customer_email: cust?.email,
              user_id: cust?.user_id,
              invoice_number: inv?.invoice_number,
              allocations: allocs,
            },
          ],
          rowCount: 1,
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
            return {
              ...i,
              customer_name: cust?.name,
            };
          }),
          rowCount: invoices.length,
        };
      }
      if (text.includes('SELECT p.payment_number, c.name AS customer_name')) {
        return {
          rows: payments.map((p) => {
            const cust = customers.find((c) => c.id === p.customer_id);
            const inv = invoices.find((i) => i.id === p.invoice_id);
            return {
              ...p,
              customer_name: cust?.name,
              invoice_number: inv?.invoice_number,
            };
          }),
          rowCount: payments.length,
        };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

test('payments and finance integration: recording, partial/full allocation, overdue reporting, and CSV export', async () => {
  const pool = createMockPool();
  const jwtSecret = 'fin-integration-secret';
  const app = createApp({ pool, jwtSecret });

  let server;
  let baseUrl;

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  const adminToken = jwt.sign({ sub: 'usr-admin-fin', role: 'admin' }, jwtSecret);
  const custAToken = jwt.sign({ sub: 'usr-cust-a', role: 'customer' }, jwtSecret);
  const custBToken = jwt.sign({ sub: 'usr-cust-b', role: 'customer' }, jwtSecret);

  async function request(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const data = res.status === 204 ? null : await res.json();
    return { status: res.status, data, headers: res.headers };
  }

  try {
    // 1. Partial payment recording on inv-a-1 (3000.00 total) -> record 1000.00
    let res = await request('/api/v1/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        invoiceId: 'inv-a-1',
        method: 'bank_transfer',
        amountCents: 100000,
        receivedDate: '2026-10-10',
        externalReference: 'HDFC-TXN-98765',
        notes: 'Initial milestone payment',
      }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.data.payment.paymentNumber, 'PAY-2026-000001');
    assert.equal(res.data.data.invoice.status, 'partially_paid');
    assert.equal(res.data.data.invoice.balanceDueCents, 200000);
    // Linked subscription balance reduced by 1000.00
    assert.equal(pool.subscriptions[0].balance_due_cents, 200000);

    // 2. Reject Overpayment: trying to pay 2500.00 when balance is 2000.00
    res = await request('/api/v1/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        invoiceId: 'inv-a-1',
        method: 'upi',
        amountCents: 250000,
      }),
    });
    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, 'OVERPAYMENT_REJECTED');

    // 3. Reject invalid payment method
    res = await request('/api/v1/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        invoiceId: 'inv-a-1',
        method: 'unsupported_method',
        amountCents: 50000,
      }),
    });
    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, 'VALIDATION_ERROR');

    // 4. Customer without payments.manage cannot record payments
    res = await request('/api/v1/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${custAToken}` },
      body: JSON.stringify({
        invoiceId: 'inv-a-1',
        method: 'upi',
        amountCents: 50000,
      }),
    });
    assert.equal(res.status, 403);
    assert.equal(res.data.error.code, 'FORBIDDEN');

    // 5. Complete full payment on remaining balance (2000.00) -> transitions to 'paid'
    res = await request('/api/v1/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        invoiceId: 'inv-a-1',
        method: 'upi',
        amountCents: 200000,
        receivedDate: '2026-10-12',
        externalReference: 'UPI-TXN-112233',
      }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.data.invoice.status, 'paid');
    assert.equal(res.data.data.invoice.balanceDueCents, 0);

    // 6. Customer portal isolation for payments
    res = await request('/api/v1/payments', {
      headers: { Authorization: `Bearer ${custAToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.length, 2); // Customer A owns both payments recorded above
    assert.equal(res.data.data[0].customerName, 'Alpha Systems');

    res = await request('/api/v1/payments', {
      headers: { Authorization: `Bearer ${custBToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.length, 0); // Customer B has 0 payments

    // 7. Finance Summary Report
    res = await request('/api/v1/reports/summary', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const summary = res.data.data;
    assert.equal(summary.activeSubscriptions.count, 1);
    assert.equal(summary.revenueCollected.totalCollectedCents, 300000); // 1000 + 2000
    assert.equal(summary.amountOutstanding.totalOutstandingCents, 200000); // inv-b-1 balance
    assert.equal(summary.reconciliation.isReconciled, true);

    // 8. Overdue Invoices Report
    // inv-a-1 is paid (0 balance), inv-b-1 is due in future -> 0 overdue
    res = await request('/api/v1/reports/overdue-invoices', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.length, 0);

    // 9. Revenue Report Grouping
    res = await request('/api/v1/reports/revenue', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.data.byMethod));
    assert.ok(Array.isArray(res.data.data.byMonth));

    // 10. CSV Export Endpoint
    const csvRes = await fetch(`${baseUrl}/api/v1/reports/exports`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'payments' }),
    });
    assert.equal(csvRes.status, 200);
    assert.ok(csvRes.headers.get('content-type').includes('text/csv'));
    const csvText = await csvRes.text();
    assert.ok(csvText.includes('Payment Number,Customer,Invoice Number,Payment Method'));
    assert.ok(csvText.includes('PAY-2026-000001'));
  } finally {
    server.close();
  }
});
