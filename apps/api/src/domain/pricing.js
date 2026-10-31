/**
 * Domain Pricing and Calculation Engine
 * Enforces integer minor-unit arithmetic, immutable snapshot generation,
 * variant adjustments, discount rule qualifications, and tax computations.
 */

/**
 * Calculates a single line item breakdown.
 * @param {Object} item
 * @param {number} item.quantity - Positive integer
 * @param {number} item.unitPriceCents - Non-negative integer (e.g. 250000 for INR 2500.00)
 * @param {string} [item.productId] - Optional product UUID
 * @param {string} [item.description] - Line description
 * @param {Object} [item.variant] - Optional variant configuration
 * @param {string} [item.variant.id] - Variant UUID
 * @param {string} [item.variant.label] - Variant label
 * @param {'fixed'|'percentage'} [item.variant.adjustmentType] - Type of adjustment
 * @param {number} [item.variant.adjustmentValue] - Fixed cents or percentage (e.g. 15 for 15%)
 * @returns {Object} Calculated line item breakdown
 */
function calculateLineItem({ quantity, unitPriceCents, productId = null, description = '', variant = null }) {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('Quantity must be a positive integer.');
  }
  if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
    throw new Error('Unit price must be a non-negative integer in minor units (cents/paise).');
  }

  let variantAdjustmentPerUnit = 0;
  let variantSnapshot = null;

  if (variant && variant.adjustmentType && variant.adjustmentValue !== undefined && variant.adjustmentValue !== null) {
    const adjVal = Number(variant.adjustmentValue);
    if (variant.adjustmentType === 'fixed') {
      variantAdjustmentPerUnit = Math.round(adjVal);
    } else if (variant.adjustmentType === 'percentage') {
      variantAdjustmentPerUnit = Math.round((unitPriceCents * adjVal) / 100);
    } else {
      throw new Error(`Unsupported variant adjustment type: ${variant.adjustmentType}`);
    }

    variantSnapshot = {
      id: variant.id || null,
      label: variant.label || 'Variant',
      adjustmentType: variant.adjustmentType,
      adjustmentValue: adjVal,
      adjustmentPerUnitCents: variantAdjustmentPerUnit,
    };
  }

  const effectiveUnitPriceCents = Math.max(0, unitPriceCents + variantAdjustmentPerUnit);
  const lineSubtotalCents = quantity * effectiveUnitPriceCents;

  return {
    productId,
    description,
    quantity,
    unitPriceCents,
    variantAdjustmentPerUnitCents: variantAdjustmentPerUnit,
    effectiveUnitPriceCents,
    lineSubtotalCents,
    variant: variantSnapshot,
  };
}

/**
 * Evaluates discount rule eligibility and calculates applicable discount cents.
 * @param {Object} params
 * @param {number} params.subtotalCents - Total order subtotal before discount
 * @param {Array<Object>} params.lines - Calculated line item breakdowns
 * @param {Object} [params.discountRule] - Discount rule from database
 * @param {Date} [params.currentDate] - Evaluation date (defaults to now)
 * @returns {Object} Discount calculation breakdown
 */
