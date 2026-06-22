/**
 * Pure money math for orders — no database, no NestJS. Kept separate from
 * OrdersService so order totals, tax, and discount behavior can be unit-tested
 * directly and stay consistent between order creation and order updates.
 */

/** Tax rate applied when a branch has no (or an invalid) configured tax rate. */
export const DEFAULT_TAX_RATE_PCT = 15;

/** Round to 2 decimal places (money). */
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Resolve the branch tax rate as a percentage. A configured `0` is preserved
 * (tax-exempt branch); only a missing / non-numeric value falls back to the default.
 */
export function resolveTaxRatePct(storeSettings: { taxRate?: unknown } | null | undefined): number {
  const raw = Number(storeSettings?.taxRate);
  return Number.isFinite(raw) ? raw : DEFAULT_TAX_RATE_PCT;
}

export interface OrderTotals {
  /** Subtotal after discount, never below 0. */
  discountedSubtotal: number;
  tax: number;
  total: number;
}

/**
 * Compute tax and grand total. Discount is applied to the subtotal first, the
 * result is floored at 0, then tax is charged on the discounted subtotal.
 */
export function computeOrderTotals(params: {
  subtotal: number;
  discount: number;
  taxRatePct: number;
}): OrderTotals {
  const taxRate = params.taxRatePct / 100;
  const discountedSubtotal = Math.max(params.subtotal - params.discount, 0);
  const tax = discountedSubtotal * taxRate;
  const total = discountedSubtotal + tax;
  return { discountedSubtotal, tax, total };
}
