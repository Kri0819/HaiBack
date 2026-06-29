import { KIND } from "./constants.js";

// ─── Primitive helpers ────────────────────────────────────────
export const uid   = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
export const today = () => new Date().toISOString().slice(0, 10);
export const toN   = (v) => Number(v) || 0;
export const clamp = (n) => Math.max(n, 0);

/**
 * strip — remove derived fields before persisting.
 * Only primitive fields are stored in Supabase / localStorage.
 */
export const strip = (r) => ({
  id:              r.id,
  userId:          r.userId          ?? null,
  kind:            r.kind,
  advStatus:       r.advStatus       ?? null,
  title:           r.title,
  date:            r.date,
  note:            r.note            || "",
  amount:          toN(r.amount),
  advanceReceived: toN(r.advanceReceived),
  actualSpent:     toN(r.actualSpent),
  settlementDate:  r.settlementDate  || "",
  paymentRecords:  r.paymentRecords  || [],
  tags:            r.tags            || [],
});

/**
 * buildRaw — construct a storable record from form fields.
 * @param {object} f      - form fields
 * @param {string|null} userId - current user id
 */
export const buildRaw = (f, userId = null) => ({
  id:              f.id              || uid(),
  userId:          f.userId          ?? userId,
  kind:            f.kind            || KIND.R,
  advStatus:       f.advStatus       ?? null,
  title:           f.title           || "",
  date:            f.date            || today(),
  note:            f.note            || "",
  amount:          toN(f.amount),
  advanceReceived: toN(f.advanceReceived),
  actualSpent:     toN(f.actualSpent),
  settlementDate:  f.settlementDate  || "",
  paymentRecords:  f.paymentRecords  || [],
  tags:            f.tags            || [],
});
