const express = require('express');
const {
  canTransitionInvoice,
  generateInvoicePdf,
  generateInvoiceHtml,
} = require('../domain/billing');
const { sendInvoiceNotification } = require('../domain/notifications');

function createInvoicesRouter({ pool, audit, sendError, authenticate, requirePermission }) {
  const router = express.Router();

  function mapInvoiceRow(row) {
    return {
      id: row.id,
      invoiceNumber: row.invoice_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      customerTaxId: row.customer_tax_identifier,
      subscriptionId: row.subscription_id,
      subscriptionNumber: row.subscription_number,
      billingOccurrenceId: row.billing_occurrence_id,
      status: row.status,
      issueDate: row.issue_date,
      dueDate: row.due_date,
      currency: row.currency,
      subtotalCents: row.subtotal_cents,
      discountCents: row.discount_cents,
      taxCents: row.tax_cents,
      grandTotalCents: row.grand_total_cents,
      balanceDueCents: row.balance_due_cents,
      paymentTermsDays: row.payment_terms_days,
      snapshotBreakdown: row.snapshot_breakdown,
      cancellationReason: row.cancellation_reason,
      sentAt: row.sent_at,
      lines: Array.isArray(row.lines) ? row.lines : [],
      notifications: Array.isArray(row.notifications) ? row.notifications : [],
      createdAt: row.created_at,
    };
  }

  // GET /api/v1/invoices
  router.get('/invoices', authenticate, async (req, res) => {
    const isStaffOrAdmin =
      req.user.permissions.includes('billing.read') ||
      req.user.permissions.includes('billing.manage') ||
      req.user.permissions.includes('customers.read');

    const customerId = req.query.customerId;
    const subscriptionId = req.query.subscriptionId;
    const status = req.query.status;

    try {
      let query = `
        SELECT i.*,
               c.name AS customer_name, c.email AS customer_email, c.tax_identifier AS customer_tax_identifier,
               c.user_id,
               s.subscription_number,
               COALESCE(
                 json_agg(
                   DISTINCT jsonb_build_object(
                     'id', il.id,
                     'productId', il.product_id,
                     'variantId', il.variant_id,
                     'description', il.description,
                     'quantity', il.quantity,
                     'unitPriceCents', il.unit_price_cents,
                     'variantAdjustmentCents', il.variant_adjustment_cents,
                     'lineSubtotalCents', il.line_subtotal_cents
                   )
                 ) FILTER (WHERE il.id IS NOT NULL), '[]'
               ) AS lines
        FROM invoices i
        JOIN customers c ON c.id = i.customer_id
        LEFT JOIN subscriptions s ON s.id = i.subscription_id
        LEFT JOIN invoice_lines il ON il.invoice_id = i.id
        WHERE 1=1
      `;
      const params = [];

      if (!isStaffOrAdmin) {
        // Enforce customer portal isolation
        params.push(req.user.id);
        query += ` AND c.user_id = $${params.length}`;
      } else if (customerId) {
        params.push(customerId);
        query += ` AND i.customer_id = $${params.length}`;
      }

      if (subscriptionId) {
        params.push(subscriptionId);
        query += ` AND i.subscription_id = $${params.length}`;
      }

      if (status) {
        params.push(status);
        query += ` AND i.status = $${params.length}`;
      }

      query += ' GROUP BY i.id, c.name, c.email, c.tax_identifier, c.user_id, s.subscription_number ORDER BY i.created_at DESC';

      const result = await pool.query(query, params);
      res.json({ data: result.rows.map(mapInvoiceRow) });
    } catch (error) {
      console.error('Error fetching invoices:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to fetch invoices.');
    }
  });

  // GET /api/v1/invoices/:id
  router.get('/invoices/:id', authenticate, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT i.*,
                c.name AS customer_name, c.email AS customer_email, c.tax_identifier AS customer_tax_identifier,
                c.billing_address AS customer_billing_address, c.user_id,
                s.subscription_number,
                COALESCE(
                  json_agg(
                    DISTINCT jsonb_build_object(
                      'id', il.id,
                      'productId', il.product_id,
                      'variantId', il.variant_id,
                      'description', il.description,
                      'quantity', il.quantity,
                      'unitPriceCents', il.unit_price_cents,
                      'variantAdjustmentCents', il.variant_adjustment_cents,
                      'lineSubtotalCents', il.line_subtotal_cents
                    )
                  ) FILTER (WHERE il.id IS NOT NULL), '[]'
                ) AS lines,
                COALESCE(
                  (
                    SELECT json_agg(
                      json_build_object(
                        'id', n.id,
                        'recipientEmail', n.recipient_email,
                        'subject', n.subject,
                        'status', n.status,
                        'retryCount', n.retry_count,
                        'sentAt', n.sent_at
                      )
                    ) FROM email_notifications n WHERE n.entity_type = 'invoice' AND n.entity_id = i.id
                  ), '[]'
                ) AS notifications
         FROM invoices i
         JOIN customers c ON c.id = i.customer_id
         LEFT JOIN subscriptions s ON s.id = i.subscription_id
         LEFT JOIN invoice_lines il ON il.invoice_id = i.id
         WHERE i.id = $1
         GROUP BY i.id, c.name, c.email, c.tax_identifier, c.billing_address, c.user_id, s.subscription_number`,
        [req.params.id],
      );

      if (!result.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Invoice not found.');
      const row = result.rows[0];

      const isStaffOrAdmin =
        req.user.permissions.includes('billing.read') ||
        req.user.permissions.includes('billing.manage') ||
        req.user.permissions.includes('customers.read');

      if (!isStaffOrAdmin && row.user_id !== req.user.id) {
        return sendError(res, 403, 'FORBIDDEN', 'Access to invoice denied.');
      }

      res.json({ data: mapInvoiceRow(row) });
    } catch (error) {
      console.error('Error fetching invoice details:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to retrieve invoice.');
    }
  });

  // POST /api/v1/invoices/:id/confirm
  router.post('/invoices/:id/confirm', authenticate, requirePermission('billing.manage'), async (req, res) => {
    try {
      const invRes = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
      if (!invRes.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Invoice not found.');
      const invoice = invRes.rows[0];

      if (!canTransitionInvoice(invoice.status, 'confirmed')) {
        return sendError(res, 400, 'INVALID_STATE', `Invoice in '${invoice.status}' state cannot be confirmed.`);
      }

      const updateRes = await pool.query(
        "UPDATE invoices SET status = 'confirmed', updated_at = NOW() WHERE id = $1 RETURNING *",
        [invoice.id],
      );

      await audit({
        actorUserId: req.user.id,
        action: 'invoice.confirmed',
        entityType: 'invoice',
        entityId: invoice.id,
        metadata: { invoiceNumber: invoice.invoice_number },
        requestId: req.requestId,
      });

      res.json({ data: updateRes.rows[0] });
    } catch (error) {
      console.error('Error confirming invoice:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to confirm invoice.');
    }
  });

  // POST /api/v1/invoices/:id/send
  router.post('/api/v1/invoices/:id/send', authenticate, requirePermission('billing.manage'), async (req, res) => {
    // Also matched below without double prefix
  });

  router.post('/invoices/:id/send', authenticate, requirePermission('billing.manage'), async (req, res) => {
    const { recipientEmail = null, simulateFailure = false } = req.body || {};
    try {
      const invRes = await pool.query(
        `SELECT i.*, c.name AS customer_name, c.email AS customer_email
         FROM invoices i
         JOIN customers c ON c.id = i.customer_id
         WHERE i.id = $1`,
        [req.params.id],
      );
      if (!invRes.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Invoice not found.');
      const invoice = invRes.rows[0];

      if (invoice.status === 'draft') {
        return sendError(res, 400, 'INVALID_STATE', 'Draft invoices must be confirmed before sending.');
      }
      if (invoice.status === 'cancelled' || invoice.status === 'voided') {
        return sendError(res, 400, 'INVALID_STATE', `Cancelled or voided invoices cannot be sent.`);
      }

      const customer = { name: invoice.customer_name, email: invoice.customer_email };
      const deliveryResult = await sendInvoiceNotification({
        pool,
        invoice,
        customer,
        recipientEmail,
        audit,
        requestId: req.requestId,
        actorUserId: req.user.id,
        simulateFailure,
      });

      if (!deliveryResult.success) {
        return res.status(502).json({
          error: {
            code: 'EMAIL_DELIVERY_FAILED',
            message: deliveryResult.error,
            notification: deliveryResult.notification,
            requestId: req.requestId,
          },
        });
      }

      const updateRes = await pool.query(
        "UPDATE invoices SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *",
        [invoice.id],
      );

      res.json({
        data: {
          invoice: updateRes.rows[0],
          notification: deliveryResult.notification,
        },
      });
    } catch (error) {
      console.error('Error sending invoice:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to send invoice.');
    }
  });

  // POST /api/v1/invoices/:id/cancel
  router.post('/invoices/:id/cancel', authenticate, requirePermission('billing.manage'), async (req, res) => {
    const { reason = null } = req.body || {};
    try {
      const invRes = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
      if (!invRes.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Invoice not found.');
      const invoice = invRes.rows[0];

      if (!canTransitionInvoice(invoice.status, 'cancelled')) {
        return sendError(res, 400, 'INVALID_STATE', `Invoice in '${invoice.status}' state cannot be cancelled.`);
      }

      const updateRes = await pool.query(
        "UPDATE invoices SET status = 'cancelled', cancellation_reason = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
        [reason, invoice.id],
      );

      await audit({
        actorUserId: req.user.id,
        action: 'invoice.cancelled',
        entityType: 'invoice',
        entityId: invoice.id,
        metadata: { invoiceNumber: invoice.invoice_number, reason },
        requestId: req.requestId,
      });

      res.json({ data: updateRes.rows[0] });
    } catch (error) {
      console.error('Error cancelling invoice:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to cancel invoice.');
    }
  });

  // GET /api/v1/invoices/:id/pdf
  router.get('/invoices/:id/pdf', authenticate, async (req, res) => {
    try {
      const invRes = await pool.query(
        `SELECT i.*,
                c.name AS customer_name, c.email AS customer_email, c.tax_identifier, c.user_id,
                c.billing_address
         FROM invoices i
         JOIN customers c ON c.id = i.customer_id
         WHERE i.id = $1`,
        [req.params.id],
      );

      if (!invRes.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Invoice not found.');
      const invoice = invRes.rows[0];

      const isStaffOrAdmin =
        req.user.permissions.includes('billing.read') ||
        req.user.permissions.includes('billing.manage') ||
        req.user.permissions.includes('customers.read');

      if (!isStaffOrAdmin && invoice.user_id !== req.user.id) {
        return sendError(res, 403, 'FORBIDDEN', 'Access to invoice PDF denied.');
      }

      const linesRes = await pool.query(
        'SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY created_at ASC',
        [invoice.id],
      );

      const customer = {
        name: invoice.customer_name,
        email: invoice.customer_email,
        taxIdentifier: invoice.tax_identifier,
        billingAddress: invoice.billing_address,
      };

      const pdfBuffer = generateInvoicePdf(
        {
          invoiceNumber: invoice.invoice_number,
          issueDate: invoice.issue_date,
          dueDate: invoice.due_date,
          status: invoice.status,
          currency: invoice.currency,
          subtotalCents: invoice.subtotal_cents,
          discountCents: invoice.discount_cents,
          taxCents: invoice.tax_cents,
          grandTotalCents: invoice.grand_total_cents,
          balanceDueCents: invoice.balance_due_cents,
          paymentTermsDays: invoice.payment_terms_days,
        },
        customer,
        linesRes.rows.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitPriceCents: l.unit_price_cents,
          lineSubtotalCents: l.line_subtotal_cents,
        })),
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${invoice.invoice_number}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (error) {
      console.error('Error generating invoice PDF:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to generate invoice PDF.');
    }
  });

  // GET /api/v1/invoices/:id/print
  router.get('/invoices/:id/print', authenticate, async (req, res) => {
    try {
      const invRes = await pool.query(
        `SELECT i.*,
                c.name AS customer_name, c.email AS customer_email, c.tax_identifier, c.user_id,
                c.billing_address
         FROM invoices i
         JOIN customers c ON c.id = i.customer_id
         WHERE i.id = $1`,
        [req.params.id],
      );

      if (!invRes.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Invoice not found.');
      const invoice = invRes.rows[0];

      const isStaffOrAdmin =
        req.user.permissions.includes('billing.read') ||
        req.user.permissions.includes('billing.manage') ||
        req.user.permissions.includes('customers.read');

      if (!isStaffOrAdmin && invoice.user_id !== req.user.id) {
        return sendError(res, 403, 'FORBIDDEN', 'Access to invoice denied.');
      }

      const linesRes = await pool.query(
        'SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY created_at ASC',
        [invoice.id],
      );

      const html = generateInvoiceHtml(
        {
          invoiceNumber: invoice.invoice_number,
          issueDate: invoice.issue_date,
          dueDate: invoice.due_date,
          status: invoice.status,
          currency: invoice.currency,
          subtotalCents: invoice.subtotal_cents,
          discountCents: invoice.discount_cents,
          taxCents: invoice.tax_cents,
          grandTotalCents: invoice.grand_total_cents,
          balanceDueCents: invoice.balance_due_cents,
          paymentTermsDays: invoice.payment_terms_days,
        },
        {
          name: invoice.customer_name,
          email: invoice.customer_email,
          taxIdentifier: invoice.tax_identifier,
        },
        linesRes.rows.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitPriceCents: l.unit_price_cents,
          lineSubtotalCents: l.line_subtotal_cents,
        })),
      );

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (error) {
      console.error('Error rendering invoice print preview:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to render invoice print preview.');
    }
  });

  return router;
}

module.exports = { createInvoicesRouter };
