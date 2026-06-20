/**
 * types/payment_v1.ts  (v1)
 *
 * Domain types for HaiBack payment records.
 * Two concrete kinds, sharing a common base.
 */

// ─── Shared base ──────────────────────────────────────────────

/** Fields every payment record has, regardless of kind. */
export interface PaymentBase {
  id:        string;
  userId:    string | null;
  title:     string;
  note:      string;
  createdAt: string;           // ISO date string, e.g. "2025-05-01"
}

// ─── Kind 1: Fixed Income ─────────────────────────────────────

/**
 * FixedIncomePayment
 *
 * For predictable, fixed amounts that will definitely be received.
 * Examples: salary, fixed allowances, confirmed reimbursements.
 *
 * Flow: pending → received
 */
export type FixedIncomeStatus = "pending" | "received";

export interface FixedIncomePayment extends PaymentBase {
  kind: "fixed_income";

  /** The exact amount expected. */
  amount: number;

  /** When we expect to receive it (ISO date). */
  expectedReceiveDate: string;

  /** When it actually arrived (ISO date, null until received). */
  actualReceiveDate: string | null;

  status: FixedIncomeStatus;
}

// ─── Kind 2: Reimbursable (advance-eligible) ─────────────────

/**
 * ReimbursablePayment
 *
 * For variable-cost activities where an advance may be requested.
 * Examples: meetings, events, business trips, projects.
 *
 * Lifecycle:
 *   1. Created with estimatedCost
 *   2. (Optional) Advance requested → approved → received
 *   3. Activity ends → actualCost filled in
 *   4. Settlement:
 *      - actualCost > advanceApprovedAmount → company pays difference
 *      - actualCost < advanceApprovedAmount → employee returns difference
 *      - no advance taken → company pays full actualCost
 */
export type ReimbursableStatus =
  | "draft"                    // created, no advance yet
  | "advance_pending"          // advance requested, awaiting approval
  | "advance_approved"         // approved, not yet received
  | "advance_received"         // advance in hand, activity not done
  | "settling"                 // activity done, calculating difference
  | "company_owes_me"          // company needs to pay me more
  | "i_owe_company"            // I need to return money to company
  | "completed";               // fully settled

export interface ReimbursablePayment extends PaymentBase {
  kind: "reimbursable";

  status: ReimbursableStatus;

  // ── Cost ────────────────────────────────────────────────────
  /** Estimated cost before the activity. */
  estimatedCost: number;

  /** Actual cost after the activity (null until known). */
  actualCost: number | null;

  // ── Advance ─────────────────────────────────────────────────
  /** Amount requested as advance (0 if no advance requested). */
  advanceRequestedAmount: number;

  /** Amount the company actually approved (null if not yet decided). */
  advanceApprovedAmount: number | null;

  /** Date the approved advance was received (null if not yet received). */
  advanceReceivedDate: string | null;

  // ── Settlement: company → me ─────────────────────────────────
  /** Amount the company paid to cover shortfall (0 if not applicable). */
  companyPaidAmount: number;

  /** Date company paid the shortfall (null if not yet paid). */
  companyPaidDate: string | null;

  // ── Settlement: me → company ─────────────────────────────────
  /** Amount I returned to company (0 if not applicable). */
  employeeReturnedAmount: number;

  /** Date I returned the money (null if not yet returned). */
  employeeReturnedDate: string | null;
}

// ─── Union type ───────────────────────────────────────────────

/**
 * Payment — the single union type used throughout the app.
 * Discriminated by `kind`.
 */
export type Payment = FixedIncomePayment | ReimbursablePayment;

// ─── Type guards ─────────────────────────────────────────────

export const isFixedIncome = (p: Payment): p is FixedIncomePayment =>
  p.kind === "fixed_income";

export const isReimbursable = (p: Payment): p is ReimbursablePayment =>
  p.kind === "reimbursable";

// ─── Derived values (pure functions, no side effects) ─────────

/**
 * For a ReimbursablePayment, compute the settlement difference.
 *
 * Returns:
 *   positive → company owes me this amount
 *   negative → I owe company this amount
 *   0        → balanced
 *   null     → can't compute yet (actualCost not filled)
 */
export const settlementDiff = (p: ReimbursablePayment): number | null => {
  if (p.actualCost === null) return null;
  const advance = p.advanceApprovedAmount ?? 0;
  // diff = actualCost - advance:
  //   > 0 → company still owes me
  //   < 0 → I over-received, owe company back
  return p.actualCost - advance;
};

/**
 * For a ReimbursablePayment, compute remaining amount to settle.
 * Returns 0 once fully settled.
 */
export const remainingToSettle = (p: ReimbursablePayment): number => {
  const diff = settlementDiff(p);
  if (diff === null) return 0;

  if (diff > 0) {
    // Company owes me: diff minus what company has already paid
    return Math.max(diff - p.companyPaidAmount, 0);
  } else if (diff < 0) {
    // I owe company: abs(diff) minus what I've already returned
    return Math.max(Math.abs(diff) - p.employeeReturnedAmount, 0);
  }
  return 0;
};

/**
 * For a FixedIncomePayment, check if it's overdue.
 */
export const isOverdue = (p: FixedIncomePayment): boolean =>
  p.status === "pending" &&
  p.expectedReceiveDate < new Date().toISOString().slice(0, 10);
