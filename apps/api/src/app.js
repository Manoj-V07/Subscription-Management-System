const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createCatalogRouter } = require('./routes/catalog');
const { createStaffRouter } = require('./routes/staff');
const { createCustomersRouter } = require('./routes/customers');
const { createSalesRouter } = require('./routes/sales');
const { createInvoicesRouter } = require('./routes/invoices');
const { createBillingRouter } = require('./routes/billing');
const { createPaymentsRouter } = require('./routes/payments');
const { createReportsRouter } = require('./routes/reports');

const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{9,}$/;

function createRateLimiter({ windowMs = 60000, max = 60, keyGenerator = (req) => req.ip || '127.0.0.1' } = {}) {
  const hits = new Map();
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits.entries()) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  if (cleanupTimer.unref) cleanupTimer.unref();

  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 1, resetAt: now + windowMs };
      hits.set(key, entry);
    } else {
      entry.count += 1;
    }
    const remaining = Math.max(0, max - entry.count);
    const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetSeconds);

    if (entry.count > max) {
      res.setHeader('Retry-After', resetSeconds);
      return res.status(429).json({
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many requests, please try again later.',
          retryAfterSeconds: resetSeconds,
          requestId: res.getHeader('x-request-id'),
        },
      });
    }
    next();
  };
}

