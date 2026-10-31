const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createCatalogRouter } = require('./routes/catalog');

const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{9,}$/;

function createApp({ pool, jwtSecret, jwtExpiresIn = '15m', appOrigin = '*' }) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => {
    const requestId = req.header('x-request-id') || `req_${crypto.randomUUID()}`;
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    res.setHeader('access-control-allow-origin', appOrigin);
    res.setHeader('access-control-allow-headers', 'Content-Type, Authorization, X-Request-Id');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  function sendError(res, status, code, message, details = []) {
    return res.status(status).json({ error: { code, message, details, requestId: res.getHeader('x-request-id') } });
  }

  async function audit({ actorUserId = null, action, entityType, entityId = null, metadata = {}, requestId }) {
    await pool.query(
      `INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, metadata, request_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [actorUserId, action, entityType, entityId, JSON.stringify(metadata), requestId],
    );
  }

  async function loadUser(userId) {
    const result = await pool.query(
      `SELECT u.id, u.email, u.display_name, u.status, r.name AS role,
              COALESCE(array_agg(p.key) FILTER (WHERE p.key IS NOT NULL), '{}') AS permissions
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE u.id = $1
       GROUP BY u.id, r.name`,
      [userId],
    );
    return result.rows[0] || null;
  }

  async function authenticate(req, res, next) {
    const header = req.header('authorization') || '';
    if (!header.startsWith('Bearer ')) return sendError(res, 401, 'UNAUTHENTICATED', 'A bearer token is required.');
    try {
      const payload = jwt.verify(header.slice(7), jwtSecret);
      const user = await loadUser(payload.sub);
      if (!user || user.status !== 'active') return sendError(res, 401, 'UNAUTHENTICATED', 'The session is no longer active.');
      req.user = user;
      next();
    } catch (error) {
      return sendError(res, 401, 'UNAUTHENTICATED', 'The access token is invalid or expired.');
    }
  }

  function requirePermission(permission) {
    return (req, res, next) => {
      if (!req.user.permissions.includes(permission)) return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to perform this action.');
      next();
    };
  }

  app.get('/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', service: 'brightloop-api', requestId: req.requestId });
    } catch (error) {
      sendError(res, 503, 'DEPENDENCY_UNAVAILABLE', 'Database is unavailable.');
    }
  });

  app.post('/api/v1/auth/register', async (req, res) => {
    const { email, password, displayName } = req.body || {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const details = [];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) details.push({ field: 'email', code: 'INVALID_EMAIL', message: 'Enter a valid email address.' });
    if (typeof password !== 'string' || !PASSWORD_PATTERN.test(password)) details.push({ field: 'password', code: 'PASSWORD_POLICY', message: 'Password must be longer than eight characters and include uppercase, lowercase, and a special character.' });
    if (typeof displayName !== 'string' || displayName.trim().length < 2) details.push({ field: 'displayName', code: 'REQUIRED', message: 'Display name is required.' });
    if (details.length) return sendError(res, 400, 'VALIDATION_ERROR', 'One or more fields are invalid.', details);
    try {
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
      if (existing.rowCount) return sendError(res, 409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists.');
      const passwordHash = await bcrypt.hash(password, 12);
      const role = await pool.query("SELECT id FROM roles WHERE name = 'customer'");
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, display_name, role_id)
         VALUES ($1, $2, $3, $4) RETURNING id, email, display_name, status`,
        [normalizedEmail, passwordHash, displayName.trim(), role.rows[0].id],
      );
      await audit({ actorUserId: result.rows[0].id, action: 'account.registered', entityType: 'user', entityId: result.rows[0].id, requestId: req.requestId });
      res.status(201).json({ data: { user: result.rows[0], message: 'Account created. Email verification will be added in the next identity slice.' } });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to create the account.');
    }
  });

  app.post('/api/v1/auth/login', async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body?.password;
    try {
      const result = await pool.query(
        `SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = $1`,
        [email],
      );
      const user = result.rows[0];
      if (!user || user.status !== 'active' || typeof password !== 'string' || !(await bcrypt.compare(password, user.password_hash))) {
        return sendError(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
      }
      await pool.query('UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1', [user.id]);
      const token = jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: jwtExpiresIn });
      await audit({ actorUserId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, requestId: req.requestId });
      res.json({ data: { accessToken: token, user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role } } });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to sign in.');
    }
  });

  app.post('/api/v1/auth/logout', authenticate, async (req, res) => {
    await audit({ actorUserId: req.user.id, action: 'auth.logout', entityType: 'user', entityId: req.user.id, requestId: req.requestId });
    res.status(204).send();
  });

  app.get('/api/v1/auth/me', authenticate, (req, res) => {
    res.json({ data: { id: req.user.id, email: req.user.email, displayName: req.user.display_name, role: req.user.role, permissions: req.user.permissions } });
  });

  app.post('/api/v1/auth/forgot-password', async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const result = await pool.query('SELECT id FROM users WHERE email = $1 AND status = $2', [email, 'active']);
    if (result.rowCount) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      await pool.query('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'30 minutes\')', [result.rows[0].id, tokenHash]);
      await audit({ action: 'auth.password_reset_requested', entityType: 'user', entityId: result.rows[0].id, requestId: req.requestId });
      if (process.env.NODE_ENV !== 'production') res.setHeader('x-development-reset-token', rawToken);
    }
    res.json({ data: { message: 'If an account exists for that email, a reset link has been sent.' } });
  });

  app.post('/api/v1/auth/reset-password', async (req, res) => {
    const { token, password } = req.body || {};
    if (typeof token !== 'string' || typeof password !== 'string' || !PASSWORD_PATTERN.test(password)) return sendError(res, 400, 'VALIDATION_ERROR', 'A valid token and password are required.');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const found = await pool.query('SELECT id, user_id FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()', [tokenHash]);
    if (!found.rowCount) return sendError(res, 400, 'INVALID_RESET_TOKEN', 'The reset token is invalid or expired.');
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query('BEGIN');
    try {
      await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, found.rows[0].user_id]);
      await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [found.rows[0].id]);
      await audit({ actorUserId: found.rows[0].user_id, action: 'auth.password_reset_completed', entityType: 'user', entityId: found.rows[0].user_id, requestId: req.requestId });
      await pool.query('COMMIT');
      res.json({ data: { message: 'Password reset completed.' } });
    } catch (error) {
      await pool.query('ROLLBACK');
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to reset the password.');
    }
  });

  app.get('/api/v1/dashboard', authenticate, requirePermission('dashboard.read'), async (req, res) => {
    const [users, auditEvents] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM users WHERE status = $1', ['active']),
      pool.query('SELECT COUNT(*)::int AS count FROM audit_events WHERE created_at >= NOW() - INTERVAL \'24 hours\''),
    ]);
    res.json({ data: { activeUsers: users.rows[0].count, auditEventsLast24Hours: auditEvents.rows[0].count, role: req.user.role } });
  });

  app.get('/api/v1/audit-events', authenticate, requirePermission('reports.read'), async (req, res) => {
    const result = await pool.query(
      `SELECT id, action, entity_type AS "entityType", entity_id AS "entityId", metadata, request_id AS "requestId", created_at AS "createdAt"
       FROM audit_events ORDER BY created_at DESC LIMIT 100`,
    );
    res.json({ data: result.rows });
  });

  const catalogRouter = createCatalogRouter({ pool, audit, sendError, authenticate, requirePermission });
  app.use('/api/v1', catalogRouter);

  app.use(express.static(require('node:path').join(__dirname, '../../web')));
  app.use((error, req, res, next) => {
    console.error(error);
    sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  });
  return app;
}

module.exports = { createApp, PASSWORD_PATTERN };
