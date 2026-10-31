const express = require('express');

function createCatalogRouter({ pool, audit, sendError, authenticate, requirePermission }) {
  const router = express.Router();

  // Helper to format product row
  function mapProductRow(row) {
    return {
      id: row.id,
      name: row.name,
      productType: row.product_type,
      salesPriceCents: row.sales_price_cents,
      costPriceCents: row.cost_price_cents,
      currency: row.currency,
      notes: row.notes,
      isArchived: row.is_archived,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      variants: Array.isArray(row.variants) ? row.variants : [],
    };
  }

  // ==========================================
  // PRODUCTS & VARIANTS
  // ==========================================

  // GET /api/v1/products - List products with nested variants
  router.get('/products', authenticate, async (req, res) => {
    const includeArchived = req.query.includeArchived === 'true';
    try {
      const query = `
        SELECT p.*,
          COALESCE(
            json_agg(
              json_build_object(
                'id', v.id,
                'label', v.label,
                'adjustmentType', v.adjustment_type,
                'adjustmentValue', v.adjustment_value,
                'isActive', v.is_active
              )
            ) FILTER (WHERE v.id IS NOT NULL), '[]'
          ) AS variants
        FROM products p
        LEFT JOIN product_variants v ON v.product_id = p.id
        WHERE ($1 = true OR p.is_archived = false)
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `;
      const result = await pool.query(query, [includeArchived]);
      res.json({ data: result.rows.map(mapProductRow) });
    } catch (error) {
      console.error('Error fetching products:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to fetch products.');
    }
  });

  // POST /api/v1/products - Create a new product
  router.post('/products', authenticate, requirePermission('catalog.manage'), async (req, res) => {
    const { name, productType = 'service', salesPriceCents, costPriceCents = 0, currency = 'INR', notes = null } = req.body || {};
    const details = [];

    if (typeof name !== 'string' || name.trim().length === 0) {
      details.push({ field: 'name', code: 'REQUIRED', message: 'Product name is required.' });
    }
    if (!['service', 'goods'].includes(productType)) {
      details.push({ field: 'productType', code: 'INVALID', message: 'Product type must be service or goods.' });
    }
    if (!Number.isInteger(salesPriceCents) || salesPriceCents < 0) {
      details.push({ field: 'salesPriceCents', code: 'INVALID_PRICE', message: 'Sales price must be a non-negative integer in minor units.' });
    }
    if (!Number.isInteger(costPriceCents) || costPriceCents < 0) {
      details.push({ field: 'costPriceCents', code: 'INVALID_PRICE', message: 'Cost price must be a non-negative integer in minor units.' });
    }

    if (details.length) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'One or more fields are invalid.', details);
    }

    try {
      const result = await pool.query(
        `INSERT INTO products (name, product_type, sales_price_cents, cost_price_cents, currency, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [name.trim(), productType, salesPriceCents, costPriceCents, currency.toUpperCase(), notes ? notes.trim() : null],
      );
      const product = mapProductRow(result.rows[0]);
      await audit({
        actorUserId: req.user.id,
        action: 'product.created',
        entityType: 'product',
        entityId: product.id,
        metadata: { name: product.name, salesPriceCents: product.salesPriceCents },
        requestId: req.requestId,
      });
      res.status(201).json({ data: product });
    } catch (error) {
      console.error('Error creating product:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to create product.');
    }
  });

  // GET /api/v1/products/:id - Single product with variants
  router.get('/products/:id', authenticate, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT p.*,
          COALESCE(
            json_agg(
              json_build_object(
                'id', v.id,
                'label', v.label,
                'adjustmentType', v.adjustment_type,
                'adjustmentValue', v.adjustment_value,
                'isActive', v.is_active
              )
            ) FILTER (WHERE v.id IS NOT NULL), '[]'
          ) AS variants
        FROM products p
        LEFT JOIN product_variants v ON v.product_id = p.id
        WHERE p.id = $1
        GROUP BY p.id`,
        [req.params.id],
      );
      if (!result.rowCount) {
        return sendError(res, 404, 'NOT_FOUND', 'Product not found.');
      }
      res.json({ data: mapProductRow(result.rows[0]) });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to retrieve product.');
    }
  });

  // PATCH /api/v1/products/:id - Update product
  router.patch('/products/:id', authenticate, requirePermission('catalog.manage'), async (req, res) => {
    const { name, productType, salesPriceCents, costPriceCents, notes } = req.body || {};
    try {
      const existing = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
      if (!existing.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Product not found.');

      const current = existing.rows[0];
      const updatedName = typeof name === 'string' && name.trim().length ? name.trim() : current.name;
      const updatedType = ['service', 'goods'].includes(productType) ? productType : current.product_type;
      const updatedSalesPrice = Number.isInteger(salesPriceCents) && salesPriceCents >= 0 ? salesPriceCents : current.sales_price_cents;
      const updatedCostPrice = Number.isInteger(costPriceCents) && costPriceCents >= 0 ? costPriceCents : current.cost_price_cents;
      const updatedNotes = notes !== undefined ? (notes ? notes.trim() : null) : current.notes;

      const result = await pool.query(
        `UPDATE products
         SET name = $1, product_type = $2, sales_price_cents = $3, cost_price_cents = $4, notes = $5, updated_at = NOW()
         WHERE id = $6
         RETURNING *`,
        [updatedName, updatedType, updatedSalesPrice, updatedCostPrice, updatedNotes, req.params.id],
      );

      await audit({
        actorUserId: req.user.id,
        action: 'product.updated',
        entityType: 'product',
        entityId: req.params.id,
        metadata: { name: updatedName, salesPriceCents: updatedSalesPrice },
        requestId: req.requestId,
      });

      res.json({ data: mapProductRow(result.rows[0]) });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to update product.');
    }
  });

  // POST /api/v1/products/:id/archive - Archive product
  router.post('/products/:id/archive', authenticate, requirePermission('catalog.manage'), async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE products SET is_archived = true, archived_at = NOW(), updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [req.params.id],
      );
      if (!result.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Product not found.');

      await audit({
        actorUserId: req.user.id,
        action: 'product.archived',
        entityType: 'product',
        entityId: req.params.id,
        requestId: req.requestId,
      });

      res.json({ data: mapProductRow(result.rows[0]) });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to archive product.');
    }
  });

  // GET /api/v1/products/:id/variants - Get variants
  router.get('/products/:id/variants', authenticate, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, product_id AS "productId", label, adjustment_type AS "adjustmentType",
                adjustment_value AS "adjustmentValue", is_active AS "isActive", created_at AS "createdAt"
         FROM product_variants WHERE product_id = $1 ORDER BY created_at ASC`,
        [req.params.id],
      );
      res.json({ data: result.rows });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to fetch variants.');
    }
  });

  // POST /api/v1/products/:id/variants - Add a variant
  router.post('/products/:id/variants', authenticate, requirePermission('catalog.manage'), async (req, res) => {
    const { label, adjustmentType, adjustmentValue } = req.body || {};
    const details = [];

    if (typeof label !== 'string' || !label.trim()) details.push({ field: 'label', code: 'REQUIRED', message: 'Variant label is required.' });
    if (!['fixed', 'percentage'].includes(adjustmentType)) details.push({ field: 'adjustmentType', code: 'INVALID', message: 'Adjustment type must be fixed or percentage.' });
    if (typeof adjustmentValue !== 'number' || isNaN(adjustmentValue)) details.push({ field: 'adjustmentValue', code: 'INVALID', message: 'Adjustment value must be a number.' });

    if (details.length) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid variant attributes.', details);

    try {
      const prod = await pool.query('SELECT id FROM products WHERE id = $1', [req.params.id]);
      if (!prod.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Product not found.');

      const result = await pool.query(
        `INSERT INTO product_variants (product_id, label, adjustment_type, adjustment_value)
         VALUES ($1, $2, $3, $4)
         RETURNING id, product_id AS "productId", label, adjustment_type AS "adjustmentType", adjustment_value AS "adjustmentValue", is_active AS "isActive"`,
        [req.params.id, label.trim(), adjustmentType, adjustmentValue],
      );

      await audit({
        actorUserId: req.user.id,
        action: 'product_variant.created',
        entityType: 'product_variant',
        entityId: result.rows[0].id,
        metadata: { label, adjustmentType, adjustmentValue, productId: req.params.id },
        requestId: req.requestId,
      });

      res.status(201).json({ data: result.rows[0] });
    } catch (error) {
      if (error.code === '23505') {
        return sendError(res, 409, 'CONFLICT', 'A variant with this label already exists for this product.');
      }
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to create variant.');
    }
  });

  // PATCH /api/v1/products/:id/variants/:variantId - Update variant
  router.patch('/products/:id/variants/:variantId', authenticate, requirePermission('catalog.manage'), async (req, res) => {
    const { label, adjustmentType, adjustmentValue, isActive } = req.body || {};
    try {
      const existing = await pool.query('SELECT * FROM product_variants WHERE id = $1 AND product_id = $2', [req.params.variantId, req.params.id]);
      if (!existing.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Variant not found.');

      const current = existing.rows[0];
      const updatedLabel = typeof label === 'string' && label.trim() ? label.trim() : current.label;
      const updatedType = ['fixed', 'percentage'].includes(adjustmentType) ? adjustmentType : current.adjustment_type;
      const updatedValue = typeof adjustmentValue === 'number' && !isNaN(adjustmentValue) ? adjustmentValue : current.adjustment_value;
      const updatedActive = typeof isActive === 'boolean' ? isActive : current.is_active;

      const result = await pool.query(
        `UPDATE product_variants
         SET label = $1, adjustment_type = $2, adjustment_value = $3, is_active = $4, updated_at = NOW()
         WHERE id = $5 AND product_id = $6
         RETURNING id, product_id AS "productId", label, adjustment_type AS "adjustmentType", adjustment_value AS "adjustmentValue", is_active AS "isActive"`,
        [updatedLabel, updatedType, updatedValue, updatedActive, req.params.variantId, req.params.id],
      );

      await audit({
        actorUserId: req.user.id,
        action: 'product_variant.updated',
        entityType: 'product_variant',
        entityId: req.params.variantId,
        metadata: { label: updatedLabel, isActive: updatedActive },
        requestId: req.requestId,
      });

      res.json({ data: result.rows[0] });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to update variant.');
    }
  });

  // ==========================================
  // PLANS
  // ==========================================

  function mapPlanRow(row) {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      interval: row.interval,
      intervalCount: row.interval_count,
      minQuantity: row.min_quantity,
      trialDays: row.trial_days,
      isActive: row.is_active,
      startDate: row.start_date,
      endDate: row.end_date,
      autoRenew: row.auto_renew,
      allowPause: row.allow_pause,
      allowEarlyClose: row.allow_early_close,
      isArchived: row.is_archived,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
    };
  }

  // GET /api/v1/plans
  router.get('/plans', authenticate, async (req, res) => {
    const includeArchived = req.query.includeArchived === 'true';
    try {
      const result = await pool.query(
        `SELECT * FROM plans WHERE ($1 = true OR is_archived = false) ORDER BY created_at DESC`,
        [includeArchived],
      );
      res.json({ data: result.rows.map(mapPlanRow) });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to fetch plans.');
    }
  });

  // POST /api/v1/plans
  router.post('/plans', authenticate, requirePermission('catalog.manage'), async (req, res) => {
    const {
      name,
      code,
      interval,
      intervalCount = 1,
      minQuantity = 1,
      trialDays = 0,
      autoRenew = true,
      allowPause = true,
      allowEarlyClose = true,
      startDate = null,
      endDate = null,
    } = req.body || {};

    const details = [];
    if (typeof name !== 'string' || !name.trim()) details.push({ field: 'name', code: 'REQUIRED', message: 'Plan name is required.' });
    if (!['daily', 'weekly', 'monthly', 'yearly'].includes(interval)) {
      details.push({ field: 'interval', code: 'INVALID', message: 'Interval must be daily, weekly, monthly, or yearly.' });
    }
    if (!Number.isInteger(intervalCount) || intervalCount <= 0) details.push({ field: 'intervalCount', code: 'INVALID', message: 'Interval count must be greater than zero.' });
    if (!Number.isInteger(minQuantity) || minQuantity <= 0) details.push({ field: 'minQuantity', code: 'INVALID', message: 'Minimum quantity must be greater than zero.' });

    if (details.length) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid plan attributes.', details);

    try {
      const result = await pool.query(
        `INSERT INTO plans (name, code, interval, interval_count, min_quantity, trial_days, auto_renew, allow_pause, allow_early_close, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          name.trim(),
          code ? code.trim() : null,
          interval,
          intervalCount,
          minQuantity,
          trialDays,
          Boolean(autoRenew),
          Boolean(allowPause),
          Boolean(allowEarlyClose),
          startDate || null,
          endDate || null,
        ],
      );

      const plan = mapPlanRow(result.rows[0]);
      await audit({
        actorUserId: req.user.id,
        action: 'plan.created',
        entityType: 'plan',
        entityId: plan.id,
        metadata: { name: plan.name, interval: plan.interval },
        requestId: req.requestId,
      });

      res.status(201).json({ data: plan });
    } catch (error) {
      if (error.code === '23505') return sendError(res, 409, 'CONFLICT', 'A plan with this code already exists.');
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to create plan.');
    }
  });

  // GET /api/v1/plans/:id
  router.get('/plans/:id', authenticate, async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM plans WHERE id = $1', [req.params.id]);
      if (!result.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Plan not found.');
      res.json({ data: mapPlanRow(result.rows[0]) });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to retrieve plan.');
    }
  });

  // PATCH /api/v1/plans/:id
  router.patch('/plans/:id', authenticate, requirePermission('catalog.manage'), async (req, res) => {
    const { name, minQuantity, autoRenew, allowPause, allowEarlyClose, isActive } = req.body || {};
    try {
      const existing = await pool.query('SELECT * FROM plans WHERE id = $1', [req.params.id]);
      if (!existing.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Plan not found.');

      const current = existing.rows[0];
      const updatedName = typeof name === 'string' && name.trim() ? name.trim() : current.name;
      const updatedMinQty = Number.isInteger(minQuantity) && minQuantity > 0 ? minQuantity : current.min_quantity;
      const updatedAutoRenew = typeof autoRenew === 'boolean' ? autoRenew : current.auto_renew;
      const updatedAllowPause = typeof allowPause === 'boolean' ? allowPause : current.allow_pause;
      const updatedAllowClose = typeof allowEarlyClose === 'boolean' ? allowEarlyClose : current.allow_early_close;
      const updatedActive = typeof isActive === 'boolean' ? isActive : current.is_active;

      const result = await pool.query(
        `UPDATE plans
         SET name = $1, min_quantity = $2, auto_renew = $3, allow_pause = $4, allow_early_close = $5, is_active = $6, updated_at = NOW()
         WHERE id = $7
         RETURNING *`,
        [updatedName, updatedMinQty, updatedAutoRenew, updatedAllowPause, updatedAllowClose, updatedActive, req.params.id],
      );

      await audit({
        actorUserId: req.user.id,
        action: 'plan.updated',
        entityType: 'plan',
        entityId: req.params.id,
        metadata: { name: updatedName },
        requestId: req.requestId,
      });

      res.json({ data: mapPlanRow(result.rows[0]) });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to update plan.');
    }
  });

  // POST /api/v1/plans/:id/archive
  router.post('/plans/:id/archive', authenticate, requirePermission('catalog.manage'), async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE plans SET is_archived = true, archived_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
        [req.params.id],
      );
      if (!result.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Plan not found.');

      await audit({
        actorUserId: req.user.id,
        action: 'plan.archived',
        entityType: 'plan',
        entityId: req.params.id,
        requestId: req.requestId,
      });

      res.json({ data: mapPlanRow(result.rows[0]) });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to archive plan.');
    }
  });

  // ==========================================
  // TAX RULES
  // ==========================================

  function mapTaxRuleRow(row) {
    return {
      id: row.id,
      name: row.name,
      ratePercentage: Number(row.rate_percentage),
      jurisdiction: row.jurisdiction,
      isActive: row.is_active,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      createdAt: row.created_at,
    };
  }

  // GET /api/v1/tax-rules
  router.get('/tax-rules', authenticate, async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM tax_rules ORDER BY created_at DESC');
      res.json({ data: result.rows.map(mapTaxRuleRow) });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to fetch tax rules.');
    }
  });

  // POST /api/v1/tax-rules
  router.post('/tax-rules', authenticate, requirePermission('catalog.manage'), async (req, res) => {
    const { name, ratePercentage, jurisdiction = 'IN', effectiveFrom = null, effectiveTo = null } = req.body || {};
    const details = [];

    if (typeof name !== 'string' || !name.trim()) details.push({ field: 'name', code: 'REQUIRED', message: 'Tax rule name is required.' });
    if (typeof ratePercentage !== 'number' || ratePercentage < 0 || ratePercentage > 100) {
      details.push({ field: 'ratePercentage', code: 'INVALID', message: 'Rate percentage must be between 0 and 100.' });
    }

    if (details.length) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid tax rule attributes.', details);

    try {
      const result = await pool.query(
        `INSERT INTO tax_rules (name, rate_percentage, jurisdiction, effective_from, effective_to)
         VALUES ($1, $2, $3, COALESCE($4, NOW()), $5)
         RETURNING *`,
        [name.trim(), ratePercentage, jurisdiction.trim().toUpperCase(), effectiveFrom || null, effectiveTo || null],
      );

      const taxRule = mapTaxRuleRow(result.rows[0]);
      await audit({
        actorUserId: req.user.id,
        action: 'tax_rule.created',
        entityType: 'tax_rule',
        entityId: taxRule.id,
        metadata: { name: taxRule.name, ratePercentage: taxRule.ratePercentage },
        requestId: req.requestId,
      });

      res.status(201).json({ data: taxRule });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to create tax rule.');
    }
  });

  // PATCH /api/v1/tax-rules/:id
  router.patch('/tax-rules/:id', authenticate, requirePermission('catalog.manage'), async (req, res) => {
    const { name, ratePercentage, jurisdiction, isActive, effectiveTo } = req.body || {};
    try {
      const existing = await pool.query('SELECT * FROM tax_rules WHERE id = $1', [req.params.id]);
      if (!existing.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Tax rule not found.');

      const current = existing.rows[0];
      const updatedName = typeof name === 'string' && name.trim() ? name.trim() : current.name;
      const updatedRate = typeof ratePercentage === 'number' && ratePercentage >= 0 && ratePercentage <= 100 ? ratePercentage : current.rate_percentage;
      const updatedJur = typeof jurisdiction === 'string' && jurisdiction.trim() ? jurisdiction.trim().toUpperCase() : current.jurisdiction;
      const updatedActive = typeof isActive === 'boolean' ? isActive : current.is_active;
      const updatedEffTo = effectiveTo !== undefined ? (effectiveTo || null) : current.effective_to;

      const result = await pool.query(
        `UPDATE tax_rules
         SET name = $1, rate_percentage = $2, jurisdiction = $3, is_active = $4, effective_to = $5
         WHERE id = $6
         RETURNING *`,
        [updatedName, updatedRate, updatedJur, updatedActive, updatedEffTo, req.params.id],
      );

      await audit({
        actorUserId: req.user.id,
        action: 'tax_rule.updated',
        entityType: 'tax_rule',
        entityId: req.params.id,
        metadata: { name: updatedName, ratePercentage: updatedRate },
        requestId: req.requestId,
      });

      res.json({ data: mapTaxRuleRow(result.rows[0]) });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to update tax rule.');
    }
  });

  // ==========================================
  // DISCOUNT RULES (Admin-only: catalog.manage)
  // ==========================================

  function mapDiscountRuleRow(row) {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      type: row.type,
      value: Number(row.value),
      minThresholdCents: row.min_threshold_cents,
      scope: row.scope,
      productId: row.product_id,
      maxUses: row.max_uses,
      timesUsed: row.times_used,
      startDate: row.start_date,
      endDate: row.end_date,
      isActive: row.is_active,
      createdAt: row.created_at,
    };
  }

  // GET /api/v1/discount-rules
  router.get('/discount-rules', authenticate, requirePermission('catalog.manage'), async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM discount_rules ORDER BY created_at DESC');
      res.json({ data: result.rows.map(mapDiscountRuleRow) });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to fetch discount rules.');
    }
  });

  // POST /api/v1/discount-rules
  router.post('/discount-rules', authenticate, requirePermission('catalog.manage'), async (req, res) => {
    const {
      name,
      code,
      type,
      value,
      minThresholdCents = 0,
      scope = 'entire_order',
      productId = null,
      maxUses = null,
      startDate = null,
      endDate = null,
    } = req.body || {};

    const details = [];
    if (typeof name !== 'string' || !name.trim()) details.push({ field: 'name', code: 'REQUIRED', message: 'Discount name is required.' });
    if (!['fixed', 'percentage'].includes(type)) details.push({ field: 'type', code: 'INVALID', message: 'Type must be fixed or percentage.' });
    if (typeof value !== 'number' || value <= 0) details.push({ field: 'value', code: 'INVALID', message: 'Value must be greater than zero.' });
    if (!['entire_order', 'product'].includes(scope)) details.push({ field: 'scope', code: 'INVALID', message: 'Scope must be entire_order or product.' });

    if (details.length) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid discount rule attributes.', details);

    try {
      const result = await pool.query(
        `INSERT INTO discount_rules (name, code, type, value, min_threshold_cents, scope, product_id, max_uses, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          name.trim(),
          code ? code.trim().toUpperCase() : null,
          type,
          value,
          Number.isInteger(minThresholdCents) && minThresholdCents >= 0 ? minThresholdCents : 0,
          scope,
          scope === 'product' ? productId : null,
          Number.isInteger(maxUses) && maxUses > 0 ? maxUses : null,
          startDate || null,
          endDate || null,
        ],
      );

      const discountRule = mapDiscountRuleRow(result.rows[0]);
      await audit({
        actorUserId: req.user.id,
        action: 'discount_rule.created',
        entityType: 'discount_rule',
        entityId: discountRule.id,
        metadata: { name: discountRule.name, type: discountRule.type, value: discountRule.value },
        requestId: req.requestId,
      });

      res.status(201).json({ data: discountRule });
    } catch (error) {
      if (error.code === '23505') return sendError(res, 409, 'CONFLICT', 'A discount rule with this code already exists.');
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to create discount rule.');
    }
  });

  // PATCH /api/v1/discount-rules/:id
  router.patch('/discount-rules/:id', authenticate, requirePermission('catalog.manage'), async (req, res) => {
    const { name, value, minThresholdCents, maxUses, isActive, endDate } = req.body || {};
    try {
      const existing = await pool.query('SELECT * FROM discount_rules WHERE id = $1', [req.params.id]);
      if (!existing.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Discount rule not found.');

      const current = existing.rows[0];
      const updatedName = typeof name === 'string' && name.trim() ? name.trim() : current.name;
      const updatedVal = typeof value === 'number' && value > 0 ? value : current.value;
      const updatedMin = Number.isInteger(minThresholdCents) && minThresholdCents >= 0 ? minThresholdCents : current.min_threshold_cents;
      const updatedMaxUses = maxUses !== undefined ? (Number.isInteger(maxUses) ? maxUses : null) : current.max_uses;
      const updatedActive = typeof isActive === 'boolean' ? isActive : current.is_active;
      const updatedEndDate = endDate !== undefined ? (endDate || null) : current.end_date;

      const result = await pool.query(
        `UPDATE discount_rules
         SET name = $1, value = $2, min_threshold_cents = $3, max_uses = $4, is_active = $5, end_date = $6
         WHERE id = $7
         RETURNING *`,
        [updatedName, updatedVal, updatedMin, updatedMaxUses, updatedActive, updatedEndDate, req.params.id],
      );

      await audit({
        actorUserId: req.user.id,
        action: 'discount_rule.updated',
        entityType: 'discount_rule',
        entityId: req.params.id,
        metadata: { name: updatedName, value: updatedVal },
        requestId: req.requestId,
      });

      res.json({ data: mapDiscountRuleRow(result.rows[0]) });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Unable to update discount rule.');
    }
  });

  return router;
}

module.exports = { createCatalogRouter };
