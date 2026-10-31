const express = require('express');

function createCustomersRouter({ pool, audit, sendError, authenticate, requirePermission }) {
  const router = express.Router();

  function mapCustomerRow(row) {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      billingAddress: row.billing_address || {},
      taxIdentifier: row.tax_identifier,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // GET /api/v1/customers - List customers (scoped by role/record authorization)
  router.get('/customers', authenticate, async (req, res) => {
    const isStaffOrAdmin = req.user.permissions.includes('customers.read');
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = req.query.status === 'archived' ? 'archived' : req.query.status === 'all' ? null : 'active';

    try {
      if (!isStaffOrAdmin) {
        // Customer portal scoping: customer can only view their own profile
        let result = await pool.query('SELECT * FROM customers WHERE user_id = $1', [req.user.id]);
        if (result.rows.length === 0) {
          // Check if there is an existing customer profile matching user email
          const byEmail = await pool.query('SELECT * FROM customers WHERE email = $1', [req.user.email]);
          if (byEmail.rows.length > 0) {
            await pool.query('UPDATE customers SET user_id = $1 WHERE id = $2', [req.user.id, byEmail.rows[0].id]);
            result = await pool.query('SELECT * FROM customers WHERE user_id = $1', [req.user.id]);
          } else {
            // Auto-provision a customer record for this registered customer user
            const created = await pool.query(
              `INSERT INTO customers (name, email, billing_address, user_id, status)
               VALUES ($1, $2, $3::jsonb, $4, 'active') RETURNING *`,
              [req.user.displayName || req.user.display_name || req.user.email, req.user.email, JSON.stringify({}), req.user.id],
            );
            result = created;
          }
        }
        return res.json({ data: result.rows.map(mapCustomerRow) });
      }

      let query = 'SELECT * FROM customers WHERE 1=1';
      const params = [];

      if (status) {
        params.push(status);
        query += ` AND status = $${params.length}`;
      }

      if (search) {
        params.push(`%${search}%`);
        query += ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length})`;
      }

      query += ' ORDER BY created_at DESC';

      const result = await pool.query(query, params);
      res.json({ data: result.rows.map(mapCustomerRow) });
    } catch (error) {
      console.error('Error fetching customers:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to fetch customers.');
    }
  });

  // POST /api/v1/customers - Create a customer profile (Internal staff/admin)
  router.post('/customers', authenticate, requirePermission('customers.manage'), async (req, res) => {
    const { name, email, phone = null, billingAddress = {}, taxIdentifier = null, userId = null } = req.body || {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const details = [];

    if (typeof name !== 'string' || name.trim().length === 0) {
      details.push({ field: 'name', code: 'REQUIRED', message: 'Customer name is required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      details.push({ field: 'email', code: 'INVALID_EMAIL', message: 'A valid email is required.' });
    }
    if (typeof billingAddress !== 'object' || billingAddress === null) {
      details.push({ field: 'billingAddress', code: 'INVALID', message: 'Billing address must be an object.' });
    }

    if (details.length) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'One or more fields are invalid.', details);
    }

    try {
      const existing = await pool.query('SELECT id FROM customers WHERE email = $1', [normalizedEmail]);
      if (existing.rowCount) {
        return sendError(res, 409, 'EMAIL_ALREADY_REGISTERED', 'A customer with this email already exists.');
      }

      const result = await pool.query(
        `INSERT INTO customers (name, email, phone, billing_address, tax_identifier, user_id, status)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'active')
         RETURNING *`,
        [name.trim(), normalizedEmail, phone ? phone.trim() : null, JSON.stringify(billingAddress), taxIdentifier ? taxIdentifier.trim() : null, userId || null],
      );

      const customer = mapCustomerRow(result.rows[0]);
      await audit({
        actorUserId: req.user.id,
        action: 'customer.created',
        entityType: 'customer',
        entityId: customer.id,
        metadata: { name: customer.name, email: customer.email },
        requestId: req.requestId,
      });

      res.status(201).json({ data: customer });
    } catch (error) {
      console.error('Error creating customer:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to create customer.');
    }
  });

  // GET /api/v1/customers/:id - Retrieve customer by ID
  router.get('/customers/:id', authenticate, async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
      if (!result.rowCount) {
        return sendError(res, 404, 'NOT_FOUND', 'Customer not found.');
      }

      const customer = result.rows[0];
      const isStaffOrAdmin = req.user.permissions.includes('customers.read');

      // If customer role, only allow viewing their own profile
      if (!isStaffOrAdmin && customer.user_id !== req.user.id) {
        return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to view this customer record.');
      }

      res.json({ data: mapCustomerRow(customer) });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to retrieve customer.');
    }
  });

  // PATCH /api/v1/customers/:id - Update customer profile
  router.patch('/customers/:id', authenticate, async (req, res) => {
    try {
      const existing = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
      if (!existing.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Customer not found.');

      const current = existing.rows[0];
      const isStaffOrAdmin = req.user.permissions.includes('customers.manage');

      if (!isStaffOrAdmin && current.user_id !== req.user.id) {
        return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to modify this customer record.');
      }

      const { name, phone, billingAddress, taxIdentifier, status } = req.body || {};

      const updatedName = (isStaffOrAdmin || current.user_id === req.user.id) && typeof name === 'string' && name.trim() ? name.trim() : current.name;
      const updatedPhone = phone !== undefined ? (phone ? phone.trim() : null) : current.phone;
      const updatedAddress = typeof billingAddress === 'object' && billingAddress !== null ? JSON.stringify(billingAddress) : JSON.stringify(current.billing_address);
      const updatedTax = (isStaffOrAdmin || current.user_id === req.user.id) && taxIdentifier !== undefined ? (taxIdentifier ? taxIdentifier.trim() : null) : current.tax_identifier;
      const updatedStatus = isStaffOrAdmin && ['active', 'archived'].includes(status) ? status : current.status;

      const result = await pool.query(
        `UPDATE customers
         SET name = $1, phone = $2, billing_address = $3::jsonb, tax_identifier = $4, status = $5, updated_at = NOW()
         WHERE id = $6
         RETURNING *`,
        [updatedName, updatedPhone, updatedAddress, updatedTax, updatedStatus, req.params.id],
      );

      const customer = mapCustomerRow(result.rows[0]);
      await audit({
        actorUserId: req.user.id,
        action: 'customer.updated',
        entityType: 'customer',
        entityId: req.params.id,
        metadata: { name: customer.name, status: customer.status },
        requestId: req.requestId,
      });

      res.json({ data: customer });
    } catch (error) {
      console.error('Error updating customer:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to update customer.');
    }
  });

  return router;
}

module.exports = { createCustomersRouter };
