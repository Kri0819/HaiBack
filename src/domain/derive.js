import { KIND, ADV, STAGE } from "./constants.js";
import { toN, clamp } from "./records.js";

/**
 * computeStage — determine the lifecycle stage of an approved advance.
 */
export const computeStage = (raw) => {
  if (!toN(raw.actualSpent)) return STAGE.WAITING;

  const advRec = toN(raw.advanceReceived);
  const diff   = advRec - toN(raw.actualSpent);
  const iOwe   = advRec > 0 && diff > 0;
  const paid   = (raw.paymentRecords || []).reduce((s, r) => s + toN(r.amount), 0);

  return (Math.abs(diff) === 0 || !iOwe || paid >= Math.abs(diff))
    ? STAGE.DONE
    : STAGE.SETTLING;
};

/**
 * derive — add computed/display fields on top of a stored raw record.
 *
 * Input:  plain object from DB / localStorage
 * Output: enriched record with: pr, paid, effectiveKind, remaining,
 *         absDiff, iOwe, diff, stage, status
 */
export const derive = (raw) => {
  const pr   = raw.paymentRecords ?? [];
  const paid = pr.reduce((s, r) => s + toN(r.amount), 0);

  // Rejected advance behaves identically to a plain reimbursement
  const isR = raw.kind === KIND.R || raw.advStatus === ADV.REJECTED;

  if (isR) {
    const rem = clamp(toN(raw.amount) - paid);
    return {
      ...raw,
      pr, paid,
      effectiveKind: KIND.R,
      remaining: rem,
      absDiff:   0,
      iOwe:      false,
      diff:      0,
      status:    rem === 0 ? "完成" : "處理中",
    };
  }

  // Advance — still pending approval
  if (raw.advStatus === ADV.PENDING) {
    return {
      ...raw,
      pr, paid,
      effectiveKind: KIND.A,
      stage:         null,
      remaining:     0,
      absDiff:       0,
      iOwe:          false,
      diff:          0,
      status:        "等待核准",
    };
  }

  // Advance — approved, full lifecycle
  const stage   = computeStage(raw);
  const advRec  = toN(raw.advanceReceived);
  const diff    = advRec - toN(raw.actualSpent);
  const absDiff = Math.abs(diff);
  const iOwe    = advRec > 0 && diff > 0;
  const rem     = clamp(absDiff - paid);

  return {
    ...raw,
    pr, paid,
    effectiveKind: KIND.A,
    stage,
    diff,
    absDiff,
    iOwe,
    remaining: stage === STAGE.DONE ? 0 : rem,
    status:    stage === STAGE.DONE ? "完成" : "處理中",
  };
};
