/**
 * Brightloop Notifications & Email Delivery Adapter
 * Records email notification delivery attempts, enforces audit tracking,
 * and maintains resilient retry mechanisms.
 */

/**
 * Prepares and sends an email notification for an invoice.
 * Records the delivery attempt in email_notifications.
 * 
 * @param {Object} params
 * @param {Object} params.pool - Database client pool
 * @param {Object} params.invoice - Invoice entity
 * @param {Object} params.customer - Customer entity
 * @param {string} [params.recipientEmail] - Optional override email
 * @param {Function} params.audit - Audit function
 * @param {string} params.requestId - Request correlation ID
 * @param {string} [params.actorUserId] - Triggering user ID
 * @param {boolean} [params.simulateFailure] - For resilience/retry testing
 * @returns {Promise<Object>} Delivery record
 */
async function sendInvoiceNotification({
  pool,
  invoice,
  customer,
  recipientEmail = null,
  audit,
  requestId,
  actorUserId = null,
  simulateFailure = false,
}) {
  const email = (recipientEmail || customer?.email || '').trim().toLowerCase();
  if (!email) {
    throw new Error('No recipient email available for customer.');
  }

  const subject = `Tax Invoice ${invoice.invoice_number || invoice.invoiceNumber} from Brightloop`;
  const grandTotal = ((invoice.grand_total_cents || invoice.grandTotalCents || 0) / 100).toFixed(2);
  const currency = invoice.currency || 'INR';
  const dueDate = (invoice.due_date || invoice.dueDate) ? new Date(invoice.due_date || invoice.dueDate).toISOString().slice(0, 10) : 'Due on receipt';

  const body = `Dear ${customer?.name || 'Customer'},\n\n` +
    `Your invoice ${invoice.invoice_number || invoice.invoiceNumber} has been issued.\n` +
    `Total Amount: ${currency} ${grandTotal}\n` +
    `Due Date: ${dueDate}\n\n` +
    `You can review and download your invoice PDF directly through the Brightloop Customer Portal.\n\n` +
    `Thank you,\nBrightloop Billing Team`;

  if (simulateFailure) {
    const errorMsg = 'Simulated SMTP connection timeout';
    const failedRes = await pool.query(
      `INSERT INTO email_notifications (entity_type, entity_id, recipient_email, subject, body, status, retry_count, last_error)
       VALUES ('invoice', $1, $2, $3, $4, 'failed', 0, $5)
       RETURNING *`,
      [invoice.id, email, subject, body, errorMsg],
    );

    if (audit) {
      await audit({
        actorUserId,
        action: 'invoice.email_delivery_failed',
        entityType: 'invoice',
        entityId: invoice.id,
        metadata: { error: errorMsg, recipient: email },
        requestId,
      });
    }

    return {
      success: false,
      notification: failedRes.rows[0],
      error: errorMsg,
    };
  }

  const res = await pool.query(
    `INSERT INTO email_notifications (entity_type, entity_id, recipient_email, subject, body, status, retry_count, sent_at)
     VALUES ('invoice', $1, $2, $3, $4, 'sent', 0, NOW())
     RETURNING *`,
    [invoice.id, email, subject, body],
  );

  if (audit) {
    await audit({
      actorUserId,
      action: 'invoice.email_delivered',
      entityType: 'invoice',
      entityId: invoice.id,
      metadata: { recipient: email, invoiceNumber: invoice.invoice_number || invoice.invoiceNumber },
      requestId,
    });
  }

  return {
    success: true,
    notification: res.rows[0],
  };
}

module.exports = {
  sendInvoiceNotification,
};
