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
    for (const [key, description] of permissions) {
      await client.query(
        'INSERT INTO permissions (key, description) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description',
        [key, description],
      );
    }

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

    // Seed default admin
    const passwordHash = await bcrypt.hash('Admin@12345', 12);
    await client.query(
      `INSERT INTO users (email, password_hash, display_name, role_id, email_verified_at)
       SELECT 'admin@brightloop.example', $1, 'Brightloop Administrator', id, NOW()
       FROM roles WHERE name = 'admin'
       ON CONFLICT (email) DO NOTHING`,
      [passwordHash],
    );

    // Seed Phase 2 default Tax Rule: GST 18%
    let taxRes = await client.query("SELECT id FROM tax_rules WHERE name = 'GST 18%'");
    if (!taxRes.rowCount) {
      taxRes = await client.query(
        `INSERT INTO tax_rules (name, rate_percentage, jurisdiction)
         VALUES ('GST 18%', 18.00, 'IN')
         RETURNING id`,
      );
    }
    const taxRuleId = taxRes.rows[0]?.id;

    // Seed Phase 2 default Discount Rule: Launch 10%
    await client.query(
      `INSERT INTO discount_rules (name, code, type, value, min_threshold_cents, scope)
       VALUES ('Launch Offer 10%', 'LAUNCH10', 'percentage', 10.00, 100000, 'entire_order')
       ON CONFLICT (code) DO NOTHING`,
    );

    // Seed Phase 2 default Product & Variants
    let prodRes = await client.query("SELECT id FROM products WHERE name = 'Brightloop Platform Core'");
    if (!prodRes.rowCount) {
      prodRes = await client.query(
        `INSERT INTO products (name, product_type, sales_price_cents, cost_price_cents, currency, notes)
         VALUES ('Brightloop Platform Core', 'service', 250000, 50000, 'INR', 'Core SaaS platform subscription tier')
         RETURNING id`,
      );
    }
    const productId = prodRes.rows[0]?.id;

    if (productId) {
      await client.query(
        `INSERT INTO product_variants (product_id, label, adjustment_type, adjustment_value)
         VALUES
           ($1, 'Enterprise Odoo SLA', 'fixed', 56000),
           ($1, 'Priority 24/7 Support', 'percentage', 15.00)
         ON CONFLICT (product_id, label) DO NOTHING`,
        [productId],
      );
    }

    // Seed Phase 2 Plans
    await client.query(
      `INSERT INTO plans (name, code, interval, interval_count, min_quantity, auto_renew)
       VALUES
         ('Monthly Professional', 'PLAN-M-PRO', 'monthly', 1, 1, true),
         ('Yearly Enterprise', 'PLAN-Y-ENT', 'yearly', 1, 5, true)
       ON CONFLICT (code) DO NOTHING`,
    );

    // Seed Phase 2 Sample Customer
    const custExists = await client.query("SELECT id FROM customers WHERE email = 'billing@acme.example'");
    if (!custExists.rowCount) {
      await client.query(
        `INSERT INTO customers (name, email, phone, billing_address, tax_identifier)
         VALUES ('Acme Software Ltd', 'billing@acme.example', '+91 98765 43210', '{"street": "100 Tech Park", "city": "Bengaluru", "state": "Karnataka", "country": "IN", "postal_code": "560001"}', 'GSTIN29AABCU9603R1ZM')`,
      );
    }
    await client.query('COMMIT');
    console.log('Seed complete. Admin: admin@brightloop.example / Admin@12345 with catalogue, subscriptions, billing, and payments engine.');
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
