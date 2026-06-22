import {
  DEFAULT_TAX_RATE_PCT,
  computeOrderTotals,
  resolveTaxRatePct,
  roundMoney,
} from './order-pricing';

describe('resolveTaxRatePct', () => {
  it('uses the configured rate', () => {
    expect(resolveTaxRatePct({ taxRate: 14 })).toBe(14);
  });

  it('preserves a configured 0% (tax-exempt branch)', () => {
    expect(resolveTaxRatePct({ taxRate: 0 })).toBe(0);
  });

  it('falls back to the default when missing', () => {
    expect(resolveTaxRatePct({})).toBe(DEFAULT_TAX_RATE_PCT);
    expect(resolveTaxRatePct(null)).toBe(DEFAULT_TAX_RATE_PCT);
    expect(resolveTaxRatePct(undefined)).toBe(DEFAULT_TAX_RATE_PCT);
  });

  it('falls back to the default when non-numeric (NaN)', () => {
    expect(resolveTaxRatePct({ taxRate: 'abc' })).toBe(DEFAULT_TAX_RATE_PCT);
    expect(resolveTaxRatePct({ taxRate: {} })).toBe(DEFAULT_TAX_RATE_PCT);
  });

  it('treats an explicit null rate as 0 (Number(null) === 0), matching legacy behavior', () => {
    // Documents existing behavior: a stored null coerces to a 0% rate, not the default.
    expect(resolveTaxRatePct({ taxRate: null })).toBe(0);
  });

  it('accepts a numeric string rate', () => {
    expect(resolveTaxRatePct({ taxRate: '12' })).toBe(12);
  });
});

describe('computeOrderTotals', () => {
  it('computes tax on the subtotal and adds it to the total (no discount)', () => {
    const { discountedSubtotal, tax, total } = computeOrderTotals({
      subtotal: 100,
      discount: 0,
      taxRatePct: 15,
    });
    expect(discountedSubtotal).toBe(100);
    expect(tax).toBeCloseTo(15, 6);
    expect(total).toBeCloseTo(115, 6);
  });

  it('applies the discount before tax (tax is charged on the discounted subtotal)', () => {
    const { discountedSubtotal, tax, total } = computeOrderTotals({
      subtotal: 100,
      discount: 20,
      taxRatePct: 10,
    });
    expect(discountedSubtotal).toBe(80);
    expect(tax).toBeCloseTo(8, 6);
    expect(total).toBeCloseTo(88, 6);
  });

  it('charges no tax for a 0% (tax-exempt) branch', () => {
    const { tax, total } = computeOrderTotals({ subtotal: 100, discount: 0, taxRatePct: 0 });
    expect(tax).toBe(0);
    expect(total).toBe(100);
  });

  it('floors the discounted subtotal at 0 when the discount exceeds the subtotal', () => {
    const { discountedSubtotal, tax, total } = computeOrderTotals({
      subtotal: 50,
      discount: 80,
      taxRatePct: 15,
    });
    expect(discountedSubtotal).toBe(0);
    expect(tax).toBe(0);
    expect(total).toBe(0);
  });

  it('handles a fully-discounted order (discount equals subtotal)', () => {
    const { total } = computeOrderTotals({ subtotal: 40, discount: 40, taxRatePct: 15 });
    expect(total).toBe(0);
  });
});

describe('roundMoney', () => {
  it('rounds to 2 decimal places', () => {
    expect(roundMoney(100.567)).toBe(100.57);
    expect(roundMoney(12.344)).toBe(12.34);
    expect(roundMoney(12.345)).toBe(12.35);
    expect(roundMoney(99.999)).toBe(100);
    expect(roundMoney(0)).toBe(0);
  });
});
