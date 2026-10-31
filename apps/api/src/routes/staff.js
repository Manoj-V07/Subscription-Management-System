const express = require('express');
const bcrypt = require('bcryptjs');

function createStaffRouter({ pool, audit, sendError, authenticate, requirePermission, PASSWORD_PATTERN }) {
  const router = express.Router();

  // Helper to map staff user row
  function mapStaffRow(row) {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      status: row.status,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
    };
  }

  // GET /api/v1/staff - List internal staff & admin users (Admin only)
  router.get('/staff', authenticate, requirePermission('staff.manage'), async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT u.id, u.email, u.display_name, u.status, u.last_login_at, u.created_at, r.name AS role
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE r.name IN ('staff', 'admin')
         ORDER BY u.created_at DESC`,
      );
      res.json({ data: result.rows.map(mapStaffRow) });
    } catch (error) {
      console.error('Error fetching staff:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to retrieve staff accounts.');
    }
  });

  // POST /api/v1/staff - Create a staff account (Admin only)
  router.post('/staff', authenticate, requirePermission('staff.manage'), async (req, res) => {
    const { email, displayName, password, role = 'staff' } = req.body || {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const details = [];

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      details.push({ field: 'email', code: 'INVALID_EMAIL', message: 'Enter a valid email address.' });
    }
    if (typeof displayName !== 'string' || displayName.trim().length < 2) {
      details.push({ field: 'displayName', code: 'REQUIRED', message: 'Display name must be at least 2 characters.' });
    }
    if (typeof password !== 'string' || !PASSWORD_PATTERN.test(password)) {
      details.push({
        field: 'password',
        code: 'PASSWORD_POLICY',
        message: 'Password must be longer than eight characters and include uppercase, lowercase, and a special character.',
      });
    }
    if (!['staff', 'admin'].includes(role)) {
      details.push({ field: 'role', code: 'INVALID_ROLE', message: 'Role must be staff or admin.' });
    }

    if (details.length) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'One or more fields are invalid.', details);
    }

    try {
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
      if (existing.rowCount) {
        return sendError(res, 409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists.');
      }

      const roleRes = await pool.query('SELECT id FROM roles WHERE name = $1', [role]);
      if (!roleRes.rowCount) {
        return sendError(res, 400, 'INVALID_ROLE', 'Specified role does not exist.');
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, display_name, role_id, status, email_verified_at)
         VALUES ($1, $2, $3, $4, 'active', NOW())
         RETURNING id, email, display_name, status, last_login_at, created_at`,
        [normalizedEmail, passwordHash, displayName.trim(), roleRes.rows[0].id],
      );

      const newStaff = {
        ...mapStaffRow(result.rows[0]),
        role,
      };

      await audit({
        actorUserId: req.user.id,
        action: 'staff.created',
        entityType: 'user',
        entityId: newStaff.id,
        metadata: { email: newStaff.email, role: newStaff.role },
        requestId: req.requestId,
      });

      res.status(201).json({ data: newStaff });
    } catch (error) {
      console.error('Error creating staff account:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to create staff account.');
    }
  });

  // PATCH /api/v1/staff/:id/status - Update staff status (e.g. active / disabled)
  router.patch('/staff/:id/status', authenticate, requirePermission('staff.manage'), async (req, res) => {
    const { status } = req.body || {};
    if (!['active', 'disabled'].includes(status)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Status must be active or disabled.');
    }

    if (req.params.id === req.user.id && status === 'disabled') {
      return sendError(res, 400, 'ACTION_FORBIDDEN', 'You cannot disable your own administrator account.');
    }

    try {
      const result = await pool.query(
        `UPDATE users u
         SET status = $1, updated_at = NOW()
         FROM roles r
         WHERE u.id = $2 AND u.role_id = r.id AND r.name IN ('staff', 'admin')
         RETURNING u.id, u.email, u.display_name, u.status, u.last_login_at, u.created_at, r.name AS role`,
        [status, req.params.id],
      );

      if (!result.rowCount) {
        return sendError(res, 404, 'NOT_FOUND', 'Staff account not found.');
      }

      const updated = mapStaffRow(result.rows[0]);
      await audit({
        actorUserId: req.user.id,
        action: 'staff.status_updated',
        entityType: 'user',
        entityId: req.params.id,
        metadata: { previousStatus: status === 'active' ? 'disabled' : 'active', newStatus: status },
        requestId: req.requestId,
      });

      res.json({ data: updated });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to update staff status.');
    }
  });

  return router;
}

module.exports = { createStaffRouter };