function createApp({
  pool,
  jwtSecret,
  jwtExpiresIn = '15m',
  appOrigin = '*',
  disableRateLimit = false,
  authRateLimitMax = 60,
  authRateLimitWindowMs = 60000,
}) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  // Metrics registry
  const metrics = {
    totalRequests: 0,
    statusCodes: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
    latencies: [],
  };

  function recordMetric(statusCode, durationMs) {
    metrics.totalRequests += 1;
    const bucket = `${Math.floor(statusCode / 100)}xx`;
    if (metrics.statusCodes[bucket] !== undefined) {
      metrics.statusCodes[bucket] += 1;
    }
    metrics.latencies.push(durationMs);
    if (metrics.latencies.length > 500) {
      metrics.latencies.shift();
    }
  }

  function getLatencyPercentile(p) {
    if (metrics.latencies.length === 0) return 0;
    const sorted = [...metrics.latencies].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return Number(sorted[idx].toFixed(2));
  }

  // Security Headers & Request Correlation Middleware
  app.use((req, res, next) => {
    const startTime = process.hrtime.bigint();
    const requestId = req.header('x-request-id') || `req_${crypto.randomUUID()}`;
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    // OWASP & Production Hardening Headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    // CORS configuration
    res.setHeader('access-control-allow-origin', appOrigin);
    res.setHeader('access-control-allow-headers', 'Content-Type, Authorization, X-Request-Id, Idempotency-Key');
    res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');

    if (req.method === 'OPTIONS') return res.sendStatus(204);

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startTime) / 1000000;
      recordMetric(res.statusCode, durationMs);
    });

    next();
  });

  // Auth rate limiter
  const authRateLimiter = disableRateLimit
    ? (req, res, next) => next()
    : createRateLimiter({
        windowMs: authRateLimitWindowMs,
        max: authRateLimitMax,
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

  function createOpaqueToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  function hashOpaqueToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async function issueRefreshToken(userId) {
    const rawToken = createOpaqueToken();
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [userId, hashOpaqueToken(rawToken)],
    );
    return rawToken;
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

  // Health and Readiness Probes
  app.get('/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({
        status: 'ok',
        service: 'brightloop-api',
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      });
    } catch (error) {
      sendError(res, 503, 'DEPENDENCY_UNAVAILABLE', 'Database is unavailable.');
    }
  });

  app.get('/health/liveness', (req, res) => {
    res.json({
      status: 'ok',
      service: 'brightloop-api',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
    });
  });

  app.get('/health/readiness', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({
        status: 'ready',
        service: 'brightloop-api',
        dependencies: {
          database: 'connected',
        },
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      });
    } catch (error) {
      res.status(503).json({
        error: {
          code: 'DEPENDENCY_UNAVAILABLE',
          message: 'Database is unavailable.',
          dependencies: {
            database: 'disconnected',
          },
          requestId: req.requestId,
        },
      });
    }
  });

  // Operational Metrics Endpoint
  app.get(['/health/metrics', '/api/v1/metrics'], (req, res) => {
    res.json({
      service: 'brightloop-api',
      uptimeSeconds: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
      requests: {
        total: metrics.totalRequests,
        status_2xx: metrics.statusCodes['2xx'],
        status_3xx: metrics.statusCodes['3xx'],
        status_4xx: metrics.statusCodes['4xx'],
        status_5xx: metrics.statusCodes['5xx'],
        latencyMs: {
          p50: getLatencyPercentile(50),
          p90: getLatencyPercentile(90),
          p95: getLatencyPercentile(95),
          p99: getLatencyPercentile(99),
        },
      },
      timestamp: new Date().toISOString(),
    });
  });

  // Authentication routes with Rate Limiter
  app.post('/api/v1/auth/register', authRateLimiter, async (req, res) => {
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
      const verificationToken = createOpaqueToken();
      await pool.query(
        `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
        [result.rows[0].id, hashOpaqueToken(verificationToken)],
      );
      await audit({ actorUserId: result.rows[0].id, action: 'account.registered', entityType: 'user', entityId: result.rows[0].id, requestId: req.requestId });
      if (process.env.NODE_ENV !== 'production') res.setHeader('x-development-verification-token', verificationToken);
      res.status(201).json({ data: { user: result.rows[0], message: 'Account created. Check your email to verify the account.' } });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to create the account.');
    }
  });

  app.post('/api/v1/auth/login', authRateLimiter, async (req, res) => {
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
      const refreshToken = await issueRefreshToken(user.id);
      await audit({ actorUserId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, requestId: req.requestId });
      res.json({ data: { accessToken: token, refreshToken, user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role } } });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to sign in.');
    }
  });

  app.post('/api/v1/auth/logout', authenticate, async (req, res) => {
    const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
    if (refreshToken) {
      await pool.query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND user_id = $2 AND revoked_at IS NULL',
        [hashOpaqueToken(refreshToken), req.user.id],
      );
    }
    await audit({ actorUserId: req.user.id, action: 'auth.logout', entityType: 'user', entityId: req.user.id, requestId: req.requestId });
    res.status(204).send();
  });

  app.post('/api/v1/auth/refresh', authRateLimiter, async (req, res) => {
    const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : '';
    if (!refreshToken) return sendError(res, 400, 'VALIDATION_ERROR', 'A refresh token is required.');

    try {
      const tokenHash = hashOpaqueToken(refreshToken);
      const found = await pool.query(
        `SELECT rt.id, rt.user_id, u.email, u.display_name, u.status, r.name AS role
         FROM refresh_tokens rt
         JOIN users u ON u.id = rt.user_id
         JOIN roles r ON r.id = u.role_id
         WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > NOW()`,
        [tokenHash],
      );
      if (!found.rowCount || found.rows[0].status !== 'active') {
        return sendError(res, 401, 'INVALID_REFRESH_TOKEN', 'The refresh token is invalid or expired.');
      }

      await pool.query('BEGIN');
      let nextRefreshToken;
      try {
        const revoked = await pool.query(
          'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL RETURNING id',
          [found.rows[0].id],
        );
        if (!revoked.rowCount) {
          await pool.query('ROLLBACK');
          return sendError(res, 401, 'INVALID_REFRESH_TOKEN', 'The refresh token is invalid or expired.');
        }
        nextRefreshToken = await issueRefreshToken(found.rows[0].user_id);
        await pool.query('COMMIT');
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
      const accessToken = jwt.sign(
        { sub: found.rows[0].user_id, role: found.rows[0].role },
        jwtSecret,
        { expiresIn: jwtExpiresIn },
      );
      await audit({
        actorUserId: found.rows[0].user_id,
        action: 'auth.refresh',
        entityType: 'user',
        entityId: found.rows[0].user_id,
        requestId: req.requestId,
      });
      res.json({
        data: {
          accessToken,
          refreshToken: nextRefreshToken,
          user: {
            id: found.rows[0].user_id,
            email: found.rows[0].email,
            displayName: found.rows[0].display_name,
            role: found.rows[0].role,
          },
        },
      });
    } catch (error) {
      console.error('Error refreshing session:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to refresh the session.');
    }
  });

  app.post('/api/v1/auth/verify-email', authRateLimiter, async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!token) return sendError(res, 400, 'VALIDATION_ERROR', 'A verification token is required.');

    try {
      const found = await pool.query(
        `SELECT id, user_id
         FROM email_verification_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
        [hashOpaqueToken(token)],
      );
      if (!found.rowCount) return sendError(res, 400, 'INVALID_VERIFICATION_TOKEN', 'The verification token is invalid or expired.');

      await pool.query('BEGIN');
      try {
        await pool.query(
          'UPDATE users SET email_verified_at = NOW(), updated_at = NOW() WHERE id = $1',
          [found.rows[0].user_id],
        );
        await pool.query('UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1', [found.rows[0].id]);
        await audit({
          actorUserId: found.rows[0].user_id,
          action: 'auth.email_verified',
          entityType: 'user',
          entityId: found.rows[0].user_id,
          requestId: req.requestId,
        });
        await pool.query('COMMIT');
        res.json({ data: { message: 'Email verification completed.' } });
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      if (error.code === 'INVALID_VERIFICATION_TOKEN') {
        return sendError(res, 400, error.code, error.message);
      }
      console.error('Error verifying email:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to verify the email address.');
    }
  });

  app.get('/api/v1/auth/me', authenticate, (req, res) => {
    res.json({ data: { id: req.user.id, email: req.user.email, displayName: req.user.display_name, role: req.user.role, permissions: req.user.permissions } });
  });

  app.post('/api/v1/auth/forgot-password', authRateLimiter, async (req, res) => {
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

  app.post('/api/v1/auth/reset-password', authRateLimiter, async (req, res) => {
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
  const staffRouter = createStaffRouter({ pool, audit, sendError, authenticate, requirePermission, PASSWORD_PATTERN });
  const customersRouter = createCustomersRouter({ pool, audit, sendError, authenticate, requirePermission });
  const salesRouter = createSalesRouter({ pool, audit, sendError, authenticate, requirePermission });
  const invoicesRouter = createInvoicesRouter({ pool, audit, sendError, authenticate, requirePermission });
  const billingRouter = createBillingRouter({ pool, audit, sendError, authenticate, requirePermission });
  const paymentsRouter = createPaymentsRouter({ pool, audit, sendError, authenticate, requirePermission });
  const reportsRouter = createReportsRouter({ pool, audit, sendError, authenticate, requirePermission });

  app.use('/api/v1', catalogRouter);
  app.use('/api/v1', staffRouter);
  app.use('/api/v1', customersRouter);
  app.use('/api/v1', salesRouter);
  app.use('/api/v1', invoicesRouter);
  app.use('/api/v1', billingRouter);
  app.use('/api/v1', paymentsRouter);
  app.use('/api/v1', reportsRouter);

  app.use(express.static(require('node:path').join(__dirname, '../../web')));
  app.use((error, req, res, next) => {
    console.error(error);
    sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  });
  return app;
}

module.exports = { createApp, PASSWORD_PATTERN };
