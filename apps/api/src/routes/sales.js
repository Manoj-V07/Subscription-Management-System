const express = require('express');
const { calculateDocument, generateDocumentNumber } = require('../domain/pricing');

function createSalesRouter({ pool, audit, sendError, authenticate, requirePermission }) {
  const router = express.Router();

  // ==========================================
  // QUOTATION TEMPLATES
  // ==========================================

  // GET /api/v1/quotation-templates
  router.get('/quotation-templates', authenticate, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT t.*,
          COALESCE(
            json_agg(
              json_build_object(
                'id', l.id,
                'productId', l.product_id,
                'variantId', l.variant_id,
                'defaultQuantity', l.default_quantity,
                'sortOrder', l.sort_order,
                'productName', p.name,
                'unitPriceCents', p.sales_price_cents
              )
            ) FILTER (WHERE l.id IS NOT NULL), '[]'
          ) AS lines
        FROM quotation_templates t
        LEFT JOIN quotation_template_lines l ON l.template_id = t.id
        LEFT JOIN products p ON p.id = l.product_id
        WHERE t.is_active = true
        GROUP BY t.id
        ORDER BY t.created_at DESC`,
      );
      res.json({
        data: result.rows.map((row) => ({
          id: row.id,
          name: row.name,
          validityDays: row.validity_days,
          notes: row.notes,
          isActive: row.is_active,
          createdAt: row.created_at,
          lines: Array.isArray(row.lines) ? row.lines : [],
        })),
      });
    } catch (error) {
      console.error('Error fetching quotation templates:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to fetch quotation templates.');
    }
  });

  // POST /api/v1/quotation-templates
  router.post('/quotation-templates', authenticate, requirePermission('quotes.manage'), async (req, res) => {
    const { name, validityDays = 30, notes = null, lines = [] } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Template name is required.');
    }
    if (!Number.isInteger(validityDays) || validityDays <= 0) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Validity days must be a positive integer.');
    }

    try {
      await pool.query('BEGIN');
      const tmplRes = await pool.query(
        `INSERT INTO quotation_templates (name, validity_days, notes)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [name.trim(), validityDays, notes ? notes.trim() : null],
      );
      const template = tmplRes.rows[0];

      if (Array.isArray(lines) && lines.length > 0) {
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          await pool.query(
            `INSERT INTO quotation_template_lines (template_id, product_id, variant_id, default_quantity, sort_order)
             VALUES ($1, $2, $3, $4, $5)`,
            [template.id, l.productId, l.variantId || null, l.defaultQuantity || 1, i],
          );
        }
      }
      await pool.query('COMMIT');

      await audit({
        actorUserId: req.user.id,
        action: 'quotation_template.created',
        entityType: 'quotation_template',
        entityId: template.id,
        metadata: { name: template.name },
        requestId: req.requestId,
      });

      res.status(201).json({
        data: {
          id: template.id,
          name: template.name,
          validityDays: template.validity_days,
          notes: template.notes,
          isActive: template.is_active,
          createdAt: template.created_at,
          lines,
        },
      });
    } catch (error) {
      await pool.query('ROLLBACK');
      console.error('Error creating template:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to create quotation template.');
    }
  });

  // ==========================================
  // QUOTATIONS
  // ==========================================

  function mapQuotationRow(row) {
    return {
      id: row.id,
      quotationNumber: row.quotation_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      planId: row.plan_id,
      planName: row.plan_name,
      status: row.status,
      issueDate: row.issue_date,
      expiryDate: row.expiry_date,
      currency: row.currency,
      subtotalCents: row.subtotal_cents,
      discountCents: row.discount_cents,
      taxCents: row.tax_cents,
      grandTotalCents: row.grand_total_cents,
      appliedDiscountRuleId: row.applied_discount_rule_id,
      appliedTaxRuleId: row.applied_tax_rule_id,
      snapshotBreakdown: row.snapshot_breakdown,
      lines: Array.isArray(row.lines) ? row.lines : [],
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // GET /api/v1/quotations
  router.get('/quotations', authenticate, async (req, res) => {
    const isStaffOrAdmin = req.user.permissions.includes('quotes.manage') || req.user.permissions.includes('customers.read');
    const customerId = req.query.customerId;
    const status = req.query.status;

    try {
      let query = `
        SELECT q.*, c.name AS customer_name, p.name AS plan_name,
          COALESCE(
            json_agg(
              json_build_object(
                'id', ql.id,
                'productId', ql.product_id,
                'variantId', ql.variant_id,
                'description', ql.description,
                'quantity', ql.quantity,
                'unitPriceCents', ql.unit_price_cents,
                'variantAdjustmentCents', ql.variant_adjustment_cents,
                'lineSubtotalCents', ql.line_subtotal_cents
              )
            ) FILTER (WHERE ql.id IS NOT NULL), '[]'
          ) AS lines
        FROM quotations q
        JOIN customers c ON c.id = q.customer_id
        JOIN plans p ON p.id = q.plan_id
        LEFT JOIN quotation_lines ql ON ql.quotation_id = q.id
        WHERE 1=1
      `;
      const params = [];

      if (!isStaffOrAdmin) {
        // Customer scoping
        params.push(req.user.id);
        query += ` AND c.user_id = $${params.length}`;
      } else if (customerId) {
        params.push(customerId);
        query += ` AND q.customer_id = $${params.length}`;
      }

      if (status) {
        params.push(status);
        query += ` AND q.status = $${params.length}`;
      }

      query += ' GROUP BY q.id, c.name, p.name ORDER BY q.created_at DESC';

      const result = await pool.query(query, params);
      res.json({ data: result.rows.map(mapQuotationRow) });
    } catch (error) {
      console.error('Error fetching quotations:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to fetch quotations.');
    }
  });

  // GET /api/v1/quotations/:id
  router.get('/quotations/:id', authenticate, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT q.*, c.name AS customer_name, c.user_id, p.name AS plan_name,
          COALESCE(
            json_agg(
              json_build_object(
                'id', ql.id,
                'productId', ql.product_id,
                'variantId', ql.variant_id,
                'description', ql.description,
                'quantity', ql.quantity,
                'unitPriceCents', ql.unit_price_cents,
                'variantAdjustmentCents', ql.variant_adjustment_cents,
                'lineSubtotalCents', ql.line_subtotal_cents
              )
            ) FILTER (WHERE ql.id IS NOT NULL), '[]'
          ) AS lines
        FROM quotations q
        JOIN customers c ON c.id = q.customer_id
        JOIN plans p ON p.id = q.plan_id
        LEFT JOIN quotation_lines ql ON ql.quotation_id = q.id
        WHERE q.id = $1
        GROUP BY q.id, c.name, c.user_id, p.name`,
        [req.params.id],
      );

      if (!result.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Quotation not found.');
      const row = result.rows[0];

      const isStaffOrAdmin = req.user.permissions.includes('quotes.manage') || req.user.permissions.includes('customers.read');
      if (!isStaffOrAdmin && row.user_id !== req.user.id) {
        return sendError(res, 403, 'FORBIDDEN', 'Access to quotation denied.');
      }

      res.json({ data: mapQuotationRow(row) });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to retrieve quotation.');
    }
  });

  // POST /api/v1/quotations - Create quotation with calculation engine
  router.post('/quotations', authenticate, requirePermission('quotes.manage'), async (req, res) => {
    const { customerId, planId, lines = [], discountRuleId = null, taxRuleId = null, validityDays = 30 } = req.body || {};

    if (!customerId) return sendError(res, 400, 'VALIDATION_ERROR', 'Customer is required.');
    if (!planId) return sendError(res, 400, 'VALIDATION_ERROR', 'Plan is required.');
    if (!Array.isArray(lines) || lines.length === 0) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'At least one line item is required.');
    }

    try {
      // 1. Verify customer and plan
      const [custRes, planRes] = await Promise.all([
        pool.query('SELECT id, name FROM customers WHERE id = $1', [customerId]),
        pool.query('SELECT id, name FROM plans WHERE id = $1', [planId]),
      ]);

      if (!custRes.rowCount) return sendError(res, 400, 'NOT_FOUND', 'Customer not found.');
      if (!planRes.rowCount) return sendError(res, 400, 'NOT_FOUND', 'Plan not found.');

      // 2. Fetch discount and tax rules if provided
      let discountRule = null;
      let taxRule = null;

      if (discountRuleId) {
        const dRes = await pool.query('SELECT * FROM discount_rules WHERE id = $1 AND is_active = true', [discountRuleId]);
        if (dRes.rowCount) discountRule = dRes.rows[0];
      }
      if (taxRuleId) {
        const tRes = await pool.query('SELECT * FROM tax_rules WHERE id = $1 AND is_active = true', [taxRuleId]);
        if (tRes.rowCount) taxRule = tRes.rows[0];
      }

      // 3. Resolve products and variants for lines
      const processedLines = [];
      for (const line of lines) {
        const prodRes = await pool.query('SELECT id, name, sales_price_cents FROM products WHERE id = $1', [line.productId]);
        if (!prodRes.rowCount) {
          return sendError(res, 400, 'VALIDATION_ERROR', `Product ${line.productId} not found.`);
        }
        const prod = prodRes.rows[0];
        let variant = null;
        if (line.variantId) {
          const varRes = await pool.query('SELECT id, label, adjustment_type, adjustment_value FROM product_variants WHERE id = $1 AND product_id = $2', [line.variantId, prod.id]);
          if (varRes.rowCount) {
            variant = {
              id: varRes.rows[0].id,
              label: varRes.rows[0].label,
              adjustmentType: varRes.rows[0].adjustment_type,
              adjustmentValue: Number(varRes.rows[0].adjustment_value),
            };
          }
        }
        processedLines.push({
          productId: prod.id,
          description: line.description || prod.name,
          quantity: Number(line.quantity) || 1,
          unitPriceCents: prod.sales_price_cents,
          variant,
        });
      }

      // 4. Run through mathematical pricing engine
      const calculation = calculateDocument({
        lines: processedLines,
        discountRule,
        taxRule,
        currency: 'INR',
      });

      // 5. Generate sequence identifier
      const countRes = await pool.query('SELECT COUNT(*)::int AS count FROM quotations');
      const seqNumber = (countRes.rows[0]?.count || 0) + 1;
      const quotationNumber = generateDocumentNumber('QT', seqNumber);

      const expiryDays = Number.isInteger(validityDays) && validityDays > 0 ? validityDays : 30;

      // 6. Transactional insert
      await pool.query('BEGIN');
      const insertQuoteRes = await pool.query(
        `INSERT INTO quotations (
          quotation_number, customer_id, plan_id, status, issue_date, expiry_date, currency,
          subtotal_cents, discount_cents, tax_cents, grand_total_cents,
          applied_discount_rule_id, applied_tax_rule_id, snapshot_breakdown, created_by
        ) VALUES (
          $1, $2, $3, 'draft', CURRENT_DATE, CURRENT_DATE + ($4 || ' days')::interval, 'INR',
          $5, $6, $7, $8, $9, $10, $11::jsonb, $12
        ) RETURNING *`,
        [
          quotationNumber,
          customerId,
          planId,
          expiryDays,
          calculation.subtotalCents,
          calculation.discountCents,
          calculation.taxCents,
          calculation.grandTotalCents,
          calculation.appliedDiscountRuleId,
          calculation.appliedTaxRuleId,
          JSON.stringify(calculation.snapshotBreakdown),
          req.user.id,
        ],
      );
      const quote = insertQuoteRes.rows[0];

      // Insert quotation lines
      for (const line of calculation.lines) {
        await pool.query(
          `INSERT INTO quotation_lines (
            quotation_id, product_id, variant_id, description, quantity,
            unit_price_cents, variant_adjustment_cents, line_subtotal_cents
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            quote.id,
            line.productId,
            line.variant?.id || null,
            line.description,
            line.quantity,
            line.unitPriceCents,
            line.variantAdjustmentPerUnitCents,
            line.lineSubtotalCents,
          ],
        );
      }
      await pool.query('COMMIT');

      await audit({
        actorUserId: req.user.id,
        action: 'quotation.created',
        entityType: 'quotation',
        entityId: quote.id,
        metadata: { quotationNumber, grandTotalCents: quote.grand_total_cents, customerId },
        requestId: req.requestId,
      });

      res.status(201).json({
        data: {
          ...mapQuotationRow({
            ...quote,
            customer_name: custRes.rows[0].name,
            plan_name: planRes.rows[0].name,
            lines: calculation.lines,
          }),
        },
      });
    } catch (error) {
      await pool.query('ROLLBACK');
      console.error('Error creating quotation:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to create quotation.');
    }
  });

  // POST /api/v1/quotations/:id/send - State machine transition: draft -> sent
  router.post('/quotations/:id/send', authenticate, requirePermission('quotes.manage'), async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE quotations SET status = 'sent', updated_at = NOW() WHERE id = $1 AND status = 'draft' RETURNING *`,
        [req.params.id],
      );
      if (!result.rowCount) return sendError(res, 400, 'INVALID_STATE', 'Quotation cannot be marked as sent unless in draft status.');

      await audit({
        actorUserId: req.user.id,
        action: 'quotation.sent',
        entityType: 'quotation',
        entityId: req.params.id,
        requestId: req.requestId,
      });

      res.json({ data: { id: req.params.id, status: 'sent', message: 'Quotation marked as sent.' } });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to send quotation.');
    }
  });

  // POST /api/v1/quotations/:id/confirm - State machine transition: sent -> accepted
  router.post('/quotations/:id/confirm', authenticate, requirePermission('quotes.manage'), async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE quotations SET status = 'accepted', updated_at = NOW() WHERE id = $1 AND status IN ('sent', 'draft') RETURNING *`,
        [req.params.id],
      );
      if (!result.rowCount) return sendError(res, 400, 'INVALID_STATE', 'Quotation cannot be accepted.');

      await audit({
        actorUserId: req.user.id,
        action: 'quotation.accepted',
        entityType: 'quotation',
        entityId: req.params.id,
        requestId: req.requestId,
      });

      res.json({ data: { id: req.params.id, status: 'accepted', message: 'Quotation accepted.' } });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to confirm quotation.');
    }
  });

  // POST /api/v1/quotations/:id/convert - ATOMIC CONVERSION TO SUBSCRIPTION
  // Fulfills Phase 2 Exit Criterion: "a valid quotation can become a confirmed subscription with a calculation breakdown"
  router.post('/quotations/:id/convert', authenticate, requirePermission('quotes.manage'), async (req, res) => {
    try {
      // 1. Fetch quotation and ensure valid status
      const quoteRes = await pool.query('SELECT * FROM quotations WHERE id = $1', [req.params.id]);
      if (!quoteRes.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Quotation not found.');

      const quote = quoteRes.rows[0];
      if (quote.status === 'converted') {
        return sendError(res, 409, 'ALREADY_CONVERTED', 'This quotation has already been converted into a subscription.');
      }
      if (!['accepted', 'sent', 'draft'].includes(quote.status)) {
        return sendError(res, 400, 'INVALID_STATE', `Quotation in '${quote.status}' state cannot be converted.`);
      }

      // Fetch quotation lines
      const linesRes = await pool.query('SELECT * FROM quotation_lines WHERE quotation_id = $1', [quote.id]);
      if (!linesRes.rowCount) {
        return sendError(res, 400, 'EMPTY_QUOTATION', 'Quotation contains no lines to convert.');
      }

      // 2. Generate subscription number: SUB-YYYY-XXXXXX
      const subCountRes = await pool.query('SELECT COUNT(*)::int AS count FROM subscriptions');
      const subSeqNumber = (subCountRes.rows[0]?.count || 0) + 1;
      const subscriptionNumber = generateDocumentNumber('SUB', subSeqNumber);

      // 3. Atomic database transaction
      await pool.query('BEGIN');

      const subRes = await pool.query(
        `INSERT INTO subscriptions (
          subscription_number, quotation_id, customer_id, plan_id, status, starts_at,
          payment_terms_days, currency, subtotal_cents, discount_cents, tax_cents,
          grand_total_cents, balance_due_cents, applied_discount_rule_id,
          applied_tax_rule_id, snapshot_breakdown, created_by
        ) VALUES (
          $1, $2, $3, $4, 'confirmed', NOW(),
          15, $5, $6, $7, $8,
          $9, $10, $11,
          $12, $13::jsonb, $14
        ) RETURNING *`,
        [
          subscriptionNumber,
          quote.id,
          quote.customer_id,
          quote.plan_id,
          quote.currency,
          quote.subtotal_cents,
          quote.discount_cents,
          quote.tax_cents,
          quote.grand_total_cents,
          quote.grand_total_cents, // initial balance due = grand total
          quote.applied_discount_rule_id,
          quote.applied_tax_rule_id,
          JSON.stringify(quote.snapshot_breakdown),
          req.user.id,
        ],
      );
      const subscription = subRes.rows[0];

      // Insert subscription lines from quote lines
      for (const line of linesRes.rows) {
        await pool.query(
          `INSERT INTO subscription_lines (
            subscription_id, product_id, variant_id, description, quantity,
            unit_price_cents, variant_adjustment_cents, line_subtotal_cents
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            subscription.id,
            line.product_id,
            line.variant_id,
            line.description,
            line.quantity,
            line.unit_price_cents,
            line.variant_adjustment_cents,
            line.line_subtotal_cents,
          ],
        );
      }

      // Update quotation state to converted
      await pool.query("UPDATE quotations SET status = 'converted', updated_at = NOW() WHERE id = $1", [quote.id]);

      // If discount rule was applied, increment its times_used counter
      if (quote.applied_discount_rule_id) {
        await pool.query('UPDATE discount_rules SET times_used = times_used + 1 WHERE id = $1', [quote.applied_discount_rule_id]);
      }

      await pool.query('COMMIT');

      // 4. Audit events
      await audit({
        actorUserId: req.user.id,
        action: 'quotation.converted',
        entityType: 'quotation',
        entityId: quote.id,
        metadata: { subscriptionId: subscription.id, subscriptionNumber },
        requestId: req.requestId,
      });

      await audit({
        actorUserId: req.user.id,
        action: 'subscription.created',
        entityType: 'subscription',
        entityId: subscription.id,
        metadata: { subscriptionNumber, quotationId: quote.id, grandTotalCents: subscription.grand_total_cents },
        requestId: req.requestId,
      });

      res.status(201).json({
        data: {
          subscription: {
            id: subscription.id,
            subscriptionNumber: subscription.subscription_number,
            quotationId: quote.id,
            customerId: subscription.customer_id,
            planId: subscription.plan_id,
            status: subscription.status,
            startsAt: subscription.starts_at,
            paymentTermsDays: subscription.payment_terms_days,
            currency: subscription.currency,
            subtotalCents: subscription.subtotal_cents,
            discountCents: subscription.discount_cents,
            taxCents: subscription.tax_cents,
            grandTotalCents: subscription.grand_total_cents,
            balanceDueCents: subscription.balance_due_cents,
            snapshotBreakdown: subscription.snapshot_breakdown,
            createdAt: subscription.created_at,
          },
          quotation: {
            id: quote.id,
            quotationNumber: quote.quotation_number,
            status: 'converted',
          },
        },
      });
    } catch (error) {
      await pool.query('ROLLBACK');
      console.error('Error converting quotation:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to convert quotation to subscription.');
    }
  });

  // ==========================================
  // SUBSCRIPTIONS
  // ==========================================

  function mapSubscriptionRow(row) {
    return {
      id: row.id,
      subscriptionNumber: row.subscription_number,
      quotationId: row.quotation_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      planId: row.plan_id,
      planName: row.plan_name,
      status: row.status,
      startsAt: row.starts_at,
      expiresAt: row.expires_at,
      nextBillingAt: row.next_billing_at,
      paymentTermsDays: row.payment_terms_days,
      currency: row.currency,
      subtotalCents: row.subtotal_cents,
      discountCents: row.discount_cents,
      taxCents: row.tax_cents,
      grandTotalCents: row.grand_total_cents,
      balanceDueCents: row.balance_due_cents,
      snapshotBreakdown: row.snapshot_breakdown,
      lines: Array.isArray(row.lines) ? row.lines : [],
      createdAt: row.created_at,
    };
  }

  // GET /api/v1/subscriptions
  router.get('/subscriptions', authenticate, async (req, res) => {
    const isStaffOrAdmin = req.user.permissions.includes('subscriptions.manage') || req.user.permissions.includes('customers.read');
    const customerId = req.query.customerId;
    const status = req.query.status;

    try {
      let query = `
        SELECT s.*, c.name AS customer_name, p.name AS plan_name,
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
        WHERE 1=1
      `;
      const params = [];

      if (!isStaffOrAdmin) {
        params.push(req.user.id);
        query += ` AND c.user_id = $${params.length}`;
      } else if (customerId) {
        params.push(customerId);
        query += ` AND s.customer_id = $${params.length}`;
      }

      if (status) {
        params.push(status);
        query += ` AND s.status = $${params.length}`;
      }

      query += ' GROUP BY s.id, c.name, p.name ORDER BY s.created_at DESC';

      const result = await pool.query(query, params);
      res.json({ data: result.rows.map(mapSubscriptionRow) });
    } catch (error) {
      console.error('Error fetching subscriptions:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to fetch subscriptions.');
    }
  });

  // GET /api/v1/subscriptions/:id
  router.get('/subscriptions/:id', authenticate, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT s.*, c.name AS customer_name, c.user_id, p.name AS plan_name,
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
        GROUP BY s.id, c.name, c.user_id, p.name`,
        [req.params.id],
      );

      if (!result.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Subscription not found.');
      const row = result.rows[0];

      const isStaffOrAdmin = req.user.permissions.includes('subscriptions.manage') || req.user.permissions.includes('customers.read');
      if (!isStaffOrAdmin && row.user_id !== req.user.id) {
        return sendError(res, 403, 'FORBIDDEN', 'Access to subscription denied.');
      }

      res.json({ data: mapSubscriptionRow(row) });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to retrieve subscription.');
    }
  });

  return router;
}

module.exports = { createSalesRouter };
