const express = require('express');
const { isValidPaymentMethod, calculatePaymentAllocation } = require('../domain/finance');
const { generateDocumentNumber } = require('../domain/pricing');

function createPaymentsRouter({ pool, audit, sendError, authenticate, requirePermission }) {
  const router = express.Router();

  function mapPaymentRow(row) {
    return {
      id: row.id,
      paymentNumber: row.payment_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      method: row.method,
      amountCents: row.amount_cents,
      currency: row.currency,
      receivedDate: row.received_date,
      externalReference: row.external_reference,
      notes: row.notes,
      createdByName: row.created_by_name,
      createdAt: row.created_at,
      allocations: Array.isArray(row.allocations) ? row.allocations : [],
    };
  }

  // GET /api/v1/payments
  router.get('/payments', authenticate, async (req, res) => {
    const isStaffOrAdmin =
      req.user.permissions.includes('billing.read') ||
      req.user.permissions.includes('billing.manage') ||
      req.user.permissions.includes('payments.read') ||
      req.user.permissions.includes('payments.manage') ||
      req.user.permissions.includes('customers.read');

    const customerId = req.query.customerId;
    const invoiceId = req.query.invoiceId;
    const method = req.query.method;

    try {
      let query = `
        SELECT p.*,
               c.name AS customer_name, c.email AS customer_email, c.user_id,
               i.invoice_number,
               u.display_name AS created_by_name,
               COALESCE(
                 json_agg(
                   json_build_object(
                     'id', pa.id,
                     'invoiceId', pa.invoice_id,
                     'amountCents', pa.amount_cents,
                     'allocatedAt', pa.allocated_at
                   )
                 ) FILTER (WHERE pa.id IS NOT NULL), '[]'
               ) AS allocations
        FROM payments p
        JOIN customers c ON c.id = p.customer_id
        LEFT JOIN invoices i ON i.id = p.invoice_id
        LEFT JOIN users u ON u.id = p.created_by
        LEFT JOIN payment_allocations pa ON pa.payment_id = p.id
        WHERE 1=1
      `;
      const params = [];

      if (!isStaffOrAdmin) {
        // Enforce customer portal isolation
        params.push(req.user.id);
        query += ` AND c.user_id = $${params.length}`;
      } else if (customerId) {
        params.push(customerId);
        query += ` AND p.customer_id = $${params.length}`;
      }

      if (invoiceId) {
        params.push(invoiceId);
        query += ` AND p.invoice_id = $${params.length}`;
      }

      if (method) {
        params.push(method);
        query += ` AND p.method = $${params.length}`;
      }

      query += ' GROUP BY p.id, c.name, c.email, c.user_id, i.invoice_number, u.display_name ORDER BY p.received_date DESC, p.created_at DESC';

      const result = await pool.query(query, params);
      res.json({ data: result.rows.map(mapPaymentRow) });
    } catch (error) {
      console.error('Error fetching payments:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to fetch payments.');
    }
  });

  // GET /api/v1/payments/:id
  router.get('/payments/:id', authenticate, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT p.*,
                c.name AS customer_name, c.email AS customer_email, c.user_id,
                i.invoice_number,
                u.display_name AS created_by_name,
                COALESCE(
                  json_agg(
                    json_build_object(
                      'id', pa.id,
                      'invoiceId', pa.invoice_id,
                      'amountCents', pa.amount_cents,
                      'allocatedAt', pa.allocated_at
                    )
                  ) FILTER (WHERE pa.id IS NOT NULL), '[]'
                ) AS allocations
         FROM payments p
         JOIN customers c ON c.id = p.customer_id
         LEFT JOIN invoices i ON i.id = p.invoice_id
         LEFT JOIN users u ON u.id = p.created_by
         LEFT JOIN payment_allocations pa ON pa.payment_id = p.id
         WHERE p.id = $1
         GROUP BY p.id, c.name, c.email, c.user_id, i.invoice_number, u.display_name`,
        [req.params.id],
      );

      if (!result.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Payment record not found.');
      const row = result.rows[0];

      const isStaffOrAdmin =
        req.user.permissions.includes('billing.read') ||
        req.user.permissions.includes('billing.manage') ||
        req.user.permissions.includes('payments.read') ||
        req.user.permissions.includes('payments.manage') ||
        req.user.permissions.includes('customers.read');

      if (!isStaffOrAdmin && row.user_id !== req.user.id) {
        return sendError(res, 403, 'FORBIDDEN', 'Access to payment record denied.');
      }

      res.json({ data: mapPaymentRow(row) });
    } catch (error) {
      console.error('Error fetching payment details:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to retrieve payment details.');
    }
  });

  // POST /api/v1/payments
  router.post('/payments', authenticate, async (req, res) => {
    // Check permission: staff/admin with billing.manage or payments.manage
    const canManagePayments =
      req.user.permissions.includes('billing.manage') ||
      req.user.permissions.includes('payments.manage');

    if (!canManagePayments) {
      return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to record payments.');
    }

    const {
      invoiceId,
      method,
      amountCents,
      receivedDate = new Date().toISOString().slice(0, 10),
      externalReference = null,
      notes = null,
    } = req.body || {};

    if (!invoiceId) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invoice ID is required for payment recording.');
    }

    if (!isValidPaymentMethod(method)) {
      return sendError(
        res,
        400,
        'VALIDATION_ERROR',
        `Invalid payment method '${method}'. Allowed: bank_transfer, credit_card, upi, cash, cheque, other.`,
      );
    }

    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Payment amount must be a positive integer in minor units (cents/paise).');
    }

    try {
      // 1. Fetch target invoice
      const invRes = await pool.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
      if (!invRes.rowCount) {
        return sendError(res, 404, 'NOT_FOUND', 'Invoice not found.');
      }
      const invoice = invRes.rows[0];

      if (invoice.status === 'cancelled' || invoice.status === 'voided') {
        return sendError(res, 400, 'INVALID_STATE', `Cannot record payment on a '${invoice.status}' invoice.`);
      }

      // If draft invoice, auto-confirm it upon payment
      if (invoice.status === 'draft') {
        await pool.query("UPDATE invoices SET status = 'confirmed', updated_at = NOW() WHERE id = $1", [invoice.id]);
        invoice.status = 'confirmed';
      }

      // 2. Validate allocation & non-overpayment invariant
      let allocation;
      try {
        allocation = calculatePaymentAllocation({ invoice, amountCents });
      } catch (allocError) {
        return sendError(res, 400, 'OVERPAYMENT_REJECTED', allocError.message);
      }

      // 3. Generate Human-Readable Payment Number: PAY-YYYY-XXXXXX
      const payCountRes = await pool.query('SELECT COUNT(*)::int AS count FROM payments');
      const paySeqNumber = (payCountRes.rows[0]?.count || 0) + 1;
      const paymentNumber = generateDocumentNumber('PAY', paySeqNumber);

      // 4. Atomic Transaction: Record payment, allocation, and update invoice & subscription balances
      await pool.query('BEGIN');

      const payInsertRes = await pool.query(
        `INSERT INTO payments (
          payment_number, customer_id, invoice_id, method, amount_cents,
          currency, received_date, external_reference, notes, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`,
        [
          paymentNumber,
          invoice.customer_id,
          invoice.id,
          method.toLowerCase().trim(),
          amountCents,
          invoice.currency || 'INR',
          receivedDate,
          externalReference ? externalReference.trim() : null,
          notes ? notes.trim() : null,
          req.user.id,
        ],
      );
      const payment = payInsertRes.rows[0];

      await pool.query(
        `INSERT INTO payment_allocations (payment_id, invoice_id, amount_cents)
         VALUES ($1, $2, $3)`,
        [payment.id, invoice.id, amountCents],
      );

      // Update invoice balance and status
      const updatedInvRes = await pool.query(
        `UPDATE invoices
         SET balance_due_cents = $1, status = $2, updated_at = NOW()
         WHERE id = $3 RETURNING *`,
        [allocation.remainingBalanceDueCents, allocation.newStatus, invoice.id],
      );
      const updatedInvoice = updatedInvRes.rows[0];

      // Update subscription balance if linked
      if (invoice.subscription_id) {
        await pool.query(
          `UPDATE subscriptions
           SET balance_due_cents = GREATEST(0, balance_due_cents - $1), updated_at = NOW()
           WHERE id = $2`,
          [amountCents, invoice.subscription_id],
        );
      }

      await pool.query('COMMIT');

      // 5. Audit Events
      await audit({
        actorUserId: req.user.id,
        action: 'payment.recorded',
        entityType: 'payment',
        entityId: payment.id,
        metadata: {
          paymentNumber,
          invoiceNumber: invoice.invoice_number,
          amountCents,
          method,
          remainingBalanceDueCents: allocation.remainingBalanceDueCents,
          newInvoiceStatus: allocation.newStatus,
        },
        requestId: req.requestId,
      });

      res.status(201).json({
        data: {
          payment: {
            id: payment.id,
            paymentNumber: payment.payment_number,
            customerId: payment.customer_id,
            invoiceId: payment.invoice_id,
            method: payment.method,
            amountCents: payment.amount_cents,
            currency: payment.currency,
            receivedDate: payment.received_date,
            externalReference: payment.external_reference,
            createdAt: payment.created_at,
          },
          invoice: {
            id: updatedInvoice.id,
            invoiceNumber: updatedInvoice.invoice_number,
            status: updatedInvoice.status,
            grandTotalCents: updatedInvoice.grand_total_cents,
            balanceDueCents: updatedInvoice.balance_due_cents,
          },
          allocation: {
            allocatedAmountCents: allocation.allocatedAmountCents,
            remainingBalanceDueCents: allocation.remainingBalanceDueCents,
          },
        },
      });
    } catch (error) {
      await pool.query('ROLLBACK');
      console.error('Error recording payment:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to record payment.');
    }
  });

  return router;
}

module.exports = { createPaymentsRouter };
