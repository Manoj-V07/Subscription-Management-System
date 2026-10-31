const assert = require('node:assert/strict');
const test = require('node:test');
const {
  calculateLineItem,
  evaluateDiscount,
  calculateTax,
  calculateDocument,
  generateDocumentNumber,
} = require('../../apps/api/src/domain/pricing');

test('pricing engine: line item calculations', async (t) => {
  await t.test('calculates standard line item without variant', () => {
    const result = calculateLineItem({
      quantity: 3,
      unitPriceCents: 250000, // 2500.00
      description: 'Business Subscription',
    });

    assert.equal(result.quantity, 3);
    assert.equal(result.unitPriceCents, 250000);
    assert.equal(result.variantAdjustmentPerUnitCents, 0);
    assert.equal(result.effectiveUnitPriceCents, 250000);
    assert.equal(result.lineSubtotalCents, 750000); // 3 * 250000
    assert.equal(result.variant, null);
  });

  await t.test('calculates line item with fixed variant adjustment', () => {
    const result = calculateLineItem({
      quantity: 2,
      unitPriceCents: 250000,
      variant: {
        id: 'var-1',
        label: 'Enterprise SLA',
        adjustmentType: 'fixed',
        adjustmentValue: 56000, // 560.00
      },
    });

    assert.equal(result.variantAdjustmentPerUnitCents, 56000);
    assert.equal(result.effectiveUnitPriceCents, 306000); // 250000 + 56000
    assert.equal(result.lineSubtotalCents, 612000); // 2 * 306000
    assert.equal(result.variant.label, 'Enterprise SLA');
  });

  await t.test('calculates line item with percentage variant adjustment', () => {
    const result = calculateLineItem({
      quantity: 1,
      unitPriceCents: 100000, // 1000.00
      variant: {
        id: 'var-2',
        label: 'Priority 15%',
        adjustmentType: 'percentage',
        adjustmentValue: 15, // 15%
      },
    });

    assert.equal(result.variantAdjustmentPerUnitCents, 15000); // 15% of 100000
    assert.equal(result.effectiveUnitPriceCents, 115000);
    assert.equal(result.lineSubtotalCents, 115000);
  });

  await t.test('rejects negative or invalid quantities and prices', () => {
    assert.throws(() => calculateLineItem({ quantity: 0, unitPriceCents: 1000 }), /positive integer/);
    assert.throws(() => calculateLineItem({ quantity: -2, unitPriceCents: 1000 }), /positive integer/);
    assert.throws(() => calculateLineItem({ quantity: 1.5, unitPriceCents: 1000 }), /positive integer/);
    assert.throws(() => calculateLineItem({ quantity: 1, unitPriceCents: -500 }), /non-negative integer/);
  });
});

test('pricing engine: discount evaluation', async (t) => {
  const dummyLines = [
    { productId: 'prod-1', lineSubtotalCents: 100000 },
    { productId: 'prod-2', lineSubtotalCents: 50000 },
  ];

  await t.test('applies percentage discount to entire order when threshold met', () => {
    const result = evaluateDiscount({
      subtotalCents: 150000,
      lines: dummyLines,
      discountRule: {
        id: 'disc-1',
        name: '10% Off',
        type: 'percentage',
        value: 10,
        min_threshold_cents: 100000,
        scope: 'entire_order',
      },
    });

    assert.equal(result.discountCents, 15000); // 10% of 150000
    assert.equal(result.appliedRule.id, 'disc-1');
  });

  await t.test('returns zero discount if order is below threshold', () => {
    const result = evaluateDiscount({
      subtotalCents: 80000,
      lines: dummyLines,
      discountRule: {
        id: 'disc-1',
        name: 'High Roller',
        type: 'percentage',
        value: 20,
        min_threshold_cents: 100000,
        scope: 'entire_order',
      },
    });

    assert.equal(result.discountCents, 0);
    assert.equal(result.appliedRule, null);
    assert.match(result.reason, /below threshold/i);
  });

  await t.test('applies fixed discount capped at total subtotal', () => {
    const result = evaluateDiscount({
      subtotalCents: 20000,
      lines: [{ productId: 'p1', lineSubtotalCents: 20000 }],
      discountRule: {
        id: 'disc-2',
        name: 'Big Voucher',
        type: 'fixed',
        value: 50000, // 500.00
        min_threshold_cents: 10000,
        scope: 'entire_order',
      },
    });

    assert.equal(result.discountCents, 20000); // Capped at subtotal
  });

  await t.test('applies discount to specific product scope only', () => {
    const result = evaluateDiscount({
      subtotalCents: 150000,
      lines: dummyLines,
      discountRule: {
        id: 'disc-prod',
        name: 'Prod 2 Special',
        type: 'percentage',
        value: 20,
        scope: 'product',
        product_id: 'prod-2',
        min_threshold_cents: 0,
      },
    });

    // Only prod-2 is 50000 cents -> 20% of 50000 = 10000 cents
    assert.equal(result.discountCents, 10000);
  });

  await t.test('enforces max uses and date bounds', () => {
    const exhaustedRule = {
      id: 'disc-ex',
      name: 'Single Use',
      type: 'fixed',
      value: 5000,
      max_uses: 5,
      times_used: 5,
    };
    const r1 = evaluateDiscount({ subtotalCents: 50000, lines: dummyLines, discountRule: exhaustedRule });
    assert.equal(r1.discountCents, 0);

    const expiredRule = {
      id: 'disc-exp',
      name: 'Old Promo',
      type: 'fixed',
      value: 5000,
      end_date: new Date('2020-01-01'),
    };
    const r2 = evaluateDiscount({ subtotalCents: 50000, lines: dummyLines, discountRule: expiredRule });
    assert.equal(r2.discountCents, 0);
  });
});

