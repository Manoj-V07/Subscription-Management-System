require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const permissions = [
  ['dashboard.read', 'View dashboards'],
  ['customers.read', 'View customers'],
  ['customers.manage', 'Manage customers'],
  ['billing.read', 'View billing records'],
  ['billing.manage', 'Manage billing records'],
  ['catalog.manage', 'Manage catalogue configuration'],
  ['staff.manage', 'Manage internal staff'],
  ['reports.read', 'View reports'],
  ['portal.read', 'View customer portal'],
];

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
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
      staff: ['dashboard.read', 'customers.read', 'customers.manage', 'billing.read', 'billing.manage', 'reports.read', 'portal.read'],
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

    const passwordHash = await bcrypt.hash('Admin@12345', 12);
    await client.query(
      `INSERT INTO users (email, password_hash, display_name, role_id, email_verified_at)
       SELECT 'admin@brightloop.example', $1, 'Brightloop Administrator', id, NOW()
       FROM roles WHERE name = 'admin'
       ON CONFLICT (email) DO NOTHING`,
      [passwordHash],
    );
    await client.query('COMMIT');
    console.log('Seed complete. Admin: admin@brightloop.example / Admin@12345');
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
