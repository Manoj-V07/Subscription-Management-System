const express = require('express');
const { executeBillingRun, retryBillingOccurrence } = require('../domain/billing-worker');

function createBillingRouter({ pool, audit, sendError, authenticate, requirePermission }) {
  const router = express.Router();

  // GET /api/v1/billing-runs
  router.get('/billing-runs', authenticate, requirePermission('billing.read'), async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT br.*, u.display_name AS created_by_name
         FROM billing_runs br
         LEFT JOIN users u ON u.id = br.created_by
         ORDER BY br.created_at DESC LIMIT 50`,
      );
      res.json({
        data: result.rows.map((r) => ({
          id: r.id,
          runNumber: r.run_number,
          targetDate: r.target_date,
          status: r.status,
          totalSubscriptions: r.total_subscriptions,
          successfulCount: r.successful_count,
          failedCount: r.failed_count,
          errorSummary: r.error_summary ? (typeof r.error_summary === 'string' ? JSON.parse(r.error_summary) : r.error_summary) : null,
          createdByName: r.created_by_name,
          createdAt: r.created_at,
          completedAt: r.completed_at,
        })),
      });
    } catch (error) {
      console.error('Error fetching billing runs:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to fetch billing runs.');
    }
  });

  // GET /api/v1/billing-runs/:id
  router.get('/billing-runs/:id', authenticate, requirePermission('billing.read'), async (req, res) => {
    try {
      const runRes = await pool.query('SELECT * FROM billing_runs WHERE id = $1', [req.params.id]);
      if (!runRes.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Billing run not found.');

      const occRes = await pool.query(
        `SELECT bo.*, s.subscription_number, c.name AS customer_name, i.invoice_number
         FROM billing_occurrences bo
         JOIN subscriptions s ON s.id = bo.subscription_id
         JOIN customers c ON c.id = s.customer_id
         LEFT JOIN invoices i ON i.id = bo.invoice_id
         WHERE bo.billing_run_id = $1
         ORDER BY bo.created_at ASC`,
        [req.params.id],
      );

      const r = runRes.rows[0];
      res.json({
        data: {
          id: r.id,
          runNumber: r.run_number,
          targetDate: r.target_date,
          status: r.status,
          totalSubscriptions: r.total_subscriptions,
          successfulCount: r.successful_count,
          failedCount: r.failed_count,
          errorSummary: r.error_summary ? (typeof r.error_summary === 'string' ? JSON.parse(r.error_summary) : r.error_summary) : null,
          createdAt: r.created_at,
          completedAt: r.completed_at,
          occurrences: occRes.rows.map((o) => ({
            id: o.id,
            subscriptionId: o.subscription_id,
            subscriptionNumber: o.subscription_number,
            customerName: o.customer_name,
            idempotencyKey: o.idempotency_key,
            periodStart: o.period_start,
            periodEnd: o.period_end,
            status: o.status,
            invoiceId: o.invoice_id,
            invoiceNumber: o.invoice_number,
            retryCount: o.retry_count,
            lastError: o.last_error,
            createdAt: o.created_at,
          })),
        },
      });
    } catch (error) {
      console.error('Error fetching billing run details:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to retrieve billing run details.');
    }
  });

  // POST /api/v1/billing-runs
  router.post('/billing-runs', authenticate, requirePermission('billing.manage'), async (req, res) => {
    const { targetDate = new Date(), subscriptionId = null, failOnSubscriptionId = null } = req.body || {};
    try {
      const summary = await executeBillingRun({
        pool,
        targetDate,
        subscriptionId,
        createdByUserId: req.user.id,
        audit,
        requestId: req.requestId,
        failOnSubscriptionId,
      });

      await audit({
        actorUserId: req.user.id,
        action: 'billing_run.executed',
        entityType: 'billing_run',
        entityId: summary.billingRun.id,
        metadata: {
          runNumber: summary.billingRun.run_number,
          targetDate,
          totalProcessed: summary.totalProcessed,
          successfulCount: summary.successfulCount,
          failedCount: summary.failedCount,
        },
        requestId: req.requestId,
      });

      res.status(201).json({
        data: {
          billingRun: {
            id: summary.billingRun.id,
            runNumber: summary.billingRun.run_number,
            status: summary.billingRun.status,
            totalSubscriptions: summary.totalProcessed,
            successfulCount: summary.successfulCount,
            failedCount: summary.failedCount,
          },
          createdInvoices: summary.createdInvoices.map((inv) => ({
            id: inv.id,
            invoiceNumber: inv.invoice_number,
            grandTotalCents: inv.grand_total_cents,
            status: inv.status,
          })),
          occurrences: summary.occurrences.map((o) => ({
            id: o.id,
            subscriptionId: o.subscription_id,
            status: o.status,
            idempotencyKey: o.idempotency_key,
            invoiceId: o.invoice_id,
            lastError: o.last_error,
          })),
        },
      });
    } catch (error) {
      console.error('Error executing billing run:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to execute billing run.');
    }
  });

  // GET /api/v1/billing-occurrences
  router.get('/billing-occurrences', authenticate, requirePermission('billing.read'), async (req, res) => {
    const status = req.query.status;
    const subscriptionId = req.query.subscriptionId;

    try {
      let query = `
        SELECT bo.*, s.subscription_number, c.name AS customer_name, i.invoice_number
        FROM billing_occurrences bo
        JOIN subscriptions s ON s.id = bo.subscription_id
        JOIN customers c ON c.id = s.customer_id
        LEFT JOIN invoices i ON i.id = bo.invoice_id
        WHERE 1=1
      `;
      const params = [];

      if (status) {
        params.push(status);
        query += ` AND bo.status = $${params.length}`;
      }

      if (subscriptionId) {
        params.push(subscriptionId);
        query += ` AND bo.subscription_id = $${params.length}`;
      }

      query += ' ORDER BY bo.created_at DESC LIMIT 100';

      const result = await pool.query(query, params);
      res.json({
        data: result.rows.map((o) => ({
          id: o.id,
          subscriptionId: o.subscription_id,
          subscriptionNumber: o.subscription_number,
          customerName: o.customer_name,
          billingRunId: o.billing_run_id,
          idempotencyKey: o.idempotency_key,
          periodStart: o.period_start,
          periodEnd: o.period_end,
          status: o.status,
          invoiceId: o.invoice_id,
          invoiceNumber: o.invoice_number,
          retryCount: o.retry_count,
          lastError: o.last_error,
          createdAt: o.created_at,
          updatedAt: o.updated_at,
        })),
      });
    } catch (error) {
      console.error('Error fetching billing occurrences:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to fetch billing occurrences.');
    }
  });

  // POST /api/v1/billing-occurrences/:id/retry
  router.post('/billing-occurrences/:id/retry', authenticate, requirePermission('billing.manage'), async (req, res) => {
    try {
      const result = await retryBillingOccurrence({
        pool,
        occurrenceId: req.params.id,
        actorUserId: req.user.id,
        audit,
        requestId: req.requestId,
      });

      res.json({
        data: {
          occurrence: {
            id: result.occurrence.id,
            status: result.occurrence.status,
            invoiceId: result.occurrence.invoice_id,
            retryCount: result.occurrence.retry_count,
            lastError: result.occurrence.last_error,
          },
          invoice: result.invoice ? {
            id: result.invoice.id,
            invoiceNumber: result.invoice.invoice_number,
            status: result.invoice.status,
            grandTotalCents: result.invoice.grand_total_cents,
          } : null,
        },
      });
    } catch (error) {
      console.error('Error retrying billing occurrence:', error);
      sendError(res, 400, 'RETRY_FAILED', error.message || 'Unable to retry billing occurrence.');
    }
  });

  return router;
}

module.exports = { createBillingRouter };