test('pricing engine: tax calculations', async (t) => {
  await t.test('calculates GST accurately on taxable base', () => {
    const result = calculateTax({
      taxableBaseCents: 100000, // 1000.00
      taxRule: {
        id: 'tax-gst',
        name: 'GST 18%',
        rate_percentage: 18.0,
        jurisdiction: 'IN',
      },
    });

    assert.equal(result.taxCents, 18000); // 180.00
    assert.equal(result.appliedRule.ratePercentage, 18);
  });

  await t.test('returns 0 tax when no tax rule is supplied', () => {
    const result = calculateTax({ taxableBaseCents: 100000, taxRule: null });
    assert.equal(result.taxCents, 0);
    assert.equal(result.appliedRule, null);
  });
});

test('pricing engine: full document calculation pipeline & immutable snapshots', async (t) => {
  const lines = [
    {
      productId: 'prod-seat',
      description: 'User Seats',
      quantity: 10,
      unitPriceCents: 250000, // 2,500.00 per seat = 25,000.00 total
      variant: {
        id: 'var-sla',
        label: 'Premium SLA',
        adjustmentType: 'fixed',
        adjustmentValue: 50000, // +500.00 per seat = 3,000.00 effective unit price
      },
    },
    {
      productId: 'prod-storage',
      description: 'Storage Add-on',
      quantity: 2,
      unitPriceCents: 50000, // 500.00 per unit = 1,000.00 total
    },
  ];

  // Subtotal calculation:
  // Line 1: 10 * (250000 + 50000) = 3,000,000 cents (30,000.00)
  // Line 2: 2 * 50000 = 100,000 cents (1,000.00)
  // Total Subtotal = 3,100,000 cents (31,000.00)

  // 10% discount on entire order:
  // Discount = 310,000 cents (3,100.00)
  // Taxable base = 3,100,000 - 310,000 = 2,790,000 cents (27,900.00)

  // 18% GST:
  // Tax = 2,790,000 * 0.18 = 502,200 cents (5,022.00)

  // Grand Total = 2,790,000 + 502,200 = 3,292,200 cents (32,922.00)

  const discountRule = {
    id: 'disc-promo',
    name: 'Enterprise Promo 10%',
    type: 'percentage',
    value: 10,
    min_threshold_cents: 1000000,
    scope: 'entire_order',
  };

  const taxRule = {
    id: 'tax-gst18',
    name: 'GST 18%',
    rate_percentage: 18.0,
    jurisdiction: 'IN',
  };

  const doc = calculateDocument({
    lines,
    discountRule,
    taxRule,
    currency: 'INR',
    calculationDate: new Date('2026-10-31T12:00:00Z'),
  });

  assert.equal(doc.subtotalCents, 3100000);
  assert.equal(doc.discountCents, 310000);
  assert.equal(doc.taxCents, 502200);
  assert.equal(doc.grandTotalCents, 3292200);
  assert.equal(doc.balanceDueCents, 3292200);

  // Validate snapshot breakdown structure
  const snapshot = doc.snapshotBreakdown;
  assert.equal(snapshot.currency, 'INR');
  assert.equal(snapshot.lines.length, 2);
  assert.equal(snapshot.lines[0].effectiveUnitPrice.amount, 300000);
  assert.equal(snapshot.lines[0].lineTotal.amount, 3000000);
  assert.equal(snapshot.totals.subtotal.amount, 3100000);
  assert.equal(snapshot.totals.discount.amount, 310000);
  assert.equal(snapshot.totals.taxableBase.amount, 2790000);
  assert.equal(snapshot.totals.tax.amount, 502200);
  assert.equal(snapshot.totals.grandTotal.amount, 3292200);
  assert.equal(snapshot.calculatedAt, '2026-10-31T12:00:00.000Z');
});

test('pricing engine: identifier generation', () => {
  assert.equal(generateDocumentNumber('QT', 1, 2026), 'QT-2026-000001');
  assert.equal(generateDocumentNumber('SUB', 123, 2026), 'SUB-2026-000123');
  assert.equal(generateDocumentNumber('SUB', 999999, 2026), 'SUB-2026-999999');
});
