const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');
const { createApp } = require('../../apps/api/src/app');

function createMockPool() {
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
        'billing.read',
        'billing.manage',
        'reports.read',
      ],
    },
    {
      id: 'usr-customer-1',
      email: 'client@alpha.example',
      display_name: 'Alpha Client',
      status: 'active',
      role: 'customer',
      permissions: ['portal.read'],
    },
    {
      id: 'usr-customer-2',
      email: 'client@beta.example',
      display_name: 'Beta Client',
      status: 'active',
      role: 'customer',
      permissions: ['portal.read'],
    },
  ];

  const customers = [
    {
      id: 'cus-alpha',
      user_id: 'usr-customer-1',
      name: 'Alpha Systems Inc',
      email: 'billing@alpha.example',
      phone: '+91 91111 22222',
      billing_address: { street: '10 Alpha Way', city: 'Bengaluru' },
      tax_identifier: 'GSTIN29AAACA1111Z',
      status: 'active',
    },
    {
      id: 'cus-beta',
      user_id: 'usr-customer-2',
      name: 'Beta Global Ltd',
      email: 'billing@beta.example',
      phone: '+91 92222 33333',
      billing_address: { street: '20 Beta Ave', city: 'Mumbai' },
      tax_identifier: 'GSTIN27AAACB2222Z',
      status: 'active',
    },
  ];

  const plans = [
    {
      id: 'plan-monthly',
      name: 'SaaS Monthly Tier',
      interval: 'monthly',
      interval_count: 1,
    },
  ];

  const subscriptions = [
    {
      id: 'sub-alpha',
      subscription_number: 'SUB-2026-000001',
      customer_id: 'cus-alpha',
      plan_id: 'plan-monthly',
      status: 'confirmed',
      starts_at: '2026-11-01T00:00:00.000Z',
      expires_at: null,
      next_billing_at: '2026-11-01T00:00:00.000Z',
      payment_terms_days: 15,
      currency: 'INR',
      subtotal_cents: 300000,
      discount_cents: 30000,
      tax_cents: 48600,
      grand_total_cents: 318600,
      balance_due_cents: 318600,
      snapshot_breakdown: {
        totals: {
          subtotal: { amount: 300000, currency: 'INR' },
          discount: { amount: 30000, currency: 'INR' },
          tax: { amount: 48600, currency: 'INR' },
          grandTotal: { amount: 318600, currency: 'INR' },
          balanceDue: { amount: 318600, currency: 'INR' },
        },
      },
      created_at: new Date().toISOString(),
    },
  ];

  const subscriptionLines = [
    {
      id: 'sl-1',
      subscription_id: 'sub-alpha',
      product_id: 'prod-1',
      variant_id: null,
      description: 'Platform Monthly License',
      quantity: 1,
      unit_price_cents: 300000,
      variant_adjustment_cents: 0,
      line_subtotal_cents: 300000,
    },
  ];

  const billingRuns = [];
  const billingOccurrences = [];
  const invoices = [];
  const invoiceLines = [];
  const emailNotifications = [];
  const auditEvents = [];

  return {
    users,
    customers,
    plans,
    subscriptions,
    subscriptionLines,
    billingRuns,
    billingOccurrences,
    invoices,
    invoiceLines,
    emailNotifications,
    auditEvents,
    query: async (text, params = []) => {
      if (text.includes('BEGIN') || text.includes('COMMIT') || text.includes('ROLLBACK')) {
        return { rowCount: 1 };
      }

      // User authentication lookup
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

      // Subscription query by ID (for detail/actions)
      if (text.includes('FROM subscriptions') && (text.includes('WHERE s.id = $1') || text.includes('WHERE id = $1')) && !text.includes("WHERE s.status = 'active'")) {
        const sub = subscriptions.find((s) => s.id === params[0]);
        if (!sub) return { rows: [], rowCount: 0 };
        const cust = customers.find((c) => c.id === sub.customer_id);
        const plan = plans.find((p) => p.id === sub.plan_id);
        const lines = subscriptionLines.filter((l) => l.subscription_id === sub.id);
        return {
          rows: [
            {
              ...sub,
              customer_name: cust?.name,
              customer_email: cust?.email,
              tax_identifier: cust?.tax_identifier,
              billing_address: cust?.billing_address,
              user_id: cust?.user_id,
              plan_name: plan?.name,
              plan_interval: plan?.interval,
              plan_interval_count: plan?.interval_count,
              lines,
            },
          ],
          rowCount: 1,
        };
      }

      // Subscriptions list
      if (text.includes('FROM subscriptions s') && !text.includes('WHERE s.status = \'active\'')) {
        let list = [...subscriptions];
        if (text.includes('c.user_id = $')) {
          const cust = customers.find((c) => c.user_id === params[0]);
          list = list.filter((s) => s.customer_id === cust?.id);
        }
        return {
          rows: list.map((s) => {
            const cust = customers.find((c) => c.id === s.customer_id);
            const plan = plans.find((p) => p.id === s.plan_id);
            const lines = subscriptionLines.filter((l) => l.subscription_id === s.id);
            return {
              ...s,
              customer_name: cust?.name,
              plan_name: plan?.name,
              lines,
            };
          }),
          rowCount: list.length,
        };
      }

      // Due active subscriptions for billing worker
      if (text.includes('FROM subscriptions s') && text.includes("WHERE s.status = 'active'")) {
        const targetDate = new Date(params[0]);
        const matched = subscriptions.filter((s) => {
          if (s.status !== 'active') return false;
          if (params.length === 1 && !text.includes('s.id = $')) {
            return new Date(s.next_billing_at) <= targetDate;
          }
          return true;
        });

        return {
          rows: matched.map((s) => {
            const cust = customers.find((c) => c.id === s.customer_id);
            const plan = plans.find((p) => p.id === s.plan_id);
            const lines = subscriptionLines.filter((l) => l.subscription_id === s.id);
            return {
              ...s,
              customer_name: cust?.name,
              customer_email: cust?.email,
              tax_identifier: cust?.tax_identifier,
              billing_address: cust?.billing_address,
              plan_name: plan?.name,
              plan_interval: plan?.interval,
              plan_interval_count: plan?.interval_count,
              lines: lines.map((l) => ({
                id: l.id,
                productId: l.product_id,
                variantId: l.variant_id,
                description: l.description,
                quantity: l.quantity,
                unitPriceCents: l.unit_price_cents,
                variantAdjustmentCents: l.variant_adjustment_cents,
                lineSubtotalCents: l.line_subtotal_cents,
              })),
            };
          }),
          rowCount: matched.length,
        };
      }

      // Update subscription
      if (text.includes('UPDATE subscriptions')) {
        const subId = params[params.length - 1];
        const sub = subscriptions.find((s) => s.id === subId);
        if (sub) {
          if (text.includes("SET status = 'active'")) {
            sub.status = 'active';
            if (params.length >= 2 && text.includes('next_billing_at = $1')) {
              sub.next_billing_at = params[0];
            }
          }
          if (text.includes("SET status = 'paused'")) sub.status = 'paused';
          if (text.includes("SET status = 'closed'")) sub.status = 'closed';
          if (text.includes('next_billing_at = $1')) sub.next_billing_at = params[0];
          return { rows: [sub], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // Billing runs count
      if (text.includes('SELECT COUNT(*)::int AS count FROM billing_runs')) {
        return { rows: [{ count: billingRuns.length }], rowCount: 1 };
      }

      // Insert billing run
      if (text.includes('INSERT INTO billing_runs')) {
        const newRun = {
          id: `br-${billingRuns.length + 1}`,
          run_number: params[0],
          target_date: params[1],
          status: 'processing',
          created_by: params[2],
          total_subscriptions: 0,
          successful_count: 0,
          failed_count: 0,
          error_summary: null,
          created_at: new Date().toISOString(),
        };
        billingRuns.push(newRun);
        return { rows: [newRun], rowCount: 1 };
      }

      // Update billing run
      if (text.includes('UPDATE billing_runs')) {
        const runId = params[params.length - 1];
        const run = billingRuns.find((r) => r.id === runId);
        if (run) {
          run.status = params[0];
          run.total_subscriptions = params[1];
          run.successful_count = params[2];
          run.failed_count = params[3];
          run.error_summary = params[4];
          run.completed_at = new Date().toISOString();
          return { rows: [run], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // Check billing occurrences by idempotency key
      if (text.includes('FROM billing_occurrences WHERE idempotency_key = $1')) {
        const occ = billingOccurrences.find((o) => o.idempotency_key === params[0]);
        if (!occ) return { rows: [], rowCount: 0 };
        return { rows: [occ], rowCount: 1 };
      }

      // Check billing occurrences by id
      if (text.includes('FROM billing_occurrences') && text.includes('WHERE id = $1')) {
        const occ = billingOccurrences.find((o) => o.id === params[0]);
        if (!occ) return { rows: [], rowCount: 0 };
        return { rows: [occ], rowCount: 1 };
      }

      // Insert billing occurrence
      if (text.includes('INSERT INTO billing_occurrences')) {
        const newOcc = {
          id: `occ-${billingOccurrences.length + 1}`,
          subscription_id: params[0],
          billing_run_id: params[1],
          idempotency_key: params[2],
          period_start: params[3],
          period_end: params[4],
          status: 'pending',
          invoice_id: null,
          retry_count: 0,
          last_error: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        billingOccurrences.push(newOcc);
        return { rows: [newOcc], rowCount: 1 };
      }

      // Update billing occurrence
      if (text.includes('UPDATE billing_occurrences')) {
        const occId = params[params.length - 1];
        const occ = billingOccurrences.find((o) => o.id === occId);
        if (occ) {
          if (text.includes('invoice_id = $1') && text.includes("status = 'succeeded'")) {
            occ.invoice_id = params[0];
            occ.status = 'succeeded';
            occ.last_error = null;
          } else if (text.includes("status = 'failed'")) {
            occ.status = 'failed';
            occ.last_error = params[0];
          } else if (text.includes('retry_count = retry_count + 1')) {
            occ.retry_count = (occ.retry_count || 0) + 1;
            if (params.length === 2 && text.includes('last_error = $1')) {
              occ.last_error = params[0];
            }
          }
          occ.updated_at = new Date().toISOString();
          return { rows: [occ], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // Invoices count
      if (text.includes('SELECT COUNT(*)::int AS count FROM invoices')) {
        return { rows: [{ count: invoices.length }], rowCount: 1 };
      }

      // Insert invoice
      if (text.includes('INSERT INTO invoices')) {
        const newInv = {
          id: `inv-${invoices.length + 1}`,
          invoice_number: params[0],
          customer_id: params[1],
          subscription_id: params[2],
          billing_occurrence_id: params[3],
          status: 'draft',
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
        invoices.push(newInv);
        return { rows: [newInv], rowCount: 1 };
      }

      // Insert invoice lines
      if (text.includes('INSERT INTO invoice_lines')) {
        const line = {
          id: `il-${invoiceLines.length + 1}`,
          invoice_id: params[0],
          product_id: params[1],
          variant_id: params[2],
          description: params[3],
          quantity: params[4],
          unit_price_cents: params[5],
          variant_adjustment_cents: params[6],
          line_subtotal_cents: params[7],
          created_at: new Date().toISOString(),
        };
        invoiceLines.push(line);
        return { rows: [line], rowCount: 1 };
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
            const sub = subscriptions.find((s) => s.id === inv.subscription_id);
            const lines = invoiceLines.filter((l) => l.invoice_id === inv.id);
            return {
              ...inv,
              customer_name: cust?.name,
              customer_email: cust?.email,
              customer_tax_identifier: cust?.tax_identifier,
              subscription_number: sub?.subscription_number,
              lines,
            };
          }),
          rowCount: list.length,
        };
      }

      // Single invoice query by id
      if (text.includes('FROM invoices') && (text.includes('WHERE i.id = $1') || text.includes('WHERE id = $1'))) {
        const inv = invoices.find((i) => i.id === params[0]);
        if (!inv) return { rows: [], rowCount: 0 };
        const cust = customers.find((c) => c.id === inv.customer_id);
        const sub = subscriptions.find((s) => s.id === inv.subscription_id);
        const lines = invoiceLines.filter((l) => l.invoice_id === inv.id);
        return {
          rows: [
            {
              ...inv,
              customer_name: cust?.name,
              customer_email: cust?.email,
              customer_tax_identifier: cust?.tax_identifier,
              customer_billing_address: cust?.billing_address,
              user_id: cust?.user_id,
              subscription_number: sub?.subscription_number,
              lines,
              notifications: emailNotifications.filter((n) => n.entity_id === inv.id),
            },
          ],
          rowCount: 1,
        };
      }

      // Invoice lines query by invoice_id
      if (text.includes('FROM invoice_lines WHERE invoice_id = $1')) {
        const lines = invoiceLines.filter((l) => l.invoice_id === params[0]);
        return { rows: lines, rowCount: lines.length };
      }

      // Update invoice status
      if (text.includes('UPDATE invoices')) {
        const invId = params[params.length - 1];
        const inv = invoices.find((i) => i.id === invId);
        if (inv) {
          if (text.includes("SET status = 'confirmed'")) inv.status = 'confirmed';
          if (text.includes("SET status = 'sent'")) {
            inv.status = 'sent';
            inv.sent_at = new Date().toISOString();
          }
          if (text.includes("SET status = 'cancelled'")) {
            inv.status = 'cancelled';
            inv.cancellation_reason = params[0];
          }
          inv.updated_at = new Date().toISOString();
          return { rows: [inv], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // Insert email notification
      if (text.includes('INSERT INTO email_notifications')) {
        const notif = {
          id: `notif-${emailNotifications.length + 1}`,
          entity_type: 'invoice',
          entity_id: params[0],
          recipient_email: params[1],
          subject: params[2],
          body: params[3],
          status: params[5] || 'sent',
          last_error: params[6] || null,
          sent_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };
        emailNotifications.push(notif);
        return { rows: [notif], rowCount: 1 };
      }

      // Default
      return { rows: [], rowCount: 0 };
    },
  };
}

test('invoices & billing integration suite: subscription lifecycle, idempotent worker, retryability, and delivery', async () => {
  const pool = createMockPool();
  const jwtSecret = 'test-secret';
  const app = createApp({ pool, jwtSecret });

  let server;
  let baseUrl;

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  const adminToken = jwt.sign({ sub: 'usr-admin', role: 'admin' }, jwtSecret);
  const client1Token = jwt.sign({ sub: 'usr-customer-1', role: 'customer' }, jwtSecret);
  const client2Token = jwt.sign({ sub: 'usr-customer-2', role: 'customer' }, jwtSecret);

  async function request(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const data = res.status === 204 ? null : await res.json();
    return { status: res.status, data, headers: res.headers };
  }

  try {
    // 1. Subscription Lifecycle: Activate subscription
    let res = await request('/api/v1/subscriptions/sub-alpha/activate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.status, 'active');
    assert.ok(res.data.data.nextBillingAt);

    // 2. Pause and Resume subscription
    res = await request('/api/v1/subscriptions/sub-alpha/pause', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.status, 'paused');

    res = await request('/api/v1/subscriptions/sub-alpha/resume', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.status, 'active');

    // 3. Trigger Billing Run (Due date: 2026-11-01)
    res = await request('/api/v1/billing-runs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ targetDate: '2026-11-05T00:00:00.000Z' }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.data.billingRun.successfulCount, 1);
    assert.equal(res.data.data.createdInvoices.length, 1);
    const firstInvoice = res.data.data.createdInvoices[0];
    assert.equal(firstInvoice.invoiceNumber, 'INV-2026-000001');

    // 4. Strict Idempotency Certification: Re-running billing run produces ZERO duplicate invoices
    res = await request('/api/v1/billing-runs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ targetDate: '2026-11-05T00:00:00.000Z' }),
    });
    assert.equal(res.status, 201);
    // Verified 1 invoice exists total in database
    assert.equal(pool.invoices.length, 1);

    // 5. Failure Injection & Retryability Certification:
    // Mark an occurrence as failed and test the retry endpoint
    pool.billingOccurrences.push({
      id: 'occ-failed-1',
      subscription_id: 'sub-alpha',
      billing_run_id: 'br-1',
      idempotency_key: 'sub_sub-alpha:2026-12-01:2027-01-01',
      period_start: '2026-12-01T00:00:00.000Z',
      period_end: '2027-01-01T00:00:00.000Z',
      status: 'failed',
      invoice_id: null,
      retry_count: 0,
      last_error: 'Temporary simulated database timeout',
    });

    res = await request('/api/v1/billing-occurrences/occ-failed-1/retry', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.occurrence.status, 'succeeded');
    assert.ok(res.data.data.invoice);
    assert.equal(res.data.data.invoice.invoiceNumber, 'INV-2026-000002');

    // 6. Invoice Lifecycle: Confirm draft invoice
    res = await request(`/api/v1/invoices/${firstInvoice.id}/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.status, 'confirmed');

    // 7. Send Invoice: Sends email notification & transitions to 'sent'
    res = await request(`/api/v1/invoices/${firstInvoice.id}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ recipientEmail: 'billing@alpha.example' }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.invoice.status, 'sent');
    assert.equal(res.data.data.notification.recipient_email, 'billing@alpha.example');

    // 8. PDF Generation Endpoint: Returns valid PDF buffer
    const pdfRes = await fetch(`${baseUrl}/api/v1/invoices/${firstInvoice.id}/pdf`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(pdfRes.status, 200);
    assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');
    const pdfBuffer = await pdfRes.arrayBuffer();
    assert.ok(pdfBuffer.byteLength > 200);

    // 9. Customer Portal Isolation:
    // Client 1 (Alpha) sees their invoice
    res = await request('/api/v1/invoices', {
      headers: { Authorization: `Bearer ${client1Token}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.length, 2);

    // Client 2 (Beta) sees 0 invoices (portal isolation!)
    res = await request('/api/v1/invoices', {
      headers: { Authorization: `Bearer ${client2Token}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.length, 0);

    // Client 2 cannot access Client 1's invoice PDF
    const forbiddenPdfRes = await fetch(`${baseUrl}/api/v1/invoices/${firstInvoice.id}/pdf`, {
      headers: { Authorization: `Bearer ${client2Token}` },
    });
    assert.equal(forbiddenPdfRes.status, 403);
  } finally {
    server.close();
  }
});
