/**
 * utils/paymentCalculator_v1.ts  (v1)
 *
 * Single source of truth for all payment calculations.
 * No component or page may calculate balances directly —
 * import from here instead.
 */

import type {
  Payment,
  FixedIncomePayment,
  ReimbursablePayment,
} from "../types/payment_v1";

// ─── Per-record calculations ──────────────────────────────────

/**
 * fixedIncomeOwed
 *
 * For a FixedIncomePayment:
 *   status !== "received"  →  company owes me `amount`
 *   status === "received"  →  fully settled, owes 0
 */
export const fixedIncomeOwed = (p: FixedIncomePayment): number =>
  p.status !== "received" ? p.amount : 0;

/**
 * reimbursableBalance
 *
 * For a ReimbursablePayment:
 *
 *   Base formula:
 *     raw = actualCost - advanceApprovedAmount - companyPaidAmount + employeeReturnedAmount
 *
 *   Interpretation:
 *     raw > 0  →  company still owes me  (positive = company owes)
 *     raw < 0  →  I still owe company    (negative = I owe)
 *     raw = 0  →  fully settled
 *
 *   Returns null if actualCost is not yet filled in
 *   (activity not complete — cannot settle yet).
 *
 * Variable explanation:
 *   actualCost              = total I spent
 *   advanceApprovedAmount   = money company already gave me upfront
 *   companyPaidAmount       = additional money company paid after activity
 *   employeeReturnedAmount  = money I returned to company
 *
 *   Net owed to me = actualCost - (advance + companyPaid) + employeeReturned
 *   Rearranged     = actualCost - advanceApprovedAmount - companyPaidAmount + employeeReturnedAmount
 */
export const reimbursableBalance = (p: ReimbursablePayment): number | null => {
  if (p.actualCost === null) return null;

  const advance  = p.advanceApprovedAmount  ?? 0;
  const paid     = p.companyPaidAmount      ?? 0;
  const returned = p.employeeReturnedAmount ?? 0;

  return p.actualCost - advance - paid + returned;
};

// ─── Portfolio summary ────────────────────────────────────────

export interface PortfolioSummary {
  /** Total amount company owes me across all records. */
  totalCompanyOwesMe: number;

  /** Total amount I owe company across all records. */
  totalIOweCompany: number;

  /**
   * Net balance from my perspective.
   *   positive → I am owed money overall
   *   negative → I owe money overall
   *   0        → fully settled
   */
  netBalance: number;
}

/**
 * calculatePortfolio
 *
 * Accepts a mixed list of Payment records and returns the combined summary.
 * This is the only function pages should use for dashboard totals.
 *
 * @param payments  Array of Payment (FixedIncome | Reimbursable)
 * @returns         PortfolioSummary
 */
export const calculatePortfolio = (payments: Payment[]): PortfolioSummary => {
  let totalCompanyOwesMe = 0;
  let totalIOweCompany   = 0;

  for (const p of payments) {
    if (p.kind === "fixed_income") {
      const owed = fixedIncomeOwed(p);
      if (owed > 0) totalCompanyOwesMe += owed;

    } else if (p.kind === "reimbursable") {
      const balance = reimbursableBalance(p);
      if (balance === null) continue;   // actualCost not known yet — skip

      if (balance > 0) {
        totalCompanyOwesMe += balance;
      } else if (balance < 0) {
        totalIOweCompany += Math.abs(balance);
      }
    }
  }

  return {
    totalCompanyOwesMe,
    totalIOweCompany,
    netBalance: totalCompanyOwesMe - totalIOweCompany,
  };
};
