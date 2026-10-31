/**
 * Brightloop Finance & Payments Domain Service
 * Enforces integer minor-unit accounting, allocation invariants,
 * overdue aging, reconciliation checks, and standard RFC 4180 CSV export.
 */

const VALID_PAYMENT_METHODS = ['bank_transfer', 'credit_card', 'upi', 'cash', 'cheque', 'other'];

/**
 * Validates a payment method against accepted types.
 * @param {string} method
 * @returns {boolean}
 */
function isValidPaymentMethod(method) {
  return typeof method === 'string' && VALID_PAYMENT_METHODS.includes(method.toLowerCase().trim());
}

/**
 * Calculates allocation of a payment amount to an invoice.
 * Enforces non-overpayment invariant.
 * 
 * @param {Object} params
 * @param {Object} params.invoice
 * @param {number} params.amountCents - Positive integer
 * @param {boolean} [params.allowOverpayment] - Defaults to false
 * @returns {Object} Calculated allocation result
 */
function calculatePaymentAllocation({ invoice, amountCents, allowOverpayment = false }) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('Payment amount must be a positive integer in minor units (cents/paise).');
  }

  const currentBalance = Number(invoice.balance_due_cents ?? invoice.balanceDueCents ?? 0);
  const grandTotal = Number(invoice.grand_total_cents ?? invoice.grandTotalCents ?? 0);

  if (!allowOverpayment && amountCents > currentBalance) {
    throw new Error(`Payment amount (${amountCents}) exceeds invoice balance due (${currentBalance}).`);
  }

  const remainingBalanceCents = Math.max(0, currentBalance - amountCents);
  let newStatus = invoice.status;

  if (remainingBalanceCents === 0) {
    newStatus = 'paid';
  } else if (remainingBalanceCents < grandTotal) {
    newStatus = 'partially_paid';
  }

  return {
    allocatedAmountCents: amountCents,
    previousBalanceDueCents: currentBalance,
    remainingBalanceDueCents: remainingBalanceCents,
    newStatus,
  };
}

/**
 * Calculates overdue days for an invoice based on due date.
 * 
 * @param {Date|string} dueDate
 * @param {Date|string} [asOfDate]
 * @returns {number} Days overdue (0 if not overdue)
 */
function calculateOverdueDays(dueDate, asOfDate = new Date()) {
  const due = new Date(dueDate);
  const ref = new Date(asOfDate);
  if (isNaN(due.getTime()) || isNaN(ref.getTime())) return 0;

  // Zero out time for clean calendar-day comparison
  const dueUtc = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const refUtc = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());

  const diffMs = refUtc - dueUtc;
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Reconciles revenue collected, outstanding balance, and active subscriptions.
 * Certifies the core accounting equation: Invoiced = Collected + Outstanding.
 * 
 * @param {Object} params
 * @param {Array} params.invoices
 * @param {Array} params.payments
 * @param {Array} params.subscriptions
 * @param {Date|string} [params.asOfDate]
 * @returns {Object} Reconciliation summary
 */
function reconcileFinanceData({ invoices = [], payments = [], subscriptions = [], asOfDate = new Date() }) {
  const refDate = new Date(asOfDate);

  // Filter valid invoices (exclude cancelled/voided)
  const billableInvoices = invoices.filter((i) => i.status !== 'cancelled' && i.status !== 'voided');

  const totalInvoicedCents = billableInvoices.reduce((sum, i) => sum + Number(i.grand_total_cents || i.grandTotalCents || 0), 0);
  const totalCollectedCents = payments.reduce((sum, p) => sum + Number(p.amount_cents || p.amountCents || 0), 0);
  const totalOutstandingCents = billableInvoices.reduce((sum, i) => sum + Number(i.balance_due_cents || i.balanceDueCents || 0), 0);

  // Identify overdue invoices
  const overdueInvoices = billableInvoices.filter((i) => {
    const bal = Number(i.balance_due_cents || i.balanceDueCents || 0);
    const due = new Date(i.due_date || i.dueDate);
    return bal > 0 && due < refDate && i.status !== 'paid';
  });

  const totalOverdueCents = overdueInvoices.reduce((sum, i) => sum + Number(i.balance_due_cents || i.balanceDueCents || 0), 0);

  // Active Subscriptions
  const activeSubs = subscriptions.filter((s) => s.status === 'active');
  const activeSubscriptionsValueCents = activeSubs.reduce((sum, s) => sum + Number(s.grand_total_cents || s.grandTotalCents || 0), 0);

  // Invariant equation check
  const equationDelta = totalInvoicedCents - (totalCollectedCents + totalOutstandingCents);
  const isReconciled = equationDelta === 0;

  return {
    activeSubscriptionsCount: activeSubs.length,
    activeSubscriptionsValueCents,
    totalInvoicedCents,
    totalCollectedCents,
    totalOutstandingCents,
    overdueInvoicesCount: overdueInvoices.length,
    totalOverdueCents,
    isReconciled,
    equationDelta,
    reconciledAt: refDate.toISOString(),
  };
}

/**
 * Generates an RFC 4180 compliant CSV string from an array of objects.
 * Properly escapes commas, double quotes, and newlines.
 * 
 * @param {Array<Object>} rows
 * @param {Array<{ key: string, label: string, format?: Function }>} columns
 * @returns {string} CSV content
 */
function generateCsv(rows = [], columns = []) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('Columns specification required for CSV export.');
  }

  function escapeCell(val) {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  const headerRow = columns.map((col) => escapeCell(col.label)).join(',');
  const dataRows = rows.map((row) => {
    return columns.map((col) => {
      const rawVal = row[col.key];
      const val = typeof col.format === 'function' ? col.format(rawVal, row) : rawVal;
      return escapeCell(val);
    }).join(',');
  });

  return [headerRow, ...dataRows].join('\r\n') + '\r\n';
}

module.exports = {
  VALID_PAYMENT_METHODS,
  isValidPaymentMethod,
  calculatePaymentAllocation,
  calculateOverdueDays,
  reconcileFinanceData,
  generateCsv,
};