function evaluateDiscount({ subtotalCents, lines, discountRule = null, currentDate = new Date() }) {
  if (!discountRule || !discountRule.isActive && discountRule.is_active === false) {
    return { discountCents: 0, appliedRule: null, reason: 'No active discount rule provided.' };
  }

  const rule = {
    id: discountRule.id,
    name: discountRule.name,
    code: discountRule.code,
    type: discountRule.type, // 'fixed' | 'percentage'
    value: Number(discountRule.value),
    minThresholdCents: Number(discountRule.min_threshold_cents || discountRule.minThresholdCents || 0),
    scope: discountRule.scope || 'entire_order', // 'entire_order' | 'product'
    productId: discountRule.product_id || discountRule.productId || null,
    maxUses: discountRule.max_uses !== undefined ? discountRule.max_uses : discountRule.maxUses,
    timesUsed: Number(discountRule.times_used || discountRule.timesUsed || 0),
    startDate: discountRule.start_date || discountRule.startDate ? new Date(discountRule.start_date || discountRule.startDate) : null,
    endDate: discountRule.end_date || discountRule.endDate ? new Date(discountRule.end_date || discountRule.endDate) : null,
  };

  // Check usage limit
  if (rule.maxUses !== null && rule.maxUses !== undefined && rule.timesUsed >= rule.maxUses) {
    return { discountCents: 0, appliedRule: null, reason: 'Discount usage limit exceeded.' };
  }

  // Check date bounds
  if (rule.startDate && currentDate < rule.startDate) {
    return { discountCents: 0, appliedRule: null, reason: 'Discount rule is not yet effective.' };
  }
  if (rule.endDate && currentDate > rule.endDate) {
    return { discountCents: 0, appliedRule: null, reason: 'Discount rule has expired.' };
  }

  // Check order subtotal threshold
  if (subtotalCents < rule.minThresholdCents) {
    return { discountCents: 0, appliedRule: null, reason: `Subtotal is below threshold of ${rule.minThresholdCents} cents.` };
  }

  let applicableBaseCents = subtotalCents;
  if (rule.scope === 'product') {
    if (!rule.productId) {
      return { discountCents: 0, appliedRule: null, reason: 'Product scope rule missing target product.' };
    }
    const eligibleLines = lines.filter((l) => l.productId === rule.productId);
    applicableBaseCents = eligibleLines.reduce((acc, l) => acc + l.lineSubtotalCents, 0);
    if (applicableBaseCents <= 0) {
      return { discountCents: 0, appliedRule: null, reason: 'No eligible products found for discount.' };
    }
  }

  let discountCents = 0;
  if (rule.type === 'fixed') {
    discountCents = Math.min(applicableBaseCents, Math.round(rule.value));
  } else if (rule.type === 'percentage') {
    discountCents = Math.round((applicableBaseCents * rule.value) / 100);
  } else {
    throw new Error(`Unsupported discount rule type: ${rule.type}`);
  }

  discountCents = Math.max(0, Math.min(discountCents, subtotalCents));

  return {
    discountCents,
    appliedRule: {
      id: rule.id,
      name: rule.name,
      code: rule.code,
      type: rule.type,
      value: rule.value,
      scope: rule.scope,
      discountAppliedCents: discountCents,
    },
    reason: 'Discount applied successfully.',
  };
}

/**
 * Calculates tax on a discounted taxable base.
 * @param {Object} params
 * @param {number} params.taxableBaseCents - Subtotal minus discounts
 * @param {Object} [params.taxRule] - Tax rule from database
 * @param {Date} [params.currentDate] - Evaluation date (defaults to now)
 * @returns {Object} Tax calculation breakdown
 */
function calculateTax({ taxableBaseCents, taxRule = null, currentDate = new Date() }) {
  if (!taxRule || (!taxRule.isActive && taxRule.is_active === false)) {
    return { taxCents: 0, appliedRule: null };
  }

  const rule = {
    id: taxRule.id,
    name: taxRule.name,
    ratePercentage: Number(taxRule.rate_percentage || taxRule.ratePercentage || 0),
    jurisdiction: taxRule.jurisdiction || 'IN',
    effectiveFrom: taxRule.effective_from || taxRule.effectiveFrom ? new Date(taxRule.effective_from || taxRule.effectiveFrom) : null,
    effectiveTo: taxRule.effective_to || taxRule.effectiveTo ? new Date(taxRule.effective_to || taxRule.effectiveTo) : null,
  };

  if (rule.effectiveFrom && currentDate < rule.effectiveFrom) {
    return { taxCents: 0, appliedRule: null };
  }
  if (rule.effectiveTo && currentDate > rule.effectiveTo) {
    return { taxCents: 0, appliedRule: null };
  }

  const taxCents = Math.max(0, Math.round((taxableBaseCents * rule.ratePercentage) / 100));

  return {
    taxCents,
    appliedRule: {
      id: rule.id,
      name: rule.name,
      ratePercentage: rule.ratePercentage,
      jurisdiction: rule.jurisdiction,
      taxCents,
    },
  };
}

