const test = require('node:test');
const assert = require('node:assert/strict');
const {
  addBillingInterval,
  computeDueDate,
  generateBillingIdempotencyKey,
  canTransitionSubscription,
  canTransitionInvoice,
  formatCurrency,
  generateInvoicePdf,
} = require('../../apps/api/src/domain/billing');

test('billing interval calculations: daily and weekly', () => {
  const start = new Date(Date.UTC(2026, 0, 10, 12, 0, 0)); // 2026-01-10

  const nextDay = addBillingInterval(start, 'daily', 1);
  assert.equal(nextDay.toISOString(), '2026-01-11T12:00:00.000Z');

  const fiveDays = addBillingInterval(start, 'daily', 5);
  assert.equal(fiveDays.toISOString(), '2026-01-15T12:00:00.000Z');

  const nextWeek = addBillingInterval(start, 'weekly', 1);
  assert.equal(nextWeek.toISOString(), '2026-01-17T12:00:00.000Z');

  const twoWeeks = addBillingInterval(start, 'weekly', 2);
  assert.equal(twoWeeks.toISOString(), '2026-01-24T12:00:00.000Z');
});

test('billing interval calculations: monthly calendar advancement & day clamping', () => {
  // Standard mid-month
  const midJan = new Date(Date.UTC(2026, 0, 15, 0, 0, 0));
  const midFeb = addBillingInterval(midJan, 'monthly', 1);
  assert.equal(midFeb.toISOString(), '2026-02-15T00:00:00.000Z');

  // Month-end clamp: Jan 31 -> Feb 28 (2026 is non-leap year)
  const endJan = new Date(Date.UTC(2026, 0, 31, 10, 0, 0));
  const endFeb = addBillingInterval(endJan, 'monthly', 1);
  assert.equal(endFeb.toISOString(), '2026-02-28T10:00:00.000Z');

  // Month-end clamp: Jan 31 -> Feb 29 (2024 is leap year)
  const endJanLeap = new Date(Date.UTC(2024, 0, 31, 0, 0, 0));
  const endFebLeap = addBillingInterval(endJanLeap, 'monthly', 1);
  assert.equal(endFebLeap.toISOString(), '2024-02-29T00:00:00.000Z');

  // Month-end clamp: Aug 31 -> Sep 30
  const endAug = new Date(Date.UTC(2026, 7, 31, 0, 0, 0));
  const endSep = addBillingInterval(endAug, 'monthly', 1);
  assert.equal(endSep.toISOString(), '2026-09-30T00:00:00.000Z');

  // Multi-month advancement: Oct 31 + 4 months -> Feb 28
  const endOct = new Date(Date.UTC(2026, 9, 31, 0, 0, 0));
  const febNext = addBillingInterval(endOct, 'monthly', 4);
  assert.equal(febNext.toISOString(), '2027-02-28T00:00:00.000Z');
});

test('billing interval calculations: yearly & leap year preservation', () => {
  const std = new Date(Date.UTC(2026, 4, 15, 0, 0, 0)); // 2026-05-15
  const nextYear = addBillingInterval(std, 'yearly', 1);
  assert.equal(nextYear.toISOString(), '2027-05-15T00:00:00.000Z');

  // Feb 29 leap year to non-leap year clamp
  const leapDay = new Date(Date.UTC(2024, 1, 29, 0, 0, 0));
  const nonLeapNext = addBillingInterval(leapDay, 'yearly', 1);
  assert.equal(nonLeapNext.toISOString(), '2025-02-28T00:00:00.000Z');

  // Feb 29 leap year to next leap year (+4 years)
  const nextLeap = addBillingInterval(leapDay, 'yearly', 4);
  assert.equal(nextLeap.toISOString(), '2028-02-29T00:00:00.000Z');

  assert.throws(() => addBillingInterval(std, 'quarterly'), /Unsupported billing interval/);
});

