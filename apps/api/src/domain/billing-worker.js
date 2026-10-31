/**
 * Brightloop Billing Worker & Idempotent Execution Engine
 * Evaluates active due subscriptions, creates immutable invoices with period locks,
 * records visible and retryable failures in billing_occurrences.
 */

const { addBillingInterval, computeDueDate, generateBillingIdempotencyKey } = require('./billing');
const { generateDocumentNumber } = require('./pricing');

/**
 * Executes a billing run for active due subscriptions.
 * Enforces strict idempotency and transparent failure tracking.
 * 
 * @param {Object} params
 * @param {Object} params.pool
 * @param {Date|string} [params.targetDate]
 * @param {string} [params.subscriptionId]
 * @param {string} [params.createdByUserId]
 * @param {Function} params.audit
 * @param {string} params.requestId
 * @param {string} [params.failOnSubscriptionId] - Simulated failure for test resilience
 * @returns {Promise<Object>} Billing run result summary
 */
async function executeBillingRun({
  pool,
  targetDate = new Date(),
  subscriptionId = null,
  createdByUserId = null,
  audit,
  requestId,
  failOnSubscriptionId = null,
}) {
  const targetIso = new Date(targetDate).toISOString();

  // 1. Initialize Billing Run Record
  const runCountRes = await pool.query('SELECT COUNT(*)::int AS count FROM billing_runs');
  const runSeqNumber = (runCountRes.rows[0]?.count || 0) + 1;
  const runNumber = generateDocumentNumber('BR', runSeqNumber);

  const runInsertRes = await pool.query(
    `INSERT INTO billing_runs (run_number, target_date, status, created_by)
     VALUES ($1, $2, 'processing', $3)
     RETURNING *`,
    [runNumber, targetIso, createdByUserId],
  );
  const billingRun = runInsertRes.rows[0];

  // 2. Fetch Due Active Subscriptions
  let query = `
    SELECT s.*,
           c.name AS customer_name, c.email AS customer_email, c.tax_identifier, c.billing_address,
           p.name AS plan_name, p.interval AS plan_interval, p.interval_count AS plan_interval_count,
           COALESCE(
             json_agg(
               json_build_object(
                 'id', sl.id,
                 'productId', sl.product_id,
                 'variantId', sl.variant_id,
                 'description', sl.description,
                 'quantity', sl.quantity,
                 'unitPriceCents', sl.unit_price_cents,
                 'variantAdjustmentCents', sl.variant_adjustment_cents,
                 'lineSubtotalCents', sl.line_subtotal_cents
               )
             ) FILTER (WHERE sl.id IS NOT NULL), '[]'
           ) AS lines
    FROM subscriptions s
    JOIN customers c ON c.id = s.customer_id
    JOIN plans p ON p.id = s.plan_id
    LEFT JOIN subscription_lines sl ON sl.subscription_id = s.id
    WHERE s.status = 'active'
  `;
  const params = [];

  if (subscriptionId) {
    params.push(subscriptionId);
    query += ` AND s.id = $${params.length}`;
  } else {
    params.push(targetIso);
    query += ` AND s.next_billing_at <= $${params.length}`;
  }

  query += ' GROUP BY s.id, c.name, c.email, c.tax_identifier, c.billing_address, p.name, p.interval, p.interval_count ORDER BY s.next_billing_at ASC';

  const dueRes = await pool.query(query, params);
  const dueSubscriptions = dueRes.rows;

  let successfulCount = 0;
  let failedCount = 0;
  const createdInvoices = [];
  const processedOccurrences = [];
  const errorDetails = [];

  // 3. Process Each Due Subscription Idempotently
  for (const sub of dueSubscriptions) {
    const periodStart = sub.next_billing_at ? new Date(sub.next_billing_at) : new Date(sub.starts_at);
    const periodEnd = addBillingInterval(periodStart, sub.plan_interval, sub.plan_interval_count || 1);
    const idempotencyKey = generateBillingIdempotencyKey(sub.id, periodStart, periodEnd);

    // Check existing occurrence
    const existingOccRes = await pool.query(
      'SELECT * FROM billing_occurrences WHERE idempotency_key = $1',
      [idempotencyKey],
    );
    let occurrence = existingOccRes.rows[0];

    if (occurrence && occurrence.status === 'succeeded') {
      // Idempotent recovery: already billed for this exact window
      const invRes = await pool.query('SELECT * FROM invoices WHERE id = $1', [occurrence.invoice_id]);
      if (invRes.rowCount) {
        createdInvoices.push(invRes.rows[0]);
      }
      processedOccurrences.push(occurrence);
      successfulCount++;
      continue;
    }

    if (!occurrence) {
      const occInsertRes = await pool.query(
        `INSERT INTO billing_occurrences (
          subscription_id, billing_run_id, idempotency_key, period_start, period_end, status
        ) VALUES ($1, $2, $3, $4, $5, 'pending')
        RETURNING *`,
        [sub.id, billingRun.id, idempotencyKey, periodStart.toISOString(), periodEnd.toISOString()],
      );
      occurrence = occInsertRes.rows[0];
    } else {
      // Existing failed occurrence being retried
      await pool.query(
        `UPDATE billing_occurrences
         SET billing_run_id = $1, retry_count = retry_count + 1, updated_at = NOW()
         WHERE id = $2`,
        [billingRun.id, occurrence.id],
      );
    }

    // Check for simulated failure injection
    if (failOnSubscriptionId === sub.id) {
      const errMsg = `Simulated billing worker failure on subscription ${sub.subscription_number}`;
      await pool.query(
        `UPDATE billing_occurrences SET status = 'failed', last_error = $1, updated_at = NOW() WHERE id = $2`,
        [errMsg, occurrence.id],
      );
      failedCount++;
      errorDetails.push({ subscriptionId: sub.id, error: errMsg });
      processedOccurrences.push({ ...occurrence, status: 'failed', last_error: errMsg });
      continue;
    }

    // Execute invoice generation transaction
    await pool.query('BEGIN');
    try {
      // Generate Invoice Number
      const invCountRes = await pool.query('SELECT COUNT(*)::int AS count FROM invoices');
      const invSeq = (invCountRes.rows[0]?.count || 0) + 1;
      const invoiceNumber = generateDocumentNumber('INV', invSeq);

      const dueDate = computeDueDate(periodStart, sub.payment_terms_days);

      // Create Invoice
      const invRes = await pool.query(
        `INSERT INTO invoices (
          invoice_number, customer_id, subscription_id, billing_occurrence_id,
          status, issue_date, due_date, currency, subtotal_cents, discount_cents,
          tax_cents, grand_total_cents, balance_due_cents, payment_terms_days,
          snapshot_breakdown, created_by
        ) VALUES (
          $1, $2, $3, $4,
          'draft', $5, $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14::jsonb, $15
        ) RETURNING *`,
        [
          invoiceNumber,
          sub.customer_id,
          sub.id,
          occurrence.id,
          periodStart.toISOString().slice(0, 10),
          dueDate.toISOString().slice(0, 10),
          sub.currency,
          sub.subtotal_cents,
          sub.discount_cents,
          sub.tax_cents,
          sub.grand_total_cents,
          sub.grand_total_cents, // initial balance due = grand total
          sub.payment_terms_days,
          JSON.stringify(sub.snapshot_breakdown || {}),
          createdByUserId,
        ],
      );
      const invoice = invRes.rows[0];

      // Copy Line Items
      const lines = Array.isArray(sub.lines) ? sub.lines : [];
      for (const line of lines) {
        await pool.query(
          `INSERT INTO invoice_lines (
            invoice_id, product_id, variant_id, description, quantity,
            unit_price_cents, variant_adjustment_cents, line_subtotal_cents
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            invoice.id,
            line.productId,
            line.variantId || null,
            line.description,
            line.quantity,
            line.unitPriceCents,
            line.variantAdjustmentCents || 0,
            line.lineSubtotalCents,
          ],
        );
      }

      // Mark occurrence as succeeded
      const updatedOccRes = await pool.query(
        `UPDATE billing_occurrences
         SET invoice_id = $1, status = 'succeeded', last_error = NULL, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [invoice.id, occurrence.id],
      );

      // Advance Subscription next_billing_at
      await pool.query(
        `UPDATE subscriptions
         SET next_billing_at = $1, updated_at = NOW()
         WHERE id = $2`,
        [periodEnd.toISOString(), sub.id],
      );

      await pool.query('COMMIT');

      if (audit) {
        await audit({
          actorUserId: createdByUserId,
          action: 'invoice.generated',
          entityType: 'invoice',
          entityId: invoice.id,
          metadata: {
            invoiceNumber,
            subscriptionNumber: sub.subscription_number,
            grandTotalCents: invoice.grand_total_cents,
            billingOccurrenceId: occurrence.id,
          },
          requestId,
        });
      }

      successfulCount++;
      createdInvoices.push(invoice);
      processedOccurrences.push(updatedOccRes.rows[0]);
    } catch (error) {
      await pool.query('ROLLBACK');

      // Record visible failure on billing occurrence
      const errRes = await pool.query(
        `UPDATE billing_occurrences
         SET status = 'failed', last_error = $1, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [error.message, occurrence.id],
      );

      failedCount++;
      errorDetails.push({ subscriptionId: sub.id, error: error.message });
      processedOccurrences.push(errRes.rows[0]);

      if (audit) {
        await audit({
          actorUserId: createdByUserId,
          action: 'billing.occurrence_failed',
          entityType: 'billing_occurrence',
          entityId: occurrence.id,
          metadata: { error: error.message, subscriptionId: sub.id },
          requestId,
        });
      }
    }
  }

  // 4. Finalize Billing Run Status
  let finalStatus = 'completed';
  if (failedCount > 0 && successfulCount === 0) {
    finalStatus = 'failed';
  }

  const finalRunRes = await pool.query(
    `UPDATE billing_runs
     SET status = $1,
         total_subscriptions = $2,
         successful_count = $3,
         failed_count = $4,
         error_summary = $5,
         completed_at = NOW()
     WHERE id = $6 RETURNING *`,
    [
      finalStatus,
      dueSubscriptions.length,
      successfulCount,
      failedCount,
      errorDetails.length ? JSON.stringify(errorDetails) : null,
      billingRun.id,
    ],
  );

  return {
    billingRun: finalRunRes.rows[0],
    totalProcessed: dueSubscriptions.length,
    successfulCount,
    failedCount,
    createdInvoices,
    occurrences: processedOccurrences,
  };
}

/**
 * Retries a specific failed billing occurrence.
 * 
 * @param {Object} params
 * @param {Object} params.pool
 * @param {string} params.occurrenceId
 * @param {string} [params.actorUserId]
 * @param {Function} params.audit
 * @param {string} params.requestId
 * @returns {Promise<Object>}
 */
async function retryBillingOccurrence({
  pool,
  occurrenceId,
  actorUserId = null,
  audit,
  requestId,
}) {
  const occRes = await pool.query('SELECT * FROM billing_occurrences WHERE id = $1', [occurrenceId]);
  if (!occRes.rowCount) {
    throw new Error('Billing occurrence not found.');
  }

  const occurrence = occRes.rows[0];
  if (occurrence.status === 'succeeded' && occurrence.invoice_id) {
    const invRes = await pool.query('SELECT * FROM invoices WHERE id = $1', [occurrence.invoice_id]);
    return {
      occurrence,
      invoice: invRes.rows[0] || null,
      message: 'Occurrence is already succeeded.',
    };
  }

  // Fetch subscription details
  const subRes = await pool.query(
    `SELECT s.*,
            c.name AS customer_name, c.email AS customer_email,
            p.name AS plan_name, p.interval AS plan_interval, p.interval_count AS plan_interval_count,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', sl.id,
                  'productId', sl.product_id,
                  'variantId', sl.variant_id,
                  'description', sl.description,
                  'quantity', sl.quantity,
                  'unitPriceCents', sl.unit_price_cents,
                  'variantAdjustmentCents', sl.variant_adjustment_cents,
                  'lineSubtotalCents', sl.line_subtotal_cents
                )
              ) FILTER (WHERE sl.id IS NOT NULL), '[]'
            ) AS lines
     FROM subscriptions s
     JOIN customers c ON c.id = s.customer_id
     JOIN plans p ON p.id = s.plan_id
     LEFT JOIN subscription_lines sl ON sl.subscription_id = s.id
     WHERE s.id = $1
     GROUP BY s.id, c.name, c.email, p.name, p.interval, p.interval_count`,
    [occurrence.subscription_id],
  );

  if (!subRes.rowCount) {
    throw new Error('Subscription associated with billing occurrence does not exist.');
  }
  const sub = subRes.rows[0];

  await pool.query('BEGIN');
  try {
    const invCountRes = await pool.query('SELECT COUNT(*)::int AS count FROM invoices');
    const invSeq = (invCountRes.rows[0]?.count || 0) + 1;
    const invoiceNumber = generateDocumentNumber('INV', invSeq);

    const periodStart = new Date(occurrence.period_start);
    const dueDate = computeDueDate(periodStart, sub.payment_terms_days);

    const invRes = await pool.query(
      `INSERT INTO invoices (
        invoice_number, customer_id, subscription_id, billing_occurrence_id,
        status, issue_date, due_date, currency, subtotal_cents, discount_cents,
        tax_cents, grand_total_cents, balance_due_cents, payment_terms_days,
        snapshot_breakdown, created_by
      ) VALUES (
        $1, $2, $3, $4,
        'draft', $5, $6, $7, $8, $9,
        $10, $11, $12, $13,
        $14::jsonb, $15
      ) RETURNING *`,
      [
        invoiceNumber,
        sub.customer_id,
        sub.id,
        occurrence.id,
        periodStart.toISOString().slice(0, 10),
        dueDate.toISOString().slice(0, 10),
        sub.currency,
        sub.subtotal_cents,
        sub.discount_cents,
        sub.tax_cents,
        sub.grand_total_cents,
        sub.grand_total_cents,
        sub.payment_terms_days,
        JSON.stringify(sub.snapshot_breakdown || {}),
        actorUserId,
      ],
    );
    const invoice = invRes.rows[0];

    const lines = Array.isArray(sub.lines) ? sub.lines : [];
    for (const line of lines) {
      await pool.query(
        `INSERT INTO invoice_lines (
          invoice_id, product_id, variant_id, description, quantity,
          unit_price_cents, variant_adjustment_cents, line_subtotal_cents
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          invoice.id,
          line.productId,
          line.variantId || null,
          line.description,
          line.quantity,
          line.unitPriceCents,
          line.variantAdjustmentCents || 0,
          line.lineSubtotalCents,
        ],
      );
    }

    const updatedOccRes = await pool.query(
      `UPDATE billing_occurrences
       SET invoice_id = $1, status = 'succeeded', last_error = NULL, retry_count = retry_count + 1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [invoice.id, occurrence.id],
    );

    // Advance subscription next_billing_at
    await pool.query(
      `UPDATE subscriptions SET next_billing_at = $1, updated_at = NOW() WHERE id = $2`,
      [occurrence.period_end, sub.id],
    );

    await pool.query('COMMIT');

    if (audit) {
      await audit({
        actorUserId,
        action: 'billing.occurrence_retry_succeeded',
        entityType: 'billing_occurrence',
        entityId: occurrence.id,
        metadata: { invoiceNumber, subscriptionId: sub.id },
        requestId,
      });
    }

    return {
      occurrence: updatedOccRes.rows[0],
      invoice,
    };
  } catch (error) {
    await pool.query('ROLLBACK');
    await pool.query(
      `UPDATE billing_occurrences
       SET retry_count = retry_count + 1, last_error = $1, updated_at = NOW()
       WHERE id = $2`,
      [error.message, occurrence.id],
    );
    throw error;
  }
}

module.exports = {
  executeBillingRun,
  retryBillingOccurrence,
};