/**
 * Full calculation pipeline for quotations and subscriptions.
 * Produces deterministic totals and an immutable snapshot breakdown.
 *
 * @param {Object} params
 * @param {Array<Object>} params.lines - Raw line items
 * @param {Object} [params.discountRule] - Optional discount rule
 * @param {Object} [params.taxRule] - Optional tax rule
 * @param {string} [params.currency='INR'] - Currency code
 * @param {Date} [params.calculationDate=new Date()] - Calculation timestamp
 * @returns {Object} Complete calculation breakdown
 */
function calculateDocument({ lines, discountRule = null, taxRule = null, currency = 'INR', calculationDate = new Date() }) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('At least one line item is required for calculation.');
  }

  // 1. Calculate each line item
  const calculatedLines = lines.map((line) => calculateLineItem(line));

  // 2. Compute subtotal
  const subtotalCents = calculatedLines.reduce((acc, l) => acc + l.lineSubtotalCents, 0);

  // 3. Evaluate eligible discount
  const discountResult = evaluateDiscount({
    subtotalCents,
    lines: calculatedLines,
    discountRule,
    currentDate: calculationDate,
  });
  const discountCents = discountResult.discountCents;

  // 4. Compute taxable base
  const taxableBaseCents = Math.max(0, subtotalCents - discountCents);

  // 5. Compute tax
  const taxResult = calculateTax({
    taxableBaseCents,
    taxRule,
    currentDate: calculationDate,
  });
  const taxCents = taxResult.taxCents;

  // 6. Compute grand total and balance due
  const grandTotalCents = subtotalCents - discountCents + taxCents;
  const balanceDueCents = grandTotalCents;

  // 7. Structured immutable snapshot
  const snapshotBreakdown = {
    currency,
    lines: calculatedLines.map((l) => ({
      productId: l.productId,
      description: l.description,
      quantity: l.quantity,
      unitPrice: { amount: l.unitPriceCents, currency },
      variantAdjustment: { amount: l.variantAdjustmentPerUnitCents, currency },
      effectiveUnitPrice: { amount: l.effectiveUnitPriceCents, currency },
      lineTotal: { amount: l.lineSubtotalCents, currency },
      variant: l.variant,
    })),
    totals: {
      subtotal: { amount: subtotalCents, currency },
      discount: {
        amount: discountCents,
        currency,
        appliedRule: discountResult.appliedRule,
      },
      taxableBase: { amount: taxableBaseCents, currency },
      tax: {
        amount: taxCents,
        currency,
        appliedRule: taxResult.appliedRule,
      },
      grandTotal: { amount: grandTotalCents, currency },
      balanceDue: { amount: balanceDueCents, currency },
    },
    calculatedAt: calculationDate.toISOString(),
  };

  return {
    subtotalCents,
    discountCents,
    taxCents,
    grandTotalCents,
    balanceDueCents,
    appliedDiscountRuleId: discountResult.appliedRule?.id || null,
    appliedTaxRuleId: taxResult.appliedRule?.id || null,
    lines: calculatedLines,
    snapshotBreakdown,
  };
}

/**
 * Formats a sequence number into standard identifier format.
 * Examples:
 *   generateDocumentNumber('QT', 1, 2026) -> 'QT-2026-000001'
 *   generateDocumentNumber('SUB', 42, 2026) -> 'SUB-2026-000042'
 */
function generateDocumentNumber(prefix, sequenceNumber, year = new Date().getFullYear()) {
  const padded = String(sequenceNumber).padStart(6, '0');
  return `${prefix}-${year}-${padded}`;
}

module.exports = {
  calculateLineItem,
  evaluateDiscount,
  calculateTax,
  calculateDocument,
  generateDocumentNumber,
};
