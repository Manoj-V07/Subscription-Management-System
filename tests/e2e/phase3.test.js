/**
 * Phase 3 Complete End-to-End Certification Test Suite
 * Formally certifies Phase 3 Exit Criterion:
 * "A due subscription produces one correct invoice and failures are retryable/visible."
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');
const { createApp } = require('../../apps/api/src/app');

function createPhase3MockPool() {
  const users = [
    {
      id: 'usr-admin-e2e',
      email: 'admin@brightloop.example',
      display_name: 'Brightloop Master Admin',
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
      id: 'usr-customer-e2e',
      email: 'finance@apex.example',
      display_name: 'Apex Finance Client',
      status: 'active',
      role: 'customer',
      permissions: ['portal.read'],
    },
    {
      id: 'usr-other-e2e',
      email: 'finance@other.example',
      display_name: 'Other Client',
      status: 'active',
      role: 'customer',
      permissions: ['portal.read'],
    },
  ];

  const customers = [
    {
      id: 'cus-apex',
      user_id: 'usr-customer-e2e',
      name: 'Apex Technologies Inc',
      email: 'finance@apex.example',
      phone: '+91 99999 88888',
      billing_address: { street: '77 Silicon Hill', city: 'Bengaluru', country: 'IN' },
      tax_identifier: 'GSTIN29AAACA9999Z',
      status: 'active',
    },
    {
      id: 'cus-other',
      user_id: 'usr-other-e2e',
      name: 'Other Operations Corp',
      email: 'finance@other.example',
      phone: '+91 91111 00000',
      billing_address: { street: '12 Marine Line', city: 'Mumbai', country: 'IN' },
      tax_identifier: 'GSTIN27AAACB0000Z',
      status: 'active',
    },
  ];

  const products = [
    {
      id: 'prod-core',
      name: 'Brightloop Enterprise Cloud',
      sales_price_cents: 500000, // 5000.00
      cost_price_cents: 100000,
      currency: 'INR',
      is_archived: false,
    },
  ];

  const variants = [];

  const plans = [
    {
      id: 'plan-monthly',
      name: 'Enterprise Cloud Monthly',
      code: 'ENT-M-2026',
      interval: 'monthly',
      interval_count: 1,
      min_quantity: 1,
      auto_renew: true,
      is_archived: false,
    },
  ];

  const taxRules = [
    {
      id: 'tax-gst-18',
      name: 'GST 18%',
      rate_percentage: 18.0,
      jurisdiction: 'IN',
      is_active: true,
    },
  ];

  const discountRules = [
    {
      id: 'disc-loyalty',
      name: 'Enterprise 10%',
      code: 'ENT10',
      type: 'percentage',
      value: 10.0,
      min_threshold_cents: 100000,
      scope: 'entire_order',
      times_used: 0,
      max_uses: null,
      is_active: true,
    },
  ];

  const quotations = [];
  const quotationLines = [];
  const subscriptions = [];
  const subscriptionLines = [];
  const billingRuns = [];
  const billingOccurrences = [];
  const invoices = [];
  const invoiceLines = [];
  const emailNotifications = [];
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

      // User lookup
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
          metadata: params[4],
        });
        return { rowCount: 1 };
      }

      // Customer by id
      if (text.includes('FROM customers') && text.includes('WHERE id = $1')) {
        const cust = customers.find((c) => c.id === params[0]);
        if (!cust) return { rows: [], rowCount: 0 };
        return { rows: [cust], rowCount: 1 };
      }

      // Plan by id
      if (text.includes('FROM plans') && text.includes('WHERE id = $1')) {
        const plan = plans.find((p) => p.id === params[0]);
        if (!plan) return { rows: [], rowCount: 0 };
        return { rows: [plan], rowCount: 1 };
      }

      // Product by id
      if (text.includes('FROM products') && text.includes('WHERE id = $1')) {
        const prod = products.find((p) => p.id === params[0]);
        if (!prod) return { rows: [], rowCount: 0 };
        return { rows: [prod], rowCount: 1 };
      }

      // Tax rule by id
      if (text.includes('FROM tax_rules') && text.includes('WHERE id = $1')) {
        const tax = taxRules.find((t) => t.id === params[0]);
        if (!tax) return { rows: [], rowCount: 0 };
        return { rows: [tax], rowCount: 1 };
      }

      // Discount rule by id
      if (text.includes('FROM discount_rules') && text.includes('WHERE id = $1')) {
        const d = discountRules.find((rule) => rule.id === params[0]);
        if (!d) return { rows: [], rowCount: 0 };
        return { rows: [d], rowCount: 1 };
      }

      // Quotations count
      if (text.includes('SELECT COUNT(*)::int AS count FROM quotations')) {
        return { rows: [{ count: quotations.length }], rowCount: 1 };
      }

      // Insert quotation
      if (text.includes('INSERT INTO quotations')) {
        const quote = {
          id: `qt-${quotations.length + 1}`,
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
          snapshot_breakdown: typeof params[10] === 'string' ? JSON.parse(params[10]) : params[10],
          created_by: params[11],
          created_at: new Date().toISOString(),
        };
        quotations.push(quote);
        return { rows: [quote], rowCount: 1 };
      }

      // Insert quotation lines
      if (text.includes('INSERT INTO quotation_lines')) {
        const line = {
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
        quotationLines.push(line);
        return { rows: [line], rowCount: 1 };
      }

      // Quotation by ID
      if (text.includes('FROM quotations') && text.includes('WHERE id = $1')) {
        const quote = quotations.find((q) => q.id === params[0]);
        if (!quote) return { rows: [], rowCount: 0 };
        const cust = customers.find((c) => c.id === quote.customer_id);
        const plan = plans.find((p) => p.id === quote.plan_id);
        const lines = quotationLines.filter((l) => l.quotation_id === quote.id);
        return {
          rows: [
            {
              ...quote,
              customer_name: cust?.name,
              plan_name: plan?.name,
              lines,
            },
          ],
          rowCount: 1,
        };
      }

      // Quotation lines by quote id
      if (text.includes('FROM quotation_lines WHERE quotation_id = $1')) {
        const lines = quotationLines.filter((l) => l.quotation_id === params[0]);
        return { rows: lines, rowCount: lines.length };
      }

      // Update quotation status
      if (text.includes('UPDATE quotations SET status = $1')) {
        const quote = quotations.find((q) => q.id === params[1]);
        if (quote) {
          quote.status = params[0];
          return { rows: [quote], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      if (text.includes("UPDATE quotations SET status = 'converted'")) {
        const quote = quotations.find((q) => q.id === params[0]);
        if (quote) {
          quote.status = 'converted';
          return { rows: [quote], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // Subscriptions count
      if (text.includes('SELECT COUNT(*)::int AS count FROM subscriptions')) {
        return { rows: [{ count: subscriptions.length }], rowCount: 1 };
      }

      // Insert subscription (via conversion)
      if (text.includes('INSERT INTO subscriptions')) {
        const sub = {
          id: `sub-${subscriptions.length + 1}`,
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
          snapshot_breakdown: typeof params[12] === 'string' ? JSON.parse(params[12]) : params[12],
          created_by: params[13],
          next_billing_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        subscriptions.push(sub);
        return { rows: [sub], rowCount: 1 };
      }

      // Insert subscription lines
      if (text.includes('INSERT INTO subscription_lines')) {
        const line = {
          id: `sl-${subscriptionLines.length + 1}`,
          subscription_id: params[0],
          product_id: params[1],
          variant_id: params[2],
          description: params[3],
          quantity: params[4],
          unit_price_cents: params[5],
          variant_adjustment_cents: params[6],
          line_subtotal_cents: params[7],
        };
        subscriptionLines.push(line);
        return { rows: [line], rowCount: 1 };
      }

      // Subscription query by ID
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

      // Due subscriptions for billing run
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
          sub.updated_at = new Date().toISOString();
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
        const run = {
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
        billingRuns.push(run);
        return { rows: [run], rowCount: 1 };
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

      // Billing occurrences list query
      if (text.includes('FROM billing_occurrences bo')) {
        let list = [...billingOccurrences];
        if (text.includes('bo.status =')) {
          list = list.filter((o) => o.status === params[0]);
        }
        return {
          rows: list.map((o) => {
            const sub = subscriptions.find((s) => s.id === o.subscription_id);
            const cust = customers.find((c) => c.id === sub?.customer_id);
            const inv = invoices.find((i) => i.id === o.invoice_id);
            return {
              ...o,
              subscription_number: sub?.subscription_number,
              customer_name: cust?.name,
              invoice_number: inv?.invoice_number,
            };
          }),
          rowCount: list.length,
        };
      }

      // Check occurrence by idempotency key
      if (text.includes('FROM billing_occurrences WHERE idempotency_key = $1')) {
        const occ = billingOccurrences.find((o) => o.idempotency_key === params[0]);
        if (!occ) return { rows: [], rowCount: 0 };
        return { rows: [occ], rowCount: 1 };
      }
      // Check occurrence by id
      if (text.includes('FROM billing_occurrences') && text.includes('WHERE id = $1')) {
        const occ = billingOccurrences.find((o) => o.id === params[0]);
        if (!occ) return { rows: [], rowCount: 0 };
        return { rows: [occ], rowCount: 1 };
      }

      // Insert occurrence
      if (text.includes('INSERT INTO billing_occurrences')) {
        const occ = {
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
        billingOccurrences.push(occ);
        return { rows: [occ], rowCount: 1 };
      }

      // Update occurrence
      if (text.includes('UPDATE billing_occurrences')) {
        const occId = params[params.length - 1];
        const occ = billingOccurrences.find((o) => o.id === occId);
        if (occ) {
          if (text.includes('retry_count = retry_count + 1')) {
            occ.retry_count = (occ.retry_count || 0) + 1;
          }
          if (text.includes('invoice_id = $1') && text.includes("status = 'succeeded'")) {
            occ.invoice_id = params[0];
            occ.status = 'succeeded';
            occ.last_error = null;
          } else if (text.includes("status = 'failed'")) {
            occ.status = 'failed';
            occ.last_error = params[0];
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
        const inv = {
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
        invoices.push(inv);
        return { rows: [inv], rowCount: 1 };
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
              tax_identifier: cust?.tax_identifier,
              customer_tax_identifier: cust?.tax_identifier,
              customer_billing_address: cust?.billing_address,
              billing_address: cust?.billing_address,
              user_id: cust?.user_id,
              subscription_number: sub?.subscription_number,
              lines,
              notifications: emailNotifications.filter((n) => n.entity_id === inv.id),
            },
          ],
          rowCount: 1,
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
          status: 'sent',
          last_error: null,
          sent_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };
        emailNotifications.push(notif);
        return { rows: [notif], rowCount: 1 };
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

      return { rows: [], rowCount: 0 };
    },
  };
}

test('phase 3 complete e2e certification: subscription billing, idempotent worker, retryability, and invoice delivery', async () => {
  const pool = createPhase3MockPool();
  const jwtSecret = 'phase3-e2e-secret';
  const app = createApp({ pool, jwtSecret });

  let server;
  let baseUrl;

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  const adminToken = jwt.sign({ sub: 'usr-admin-e2e', role: 'admin' }, jwtSecret);
  const clientToken = jwt.sign({ sub: 'usr-customer-e2e', role: 'customer' }, jwtSecret);
  const otherClientToken = jwt.sign({ sub: 'usr-other-e2e', role: 'customer' }, jwtSecret);

  async function request(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const data = res.status === 204 ? null : await res.json();
    return { status: res.status, data, headers: res.headers };
  }

  try {
    // ----------------------------------------------------
    // STEP 1: CREATE QUOTATION & PROGRESS TO CONVERSION
    // ----------------------------------------------------
    let res = await request('/api/v1/quotations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        customerId: 'cus-apex',
        planId: 'plan-monthly',
        discountRuleId: 'disc-loyalty',
        taxRuleId: 'tax-gst-18',
        lines: [
          {
            productId: 'prod-core',
            quantity: 1,
            unitPriceCents: 500000,
          },
        ],
      }),
    });
    assert.equal(res.status, 201);
    const quote = res.data.data;
    assert.equal(quote.quotationNumber, 'QT-2026-000001');
    assert.equal(quote.grandTotalCents, 531000); // 5000 - 500 + 810 = 5310 INR

    // Send and confirm quote
    await request(`/api/v1/quotations/${quote.id}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    await request(`/api/v1/quotations/${quote.id}/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    // Convert quotation to confirmed subscription
    res = await request(`/api/v1/quotations/${quote.id}/convert`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 201);
    const { subscription } = res.data.data;
    assert.equal(subscription.status, 'confirmed');

    // ----------------------------------------------------
    // STEP 2: ACTIVATE SUBSCRIPTION (PHASE 3 LIFECYCLE)
    // ----------------------------------------------------
    res = await request(`/api/v1/subscriptions/${subscription.id}/activate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.status, 'active');
    assert.ok(res.data.data.nextBillingAt, 'Subscription must have active nextBillingAt schedule');

    // ----------------------------------------------------
    // STEP 3: EXECUTE SCHEDULED BILLING WORKER
    // (Formally Certifies Exit Criterion: "A due subscription produces one correct invoice")
    // ----------------------------------------------------
    const targetDate = new Date(Date.now() + 86400000).toISOString(); // Tomorrow
    res = await request('/api/v1/billing-runs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ targetDate }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.data.billingRun.successfulCount, 1);
    assert.equal(res.data.data.createdInvoices.length, 1);

    const generatedInvoice = res.data.data.createdInvoices[0];
    assert.equal(generatedInvoice.invoiceNumber, 'INV-2026-000001');
    assert.equal(generatedInvoice.grandTotalCents, 531000);
    assert.equal(generatedInvoice.status, 'draft');

    // ----------------------------------------------------
    // STEP 4: STRICT IDEMPOTENCY CERTIFICATION
    // Re-running billing for the same window must produce ZERO duplicate invoices
    // ----------------------------------------------------
    res = await request('/api/v1/billing-runs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ targetDate }),
    });
    assert.equal(res.status, 201);
    // Database invoice count must strictly remain 1
    assert.equal(pool.invoices.length, 1, 'Duplicate billing run must not create duplicate invoices');

    // ----------------------------------------------------
    // STEP 5: VISIBLE FAILURE & RETRYABILITY CERTIFICATION
    // (Formally Certifies Exit Criterion: "failures are retryable/visible")
    // ----------------------------------------------------
    // Inject a failed occurrence record
    pool.billingOccurrences.push({
      id: 'occ-simulated-failure',
      subscription_id: subscription.id,
      billing_run_id: 'br-1',
      idempotency_key: `sub_${subscription.id}:2026-12-01:2027-01-01`,
      period_start: '2026-12-01T00:00:00.000Z',
      period_end: '2027-01-01T00:00:00.000Z',
      status: 'failed',
      invoice_id: null,
      retry_count: 0,
      last_error: 'Simulated connection failure during worker execution',
      created_at: new Date().toISOString(),
    });

    // Inspect failed occurrence through public audit/monitoring API
    res = await request('/api/v1/billing-occurrences?status=failed', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const failedOcc = res.data.data.find((o) => o.id === 'occ-simulated-failure');
    assert.ok(failedOcc, 'Failed billing occurrence must be visible');
    assert.equal(failedOcc.status, 'failed');
    assert.equal(failedOcc.lastError, 'Simulated connection failure during worker execution');

    // Retry the failed occurrence
    res = await request('/api/v1/billing-occurrences/occ-simulated-failure/retry', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.occurrence.status, 'succeeded');
    assert.equal(res.data.data.occurrence.retryCount, 1);
    assert.ok(res.data.data.invoice);
    assert.equal(res.data.data.invoice.invoiceNumber, 'INV-2026-000002');

    // ----------------------------------------------------
    // STEP 6: INVOICE LIFECYCLE (CONFIRM -> SEND WITH EMAIL)
    // ----------------------------------------------------
    res = await request(`/api/v1/invoices/${generatedInvoice.id}/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.status, 'confirmed');

    // Send invoice
    res = await request(`/api/v1/invoices/${generatedInvoice.id}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ recipientEmail: 'finance@apex.example' }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.invoice.status, 'sent');
    assert.equal(res.data.data.notification.recipient_email, 'finance@apex.example');
    assert.equal(res.data.data.notification.status, 'sent');

    // ----------------------------------------------------
    // STEP 7: INVOICE PDF DOWNLOAD & SPECIFICATION COMPLIANCE
    // ----------------------------------------------------
    const pdfResponse = await fetch(`${baseUrl}/api/v1/invoices/${generatedInvoice.id}/pdf`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(pdfResponse.status, 200);
    assert.equal(pdfResponse.headers.get('content-type'), 'application/pdf');
    const pdfArrayBuffer = await pdfResponse.arrayBuffer();
    assert.ok(pdfArrayBuffer.byteLength > 200);
    const pdfContent = Buffer.from(pdfArrayBuffer).toString('utf8');
    assert.ok(pdfContent.startsWith('%PDF-1.4'));
    assert.ok(pdfContent.includes('INV-2026-000001'));
    assert.ok(pdfContent.includes('Apex Technologies Inc'));
    assert.ok(pdfContent.endsWith('%%EOF'));

    // ----------------------------------------------------
    // STEP 8: CUSTOMER PORTAL ACCESS & DATA ISOLATION
    // ----------------------------------------------------
    // Apex client retrieves their invoices
    res = await request('/api/v1/invoices', {
      headers: { Authorization: `Bearer ${clientToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.length, 2); // The 2 invoices created for Apex
    assert.equal(res.data.data[0].customerName, 'Apex Technologies Inc');

    // Apex client downloads their own invoice PDF
    const customerPdfRes = await fetch(`${baseUrl}/api/v1/invoices/${generatedInvoice.id}/pdf`, {
      headers: { Authorization: `Bearer ${clientToken}` },
    });
    assert.equal(customerPdfRes.status, 200);

    // Other client retrieves their invoices -> gets 0
    res = await request('/api/v1/invoices', {
      headers: { Authorization: `Bearer ${otherClientToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.length, 0);

    // Other client forbidden from downloading Apex invoice PDF
    const forbiddenRes = await fetch(`${baseUrl}/api/v1/invoices/${generatedInvoice.id}/pdf`, {
      headers: { Authorization: `Bearer ${otherClientToken}` },
    });
    assert.equal(forbiddenRes.status, 403);
  } finally {
    server.close();
  }
});
