const express = require('express');
const { reconcileFinanceData, calculateOverdueDays, generateCsv } = require('../domain/finance');

function createReportsRouter({ pool, audit, sendError, authenticate, requirePermission }) {
  const router = express.Router();

  function addFilter(filters, params, clause, value) {
    if (value === undefined || value === null || value === '') return;
    params.push(value);
    filters.push(clause.replace('?', `$${params.length}`));
  }

  // GET /api/v1/reports/summary
  // Directly fulfills Phase 4 Exit Criterion:
  // "finance can answer active, collected, owed, and overdue questions from the application"
  router.get('/reports/summary', authenticate, requirePermission('reports.read'), async (req, res) => {
    try {
      const hasFilters = ['dateFrom', 'dateTo', 'customerId', 'status', 'planId', 'paymentMethod', 'currency']
        .some((key) => req.query[key]);
      let invoicesQuery = 'SELECT id, status, due_date, grand_total_cents, balance_due_cents, currency FROM invoices';
      let paymentsQuery = 'SELECT id, amount_cents, currency, received_date FROM payments';
      let subscriptionsQuery = 'SELECT id, status, grand_total_cents FROM subscriptions';
      const invoiceParams = [];
      const paymentParams = [];
      const subscriptionParams = [];
      if (hasFilters) {
        const invoiceFilters = [];
        addFilter(invoiceFilters, invoiceParams, 'i.issue_date >= ?', req.query.dateFrom);
        addFilter(invoiceFilters, invoiceParams, 'i.issue_date <= ?', req.query.dateTo);
        addFilter(invoiceFilters, invoiceParams, 'i.customer_id = ?', req.query.customerId);
        addFilter(invoiceFilters, invoiceParams, 'i.status = ?', req.query.status);
        addFilter(invoiceFilters, invoiceParams, 's.plan_id = ?', req.query.planId);
        addFilter(invoiceFilters, invoiceParams, 'i.currency = ?', req.query.currency);
        invoicesQuery = `SELECT i.id, i.status, i.due_date, i.grand_total_cents, i.balance_due_cents, i.currency
                         FROM invoices i
                         LEFT JOIN subscriptions s ON s.id = i.subscription_id
                         WHERE ${invoiceFilters.length ? invoiceFilters.join(' AND ') : '1=1'}`;
        const paymentFilters = [];
        addFilter(paymentFilters, paymentParams, 'p.received_date >= ?', req.query.dateFrom);
        addFilter(paymentFilters, paymentParams, 'p.received_date <= ?', req.query.dateTo);
        addFilter(paymentFilters, paymentParams, 'p.customer_id = ?', req.query.customerId);
        addFilter(paymentFilters, paymentParams, 'p.method = ?', req.query.paymentMethod);
        addFilter(paymentFilters, paymentParams, 'p.currency = ?', req.query.currency);
        paymentsQuery = `SELECT p.id, p.amount_cents, p.currency, p.received_date
                         FROM payments p
                         WHERE ${paymentFilters.length ? paymentFilters.join(' AND ') : '1=1'}`;
        const subscriptionFilters = [];
        addFilter(subscriptionFilters, subscriptionParams, 's.status = ?', req.query.status);
        addFilter(subscriptionFilters, subscriptionParams, 's.customer_id = ?', req.query.customerId);
        addFilter(subscriptionFilters, subscriptionParams, 's.plan_id = ?', req.query.planId);
        addFilter(subscriptionFilters, subscriptionParams, 's.currency = ?', req.query.currency);
        subscriptionsQuery = `SELECT s.id, s.status, s.grand_total_cents
                              FROM subscriptions s
                              WHERE ${subscriptionFilters.length ? subscriptionFilters.join(' AND ') : '1=1'}`;
      }

      const [invoicesRes, paymentsRes, subsRes] = await Promise.all([
        pool.query(invoicesQuery, invoiceParams),
        pool.query(paymentsQuery, paymentParams),
        pool.query(subscriptionsQuery, subscriptionParams),
      ]);

      const summary = reconcileFinanceData({
        invoices: invoicesRes.rows,
        payments: paymentsRes.rows,
        subscriptions: subsRes.rows,
        asOfDate: new Date(),
      });

      res.json({
        data: {
          activeSubscriptions: {
            count: summary.activeSubscriptionsCount,
            totalValueCents: summary.activeSubscriptionsValueCents,
          },
          revenueCollected: {
            totalCollectedCents: summary.totalCollectedCents,
            paymentsCount: paymentsRes.rowCount,
          },
          amountOutstanding: {
            totalOutstandingCents: summary.totalOutstandingCents,
            totalInvoicedCents: summary.totalInvoicedCents,
          },
          overdueInvoices: {
            count: summary.overdueInvoicesCount,
            totalOverdueCents: summary.totalOverdueCents,
          },
          reconciliation: {
            isReconciled: summary.isReconciled,
            equationDelta: summary.equationDelta,
            reconciledAt: summary.reconciledAt,
          },
        },
      });
    } catch (error) {
      console.error('Error calculating finance summary report:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to calculate finance summary report.');
    }
  });

  // GET /api/v1/reports/overdue-invoices
  router.get('/reports/overdue-invoices', authenticate, requirePermission('reports.read'), async (req, res) => {
    const customerId = req.query.customerId;
    const minDays = parseInt(req.query.minDaysOverdue) || 0;

    try {
      let query = `
        SELECT i.*,
               c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
               s.subscription_number
        FROM invoices i
        JOIN customers c ON c.id = i.customer_id
        LEFT JOIN subscriptions s ON s.id = i.subscription_id
        WHERE i.balance_due_cents > 0
          AND i.due_date < CURRENT_DATE
          AND i.status NOT IN ('paid', 'cancelled', 'voided')
      `;
      const params = [];

      if (customerId) {
        params.push(customerId);
        query += ` AND i.customer_id = $${params.length}`;
      }

      query += ' ORDER BY i.due_date ASC';

      const result = await pool.query(query, params);
      const today = new Date();

      const overdueList = result.rows
        .map((row) => {
          const daysOverdue = calculateOverdueDays(row.due_date, today);
          return {
            id: row.id,
            invoiceNumber: row.invoice_number,
            customerId: row.customer_id,
            customerName: row.customer_name,
            customerEmail: row.customer_email,
            customerPhone: row.customer_phone,
            subscriptionNumber: row.subscription_number,
            issueDate: row.issue_date,
            dueDate: row.due_date,
            daysOverdue,
            currency: row.currency,
            grandTotalCents: row.grand_total_cents,
            balanceDueCents: row.balance_due_cents,
            status: row.status,
          };
        })
        .filter((item) => item.daysOverdue >= minDays);

      res.json({ data: overdueList });
    } catch (error) {
      console.error('Error fetching overdue invoices report:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to fetch overdue invoices report.');
    }
  });

  // GET /api/v1/reports/revenue
  router.get('/reports/revenue', authenticate, requirePermission('reports.read'), async (req, res) => {
    try {
      const hasFilters = ['dateFrom', 'dateTo', 'customerId', 'paymentMethod', 'currency'].some((key) => req.query[key]);
      const filters = [];
      const params = [];
      if (hasFilters) {
        addFilter(filters, params, 'p.received_date >= ?', req.query.dateFrom);
        addFilter(filters, params, 'p.received_date <= ?', req.query.dateTo);
        addFilter(filters, params, 'p.customer_id = ?', req.query.customerId);
        addFilter(filters, params, 'p.method = ?', req.query.paymentMethod);
        addFilter(filters, params, 'p.currency = ?', req.query.currency);
      }
      const whereClause = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
      const [byMethodRes, byMonthRes] = await Promise.all([
        pool.query(
          `SELECT p.method, COUNT(*)::int AS count, SUM(p.amount_cents)::int AS total_cents
           FROM payments p${whereClause}
           GROUP BY p.method ORDER BY total_cents DESC`,
          params,
        ),
        pool.query(
          `SELECT TO_CHAR(p.received_date, 'YYYY-MM') AS month,
                  COUNT(*)::int AS count,
                  SUM(p.amount_cents)::int AS total_cents
           FROM payments p${whereClause}
           GROUP BY TO_CHAR(p.received_date, 'YYYY-MM')
           ORDER BY month DESC LIMIT 12`,
          params,
        ),
      ]);

      res.json({
        data: {
          byMethod: byMethodRes.rows.map((r) => ({
            method: r.method,
            count: r.count,
            totalCents: r.total_cents,
          })),
          byMonth: byMonthRes.rows.map((r) => ({
            month: r.month,
            count: r.count,
            totalCents: r.total_cents,
          })),
        },
      });
    } catch (error) {
      console.error('Error fetching revenue report:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to fetch revenue report.');
    }
  });

  // POST /api/v1/reports/exports
  // RFC 4180 CSV Export Endpoint with audit logging
  router.post('/reports/exports', authenticate, requirePermission('reports.read'), async (req, res) => {
    const { type = 'invoices' } = req.body || {};

    try {
      let csvContent = '';
      let filename = `export-${type}-${new Date().toISOString().slice(0, 10)}.csv`;

      if (type === 'invoices') {
        const result = await pool.query(
          `SELECT i.invoice_number, c.name AS customer_name, i.issue_date, i.due_date,
                  i.grand_total_cents, i.balance_due_cents, i.currency, i.status
           FROM invoices i
           JOIN customers c ON c.id = i.customer_id
           ORDER BY i.created_at DESC`,
        );
        csvContent = generateCsv(result.rows, [
          { key: 'invoice_number', label: 'Invoice Number' },
          { key: 'customer_name', label: 'Customer' },
          { key: 'issue_date', label: 'Issue Date' },
          { key: 'due_date', label: 'Due Date' },
          { key: 'grand_total_cents', label: 'Grand Total (INR)', format: (c) => (c / 100).toFixed(2) },
          { key: 'balance_due_cents', label: 'Balance Due (INR)', format: (c) => (c / 100).toFixed(2) },
          { key: 'status', label: 'Status' },
        ]);
      } else if (type === 'payments') {
        const result = await pool.query(
          `SELECT p.payment_number, c.name AS customer_name, i.invoice_number,
                  p.method, p.amount_cents, p.received_date, p.external_reference
           FROM payments p
           JOIN customers c ON c.id = p.customer_id
           LEFT JOIN invoices i ON i.id = p.invoice_id
           ORDER BY p.received_date DESC`,
        );
        csvContent = generateCsv(result.rows, [
          { key: 'payment_number', label: 'Payment Number' },
          { key: 'customer_name', label: 'Customer' },
          { key: 'invoice_number', label: 'Invoice Number' },
          { key: 'method', label: 'Payment Method' },
          { key: 'amount_cents', label: 'Amount (INR)', format: (c) => (c / 100).toFixed(2) },
          { key: 'received_date', label: 'Received Date' },
          { key: 'external_reference', label: 'Reference' },
        ]);
      } else if (type === 'overdue') {
        const result = await pool.query(
          `SELECT i.invoice_number, c.name AS customer_name, c.email AS customer_email,
                  i.due_date, i.grand_total_cents, i.balance_due_cents
           FROM invoices i
           JOIN customers c ON c.id = i.customer_id
           WHERE i.balance_due_cents > 0
             AND i.due_date < CURRENT_DATE
             AND i.status NOT IN ('paid', 'cancelled', 'voided')
           ORDER BY i.due_date ASC`,
        );
        const today = new Date();
        const rows = result.rows.map((r) => ({
          ...r,
          days_overdue: calculateOverdueDays(r.due_date, today),
        }));
        csvContent = generateCsv(rows, [
          { key: 'invoice_number', label: 'Invoice Number' },
          { key: 'customer_name', label: 'Customer Name' },
          { key: 'customer_email', label: 'Customer Email' },
          { key: 'due_date', label: 'Due Date' },
          { key: 'days_overdue', label: 'Days Overdue' },
          { key: 'grand_total_cents', label: 'Total Billed (INR)', format: (c) => (c / 100).toFixed(2) },
          { key: 'balance_due_cents', label: 'Balance Owed (INR)', format: (c) => (c / 100).toFixed(2) },
        ]);
      } else {
        return sendError(res, 400, 'VALIDATION_ERROR', `Unsupported export type '${type}'. Supported: invoices, payments, overdue.`);
      }

      await audit({
        actorUserId: req.user.id,
        action: 'report.exported',
        entityType: 'report',
        entityId: type,
        metadata: { type, filename },
        requestId: req.requestId,
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvContent);
    } catch (error) {
      console.error('Error generating CSV export:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to generate CSV export.');
    }
  });

  return router;
}

module.exports = { createReportsRouter };
