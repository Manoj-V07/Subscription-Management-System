const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidPaymentMethod,
  calculatePaymentAllocation,
  calculateOverdueDays,
  reconcileFinanceData,
  generateCsv,
} = require('../../apps/api/src/domain/finance');

test('finance: payment method validation', () => {
  assert.equal(isValidPaymentMethod('bank_transfer'), true);
  assert.equal(isValidPaymentMethod('credit_card'), true);
  assert.equal(isValidPaymentMethod('upi'), true);
  assert.equal(isValidPaymentMethod('cash'), true);
  assert.equal(isValidPaymentMethod('cheque'), true);
  assert.equal(isValidPaymentMethod('other'), true);
  assert.equal(isValidPaymentMethod('  UPI  '), true);

  assert.equal(isValidPaymentMethod('crypto'), false);
  assert.equal(isValidPaymentMethod(''), false);
  assert.equal(isValidPaymentMethod(null), false);
});

test('finance: payment allocation calculations and overpayment prevention', () => {
  const invoice = {
    id: 'inv-1',
    grand_total_cents: 500000, // 5000.00
    balance_due_cents: 500000,
    status: 'sent',
  };

  // 1. Partial payment
  const partial = calculatePaymentAllocation({ invoice, amountCents: 200000 });
  assert.equal(partial.allocatedAmountCents, 200000);
  assert.equal(partial.previousBalanceDueCents, 500000);
  assert.equal(partial.remainingBalanceDueCents, 300000);
  assert.equal(partial.newStatus, 'partially_paid');

  // 2. Full payment from remaining balance
  const full = calculatePaymentAllocation({
    invoice: { ...invoice, balance_due_cents: 300000, status: 'partially_paid' },
    amountCents: 300000,
  });
  assert.equal(full.allocatedAmountCents, 300000);
  assert.equal(full.remainingBalanceDueCents, 0);
  assert.equal(full.newStatus, 'paid');

  // 3. Overpayment rejection invariant
  assert.throws(
    () => calculatePaymentAllocation({ invoice: { ...invoice, balance_due_cents: 100000 }, amountCents: 150000 }),
    /exceeds invoice balance due/,
  );

  // 4. Invalid amounts
  assert.throws(
    () => calculatePaymentAllocation({ invoice, amountCents: -500 }),
    /positive integer/,
  );
  assert.throws(
    () => calculatePaymentAllocation({ invoice, amountCents: 0 }),
    /positive integer/,
  );
});

test('finance: overdue aging days calculation', () => {
  const reference = new Date(Date.UTC(2026, 10, 20, 12, 0, 0)); // Nov 20, 2026

  // 10 days in the past -> 10 days overdue
  const duePast = new Date(Date.UTC(2026, 10, 10, 0, 0, 0)); // Nov 10
  assert.equal(calculateOverdueDays(duePast, reference), 10);

  // Today -> 0 days overdue
  const dueToday = new Date(Date.UTC(2026, 10, 20, 0, 0, 0));
  assert.equal(calculateOverdueDays(dueToday, reference), 0);

  // Future -> 0 days overdue
  const dueFuture = new Date(Date.UTC(2026, 10, 30, 0, 0, 0));
  assert.equal(calculateOverdueDays(dueFuture, reference), 0);
});

test('finance: reconciliation accounting equation', () => {
  const invoices = [
    { id: '1', grand_total_cents: 100000, balance_due_cents: 0, status: 'paid', due_date: '2026-10-01' },
    { id: '2', grand_total_cents: 200000, balance_due_cents: 50000, status: 'partially_paid', due_date: '2026-10-15' },
    { id: '3', grand_total_cents: 150000, balance_due_cents: 150000, status: 'sent', due_date: '2026-11-01' },
    { id: '4', grand_total_cents: 50000, balance_due_cents: 50000, status: 'cancelled', due_date: '2026-10-05' }, // excluded
  ];

  const payments = [
    { id: 'p1', amount_cents: 100000 },
    { id: 'p2', amount_cents: 150000 },
  ];

  const subscriptions = [
    { id: 's1', status: 'active', grand_total_cents: 200000 },
    { id: 's2', status: 'active', grand_total_cents: 150000 },
    { id: 's3', status: 'closed', grand_total_cents: 100000 },
  ];

  const asOfDate = new Date(Date.UTC(2026, 10, 20)); // Nov 20

  const summary = reconcileFinanceData({ invoices, payments, subscriptions, asOfDate });

  // Billable Invoiced = 100000 + 200000 + 150000 = 450000
  assert.equal(summary.totalInvoicedCents, 450000);
  // Total Collected = 100000 + 150000 = 250000
  assert.equal(summary.totalCollectedCents, 250000);
  // Total Outstanding = 0 + 50000 + 150000 = 200000
  assert.equal(summary.totalOutstandingCents, 200000);

  // Accounting equation: Invoiced (450000) === Collected (250000) + Outstanding (200000)
  assert.equal(summary.isReconciled, true);
  assert.equal(summary.equationDelta, 0);

  // Active Subscriptions
  assert.equal(summary.activeSubscriptionsCount, 2);
  assert.equal(summary.activeSubscriptionsValueCents, 350000);

  // Overdue: inv 2 (due Oct 15, bal 50000) and inv 3 (due Nov 1, bal 150000) -> both < Nov 20!
  assert.equal(summary.overdueInvoicesCount, 2);
  assert.equal(summary.totalOverdueCents, 200000);
});

test('finance: RFC 4180 CSV export generation & escaping', () => {
  const rows = [
    { number: 'INV-001', customer: 'Acme, Inc.', total: '1500.00', status: 'paid' },
    { number: 'INV-002', customer: 'Globex "Worldwide"', total: '2000.00', status: 'sent' },
  ];

  const columns = [
    { key: 'number', label: 'Invoice #' },
    { key: 'customer', label: 'Customer Legal Name' },
    { key: 'total', label: 'Grand Total' },
    { key: 'status', label: 'Status' },
  ];

  const csv = generateCsv(rows, columns);

  // Contains header
  assert.ok(csv.startsWith('Invoice #,Customer Legal Name,Grand Total,Status'));
  // Contains escaped comma in company name: "Acme, Inc."
  assert.ok(csv.includes('"Acme, Inc."'));
  // Contains escaped quotes in company name: "Globex ""Worldwide"""
  assert.ok(csv.includes('"Globex ""Worldwide"""'));
  assert.ok(csv.includes('INV-001'));
  assert.ok(csv.includes('INV-002'));
});