test('due date computation with payment terms', () => {
  const issueDate = new Date(Date.UTC(2026, 10, 1)); // Nov 1
  const dueDate = computeDueDate(issueDate, 15);
  assert.equal(dueDate.getUTCDate(), 16);
  assert.equal(dueDate.getUTCMonth(), 10); // Nov
  assert.equal(dueDate.getUTCFullYear(), 2026);

  // Month boundary wrap
  const endNov = new Date(Date.UTC(2026, 10, 25));
  const dueDec = computeDueDate(endNov, 10);
  assert.equal(dueDec.getUTCDate(), 5);
  assert.equal(dueDec.getUTCMonth(), 11); // Dec
});

test('idempotency key generation', () => {
  const key = generateBillingIdempotencyKey(
    'sub_12345',
    '2026-11-01T00:00:00.000Z',
    '2026-12-01T00:00:00.000Z',
  );
  assert.equal(key, 'sub_sub_12345:2026-11-01T00:00:00.000Z:2026-12-01T00:00:00.000Z');

  assert.throws(() => generateBillingIdempotencyKey('', '2026-01-01', '2026-02-01'), /subscriptionId is required/);
});

test('state machine transitions: subscription', () => {
  // Allowed
  assert.equal(canTransitionSubscription('draft', 'quotation'), true);
  assert.equal(canTransitionSubscription('quotation', 'confirmed'), true);
  assert.equal(canTransitionSubscription('confirmed', 'active'), true);
  assert.equal(canTransitionSubscription('active', 'paused'), true);
  assert.equal(canTransitionSubscription('paused', 'active'), true);
  assert.equal(canTransitionSubscription('active', 'active'), true); // Renewal
  assert.equal(canTransitionSubscription('active', 'closed'), true);
  assert.equal(canTransitionSubscription('confirmed', 'closed'), true);

  // Forbidden
  assert.equal(canTransitionSubscription('closed', 'active'), false);
  assert.equal(canTransitionSubscription('draft', 'active'), false);
  assert.equal(canTransitionSubscription('paused', 'quotation'), false);
});

test('state machine transitions: invoice', () => {
  // Allowed
  assert.equal(canTransitionInvoice('draft', 'confirmed'), true);
  assert.equal(canTransitionInvoice('confirmed', 'sent'), true);
  assert.equal(canTransitionInvoice('sent', 'paid'), true);
  assert.equal(canTransitionInvoice('confirmed', 'cancelled'), true);
  assert.equal(canTransitionInvoice('sent', 'overdue'), true);
  assert.equal(canTransitionInvoice('overdue', 'paid'), true);

  // Forbidden
  assert.equal(canTransitionInvoice('paid', 'draft'), false);
  assert.equal(canTransitionInvoice('cancelled', 'confirmed'), false);
  assert.equal(canTransitionInvoice('draft', 'paid'), false);
});

test('PDF invoice generation: binary structure and content integrity', () => {
  const invoice = {
    invoiceNumber: 'INV-2026-000042',
    issueDate: '2026-11-01',
    dueDate: '2026-11-16',
    status: 'confirmed',
    currency: 'INR',
    subtotalCents: 250000,
    discountCents: 25000,
    taxCents: 40500,
    grandTotalCents: 265500,
    balanceDueCents: 265500,
    paymentTermsDays: 15,
  };

  const customer = {
    name: 'Vertex Systems Tech',
    email: 'accounts@vertex.example',
    taxIdentifier: 'GSTIN29AAACB1234Z',
  };

  const lines = [
    {
      description: 'Brightloop Platform Core',
      quantity: 1,
      unitPriceCents: 250000,
      lineSubtotalCents: 250000,
    },
  ];

  const pdf = generateInvoicePdf(invoice, customer, lines);
  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.length > 200, 'PDF buffer must have valid size');

  const pdfString = pdf.toString('utf8');
  assert.ok(pdfString.startsWith('%PDF-1.4'), 'PDF must start with %PDF-1.4 header');
  assert.ok(pdfString.includes('/Root 1 0 R'), 'PDF must reference Catalog Root');
  assert.ok(pdfString.includes('INV-2026-000042'), 'PDF must include invoice number');
  assert.ok(pdfString.includes('Vertex Systems Tech'), 'PDF must include customer name');
  assert.ok(pdfString.includes('%%EOF'), 'PDF must finish with %%EOF trailer');
});
