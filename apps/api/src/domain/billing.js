/**
 * Brightloop Billing & Scheduling Domain Service
 * Encapsulates interval calculations, state machines, idempotency keys,
 * and standard PDF/HTML invoice rendering.
 */

/**
 * Calculates a date advanced by a given plan interval in UTC.
 * Safely preserves calendar end-of-month dates without drifting.
 * 
 * @param {Date|string|number} baseDate - Starting point
 * @param {'daily'|'weekly'|'monthly'|'yearly'} interval
 * @param {number} intervalCount - Positive integer multiplier (e.g. 1, 3, 12)
 * @returns {Date} Advanced Date in UTC
 */
function addBillingInterval(baseDate, interval, intervalCount = 1) {
  const d = new Date(baseDate);
  if (isNaN(d.getTime())) {
    throw new Error('Invalid baseDate provided to addBillingInterval');
  }
  const count = Number.isInteger(intervalCount) && intervalCount > 0 ? intervalCount : 1;

  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const seconds = d.getUTCSeconds();
  const ms = d.getUTCMilliseconds();

  switch (interval) {
    case 'daily': {
      const target = new Date(Date.UTC(year, month, day + count, hours, minutes, seconds, ms));
      return target;
    }
    case 'weekly': {
      const target = new Date(Date.UTC(year, month, day + (count * 7), hours, minutes, seconds, ms));
      return target;
    }
    case 'monthly': {
      // Advance month while handling shorter months (e.g. Jan 31 -> Feb 28/29)
      const targetMonth = month + count;
      const targetYear = year + Math.floor(targetMonth / 12);
      const normalizedMonth = ((targetMonth % 12) + 12) % 12;
      
      // Days in target month
      const daysInTargetMonth = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
      const clampedDay = Math.min(day, daysInTargetMonth);

      return new Date(Date.UTC(targetYear, normalizedMonth, clampedDay, hours, minutes, seconds, ms));
    }
    case 'yearly': {
      const targetYear = year + count;
      // Handle leap year clamp (Feb 29 on non-leap year -> Feb 28)
      let clampedDay = day;
      if (month === 1 && day === 29) {
        const isLeap = (targetYear % 4 === 0 && targetYear % 100 !== 0) || (targetYear % 400 === 0);
        if (!isLeap) clampedDay = 28;
      }
      return new Date(Date.UTC(targetYear, month, clampedDay, hours, minutes, seconds, ms));
    }
    default:
      throw new Error(`Unsupported billing interval: '${interval}'`);
  }
}

/**
 * Computes an invoice due date based on issue date and payment terms days.
 * 
 * @param {Date|string} issueDate
 * @param {number} paymentTermsDays
 * @returns {Date}
 */
function computeDueDate(issueDate, paymentTermsDays = 15) {
  const d = new Date(issueDate);
  if (isNaN(d.getTime())) {
    throw new Error('Invalid issueDate provided to computeDueDate');
  }
  const days = Number.isInteger(paymentTermsDays) && paymentTermsDays >= 0 ? paymentTermsDays : 15;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days, 23, 59, 59, 999));
}

/**
 * Generates an immutable, unique idempotency key for a subscription billing period.
 * 
 * @param {string} subscriptionId
 * @param {Date|string} periodStart
 * @param {Date|string} periodEnd
 * @returns {string}
 */
function generateBillingIdempotencyKey(subscriptionId, periodStart, periodEnd) {
  if (!subscriptionId) throw new Error('subscriptionId is required for billing idempotency key.');
  const startIso = new Date(periodStart).toISOString();
  const endIso = new Date(periodEnd).toISOString();
  return `sub_${subscriptionId}:${startIso}:${endIso}`;
}

/**
 * Subscription State Machine Transitions
 */
const SUBSCRIPTION_TRANSITIONS = {
  draft: ['quotation', 'confirmed', 'closed'],
  quotation: ['confirmed', 'closed'],
  confirmed: ['active', 'closed'],
  active: ['paused', 'active', 'closed'], // active -> active on renewal
  paused: ['active', 'closed'],
  closed: [], // Terminal
};

/**
 * Validates whether a subscription status transition is legal.
 */
function canTransitionSubscription(currentStatus, targetStatus) {
  if (currentStatus === targetStatus && currentStatus === 'active') return true; // renewal
  const allowed = SUBSCRIPTION_TRANSITIONS[currentStatus];
  return Array.isArray(allowed) && allowed.includes(targetStatus);
}

/**
 * Invoice State Machine Transitions
 */
