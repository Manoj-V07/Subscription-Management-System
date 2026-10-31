require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const permissions = [
  ['dashboard.read', 'View dashboards'],
  ['customers.read', 'View customers'],
  ['customers.manage', 'Manage customers'],
  ['catalog.manage', 'Manage catalogue configuration'],
  ['quotes.manage', 'Manage quotations and sales templates'],
  ['subscriptions.manage', 'Manage subscriptions and lifecycle'],
  ['billing.read', 'View billing records'],
  ['billing.manage', 'Manage billing records'],
  ['payments.read', 'View payment records'],
  ['payments.manage', 'Record and allocate payments'],
  ['staff.manage', 'Manage internal staff'],
  ['reports.read', 'View reports'],
  ['portal.read', 'View customer portal'],
];

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://brightloop:brightloop@localhost:5432/brightloop' });
  await client.connect();
  try {
    await client.query('BEGIN');

    // 1. Permissions
    for (const [key, description] of permissions) {
      await client.query(
        'INSERT INTO permissions (key, description) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description',
        [key, description],
      );
    }

    // 2. Roles & Role-Permissions
    const rolePermissions = {
      admin: permissions.map(([key]) => key),
      staff: [
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
      ],
      customer: ['portal.read'],
    };

    for (const roleName of Object.keys(rolePermissions)) {
      await client.query('INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [roleName]);
      for (const permission of rolePermissions[roleName]) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
           WHERE r.name = $1 AND p.key = $2 ON CONFLICT DO NOTHING`,
          [roleName, permission],
        );
      }
    }

    // 3. Users
    const adminHash = await bcrypt.hash('Admin@12345', 12);
    const staffHash = await bcrypt.hash('Staff@12345', 12);
    const customerHash = await bcrypt.hash('Customer@12345', 12);

    const userDefinitions = [
      { email: 'admin@brightloop.example', hash: adminHash, name: 'Brightloop Administrator', role: 'admin' },
      { email: 'staff@brightloop.example', hash: staffHash, name: 'Sales & Billing Staff', role: 'staff' },
      { email: 'billing@acme.example', hash: customerHash, name: 'Acme Software AP', role: 'customer' },
      { email: 'accounts@vertex.example', hash: customerHash, name: 'Vertex Systems Finance', role: 'customer' },
      { email: 'finance@nexusai.example', hash: customerHash, name: 'Nexus AI Billing', role: 'customer' },
      { email: 'operations@zenith.example', hash: customerHash, name: 'Zenith Retail Procurement', role: 'customer' },
    ];

    const userMap = {};
    for (const u of userDefinitions) {
      const uRes = await client.query(
        `INSERT INTO users (email, password_hash, display_name, role_id, email_verified_at)
         SELECT $1, $2, $3, id, NOW()
         FROM roles WHERE name = $4
         ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
         RETURNING id`,
        [u.email, u.hash, u.name, u.role],
      );
      userMap[u.email] = uRes.rows[0].id;
    }

    // 4. Tax Rules
    let taxRes = await client.query("SELECT id FROM tax_rules WHERE name = 'GST 18%'");
    if (!taxRes.rowCount) {
      taxRes = await client.query(
        `INSERT INTO tax_rules (name, rate_percentage, jurisdiction)
         VALUES ('GST 18%', 18.00, 'IN')
         RETURNING id`,
      );
    }
    const gstTaxRuleId = taxRes.rows[0].id;

    let zeroTaxRes = await client.query("SELECT id FROM tax_rules WHERE name = 'Zero-Rated Export (0%)'");
    if (!zeroTaxRes.rowCount) {
      zeroTaxRes = await client.query(
        `INSERT INTO tax_rules (name, rate_percentage, jurisdiction)
         VALUES ('Zero-Rated Export (0%)', 0.00, 'EX')
         RETURNING id`,
      );
    }
    const exportTaxRuleId = zeroTaxRes.rows[0].id;

    // 5. Discount Rules
    let discRes = await client.query("SELECT id FROM discount_rules WHERE code = 'LAUNCH10'");
    if (!discRes.rowCount) {
      discRes = await client.query(
        `INSERT INTO discount_rules (name, code, type, value, min_threshold_cents, scope, times_used)
         VALUES ('Launch Offer 10%', 'LAUNCH10', 'percentage', 10.00, 100000, 'entire_order', 3)
         RETURNING id`,
      );
    }
    const launchDiscRuleId = discRes.rows[0].id;

    let entDiscRes = await client.query("SELECT id FROM discount_rules WHERE code = 'ENT500'");
    if (!entDiscRes.rowCount) {
      entDiscRes = await client.query(
        `INSERT INTO discount_rules (name, code, type, value, min_threshold_cents, scope, times_used)
         VALUES ('Enterprise Tier ₹500 Off', 'ENT500', 'fixed', 50000, 500000, 'entire_order', 1)
         RETURNING id`,
      );
    }
    const entDiscRuleId = entDiscRes.rows[0].id;

    // 6. Products & Variants
    const productData = [
      { name: 'Brightloop Platform Core', type: 'service', sales: 250000, cost: 50000, notes: 'Core SaaS platform subscription tier' },
      { name: 'Developer API Gateway', type: 'service', sales: 100000, cost: 20000, notes: 'High-throughput API quota pack' },
      { name: 'Enterprise Compliance Vault', type: 'service', sales: 150000, cost: 30000, notes: 'Immutable audit logs and tamper-proof storage' },
      { name: 'Dedicated Multi-Tenant Cloud', type: 'service', sales: 500000, cost: 120000, notes: 'Dedicated cluster with isolated compute and storage' },
    ];

    const prodMap = {};
    for (const p of productData) {
      let pRes = await client.query('SELECT id FROM products WHERE name = $1', [p.name]);
      if (!pRes.rowCount) {
        pRes = await client.query(
          `INSERT INTO products (name, product_type, sales_price_cents, cost_price_cents, currency, notes)
           VALUES ($1, $2, $3, $4, 'INR', $5)
           RETURNING id`,
          [p.name, p.type, p.sales, p.cost, p.notes],
        );
      }
      prodMap[p.name] = pRes.rows[0].id;
    }

    // Product Variants
    await client.query(
      `INSERT INTO product_variants (product_id, label, adjustment_type, adjustment_value)
       VALUES
         ($1, 'Enterprise 99.99% SLA', 'fixed', 50000),
         ($1, 'Priority 24/7 Phone Support', 'percentage', 15.00),
         ($2, 'Burst Capacity (10x concurrency)', 'fixed', 35000),
         ($3, '7-Year Archival Guarantee', 'fixed', 40000)
       ON CONFLICT (product_id, label) DO NOTHING`,
      [prodMap['Brightloop Platform Core'], prodMap['Developer API Gateway'], prodMap['Enterprise Compliance Vault']],
    );

    // 7. Plans
    const planData = [
      { name: 'Monthly Professional', code: 'PLAN-M-PRO', interval: 'monthly', count: 1, min: 1, terms: 15 },
      { name: 'Yearly Enterprise', code: 'PLAN-Y-ENT', interval: 'yearly', count: 1, min: 2, terms: 30 },
      { name: 'Quarterly Growth', code: 'PLAN-Q-GROWTH', interval: 'monthly', count: 3, min: 1, terms: 20 },
    ];

    const planMap = {};
    for (const pl of planData) {
      let plRes = await client.query('SELECT id FROM plans WHERE code = $1', [pl.code]);
      if (!plRes.rowCount) {
        plRes = await client.query(
          `INSERT INTO plans (name, code, interval, interval_count, min_quantity, auto_renew)
           VALUES ($1, $2, $3, $4, $5, true)
           RETURNING id`,
          [pl.name, pl.code, pl.interval, pl.count, pl.min],
        );
      }
      planMap[pl.code] = plRes.rows[0].id;
    }

    // 8. Customers
    const customerData = [
      {
        name: 'Acme Software Ltd',
        email: 'billing@acme.example',
        phone: '+91 98765 43210',
        tax: 'GSTIN29AABCU9603R1ZM',
        user: userMap['billing@acme.example'],
        addr: { street: '100 Tech Park, 4th Floor', city: 'Bengaluru', state: 'Karnataka', country: 'IN', postal_code: '560001' },
      },
      {
        name: 'Vertex Systems Corp',
        email: 'accounts@vertex.example',
        phone: '+91 91234 56789',
        tax: 'GSTIN27AAACB2222Z1ZA',
        user: userMap['accounts@vertex.example'],
        addr: { street: '42 Cyber City, Magarpatta', city: 'Pune', state: 'Maharashtra', country: 'IN', postal_code: '411001' },
      },
      {
        name: 'Nexus AI Technologies',
        email: 'finance@nexusai.example',
        phone: '+91 98111 22334',
        tax: 'GSTIN36AABCN8899K1ZT',
        user: userMap['finance@nexusai.example'],
        addr: { street: '88 Innovation Boulevard, HITEC City', city: 'Hyderabad', state: 'Telangana', country: 'IN', postal_code: '500081' },
      },
      {
        name: 'Zenith Retail Global',
        email: 'operations@zenith.example',
        phone: '+91 99440 11223',
        tax: 'GSTIN27AAACZ4455L1Z2',
        user: userMap['operations@zenith.example'],
        addr: { street: '12 Harbor View Road, Nariman Point', city: 'Mumbai', state: 'Maharashtra', country: 'IN', postal_code: '400001' },
      },
    ];

    const custMap = {};
    for (const c of customerData) {
      let cRes = await client.query('SELECT id FROM customers WHERE email = $1', [c.email]);
      if (!cRes.rowCount) {
        cRes = await client.query(
          `INSERT INTO customers (name, email, phone, billing_address, tax_identifier, user_id, status)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'active')
           RETURNING id`,
          [c.name, c.email, c.phone, JSON.stringify(c.addr), c.tax, c.user],
        );
      } else {
        await client.query('UPDATE customers SET user_id = $1, tax_identifier = $2 WHERE id = $3', [c.user, c.tax, cRes.rows[0].id]);
      }
      custMap[c.email] = cRes.rows[0].id;
    }

    // 9. Quotations & Subscriptions
    // Customer 1: Acme Software
    let q1 = await client.query("SELECT id FROM quotations WHERE quotation_number = 'QT-2026-000101'");
    let q1Id = q1.rows[0]?.id;
    if (!q1Id) {
      const ins = await client.query(
        `INSERT INTO quotations (quotation_number, customer_id, plan_id, status, issue_date, expiry_date, subtotal_cents, discount_cents, tax_cents, grand_total_cents, snapshot_breakdown, created_by)
         VALUES ('QT-2026-000101', $1, $2, 'converted', '2026-10-01', '2026-10-31', 250000, 25000, 40500, 265500, '{"subtotal_cents":250000,"discount_cents":25000,"tax_cents":40500,"grand_total_cents":265500}'::jsonb, $3)
         RETURNING id`,
        [custMap['billing@acme.example'], planMap['PLAN-M-PRO'], userMap['admin@brightloop.example']],
      );
      q1Id = ins.rows[0].id;
      await client.query(
        `INSERT INTO quotation_lines (quotation_id, product_id, description, quantity, unit_price_cents, line_subtotal_cents)
         VALUES ($1, $2, 'Brightloop Platform Core', 1, 250000, 250000)`,
        [q1Id, prodMap['Brightloop Platform Core']],
      );
    }

    let sub1 = await client.query("SELECT id FROM subscriptions WHERE subscription_number = 'SUB-2026-000101'");
    let sub1Id = sub1.rows[0]?.id;
    if (!sub1Id) {
      const ins = await client.query(
        `INSERT INTO subscriptions (subscription_number, quotation_id, customer_id, plan_id, status, starts_at, next_billing_at, payment_terms_days, subtotal_cents, discount_cents, tax_cents, grand_total_cents, balance_due_cents, snapshot_breakdown, created_by)
         VALUES ('SUB-2026-000101', $1, $2, $3, 'active', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', 15, 250000, 25000, 40500, 265500, 165500, '{"subtotal_cents":250000,"discount_cents":25000,"tax_cents":40500,"grand_total_cents":265500}'::jsonb, $4)
         RETURNING id`,
        [q1Id, custMap['billing@acme.example'], planMap['PLAN-M-PRO'], userMap['admin@brightloop.example']],
      );
      sub1Id = ins.rows[0].id;
      await client.query(
        `INSERT INTO subscription_lines (subscription_id, product_id, description, quantity, unit_price_cents, line_subtotal_cents)
         VALUES ($1, $2, 'Brightloop Platform Core', 1, 250000, 250000)`,
        [sub1Id, prodMap['Brightloop Platform Core']],
      );
    }

    // Customer 2: Vertex Systems
    let q2 = await client.query("SELECT id FROM quotations WHERE quotation_number = 'QT-2026-000102'");
    let q2Id = q2.rows[0]?.id;
    if (!q2Id) {
      const ins = await client.query(
        `INSERT INTO quotations (quotation_number, customer_id, plan_id, status, issue_date, expiry_date, subtotal_cents, discount_cents, tax_cents, grand_total_cents, snapshot_breakdown, created_by)
         VALUES ('QT-2026-000102', $1, $2, 'converted', '2026-09-01', '2026-10-01', 1000000, 50000, 171000, 1250000, '{"subtotal_cents":1000000,"discount_cents":50000,"tax_cents":171000,"grand_total_cents":1250000}'::jsonb, $3)
         RETURNING id`,
        [custMap['accounts@vertex.example'], planMap['PLAN-Y-ENT'], userMap['admin@brightloop.example']],
      );
      q2Id = ins.rows[0].id;
      await client.query(
        `INSERT INTO quotation_lines (quotation_id, product_id, description, quantity, unit_price_cents, line_subtotal_cents)
         VALUES ($1, $2, 'Dedicated Multi-Tenant Cloud (2 Nodes)', 2, 500000, 1000000)`,
        [q2Id, prodMap['Dedicated Multi-Tenant Cloud']],
      );
    }

    let sub2 = await client.query("SELECT id FROM subscriptions WHERE subscription_number = 'SUB-2026-000102'");
    let sub2Id = sub2.rows[0]?.id;
    if (!sub2Id) {
      const ins = await client.query(
        `INSERT INTO subscriptions (subscription_number, quotation_id, customer_id, plan_id, status, starts_at, next_billing_at, payment_terms_days, subtotal_cents, discount_cents, tax_cents, grand_total_cents, balance_due_cents, snapshot_breakdown, created_by)
         VALUES ('SUB-2026-000102', $1, $2, $3, 'active', '2026-09-01T00:00:00Z', '2027-09-01T00:00:00Z', 30, 1000000, 50000, 171000, 1250000, 0, '{"subtotal_cents":1000000,"discount_cents":50000,"tax_cents":171000,"grand_total_cents":1250000}'::jsonb, $4)
         RETURNING id`,
        [q2Id, custMap['accounts@vertex.example'], planMap['PLAN-Y-ENT'], userMap['admin@brightloop.example']],
      );
      sub2Id = ins.rows[0].id;
      await client.query(
        `INSERT INTO subscription_lines (subscription_id, product_id, description, quantity, unit_price_cents, line_subtotal_cents)
         VALUES ($1, $2, 'Dedicated Multi-Tenant Cloud (2 Nodes)', 2, 500000, 1000000)`,
        [sub2Id, prodMap['Dedicated Multi-Tenant Cloud']],
      );
    }

    // Customer 3: Nexus AI
    let q3 = await client.query("SELECT id FROM quotations WHERE quotation_number = 'QT-2026-000103'");
    let q3Id = q3.rows[0]?.id;
    if (!q3Id) {
      const ins = await client.query(
        `INSERT INTO quotations (quotation_number, customer_id, plan_id, status, issue_date, expiry_date, subtotal_cents, discount_cents, tax_cents, grand_total_cents, snapshot_breakdown, created_by)
         VALUES ('QT-2026-000103', $1, $2, 'converted', '2026-08-15', '2026-09-15', 350000, 0, 63000, 413000, '{"subtotal_cents":350000,"discount_cents":0,"tax_cents":63000,"grand_total_cents":413000}'::jsonb, $3)
         RETURNING id`,
        [custMap['finance@nexusai.example'], planMap['PLAN-Q-GROWTH'], userMap['admin@brightloop.example']],
      );
      q3Id = ins.rows[0].id;
      await client.query(
        `INSERT INTO quotation_lines (quotation_id, product_id, description, quantity, unit_price_cents, line_subtotal_cents)
         VALUES ($1, $2, 'Developer API Gateway + Burst Capacity', 3, 100000, 350000)`,
        [q3Id, prodMap['Developer API Gateway']],
      );
    }

    let sub3 = await client.query("SELECT id FROM subscriptions WHERE subscription_number = 'SUB-2026-000103'");
    let sub3Id = sub3.rows[0]?.id;
    if (!sub3Id) {
      const ins = await client.query(
        `INSERT INTO subscriptions (subscription_number, quotation_id, customer_id, plan_id, status, starts_at, next_billing_at, payment_terms_days, subtotal_cents, discount_cents, tax_cents, grand_total_cents, balance_due_cents, snapshot_breakdown, created_by)
         VALUES ('SUB-2026-000103', $1, $2, $3, 'paused', '2026-08-15T00:00:00Z', '2026-11-15T00:00:00Z', 20, 350000, 0, 63000, 413000, 213000, '{"subtotal_cents":350000,"discount_cents":0,"tax_cents":63000,"grand_total_cents":413000}'::jsonb, $4)
         RETURNING id`,
        [q3Id, custMap['finance@nexusai.example'], planMap['PLAN-Q-GROWTH'], userMap['admin@brightloop.example']],
      );
      sub3Id = ins.rows[0].id;
      await client.query(
        `INSERT INTO subscription_lines (subscription_id, product_id, description, quantity, unit_price_cents, line_subtotal_cents)
         VALUES ($1, $2, 'Developer API Gateway + Burst Capacity', 3, 100000, 350000)`,
        [sub3Id, prodMap['Developer API Gateway']],
      );
    }

    // Customer 4: Zenith Retail Global
    let q4 = await client.query("SELECT id FROM quotations WHERE quotation_number = 'QT-2026-000104'");
    let q4Id = q4.rows[0]?.id;
    if (!q4Id) {
      const ins = await client.query(
        `INSERT INTO quotations (quotation_number, customer_id, plan_id, status, issue_date, expiry_date, subtotal_cents, discount_cents, tax_cents, grand_total_cents, snapshot_breakdown, created_by)
         VALUES ('QT-2026-000104', $1, $2, 'converted', '2026-10-20', '2026-11-20', 300000, 0, 54000, 354000, '{"subtotal_cents":300000,"discount_cents":0,"tax_cents":54000,"grand_total_cents":354000}'::jsonb, $3)
         RETURNING id`,
        [custMap['operations@zenith.example'], planMap['PLAN-M-PRO'], userMap['admin@brightloop.example']],
      );
      q4Id = ins.rows[0].id;
      await client.query(
        `INSERT INTO quotation_lines (quotation_id, product_id, description, quantity, unit_price_cents, line_subtotal_cents)
         VALUES ($1, $2, 'Enterprise Compliance Vault (2 Years)', 2, 150000, 300000)`,
        [q4Id, prodMap['Enterprise Compliance Vault']],
      );
    }

    let sub4 = await client.query("SELECT id FROM subscriptions WHERE subscription_number = 'SUB-2026-000104'");
    let sub4Id = sub4.rows[0]?.id;
    if (!sub4Id) {
      const ins = await client.query(
        `INSERT INTO subscriptions (subscription_number, quotation_id, customer_id, plan_id, status, starts_at, next_billing_at, payment_terms_days, subtotal_cents, discount_cents, tax_cents, grand_total_cents, balance_due_cents, snapshot_breakdown, created_by)
         VALUES ('SUB-2026-000104', $1, $2, $3, 'active', '2026-10-20T00:00:00Z', '2026-11-20T00:00:00Z', 15, 300000, 0, 54000, 354000, 354000, '{"subtotal_cents":300000,"discount_cents":0,"tax_cents":54000,"grand_total_cents":354000}'::jsonb, $4)
         RETURNING id`,
        [q4Id, custMap['operations@zenith.example'], planMap['PLAN-M-PRO'], userMap['admin@brightloop.example']],
      );
      sub4Id = ins.rows[0].id;
      await client.query(
        `INSERT INTO subscription_lines (subscription_id, product_id, description, quantity, unit_price_cents, line_subtotal_cents)
         VALUES ($1, $2, 'Enterprise Compliance Vault (2 Years)', 2, 150000, 300000)`,
        [sub4Id, prodMap['Enterprise Compliance Vault']],
      );
    }

    // 10. Billing Runs
    let br1 = await client.query("SELECT id FROM billing_runs WHERE run_number = 'RUN-2026-000001'");
    let br1Id = br1.rows[0]?.id;
    if (!br1Id) {
      const ins = await client.query(
        `INSERT INTO billing_runs (run_number, target_date, status, total_subscriptions, successful_count, failed_count, created_by, created_at, completed_at)
         VALUES ('RUN-2026-000001', '2026-10-01T00:00:00Z', 'completed', 2, 2, 0, $1, '2026-10-01T00:05:00Z', '2026-10-01T00:05:03Z')
         RETURNING id`,
        [userMap['admin@brightloop.example']],
      );
      br1Id = ins.rows[0].id;
    }

    let br2 = await client.query("SELECT id FROM billing_runs WHERE run_number = 'RUN-2026-000002'");
    let br2Id = br2.rows[0]?.id;
    if (!br2Id) {
      const ins = await client.query(
        `INSERT INTO billing_runs (run_number, target_date, status, total_subscriptions, successful_count, failed_count, created_by, created_at, completed_at)
         VALUES ('RUN-2026-000002', '2026-10-20T00:00:00Z', 'completed', 2, 2, 0, $1, '2026-10-20T00:05:00Z', '2026-10-20T00:05:02Z')
         RETURNING id`,
        [userMap['admin@brightloop.example']],
      );
      br2Id = ins.rows[0].id;
    }

    // 11. Invoices & Billing Occurrences
    // Invoice 1: Acme
    let inv1 = await client.query("SELECT id FROM invoices WHERE invoice_number = 'INV-2026-000101'");
    let inv1Id = inv1.rows[0]?.id;
    if (!inv1Id) {
      const ins = await client.query(
        `INSERT INTO invoices (invoice_number, customer_id, subscription_id, status, issue_date, due_date, subtotal_cents, discount_cents, tax_cents, grand_total_cents, balance_due_cents, payment_terms_days, snapshot_breakdown, created_by)
         VALUES ('INV-2026-000101', $1, $2, 'partially_paid', '2026-10-01', '2026-10-16', 250000, 25000, 40500, 265500, 165500, 15, '{"subtotal_cents":250000,"discount_cents":25000,"tax_cents":40500,"grand_total_cents":265500}'::jsonb, $3)
         RETURNING id`,
        [custMap['billing@acme.example'], sub1Id, userMap['admin@brightloop.example']],
      );
      inv1Id = ins.rows[0].id;
      await client.query(
        `INSERT INTO invoice_lines (invoice_id, product_id, description, quantity, unit_price_cents, line_subtotal_cents)
         VALUES ($1, $2, 'Brightloop Platform Core', 1, 250000, 250000)`,
        [inv1Id, prodMap['Brightloop Platform Core']],
      );
      await client.query(
        `INSERT INTO billing_occurrences (subscription_id, billing_run_id, idempotency_key, period_start, period_end, status, invoice_id)
         VALUES ($1, $2, 'sub_demo_1_20261001_20261101', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', 'succeeded', $3)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [sub1Id, br1Id, inv1Id],
      );
    }

    // Invoice 2: Vertex
    let inv2 = await client.query("SELECT id FROM invoices WHERE invoice_number = 'INV-2026-000102'");
    let inv2Id = inv2.rows[0]?.id;
    if (!inv2Id) {
      const ins = await client.query(
        `INSERT INTO invoices (invoice_number, customer_id, subscription_id, status, issue_date, due_date, subtotal_cents, discount_cents, tax_cents, grand_total_cents, balance_due_cents, payment_terms_days, snapshot_breakdown, created_by)
         VALUES ('INV-2026-000102', $1, $2, 'paid', '2026-09-01', '2026-10-01', 1000000, 50000, 171000, 1250000, 0, 30, '{"subtotal_cents":1000000,"discount_cents":50000,"tax_cents":171000,"grand_total_cents":1250000}'::jsonb, $3)
         RETURNING id`,
        [custMap['accounts@vertex.example'], sub2Id, userMap['admin@brightloop.example']],
      );
      inv2Id = ins.rows[0].id;
      await client.query(
        `INSERT INTO invoice_lines (invoice_id, product_id, description, quantity, unit_price_cents, line_subtotal_cents)
         VALUES ($1, $2, 'Dedicated Multi-Tenant Cloud (2 Nodes)', 2, 500000, 1000000)`,
        [inv2Id, prodMap['Dedicated Multi-Tenant Cloud']],
      );
      await client.query(
        `INSERT INTO billing_occurrences (subscription_id, billing_run_id, idempotency_key, period_start, period_end, status, invoice_id)
         VALUES ($1, $2, 'sub_demo_2_20260901_20270901', '2026-09-01T00:00:00Z', '2027-09-01T00:00:00Z', 'succeeded', $3)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [sub2Id, br1Id, inv2Id],
      );
    }

    // Invoice 3: Nexus AI
    let inv3 = await client.query("SELECT id FROM invoices WHERE invoice_number = 'INV-2026-000103'");
    let inv3Id = inv3.rows[0]?.id;
    if (!inv3Id) {
      const ins = await client.query(
        `INSERT INTO invoices (invoice_number, customer_id, subscription_id, status, issue_date, due_date, subtotal_cents, discount_cents, tax_cents, grand_total_cents, balance_due_cents, payment_terms_days, snapshot_breakdown, created_by)
         VALUES ('INV-2026-000103', $1, $2, 'overdue', '2026-08-15', '2026-09-05', 350000, 0, 63000, 413000, 213000, 20, '{"subtotal_cents":350000,"discount_cents":0,"tax_cents":63000,"grand_total_cents":413000}'::jsonb, $3)
         RETURNING id`,
        [custMap['finance@nexusai.example'], sub3Id, userMap['admin@brightloop.example']],
      );
      inv3Id = ins.rows[0].id;
      await client.query(
        `INSERT INTO invoice_lines (invoice_id, product_id, description, quantity, unit_price_cents, line_subtotal_cents)
         VALUES ($1, $2, 'Developer API Gateway + Burst Capacity', 3, 100000, 350000)`,
        [inv3Id, prodMap['Developer API Gateway']],
      );
      await client.query(
        `INSERT INTO billing_occurrences (subscription_id, billing_run_id, idempotency_key, period_start, period_end, status, invoice_id)
         VALUES ($1, $2, 'sub_demo_3_20260815_20261115', '2026-08-15T00:00:00Z', '2026-11-15T00:00:00Z', 'succeeded', $3)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [sub3Id, br1Id, inv3Id],
      );
    }

    // Invoice 4: Zenith Retail Global
    let inv4 = await client.query("SELECT id FROM invoices WHERE invoice_number = 'INV-2026-000104'");
    let inv4Id = inv4.rows[0]?.id;
    if (!inv4Id) {
      const ins = await client.query(
        `INSERT INTO invoices (invoice_number, customer_id, subscription_id, status, issue_date, due_date, subtotal_cents, discount_cents, tax_cents, grand_total_cents, balance_due_cents, payment_terms_days, snapshot_breakdown, created_by)
         VALUES ('INV-2026-000104', $1, $2, 'confirmed', '2026-10-20', '2026-11-04', 300000, 0, 54000, 354000, 354000, 15, '{"subtotal_cents":300000,"discount_cents":0,"tax_cents":54000,"grand_total_cents":354000}'::jsonb, $3)
         RETURNING id`,
        [custMap['operations@zenith.example'], sub4Id, userMap['admin@brightloop.example']],
      );
      inv4Id = ins.rows[0].id;
      await client.query(
        `INSERT INTO invoice_lines (invoice_id, product_id, description, quantity, unit_price_cents, line_subtotal_cents)
         VALUES ($1, $2, 'Enterprise Compliance Vault (2 Years)', 2, 150000, 300000)`,
        [inv4Id, prodMap['Enterprise Compliance Vault']],
      );
      await client.query(
        `INSERT INTO billing_occurrences (subscription_id, billing_run_id, idempotency_key, period_start, period_end, status, invoice_id)
         VALUES ($1, $2, 'sub_demo_4_20261020_20261120', '2026-10-20T00:00:00Z', '2026-11-20T00:00:00Z', 'succeeded', $3)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [sub4Id, br2Id, inv4Id],
      );
    }

    // 12. Payments & Allocations
    // Payment 1: Acme
    let p1 = await client.query("SELECT id FROM payments WHERE payment_number = 'PAY-2026-000001'");
    if (!p1.rowCount) {
      const ins = await client.query(
        `INSERT INTO payments (payment_number, customer_id, invoice_id, method, amount_cents, currency, received_date, external_reference, notes, created_by)
         VALUES ('PAY-2026-000001', $1, $2, 'bank_transfer', 100000, 'INR', '2026-10-05', 'UTR12345678DEMO', 'Initial bank remittance', $3)
         RETURNING id`,
        [custMap['billing@acme.example'], inv1Id, userMap['admin@brightloop.example']],
      );
      await client.query(
        `INSERT INTO payment_allocations (payment_id, invoice_id, amount_cents)
         VALUES ($1, $2, 100000)`,
        [ins.rows[0].id, inv1Id],
      );
    }

    // Payment 2: Vertex
    let p2 = await client.query("SELECT id FROM payments WHERE payment_number = 'PAY-2026-000002'");
    if (!p2.rowCount) {
      const ins = await client.query(
        `INSERT INTO payments (payment_number, customer_id, invoice_id, method, amount_cents, currency, received_date, external_reference, notes, created_by)
         VALUES ('PAY-2026-000002', $1, $2, 'bank_transfer', 1250000, 'INR', '2026-09-10', 'HDFC9876543210', 'Full annual enterprise contract settlement', $3)
         RETURNING id`,
        [custMap['accounts@vertex.example'], inv2Id, userMap['admin@brightloop.example']],
      );
      await client.query(
        `INSERT INTO payment_allocations (payment_id, invoice_id, amount_cents)
         VALUES ($1, $2, 1250000)`,
        [ins.rows[0].id, inv2Id],
      );
    }

    // Payment 3: Nexus AI
    let p3 = await client.query("SELECT id FROM payments WHERE payment_number = 'PAY-2026-000003'");
    if (!p3.rowCount) {
      const ins = await client.query(
        `INSERT INTO payments (payment_number, customer_id, invoice_id, method, amount_cents, currency, received_date, external_reference, notes, created_by)
         VALUES ('PAY-2026-000003', $1, $2, 'credit_card', 200000, 'INR', '2026-08-25', 'STRIPE_CH_994421', 'Online card payment installment', $3)
         RETURNING id`,
        [custMap['finance@nexusai.example'], inv3Id, userMap['staff@brightloop.example']],
      );
      await client.query(
        `INSERT INTO payment_allocations (payment_id, invoice_id, amount_cents)
         VALUES ($1, $2, 200000)`,
        [ins.rows[0].id, inv3Id],
      );
    }

    await client.query('COMMIT');
    console.log('Seed complete! Pre-populated rich B2B dataset:');
    console.log(' - Admin: admin@brightloop.example / Admin@12345');
    console.log(' - Staff: staff@brightloop.example / Staff@12345');
    console.log(' - Customers: billing@acme.example, accounts@vertex.example, finance@nexusai.example, operations@zenith.example / Customer@12345');
    console.log(' - Subscriptions: SUB-2026-000101..104 with complete lifecycle and pricing');
    console.log(' - Invoices: INV-2026-000101..104, Payments: PAY-2026-000001..003 (Reconciled)');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Database seed failed:', error.message);
  process.exitCode = 1;
});
