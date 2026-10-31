/**
 * In-Memory Database Pool & Demo Seed Engine
 * Provides fallback persistence when a live PostgreSQL cluster is offline,
 * pre-populating roles, admin credentials, catalogue, customers, quotations,
 * subscriptions, invoices, and payments.
 */

const bcrypt = require('bcryptjs');

function createMemoryPool() {
  const adminHash = bcrypt.hashSync('Admin@12345', 10);
  const staffHash = bcrypt.hashSync('Staff@12345', 10);
  const clientHash = bcrypt.hashSync('Customer@123', 10);

  const roles = [
    { id: 'rol-admin', name: 'admin' },
    { id: 'rol-staff', name: 'staff' },
    { id: 'rol-customer', name: 'customer' },
  ];

  const permissions = [
    { id: 'p-1', key: 'dashboard.read', description: 'View dashboards' },
    { id: 'p-2', key: 'customers.read', description: 'View customers' },
    { id: 'p-3', key: 'customers.manage', description: 'Manage customers' },
    { id: 'p-4', key: 'catalog.manage', description: 'Manage catalogue configuration' },
    { id: 'p-5', key: 'quotes.manage', description: 'Manage quotations and sales templates' },
    { id: 'p-6', key: 'subscriptions.manage', description: 'Manage subscriptions and lifecycle' },
    { id: 'p-7', key: 'billing.read', description: 'View billing records' },
    { id: 'p-8', key: 'billing.manage', description: 'Manage billing records' },
    { id: 'p-9', key: 'payments.read', description: 'View payment records' },
    { id: 'p-10', key: 'payments.manage', description: 'Record and allocate payments' },
    { id: 'p-11', key: 'staff.manage', description: 'Manage internal staff' },
    { id: 'p-12', key: 'reports.read', description: 'View reports' },
    { id: 'p-13', key: 'portal.read', description: 'View customer portal' },
  ];

  const allPermKeys = permissions.map((p) => p.key);
  const staffPermKeys = [
    'dashboard.read',
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
    'portal.read',
  ];

  const users = [
    {
      id: 'usr-admin-1',
      email: 'admin@brightloop.example',
      password_hash: adminHash,
      display_name: 'Brightloop Administrator',
      status: 'active',
      role_id: 'rol-admin',
      role: 'admin',
      permissions: allPermKeys,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'usr-staff-1',
      email: 'staff@brightloop.example',
      password_hash: staffHash,
      display_name: 'Sales & Billing Staff',
      status: 'active',
      role_id: 'rol-staff',
      role: 'staff',
      permissions: staffPermKeys,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'usr-customer-1',
      email: 'billing@acme.example',
      password_hash: clientHash,
      display_name: 'Acme Software AP',
      status: 'active',
      role_id: 'rol-customer',
      role: 'customer',
      permissions: ['portal.read'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const customers = [
    {
      id: 'cus-acme',
      user_id: 'usr-customer-1',
      name: 'Acme Software Ltd',
      email: 'billing@acme.example',
      phone: '+91 98765 43210',
      billing_address: { street: '100 Tech Park', city: 'Bengaluru', state: 'Karnataka', country: 'IN', postal_code: '560001' },
      tax_identifier: 'GSTIN29AABCU9603R1ZM',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'cus-vertex',
      user_id: null,
      name: 'Vertex Systems Corp',
      email: 'accounts@vertex.example',
      phone: '+91 91234 56789',
      billing_address: { street: '42 Cyber City', city: 'Pune', state: 'Maharashtra', country: 'IN', postal_code: '411001' },
      tax_identifier: 'GSTIN27AAACB2222Z',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const products = [
    {
      id: 'prod-core',
      name: 'Brightloop Platform Core',
      product_type: 'service',
      sales_price_cents: 250000,
      cost_price_cents: 50000,
      currency: 'INR',
      notes: 'Core SaaS platform subscription tier',
      is_archived: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'prod-api',
      name: 'Developer API Gateway',
      product_type: 'service',
      sales_price_cents: 100000,
      cost_price_cents: 20000,
      currency: 'INR',
      notes: 'High-throughput API quota pack',
      is_archived: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const variants = [
    {
      id: 'var-sla',
      product_id: 'prod-core',
      label: 'Enterprise Odoo SLA',
      adjustment_type: 'fixed',
      adjustment_value: 56000,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'var-support',
      product_id: 'prod-core',
      label: 'Priority 24/7 Support',
      adjustment_type: 'percentage',
      adjustment_value: 15.0,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const plans = [
    {
      id: 'plan-m-pro',
      name: 'Monthly Professional',
      code: 'PLAN-M-PRO',
      interval: 'monthly',
      interval_count: 1,
      min_quantity: 1,
      auto_renew: true,
      is_active: true,
      payment_terms_days: 15,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'plan-y-ent',
      name: 'Yearly Enterprise',
      code: 'PLAN-Y-ENT',
      interval: 'yearly',
      interval_count: 1,
      min_quantity: 5,
      auto_renew: true,
      is_active: true,
      payment_terms_days: 30,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const taxRules = [
    {
      id: 'tax-gst',
      name: 'GST 18%',
      rate_percentage: 18.0,
      jurisdiction: 'IN',
      is_active: true,
      effective_from: new Date().toISOString(),
      created_at: new Date().toISOString(),
    },
  ];

  const discountRules = [
    {
      id: 'disc-launch',
      name: 'Launch Offer 10%',
      code: 'LAUNCH10',
      type: 'percentage',
      value: 10.0,
      min_threshold_cents: 100000,
      scope: 'entire_order',
      is_active: true,
      times_used: 1,
      created_at: new Date().toISOString(),
    },
  ];

  const quotations = [
    {
      id: 'qt-demo-1',
      quotation_number: 'QT-2026-000101',
      customer_id: 'cus-acme',
      plan_id: 'plan-m-pro',
      status: 'accepted',
      issue_date: '2026-10-15',
      expiry_date: '2026-11-15',
      currency: 'INR',
      subtotal_cents: 250000,
      discount_cents: 25000,
      tax_cents: 40500,
      grand_total_cents: 265500,
      snapshot_breakdown: { subtotal_cents: 250000, discount_cents: 25000, tax_cents: 40500, grand_total_cents: 265500 },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const quotationLines = [
    {
      id: 'ql-demo-1',
      quotation_id: 'qt-demo-1',
      product_id: 'prod-core',
      variant_id: null,
      description: 'Brightloop Platform Core',
      quantity: 1,
      unit_price_cents: 250000,
      variant_adjustment_cents: 0,
      line_subtotal_cents: 250000,
      created_at: new Date().toISOString(),
    },
  ];

  const subscriptions = [
    {
      id: 'sub-demo-1',
      subscription_number: 'SUB-2026-000101',
      quotation_id: 'qt-demo-1',
      customer_id: 'cus-acme',
      plan_id: 'plan-m-pro',
      status: 'active',
      starts_at: '2026-10-15T00:00:00Z',
      next_billing_at: '2026-11-15T00:00:00Z',
      payment_terms_days: 15,
      currency: 'INR',
      subtotal_cents: 250000,
      discount_cents: 25000,
      tax_cents: 40500,
      grand_total_cents: 265500,
      balance_due_cents: 165500,
      snapshot_breakdown: { subtotal_cents: 250000, discount_cents: 25000, tax_cents: 40500, grand_total_cents: 265500 },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const subscriptionLines = [
    {
      id: 'sl-demo-1',
      subscription_id: 'sub-demo-1',
      product_id: 'prod-core',
      variant_id: null,
      description: 'Brightloop Platform Core',
      quantity: 1,
      unit_price_cents: 250000,
      variant_adjustment_cents: 0,
      line_subtotal_cents: 250000,
      created_at: new Date().toISOString(),
    },
  ];

  const billingRuns = [
    {
      id: 'br-demo-1',
      run_number: 'RUN-2026-000001',
      target_date: '2026-10-15T00:00:00Z',
      status: 'completed',
      total_subscriptions: 1,
      successful_count: 1,
      failed_count: 0,
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    },
  ];

  const billingOccurrences = [
    {
      id: 'bo-demo-1',
      subscription_id: 'sub-demo-1',
      billing_run_id: 'br-demo-1',
      idempotency_key: 'sub_demo_1_20261015_20261115',
      period_start: '2026-10-15T00:00:00Z',
      period_end: '2026-11-15T00:00:00Z',
      status: 'succeeded',
      retry_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const invoices = [
    {
      id: 'inv-demo-1',
      invoice_number: 'INV-2026-000101',
      customer_id: 'cus-acme',
      subscription_id: 'sub-demo-1',
      billing_occurrence_id: 'bo-demo-1',
      status: 'partially_paid',
      issue_date: '2026-10-15',
      due_date: '2026-10-30',
      currency: 'INR',
      subtotal_cents: 250000,
      discount_cents: 25000,
      tax_cents: 40500,
      grand_total_cents: 265500,
      balance_due_cents: 165500,
      payment_terms_days: 15,
      snapshot_breakdown: { subtotal_cents: 250000, discount_cents: 25000, tax_cents: 40500, grand_total_cents: 265500 },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const invoiceLines = [
    {
      id: 'il-demo-1',
      invoice_id: 'inv-demo-1',
      product_id: 'prod-core',
      variant_id: null,
      description: 'Brightloop Platform Core',
      quantity: 1,
      unit_price_cents: 250000,
      variant_adjustment_cents: 0,
      line_subtotal_cents: 250000,
      created_at: new Date().toISOString(),
    },
  ];

  const payments = [
    {
      id: 'pay-demo-1',
      payment_number: 'PAY-2026-000001',
      customer_id: 'cus-acme',
      invoice_id: 'inv-demo-1',
      method: 'bank_transfer',
      amount_cents: 100000,
      currency: 'INR',
      received_date: '2026-10-20',
      external_reference: 'UTR12345678DEMO',
      notes: 'Initial bank remittance',
      created_by: 'usr-admin-1',
      created_at: new Date().toISOString(),
    },
  ];

  const paymentAllocations = [
    {
      id: 'pa-demo-1',
      payment_id: 'pay-demo-1',
      invoice_id: 'inv-demo-1',
      amount_cents: 100000,
      allocated_at: new Date().toISOString(),
    },
  ];

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

      // 1. Users & Auth
      if (text.includes('SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = $1')) {
        const u = users.find((user) => user.email === params[0]);
        if (!u) return { rows: [], rowCount: 0 };
        return { rows: [u], rowCount: 1 };
      }
      if (text.includes('FROM users u') && text.includes('WHERE u.id = $1')) {
        const u = users.find((user) => user.id === params[0]);
        if (!u) return { rows: [], rowCount: 0 };
        return { rows: [u], rowCount: 1 };
      }
      if (text.includes('SELECT id FROM users WHERE email = $1')) {
        const u = users.find((user) => user.email === params[0]);
        return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
      }
      if (text.includes('SELECT id FROM roles WHERE name =')) {
        const rName = params[0] || 'customer';
        const r = roles.find((role) => role.name === rName);
        return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
      }
      if (text.includes('INSERT INTO users')) {
        const newUser = {
          id: `usr-${users.length + 1}`,
          email: params[0],
          password_hash: params[1],
          display_name: params[2],
          role_id: params[3],
          role: 'customer',
          status: 'active',
          permissions: ['portal.read'],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        users.push(newUser);
        return { rows: [newUser], rowCount: 1 };
      }
      if (text.includes('UPDATE users SET last_login_at = NOW()')) {
        return { rowCount: 1 };
      }
      if (text.includes('SELECT COUNT(*)::int AS count FROM users')) {
        return { rows: [{ count: users.filter((u) => u.status === 'active').length }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO audit_events')) {
        auditEvents.push({
          id: `aud-${auditEvents.length + 1}`,
          action: params[1],
          entity_type: params[2],
          entity_id: params[3],
          metadata: JSON.parse(params[4] || '{}'),
          request_id: params[5],
          created_at: new Date().toISOString(),
        });
        return { rowCount: 1 };
      }
      if (text.includes('SELECT COUNT(*)::int AS count FROM audit_events')) {
        return { rows: [{ count: auditEvents.length }], rowCount: 1 };
      }
      if (text.includes('SELECT id, action, entity_type AS "entityType" FROM audit_events')) {
        return { rows: auditEvents.slice().reverse().slice(0, 50), rowCount: auditEvents.length };
      }

      // 2. Customers
      if (text.includes('SELECT * FROM customers') || text.includes('FROM customers WHERE status = $1')) {
        return { rows: customers.filter((c) => c.status === 'active'), rowCount: customers.length };
      }
      if (text.includes('SELECT * FROM customers WHERE id = $1')) {
        const c = customers.find((cust) => cust.id === params[0]);
        return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
      }
      if (text.includes('INSERT INTO customers')) {
        const newCustomer = {
          id: `cus-${customers.length + 1}`,
          user_id: null,
          name: params[0],
          email: params[1],
          phone: params[2],
          billing_address: JSON.parse(params[3] || '{}'),
          tax_identifier: params[4],
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        customers.push(newCustomer);
        return { rows: [newCustomer], rowCount: 1 };
      }

      // 3. Products, Variants & Plans
      if (text.includes('FROM products p')) {
        const rows = products
          .filter((p) => !p.is_archived)
          .map((prod) => ({
            ...prod,
            variants: variants.filter((v) => v.product_id === prod.id && v.is_active),
          }));
        return { rows, rowCount: rows.length };
      }
      if (text.includes('FROM plans') && !text.includes('INSERT')) {
        return { rows: plans.filter((pl) => pl.is_active && !pl.is_archived), rowCount: plans.length };
      }
      if (text.includes('FROM tax_rules') && !text.includes('INSERT')) {
        return { rows: taxRules.filter((t) => t.is_active), rowCount: taxRules.length };
      }
      if (text.includes('FROM discount_rules') && !text.includes('INSERT')) {
        return { rows: discountRules.filter((d) => d.is_active), rowCount: discountRules.length };
      }
      if (text.includes('SELECT * FROM products WHERE id = $1')) {
        const prod = products.find((p) => p.id === params[0]);
        return { rows: prod ? [prod] : [], rowCount: prod ? 1 : 0 };
      }
      if (text.includes('SELECT * FROM product_variants WHERE id = $1')) {
        const v = variants.find((vr) => vr.id === params[0]);
        return { rows: v ? [v] : [], rowCount: v ? 1 : 0 };
      }
      if (text.includes('SELECT * FROM plans WHERE id = $1')) {
        const pl = plans.find((p) => p.id === params[0]);
        return { rows: pl ? [pl] : [], rowCount: pl ? 1 : 0 };
      }
      if (text.includes('SELECT * FROM tax_rules WHERE id = $1')) {
        const tx = taxRules.find((t) => t.id === params[0]);
        return { rows: tx ? [tx] : [], rowCount: tx ? 1 : 0 };
      }
      if (text.includes('SELECT * FROM discount_rules WHERE id = $1')) {
        const d = discountRules.find((dc) => dc.id === params[0]);
        return { rows: d ? [d] : [], rowCount: d ? 1 : 0 };
      }

      // 4. Quotations
      if (text.includes('FROM quotations q')) {
        const rows = quotations.map((q) => {
          const cust = customers.find((c) => c.id === q.customer_id) || {};
          const plan = plans.find((p) => p.id === q.plan_id) || {};
          return {
            ...q,
            customer_name: cust.name,
            customer_email: cust.email,
            plan_name: plan.name,
            lines: quotationLines.filter((l) => l.quotation_id === q.id),
          };
        });
        return { rows, rowCount: rows.length };
      }
      if (text.includes('SELECT COUNT(*)::int AS count FROM quotations')) {
        return { rows: [{ count: quotations.length }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO quotations')) {
        const newQ = {
          id: `qt-${quotations.length + 1}`,
          quotation_number: params[0],
          customer_id: params[1],
          plan_id: params[2],
          status: 'draft',
          issue_date: params[3] || new Date().toISOString().slice(0, 10),
          expiry_date: params[4] || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
          currency: params[5] || 'INR',
          subtotal_cents: params[6],
          discount_cents: params[7],
          tax_cents: params[8],
          grand_total_cents: params[9],
          applied_discount_rule_id: params[10],
          applied_tax_rule_id: params[11],
          snapshot_breakdown: JSON.parse(params[12] || '{}'),
          created_by: params[13],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        quotations.push(newQ);
        return { rows: [newQ], rowCount: 1 };
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
          created_at: new Date().toISOString(),
        };
        quotationLines.push(newLine);
        return { rows: [newLine], rowCount: 1 };
      }
      if (text.includes('UPDATE quotations SET status = $1 WHERE id = $2')) {
        const q = quotations.find((item) => item.id === params[1]);
        if (q) q.status = params[0];
        return { rows: q ? [q] : [], rowCount: q ? 1 : 0 };
      }

      // 5. Subscriptions
      if (text.includes('FROM subscriptions s') && text.includes('JOIN customers c') && text.includes('JOIN plans p')) {
        const rows = subscriptions.filter((s) => s.status === 'active').map((s) => {
          const cust = customers.find((c) => c.id === s.customer_id) || {};
          const plan = plans.find((p) => p.id === s.plan_id) || {};
          return {
            ...s,
            customer_name: cust.name,
            customer_email: cust.email,
            tax_identifier: cust.tax_identifier,
            billing_address: cust.billing_address,
            plan_name: plan.name,
            plan_interval: plan.interval,
            plan_interval_count: plan.interval_count,
            lines: subscriptionLines.filter((l) => l.subscription_id === s.id),
          };
        });
        return { rows, rowCount: rows.length };
      }
      if (text.includes('FROM subscriptions s')) {
        const rows = subscriptions.map((s) => {
          const cust = customers.find((c) => c.id === s.customer_id) || {};
          const plan = plans.find((p) => p.id === s.plan_id) || {};
          return {
            ...s,
            customer_name: cust.name,
            customer_email: cust.email,
            plan_name: plan.name,
            lines: subscriptionLines.filter((l) => l.subscription_id === s.id),
          };
        });
        return { rows, rowCount: rows.length };
      }
      if (text.includes('SELECT COUNT(*)::int AS count FROM subscriptions')) {
        return { rows: [{ count: subscriptions.length }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO subscriptions')) {
        const newSub = {
          id: `sub-${subscriptions.length + 1}`,
          subscription_number: params[0],
          quotation_id: params[1],
          customer_id: params[2],
          plan_id: params[3],
          status: 'confirmed',
          starts_at: params[4],
          expires_at: params[5],
          next_billing_at: params[6],
          payment_terms_days: params[7],
          currency: params[8] || 'INR',
          subtotal_cents: params[9],
          discount_cents: params[10],
          tax_cents: params[11],
          grand_total_cents: params[12],
          balance_due_cents: params[13],
          applied_discount_rule_id: params[14],
          applied_tax_rule_id: params[15],
          snapshot_breakdown: JSON.parse(params[16] || '{}'),
          created_by: params[17],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        subscriptions.push(newSub);
        return { rows: [newSub], rowCount: 1 };
      }
      if (text.includes('INSERT INTO subscription_lines')) {
        const newLine = {
          id: `sl-${subscriptionLines.length + 1}`,
          subscription_id: params[0],
          product_id: params[1],
          variant_id: params[2],
          description: params[3],
          quantity: params[4],
          unit_price_cents: params[5],
          variant_adjustment_cents: params[6],
          line_subtotal_cents: params[7],
          created_at: new Date().toISOString(),
        };
        subscriptionLines.push(newLine);
        return { rows: [newLine], rowCount: 1 };
      }
      if (text.includes('UPDATE subscriptions') && text.includes('next_billing_at')) {
        const sub = subscriptions.find((s) => s.id === params[1]);
        if (sub) sub.next_billing_at = params[0];
        return { rowCount: 1 };
      }

      // 6. Invoices & Billing
      if (text.includes('FROM invoices i')) {
        const rows = invoices.map((inv) => {
          const cust = customers.find((c) => c.id === inv.customer_id) || {};
          const sub = subscriptions.find((s) => s.id === inv.subscription_id) || {};
          return {
            ...inv,
            customer_name: cust.name,
            customer_email: cust.email,
            customer_tax_identifier: cust.tax_identifier,
            customer_billing_address: cust.billing_address,
            user_id: cust.user_id,
            subscription_number: sub.subscription_number,
            lines: invoiceLines.filter((l) => l.invoice_id === inv.id),
            notifications: [],
          };
        });
        if (text.includes('WHERE i.id = $1')) {
          const match = rows.find((r) => r.id === params[0]);
          return { rows: match ? [match] : [], rowCount: match ? 1 : 0 };
        }
        return { rows, rowCount: rows.length };
      }
      if (text.includes('SELECT * FROM invoices WHERE id = $1')) {
        const inv = invoices.find((i) => i.id === params[0]);
        return { rows: inv ? [inv] : [], rowCount: inv ? 1 : 0 };
      }
      if (text.includes('SELECT COUNT(*)::int AS count FROM invoices')) {
        return { rows: [{ count: invoices.length }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO invoices')) {
        const newInv = {
          id: `inv-${invoices.length + 1}`,
          invoice_number: params[0],
          customer_id: params[1],
          subscription_id: params[2],
          billing_occurrence_id: params[3],
          status: 'confirmed',
          issue_date: params[4] || new Date().toISOString().slice(0, 10),
          due_date: params[5],
          currency: params[6] || 'INR',
          subtotal_cents: params[7],
          discount_cents: params[8],
          tax_cents: params[9],
          grand_total_cents: params[10],
          balance_due_cents: params[11],
          payment_terms_days: params[12],
          snapshot_breakdown: JSON.parse(params[13] || '{}'),
          created_by: params[14],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        invoices.push(newInv);
        return { rows: [newInv], rowCount: 1 };
      }
      if (text.includes('INSERT INTO invoice_lines')) {
        const newLine = {
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
        invoiceLines.push(newLine);
        return { rows: [newLine], rowCount: 1 };
      }
      if (text.includes('UPDATE invoices') && text.includes('balance_due_cents = $1')) {
        const inv = invoices.find((i) => i.id === params[2]);
        if (inv) {
          inv.balance_due_cents = params[0];
          inv.status = params[1];
        }
        return { rows: inv ? [inv] : [], rowCount: 1 };
      }
      if (text.includes('UPDATE invoices SET status = $1 WHERE id = $2')) {
        const inv = invoices.find((i) => i.id === params[1]);
        if (inv) inv.status = params[0];
        return { rows: inv ? [inv] : [], rowCount: 1 };
      }
      if (text.includes('FROM billing_runs')) {
        return { rows: billingRuns, rowCount: billingRuns.length };
      }
      if (text.includes('FROM billing_occurrences WHERE idempotency_key = $1')) {
        const occ = billingOccurrences.find((o) => o.idempotency_key === params[0]);
        return { rows: occ ? [occ] : [], rowCount: occ ? 1 : 0 };
      }
      if (text.includes('FROM billing_occurrences')) {
        return { rows: billingOccurrences, rowCount: billingOccurrences.length };
      }
      if (text.includes('INSERT INTO billing_runs')) {
        const run = {
          id: `br-${billingRuns.length + 1}`,
          run_number: params[0],
          target_date: params[1],
          status: params[2] || 'completed',
          created_by: params[3] || null,
          total_subscriptions: 0,
          successful_count: 0,
          failed_count: 0,
          created_at: new Date().toISOString(),
        };
        billingRuns.push(run);
        return { rows: [run], rowCount: 1 };
      }
      if (text.includes('UPDATE billing_runs')) {
        return { rowCount: 1 };
      }
      if (text.includes('INSERT INTO billing_occurrences')) {
        const occ = {
          id: `bo-${billingOccurrences.length + 1}`,
          subscription_id: params[0],
          billing_run_id: params[1],
          idempotency_key: params[2],
          period_start: params[3],
          period_end: params[4],
          status: 'pending',
          retry_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        billingOccurrences.push(occ);
        return { rows: [occ], rowCount: 1 };
      }
      if (text.includes('UPDATE billing_occurrences')) {
        return { rowCount: 1 };
      }
      if (text.includes('INSERT INTO email_notifications')) {
        return { rowCount: 1 };
      }

      // 7. Payments & Allocations
      if (text.includes('FROM payments p')) {
        const rows = payments.map((p) => {
          const cust = customers.find((c) => c.id === p.customer_id) || {};
          const inv = invoices.find((i) => i.id === p.invoice_id) || {};
          return {
            ...p,
            customer_name: cust.name,
            customer_email: cust.email,
            user_id: cust.user_id,
            invoice_number: inv.invoice_number,
            allocations: paymentAllocations.filter((a) => a.payment_id === p.id),
          };
        });
        return { rows, rowCount: rows.length };
      }
      if (text.includes('SELECT COUNT(*)::int AS count FROM payments')) {
        return { rows: [{ count: payments.length }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO payments')) {
        const newPay = {
          id: `pay-${payments.length + 1}`,
          payment_number: params[0],
          customer_id: params[1],
          invoice_id: params[2],
          method: params[3],
          amount_cents: params[4],
          currency: params[5] || 'INR',
          received_date: params[6],
          external_reference: params[7],
          notes: params[8],
          created_by: params[9],
          created_at: new Date().toISOString(),
        };
        payments.push(newPay);
        return { rows: [newPay], rowCount: 1 };
      }
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
      if (text.includes('UPDATE subscriptions') && text.includes('balance_due_cents = GREATEST')) {
        const sub = subscriptions.find((s) => s.id === params[1]);
        if (sub) {
          sub.balance_due_cents = Math.max(0, sub.balance_due_cents - params[0]);
        }
        return { rowCount: 1 };
      }

      // 8. Reports & Summary Dashboard
      if (text.includes('SELECT') && text.includes('active_subscriptions_count')) {
        const totalInvoiced = invoices.filter((i) => i.status !== 'cancelled').reduce((sum, i) => sum + i.grand_total_cents, 0);
        const totalCollected = payments.reduce((sum, p) => sum + p.amount_cents, 0);
        const totalOutstanding = invoices.filter((i) => i.status !== 'cancelled').reduce((sum, i) => sum + i.balance_due_cents, 0);
        const activeSubs = subscriptions.filter((s) => s.status === 'active' || s.status === 'confirmed');
        const activeVal = activeSubs.reduce((sum, s) => sum + s.grand_total_cents, 0);

        return {
          rows: [
            {
              active_subscriptions_count: activeSubs.length,
              active_subscriptions_value_cents: activeVal,
              total_invoiced_cents: totalInvoiced,
              revenue_collected_cents: totalCollected,
              outstanding_balance_cents: totalOutstanding,
              unpaid_invoices_count: invoices.filter((i) => i.balance_due_cents > 0).length,
              overdue_invoices_count: 0,
              overdue_amount_cents: 0,
              payments_count: payments.length,
            },
          ],
          rowCount: 1,
        };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

module.exports = { createMemoryPool };