const INVOICE_TRANSITIONS = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['sent', 'partially_paid', 'paid', 'overdue', 'cancelled'],
  sent: ['partially_paid', 'paid', 'overdue', 'cancelled'],
  partially_paid: ['paid', 'overdue', 'cancelled'],
  overdue: ['partially_paid', 'paid', 'cancelled'],
  paid: [],
  cancelled: [],
  voided: [],
};

/**
 * Validates whether an invoice status transition is legal.
 */
function canTransitionInvoice(currentStatus, targetStatus) {
  const allowed = INVOICE_TRANSITIONS[currentStatus];
  return Array.isArray(allowed) && allowed.includes(targetStatus);
}

/**
 * Formats minor units (cents/paise) into decimal currency string.
 */
function formatCurrency(cents, currency = 'INR') {
  const symbol = currency === 'INR' ? '₹' : (currency === 'USD' ? '$' : `${currency} `);
  const formatted = (Number(cents || 0) / 100).toFixed(2);
  return `${symbol}${formatted}`;
}

/**
 * Generates a standard PDF 1.4 binary buffer for an invoice.
 * Completely self-contained without external native binary dependencies.
 */
function generateInvoicePdf(invoice, customer, lines = []) {
  const title = `TAX INVOICE - ${invoice.invoiceNumber || 'INV'}`;
  const invNum = invoice.invoiceNumber || 'INV-DRAFT';
  const issueDate = invoice.issueDate ? new Date(invoice.issueDate).toISOString().slice(0, 10) : 'N/A';
  const dueDate = invoice.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : 'N/A';
  const status = (invoice.status || 'draft').toUpperCase();
  const customerName = customer?.name || 'Customer';
  const customerEmail = customer?.email || '';
  const taxId = customer?.taxIdentifier || 'N/A';
  const currency = invoice.currency || 'INR';

  const subtotal = formatCurrency(invoice.subtotalCents, currency);
  const discount = formatCurrency(invoice.discountCents, currency);
  const tax = formatCurrency(invoice.taxCents, currency);
  const grandTotal = formatCurrency(invoice.grandTotalCents, currency);
  const balanceDue = formatCurrency(invoice.balanceDueCents, currency);

  // Build PDF Content Stream Commands
  const textLines = [
    'BT',
    '/F1 20 Tf',
    '50 780 Td',
    '(BRIGHTLOOP SOFTWARE) Tj',
    '0 -24 Td',
    '/F1 14 Tf',
    `(${title}) Tj`,
    '0 -20 Td',
    '/F2 10 Tf',
    `(Status: ${status}    |    Issued: ${issueDate}    |    Due: ${dueDate}) Tj`,
    '0 -30 Td',
    '/F1 11 Tf',
    '(BILLED TO:) Tj',
    '0 -15 Td',
    '/F2 10 Tf',
    `(${customerName.replace(/[()]/g, '')}) Tj`,
    '0 -14 Td',
    `(${customerEmail.replace(/[()]/g, '')}    GSTIN/Tax ID: ${taxId.replace(/[()]/g, '')}) Tj`,
    '0 -30 Td',
    '/F1 11 Tf',
    '(ITEMS & CHARGES) Tj',
    '0 -5 Td',
  ];

  // Draw Line Items
  textLines.push('/F2 10 Tf');
  lines.forEach((l, index) => {
    const desc = (l.description || `Line item ${index + 1}`).replace(/[()]/g, '');
    const qty = l.quantity || 1;
    const unit = formatCurrency(l.unitPriceCents, currency);
    const total = formatCurrency(l.lineSubtotalCents, currency);
    textLines.push('0 -18 Td');
    textLines.push(`(${index + 1}. ${desc} x ${qty} @ ${unit} = ${total}) Tj`);
  });

  // Totals Section
  textLines.push('0 -35 Td');
  textLines.push('/F1 11 Tf');
  textLines.push('(PAYMENT SUMMARY) Tj');
  textLines.push('/F2 10 Tf');
  textLines.push('0 -18 Td');
  textLines.push(`(Subtotal: ${subtotal}) Tj`);
  if (invoice.discountCents > 0) {
    textLines.push('0 -16 Td');
    textLines.push(`(Discount: -${discount}) Tj`);
  }
  textLines.push('0 -16 Td');
  textLines.push(`(Tax: +${tax}) Tj`);
  textLines.push('0 -18 Td');
  textLines.push('/F1 12 Tf');
  textLines.push(`(Grand Total: ${grandTotal}    Balance Due: ${balanceDue}) Tj`);

  textLines.push('0 -40 Td');
  textLines.push('/F2 9 Tf');
  textLines.push('(Thank you for your business. Payment terms: Due within specified date.) Tj');
  textLines.push('ET');

  const streamContent = textLines.join('\n');
  const streamLength = Buffer.byteLength(streamContent, 'utf8');

  // PDF 1.4 Object Construction
  const objects = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');
  objects.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj');
  objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj');
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj');
  objects.push(`6 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream\nendobj`);

  let offset = 0;
  let body = '%PDF-1.4\n';
  offset = Buffer.byteLength(body, 'utf8');

  const xref = ['xref', '0 7', '0000000000 65535 f '];
  objects.forEach((obj) => {
    const padded = String(offset).padStart(10, '0');
    xref.push(`${padded} 00000 n `);
    body += obj + '\n';
    offset = Buffer.byteLength(body, 'utf8');
  });

  const xrefStart = offset;
  const trailer = `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  const pdfString = body + xref.join('\n') + '\n' + trailer;

  return Buffer.from(pdfString, 'utf8');
}

/**
 * Generates structured HTML markup for an invoice (for preview / browser printing).
 */
function generateInvoiceHtml(invoice, customer, lines = []) {
  const currency = invoice.currency || 'INR';
  const rows = lines
    .map(
      (l, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${l.description}</td>
      <td style="text-align:center;">${l.quantity}</td>
      <td style="text-align:right;">${formatCurrency(l.unitPriceCents, currency)}</td>
      <td style="text-align:right;">${formatCurrency(l.lineSubtotalCents, currency)}</td>
    </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Invoice ${invoice.invoiceNumber}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 40px; color: #1e293b; }
    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; }
    .brand { font-size: 24px; font-weight: 700; color: #0284c7; }
    .invoice-title { font-size: 22px; font-weight: 700; text-align: right; }
    .details { display: flex; justify-content: space-between; margin: 30px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th { background: #f8fafc; border-bottom: 2px solid #cbd5e1; padding: 10px; text-align: left; }
    td { padding: 10px; border-bottom: 1px solid #e2e8f0; }
    .totals { margin-top: 30px; margin-left: auto; width: 300px; }
    .totals-row { display: flex; justify-content: space-between; padding: 6px 0; }
    .totals-row.grand { font-size: 18px; font-weight: 700; border-top: 2px solid #0f172a; padding-top: 10px; }
    .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; background: #e0f2fe; color: #0369a1; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">BRIGHTLOOP</div>
      <p>Brightloop Subscription Operations</p>
    </div>
    <div class="invoice-title">
      <div>TAX INVOICE</div>
      <div style="font-size:16px; color:#64748b; margin-top:4px;">${invoice.invoiceNumber}</div>
      <div class="badge" style="margin-top:6px;">${invoice.status}</div>
    </div>
  </div>
  <div class="details">
    <div>
      <strong>Billed To:</strong><br>
      ${customer?.name || 'Customer'}<br>
      ${customer?.email || ''}<br>
      Tax ID / GSTIN: ${customer?.taxIdentifier || 'N/A'}
    </div>
    <div style="text-align:right;">
      <strong>Issue Date:</strong> ${invoice.issueDate ? new Date(invoice.issueDate).toLocaleDateString() : 'N/A'}<br>
      <strong>Due Date:</strong> ${invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'N/A'}<br>
      <strong>Payment Terms:</strong> ${invoice.paymentTermsDays || 15} Days
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Description</th>
        <th style="text-align:center;">Qty</th>
        <th style="text-align:right;">Unit Price</th>
        <th style="text-align:right;">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <div class="totals">
    <div class="totals-row"><span>Subtotal:</span><span>${formatCurrency(invoice.subtotalCents, currency)}</span></div>
    ${invoice.discountCents > 0 ? `<div class="totals-row"><span>Discount:</span><span>-${formatCurrency(invoice.discountCents, currency)}</span></div>` : ''}
    <div class="totals-row"><span>Tax (GST):</span><span>+${formatCurrency(invoice.taxCents, currency)}</span></div>
    <div class="totals-row grand"><span>Grand Total:</span><span>${formatCurrency(invoice.grandTotalCents, currency)}</span></div>
    <div class="totals-row" style="font-weight:600; color:#0369a1;"><span>Balance Due:</span><span>${formatCurrency(invoice.balanceDueCents, currency)}</span></div>
  </div>
</body>
</html>`;
}

module.exports = {
  addBillingInterval,
  computeDueDate,
  generateBillingIdempotencyKey,
  canTransitionSubscription,
  canTransitionInvoice,
  SUBSCRIPTION_TRANSITIONS,
  INVOICE_TRANSITIONS,
  formatCurrency,
  generateInvoicePdf,
  generateInvoiceHtml,
};
