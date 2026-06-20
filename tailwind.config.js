/**
 * utils/paymentStatus_v1.ts  (v1)
 *
 * Canonical status definitions for ReimbursablePayment.
 * All UI that displays status labels must use getPaymentStatusLabel().
 * No component may hardcode Chinese status strings directly.
 */

import type { ReimbursablePayment } from "../types/payment_v1";

// ─── Status type (extends payment_v1 for reimbursable) ────────

/**
 * ReimbursableStatus — full lifecycle for a reimbursable payment.
 *
 *  draft              Created, nothing submitted yet.
 *  submitted          Advance application submitted, awaiting approval.
 *  advance_approved   Company approved the advance amount.
 *  advance_received   Employee has received the advance funds.
 *  expense_completed  Activity done, actual cost filled in.
 *  settled            All money reconciled — no remaining balance.
 */
export type ReimbursableStatus =
  | "draft"
  | "submitted"
  | "advance_approved"
  | "advance_received"
  | "expense_completed"
  | "settled";

// ─── Chinese labels ───────────────────────────────────────────

const STATUS_LABEL: Record<ReimbursableStatus, string> = {
  draft:             "草稿",
  submitted:         "已送審",
  advance_approved:  "預支核准",
  advance_received:  "預支已領",
  expense_completed: "費用填寫完成",
  settled:           "已結清",
};

/**
 * getPaymentStatusLabel
 *
 * Returns the Chinese display label for a given status string.
 * Falls back to the raw status value if unrecognised.
 *
 * Usage:
 *   getPaymentStatusLabel("advance_approved")  →  "預支核准"
 *   getPaymentStatusLabel(payment.status)      →  appropriate label
 */
export const getPaymentStatusLabel = (status: ReimbursableStatus | string): string =>
  STATUS_LABEL[status as ReimbursableStatus] ?? status;

// ─── Status ordering (for progress display) ───────────────────

/** Ordered list of statuses — useful for timeline / stepper UI. */
export const REIMBURSABLE_STATUS_ORDER: ReimbursableStatus[] = [
  "draft",
  "submitted",
  "advance_approved",
  "advance_received",
  "expense_completed",
  "settled",
];

/**
 * getStatusStep
 *
 * Returns the 0-based index of a status in the lifecycle order.
 * Useful for progress bars and timeline components.
 *
 * Usage:
 *   getStatusStep("advance_received")  →  3
 */
export const getStatusStep = (status: ReimbursableStatus): number =>
  REIMBURSABLE_STATUS_ORDER.indexOf(status);

/**
 * isStatusAfter
 *
 * Returns true if `current` is further along than `target` in the lifecycle.
 *
 * Usage:
 *   isStatusAfter("expense_completed", "advance_received")  →  true
 *   isStatusAfter("submitted", "settled")                   →  false
 */
export const isStatusAfter = (
  current: ReimbursableStatus,
  target:  ReimbursableStatus,
): boolean => getStatusStep(current) > getStatusStep(target);

/**
 * isStatusAtOrAfter
 *
 * Returns true if `current` has reached or passed `target`.
 *
 * Usage:
 *   isStatusAtOrAfter("advance_approved", "advance_approved")  →  true
 *   isStatusAtOrAfter("draft", "submitted")                    →  false
 */
export const isStatusAtOrAfter = (
  current: ReimbursableStatus,
  target:  ReimbursableStatus,
): boolean => getStatusStep(current) >= getStatusStep(target);

// ─── Status transition rules ──────────────────────────────────

/**
 * ALLOWED_TRANSITIONS
 *
 * Defines which statuses a record can move to from its current status.
 * Use this to validate or build transition UI (e.g. dropdown of next steps).
 */
export const ALLOWED_TRANSITIONS: Record<ReimbursableStatus, ReimbursableStatus[]> = {
  draft:             ["submitted"],
  submitted:         ["advance_approved", "draft"],     // can retract to draft
  advance_approved:  ["advance_received", "submitted"], // can revert if mistake
  advance_received:  ["expense_completed"],
  expense_completed: ["settled"],
  settled:           [],                                // terminal state
};

/**
 * canTransitionTo
 *
 * Returns true if moving from `from` to `to` is allowed.
 *
 * Usage:
 *   canTransitionTo("submitted", "advance_approved")  →  true
 *   canTransitionTo("settled", "draft")               →  false
 */
export const canTransitionTo = (
  from: ReimbursableStatus,
  to:   ReimbursableStatus,
): boolean => ALLOWED_TRANSITIONS[from].includes(to);
