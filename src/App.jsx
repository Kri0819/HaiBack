/**
 * HaiBack｜還袂  v8 — Supabase edition
 *
 * ── SETUP (do once) ──────────────────────────────────────────
 * 1. Create project at https://supabase.com
 * 2. Copy your URL + anon key into the constants below
 * 3. Run the SQL in your Supabase SQL Editor (see bottom of file)
 * 4. npm install @supabase/supabase-js
 * ─────────────────────────────────────────────────────────────
 */
import { useState, useMemo, useCallback, useReducer, createContext, useContext, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { KIND, ADV, STAGE } from "./domain/constants.js";
import { today, toN, clamp, strip, buildRaw } from "./domain/records.js";
import { derive } from "./domain/derive.js";
import { recordsReducer, RECORDS_ACTION } from "./store/recordsReducer_v1.js";
import {
  getTheme, saveTheme,
  getGuestDismissed, setGuestDismissed,
  loadRecords, saveRecords,
  getTagList, saveTagList,
  ensureFirstVisit, daysSinceFirstVisit,
  getLoginReminderShown, setLoginReminderShown,
  getFirstRecoveryPromptShown, setFirstRecoveryPromptShown,
} from "./services/storage_v1.js";

// ── PASTE YOUR SUPABASE CREDENTIALS HERE ─────────────────────
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  || "https://YOUR_PROJECT.supabase.co";
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || "YOUR_ANON_KEY";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── App version — bump this on every release ──────────────────
// Used to auto-detect stale cached sessions and force a one-time
// reload, so users never need to manually press Cmd/Ctrl+Shift+R.
const APP_VERSION = "1.3.5";
const VERSION_KEY  = "hb_app_version";
// ─────────────────────────────────────────────────────────────

// ── Supabase auth helpers (Magic Link / Email OTP) ───────────
const auth = {
  loginWithGoogle: async () => {
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (error) throw new Error(error.message);
  },

  /**
   * getSession — also handles Google OAuth callback.
   * After Google redirect, the URL contains ?code=... or #access_token=...
   * Supabase auto-exchanges these via detectSessionInUrl (enabled by default).
   * We call getSession() which will pick up the exchanged session,
   * then clean the URL so the tokens don't stay in browser history.
   */
  getSession: async () => {
    const { data } = await sb.auth.getSession();

    // Clean OAuth callback params from URL after successful exchange
    const url = new URL(window.location.href);
    const hasOAuthParams = url.searchParams.has("code") ||
                           url.hash.includes("access_token");
    if (hasOAuthParams) {
      url.searchParams.delete("code");
      url.hash = "";
      window.history.replaceState({}, "", url.toString());
    }

    return data?.session?.user ?? null;
  },

  /**
   * onAuthChange — sync user on all relevant events.
   * SIGNED_IN:       fresh login (Google callback or magic link)
   * TOKEN_REFRESHED: session renewed automatically
   * SIGNED_OUT:      logout
   *
   * On SIGNED_IN, also migrates any guest-mode local records into
   * Supabase in the background — the UI unlocks immediately (cb(user)
   * fires first), migration happens after via setTimeout so it never
   * blocks rendering. Migration is best-effort: failures are logged,
   * never thrown, and never block the user from using the app.
   */
  onAuthChange: (cb) => {
    const { data } = sb.auth.onAuthStateChange((event, session) => {
      if (
        event === "SIGNED_IN"       ||
        event === "TOKEN_REFRESHED" ||
        event === "USER_UPDATED"
      ) {
        const user = session?.user ?? null;

        // Unlock the UI first — never let migration block rendering
        cb(user);

        if (event === "SIGNED_IN" && user) {
          // Defer to next tick so this never competes with the UI update
          setTimeout(() => migrateGuestRecords(user), 0);
        }
      } else if (event === "SIGNED_OUT") {
        cb(null);
      }
    });
    return data.subscription;
  },

  logout: () => sb.auth.signOut(),

  displayName: (user) => user?.email?.split("@")[0] ?? "使用者",
};

/**
 * migrateGuestRecords — one-time background migration of guest-mode
 * localStorage records into Supabase after a fresh login.
 *
 * Uses the storage_v1 service layer (loadRecords/saveRecords) rather
 * than touching localStorage directly, per project convention.
 *
 * Field mapping note: the local cache stores records via `strip()`
 * (domain/records.js), which uses camelCase keys (advanceReceived,
 * actualSpent, settlementDate, paymentRecords) — NOT snake_case.
 * rawToDbRow() already converts camelCase → snake_case for the DB,
 * so we reuse it here instead of re-mapping fields by hand.
 */
async function migrateGuestRecords(user) {
  try {
    const guestRecords = loadRecords(); // camelCase raw records from localStorage
    if (!Array.isArray(guestRecords) || guestRecords.length === 0) return;

    console.warn(`[migrate] found ${guestRecords.length} guest record(s), migrating to cloud…`);

    const rows = guestRecords.map((r) => ({
      ...rawToDbRow(r),
      user_id: user.id,
    }));

    const { error } = await sb.from("hb_records").insert(rows);

    if (error) {
      console.error("[migrate] insert failed, guest data left untouched:", error.message);
      return; // do NOT clear local cache on failure — keep the data safe
    }

    console.warn("[migrate] success — clearing local guest cache");
    saveRecords([]); // only clear after confirmed successful insert
  } catch (e) {
    console.error("[migrate] unexpected error, guest data left untouched:", e);
  }
}

// ── Supabase records helpers ──────────────────────────────────
const db = {
  load: async () => {
    const { data, error } = await sb
      .from("hb_records")
      .select("*")
      .order("date", { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(dbRowToRaw);
  },

  upsert: async (raw) => {
    const { error } = await sb
      .from("hb_records")
      .upsert(rawToDbRow(raw), { onConflict: "id" });
    if (error) throw new Error(error.message);
  },

  delete: async (id) => {
    const { error } = await sb.from("hb_records").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },
};

// ── User settings (tags, theme) — cloud for logged-in, localStorage for guests ──
const userSettings = {
  /**
   * load — fetch tags from hb_user_settings.
   * Returns null if no row exists yet (first login).
   */
  load: async () => {
    const { data, error } = await sb
      .from("hb_user_settings")
      .select("tags")
      .single();
    if (error && error.code !== "PGRST116") throw new Error(error.message);
    return data?.tags ?? null; // null = no row yet
  },

  /**
   * saveTags — upsert tags into hb_user_settings.
   * Creates the row on first call, updates on subsequent calls.
   */
  saveTags: async (tags) => {
    const { error } = await sb
      .from("hb_user_settings")
      .upsert({ user_id: (await sb.auth.getUser()).data.user?.id, tags }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
  },
};
// user_id is intentionally omitted from rawToDbRow —
// Supabase RLS uses auth.uid() server-side for insert/update.
// Passing it from client is redundant and can cause mismatch if stale.
const rawToDbRow = (r) => ({
  id:               r.id,
  kind:             r.kind,
  adv_status:       r.advStatus ?? null,
  title:            r.title,
  date:             r.date,
  note:             r.note || "",
  amount:           r.amount || 0,
  advance_received: r.advanceReceived || 0,
  actual_spent:     r.actualSpent || 0,
  settlement_date:  r.settlementDate || "",
  payment_records:  r.paymentRecords || [],
  tags:             r.tags || [],
});

const dbRowToRaw = (row) => ({
  id:              row.id,
  userId:          row.user_id,
  kind:            row.kind            ?? "reimburse",
  advStatus:       row.adv_status      ?? null,
  title:           row.title           ?? "",
  date:            row.date            ?? "",
  note:            row.note            ?? "",
  amount:          row.amount          ?? 0,
  advanceReceived: row.advance_received ?? 0,
  actualSpent:     row.actual_spent     ?? 0,
  settlementDate:  row.settlement_date  ?? "",
  paymentRecords:  row.payment_records  ?? [],
  tags:            row.tags             ?? [],
});

// ─── Theme ────────────────────────────────────────────────────
const ThemeCtx = createContext({ dark: false, pref: "light", setPref: () => {} });
const useTheme = () => useContext(ThemeCtx);

function ThemeProvider({ children }) {
  const [pref, _setPref] = useState(() => getTheme());
  const sysDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = pref === "dark" || (pref === "system" && sysDark);

  const setPref = useCallback((t) => { _setPref(t); saveTheme(t); }, []);

  useEffect(() => {
    document.body.style.background = dark ? "#09090b" : "#f9fafb";
    document.title = "HaiBack｜還袂";
  }, [dark]);

  return (
    <ThemeCtx.Provider value={{ dark, pref, setPref }}>
      {children}
    </ThemeCtx.Provider>
  );
}

// ─── Design tokens (functions, not strings) ───────────────────
// Call with dark to get the right class for that context
const C = {
  page:    (d) => d ? "bg-zinc-950 text-zinc-100"          : "bg-zinc-50 text-zinc-900",
  card:    (d) => d ? "bg-zinc-900 border border-zinc-800"  : "bg-white border border-zinc-100",
  card2:   (d) => d ? "bg-zinc-800 border border-zinc-700"  : "bg-zinc-50 border border-zinc-200",
  input:   (d) => d ? "bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500" : "bg-white border-zinc-200 text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400",
  tx:      (d) => d ? "text-zinc-100"  : "text-zinc-900",
  tx2:     (d) => d ? "text-zinc-400"  : "text-zinc-500",
  tx3:     (d) => d ? "text-zinc-500"  : "text-zinc-400",
  border:  (d) => d ? "border-zinc-800" : "border-zinc-100",
  divider: (d) => d ? "bg-zinc-800"    : "bg-zinc-100",
  btn:     (d) => d ? "bg-white text-zinc-900 hover:bg-zinc-100" : "bg-zinc-900 text-white hover:bg-zinc-800",
  btnGhost:(d) => d ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50",
  activeFilter: (d) => d ? "bg-white text-zinc-900 border-white" : "bg-zinc-900 text-white border-zinc-900",
  inactFilter:  (d) => d ? "bg-zinc-800 text-zinc-300 border-zinc-700 hover:border-zinc-500" : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400",
  fabBg:   (d) => d ? "bg-white"       : "bg-zinc-900",
  fabTx:   (d) => d ? "text-zinc-900"  : "text-white",
  overlay: () => "bg-black/50 backdrop-blur-sm",
  closeBtn:(d) => d ? "bg-zinc-800 text-zinc-400 hover:bg-zinc-700" : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200",
  sheetBg: (d) => d ? "bg-zinc-900 border-t border-zinc-800" : "bg-white",
  // Tag pills: dashed/grey when empty, solid when has tags
  tagEmpty: (d) => d ? "border-dashed border-zinc-700 text-zinc-500" : "border-dashed border-zinc-300 text-zinc-400",
  tagFilled:(d) => d ? "border-zinc-600 bg-zinc-800 text-zinc-200" : "border-zinc-300 bg-zinc-100 text-zinc-700",
  // Unselected-but-existing tag: solid outline, no fill (used in TagPicker form, distinct from tagEmpty which is the dashed "+新增" placeholder)
  tagUnselected: (d) => d ? "border-zinc-700 text-zinc-400 bg-transparent" : "border-zinc-300 text-zinc-500 bg-transparent",
};

// ─── UI formatting helpers ────────────────────────────────────
const fmt  = (n) => `$${Number(n || 0).toLocaleString()}`;
const fmtD = (s) => (s || "").slice(0, 10).replace(/-/g, "/");

// ─── Icons ────────────────────────────────────────────────────
const sv = (d, c = "w-4 h-4") =>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={c}>{d}</svg>;
const I = {
  back:   sv(<><path d="M19 12H5M12 5l-7 7 7 7"/></>),
  edit:   sv(<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>),
  trash:  sv(<><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></>),
  search: sv(<><circle cx={11} cy={11} r={8}/><path d="M21 21l-4.35-4.35"/></>),
  filter: sv(<><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></>),
  user:   sv(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>),
  plus:   sv(<><path d="M12 5v14M5 12h14"/></>, "w-5 h-5"),
  check:  sv(<><polyline points="20 6 9 17 4 12"/></>, "w-3 h-3"),
  clock:  sv(<><circle cx={12} cy={12} r={10}/><polyline points="12 6 12 12 16 14"/></>, "w-3 h-3"),
  cal:    sv(<><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>),
  eye:    sv(<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>),
  eyeOff: sv(<><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>),
  sun:    sv(<><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></>),
  moon:   sv(<><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></>),
  phone:  sv(<><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></>),
  chevR:  sv(<><polyline points="9 18 15 12 9 6"/></>),
  info:   sv(<><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>),
};

// ─── Atoms ────────────────────────────────────────────────────
function PBtn({ onClick, disabled, children, d, className = "" }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-full py-4 rounded-2xl font-semibold text-sm active:scale-[0.98] transition-all disabled:opacity-40 ${C.btn(d)} ${className}`}>
      {children}
    </button>
  );
}
function GBtn({ onClick, children, d, className = "" }) {
  return (
    <button onClick={onClick}
      className={`flex-1 py-4 rounded-2xl border text-sm transition-all ${C.btnGhost(d)} ${className}`}>
      {children}
    </button>
  );
}

function Field({ label, hint, children, d }) {
  return (
    <div className="flex flex-col gap-2">
      <label className={`text-xs font-semibold uppercase tracking-wider ${C.tx3(d)}`}>{label}</label>
      {children}
      {hint && <p className={`text-xs ${C.tx3(d)} leading-relaxed`}>{hint}</p>}
    </div>
  );
}

function Input({ d, ...props }) {
  return (
    <input {...props}
      className={`w-full px-4 py-3 rounded-2xl border text-sm focus:outline-none focus:ring-2 focus:ring-black/10 transition-all ${C.input(d)} ${props.className || ""}`} />
  );
}

function Textarea({ d, ...props }) {
  return (
    <textarea {...props}
      className={`w-full px-4 py-3 rounded-2xl border text-sm focus:outline-none focus:ring-2 focus:ring-black/10 transition-all resize-none ${C.input(d)} ${props.className || ""}`} />
  );
}

function DateInput({ value, onChange, d }) {
  const ref = useRef();
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border cursor-pointer transition-all ${C.input(d)}`}
      onClick={() => ref.current?.showPicker?.()}>
      <span className={C.tx3(d)}>{I.cal}</span>
      <input ref={ref} type="date" value={value} onChange={e => onChange(e.target.value)}
        className={`flex-1 text-sm font-medium bg-transparent focus:outline-none cursor-pointer ${C.tx(d)}`} />
    </div>
  );
}

function Sheet({ title, onClose, d, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className={`absolute inset-0 ${C.overlay()}`} onClick={onClose} />
      <div className={`relative w-full rounded-t-3xl shadow-2xl max-h-[93vh] flex flex-col ${C.sheetBg(d)}`}>
        <div className={`flex items-center justify-between px-5 pt-5 pb-4 border-b ${C.border(d)} shrink-0`}>
          <h2 className={`text-base font-bold ${C.tx(d)}`}>{title}</h2>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-full text-xl transition-colors ${C.closeBtn(d)}`}>×</button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-5 pb-12">{children}</div>
      </div>
    </div>
  );
}

function SRow({ l, v, d }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className={`text-sm ${C.tx2(d)}`}>{l}</span>
      <span className={`text-sm font-semibold ${C.tx(d)}`}>{v}</span>
    </div>
  );
}

function SecTitle({ children, d }) {
  return <p className={`text-xs font-semibold uppercase tracking-wider ${C.tx3(d)} mb-2`}>{children}</p>;
}

function SettingRow({ icon, label, value, right, onClick, danger, d }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3.5 ${C.card(d)} rounded-2xl ${onClick ? "cursor-pointer hover:opacity-75 transition-opacity" : ""}`}
      onClick={onClick}>
      {icon && <span className={danger ? "text-red-500" : C.tx2(d)}>{icon}</span>}
      <span className={`text-sm flex-1 ${danger ? "text-red-500" : C.tx(d)}`}>{label}</span>
      {value && <span className={`text-sm ${C.tx3(d)}`}>{value}</span>}
      {right && <span className={C.tx3(d)}>{right}</span>}
    </div>
  );
}

// ─── Kind / Status pills ──────────────────────────────────────
function KindPill({ rec, d }) {
  const label = rec.kind === KIND.R ? "純報銷"
    : rec.advStatus === ADV.PENDING   ? "預支審核中"
    : rec.advStatus === ADV.REJECTED  ? "預支未通過"
    : "需結算";
  const style = d
    ? "bg-zinc-700 text-zinc-200 border-zinc-600"
    : "bg-zinc-100 text-zinc-600 border-zinc-200";
  return <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${style}`}>{label}</span>;
}

function StatusPill({ status, d }) {
  const done    = status === "完成";
  const waiting = status === "等待核准";
  const style = done
    ? (d ? "bg-zinc-800 text-zinc-300 border-zinc-700" : "bg-zinc-100 text-zinc-500 border-zinc-200")
    : waiting
    ? (d ? "bg-zinc-800 text-zinc-400 border-zinc-700" : "bg-zinc-100 text-zinc-400 border-zinc-200")
    : (d ? "bg-white text-zinc-900 border-white" : "bg-zinc-900 text-white border-zinc-900");
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${style}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${done || waiting ? (d ? "bg-zinc-500" : "bg-zinc-400") : (d ? "bg-zinc-900" : "bg-white")}`}/>
      {status}
    </span>
  );
}

// ─── Timeline ─────────────────────────────────────────────────
function Timeline({ rec, compact = false, d }) {
  const hasAdv = toN(rec.advanceReceived) > 0;
  const steps  = hasAdv
    ? ["建立","領款","填費","結算","完成"]
    : ["建立","填費","補款","完成"];
  const idxMap = hasAdv
    ? { [STAGE.WAITING]:1,[STAGE.SETTLING]:3,[STAGE.DONE]:4 }
    : { [STAGE.WAITING]:1,[STAGE.SETTLING]:2,[STAGE.DONE]:3 };
  const cur = rec.stage ? (idxMap[rec.stage] ?? 0) : 0;

  const doneBg  = d ? "bg-zinc-100" : "bg-zinc-900";
  const doneTx  = d ? "text-zinc-900" : "text-white";
  const actBg   = d ? "bg-zinc-100 ring-zinc-700" : "bg-zinc-900 ring-zinc-200";
  const actInner= d ? "bg-zinc-900" : "bg-white";
  const pendBg  = d ? "bg-zinc-700" : "bg-zinc-200";
  const lineDone= d ? "bg-zinc-400" : "bg-zinc-900";
  const linePend= d ? "bg-zinc-700" : "bg-zinc-200";

  if (compact) return (
    <div className="flex items-center gap-1">
      {steps.map((_, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className={`w-1.5 h-1.5 rounded-full ${i < cur ? doneBg : i === cur ? doneBg + " ring-2 " + (d ? "ring-zinc-600" : "ring-zinc-300") : pendBg}`}/>
          {i < steps.length-1 && <div className={`w-3 h-px ${i < cur ? lineDone : linePend}`}/>}
        </div>
      ))}
    </div>
  );

  const labels = hasAdv
    ? ["款項建立", rec.advanceReceived > 0 ? `預支金額 ${fmt(rec.advanceReceived)}` : "預支金額", rec.actualSpent > 0 ? `實際花費 ${fmt(rec.actualSpent)}` : "填寫實際花費", "結算中", "已結清"]
    : ["款項建立", rec.actualSpent > 0 ? `實際花費 ${fmt(rec.actualSpent)}` : "填寫實際花費", rec.stage === STAGE.DONE ? "補款完成" : "公司補款", "已完成"];

  // Dates aligned to each step index — only shown for completed/active steps
  const stepDates = hasAdv
    ? [rec.date, rec.date, rec.settlementDate, rec.settlementDate, rec.settlementDate]
    : [rec.date, rec.settlementDate, rec.settlementDate, rec.settlementDate];

  return (
    <div className="flex flex-col">
      {labels.map((label, i) => {
        const done = i < cur, active = i === cur;
        const stepDate = stepDates[i];
        // Show date for any step that's been reached (done or currently active-and-checked,
        // e.g. "已結清"/"已完成" is the final active step but should still show its date)
        const showDate = (done || active) && stepDate;
        return (
          <div key={i} className="flex items-start gap-3">
            <div className="flex flex-col items-center shrink-0">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center mt-0.5 ${done ? doneBg : active ? `${actBg} ring-4` : pendBg}`}>
                {done   && <span className={doneTx}>{I.check}</span>}
                {active && <div className={`w-2 h-2 rounded-full ${actInner}`}/>}
              </div>
              {i < labels.length-1 && <div className={`w-px my-1 ${done ? lineDone : linePend}`} style={{minHeight:14}}/>}
            </div>
            <div className="flex items-center gap-2 pb-3 pt-0.5 flex-wrap">
              <p className={`text-sm ${done ? `${C.tx3(d)} line-through` : active ? `${C.tx(d)} font-semibold` : C.tx3(d)}`}>{label}</p>
              {showDate && <span className={`text-xs ${C.tx3(d)}`}>{fmtD(stepDate)}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── About Page ───────────────────────────────────────────────
function AboutPage({ d, user, onBack, onClose }) {
  const [panel, setPanel] = useState(null); // null | 'feedback' | 'support' | 'changelog'

  // ── Feedback state ─────────────────────────────────────────
  const [fbType,    setFbType]    = useState("bug");
  const [fbTitle,   setFbTitle]   = useState("");
  const [fbContent, setFbContent] = useState("");
  const [fbEmail,   setFbEmail]   = useState("");
  const [fbBusy,    setFbBusy]    = useState(false);
  const [fbDone,    setFbDone]    = useState(false);

  const resetFb = () => { setFbType("bug"); setFbTitle(""); setFbContent(""); setFbEmail(""); setFbDone(false); };

  const submitFeedback = async () => {
    if (!user) return alert("請先登入後再送出回饋。");
    if (!fbTitle.trim())   return alert("請填寫標題");
    if (!fbContent.trim()) return alert("請填寫內容");
    setFbBusy(true);
    const { error } = await sb.from("hb_feedback").insert({
      user_id:     user.id,
      is_guest:    false,
      app_name:    "HaiBack",
      app_version: APP_VERSION,
      platform:    navigator.userAgent,
      type:        fbType,
      title:       fbTitle.trim(),
      content:     fbContent.trim(),
      email:       fbEmail.trim(),
    });
    setFbBusy(false);
    if (error) { alert("送出失敗，請稍後再試：\n" + error.message); return; }
    setFbDone(true);
  };

  const typeOpts = [
    { v: "bug",     l: "Bug 回報" },
    { v: "feature", l: "功能建議" },
    { v: "other",   l: "其他" },
  ];

  // ── Changelog ──────────────────────────────────────────────
  const changelogEntries = [
    { v: "1.3.5", note: "設定頁 footer 新增使用條款、隱私權政策與聯絡作者入口。" },
    { v: "1.3.4", note: "設定頁重新分區，顯示改為藥丸切換，標籤與匯出資料合併為資料管理。" },
    { v: "1.3.3", note: "更新日誌改為緊湊列表樣式，移除多餘的重複返回按鈕。" },
    { v: "1.3.2", note: "調整更新日誌卡片間距，設定主頁補回版本號顯示。" },
    { v: "1.3.1", note: "整理匯出資料細節與更新日誌。" },
    { v: "1.3.0", note: "新增資料與備份區，可匯出 JSON 備份與 CSV 表格。" },
    { v: "1.2.9", note: "整理關於頁、支持頁與回饋流程。" },
    { v: "1.2.8", note: "修正第一次追回款項提示條件，並整理標籤同步與空狀態顯示。" },
    { v: "1.2.7", note: "新增第一次追回款項提示。" },
    { v: "1.2.6", note: "完成頁改為顯示已追回總額。" },
    { v: "1.2.5", note: "標籤支援雲端同步。" },
  ];

  if (panel === "changelog") {
    return (
      <Sheet title="更新日誌" onClose={onClose} d={d}>
        <div className="flex flex-col gap-6">
          <button onClick={() => setPanel(null)}
            className={`flex items-center gap-2 text-sm font-medium ${C.tx2(d)} hover:opacity-70 transition-opacity w-fit`}>
            {I.back} 返回關於
          </button>
          <div className="flex flex-col gap-1">
            {changelogEntries.map(({ v, note }) => (
              <div key={v} className={`px-4 py-3.5 rounded-2xl ${C.card(d)}`}>
                <div className={`text-sm font-semibold ${C.tx(d)}`}>v{v}</div>
                <p className={`text-xs mt-0.5 ${C.tx3(d)}`}>{note}</p>
              </div>
            ))}
          </div>
        </div>
      </Sheet>
    );
  }

  // ── Support ────────────────────────────────────────────────
  if (panel === "support") {
    return (
      <Sheet title="支持 HaiBack" onClose={onClose} d={d}>
        <div className="flex flex-col gap-6">
          <button onClick={() => setPanel(null)}
            className={`flex items-center gap-2 text-sm font-medium ${C.tx2(d)} hover:opacity-70 transition-opacity w-fit`}>
            {I.back} 返回關於
          </button>
          <div className="flex flex-col items-center gap-5 py-4 text-center">
            <span className="text-5xl">🧋</span>
            <div className={`font-bold text-lg ${C.tx(d)}`}>支持 HaiBack</div>
            <p className={`text-sm leading-relaxed ${C.tx2(d)} max-w-xs`}>
              HaiBack 會持續保持免費。<br/><br/>
              如果它曾經幫你少算一點帳、<br/>
              少忘一筆報銷，<br/>
              歡迎之後請作者喝杯奶茶 🧋<br/><br/>
              你的支持，會成為 HaiBack 持續更新，<br/>
              以及下一個實用小工具誕生的動力。
            </p>
          </div>
          <PBtn d={d} disabled>
            奶茶基金準備中
          </PBtn>
        </div>
      </Sheet>
    );
  }

  // ── Feedback ───────────────────────────────────────────────
  if (panel === "feedback") {
    return (
      <Sheet title="回報問題／功能建議" onClose={onClose} d={d}>
        <div className="flex flex-col gap-5">
          <button onClick={() => { setPanel(null); resetFb(); }}
            className={`flex items-center gap-2 text-sm font-medium ${C.tx2(d)} hover:opacity-70 transition-opacity w-fit`}>
            {I.back} 返回關於
          </button>

          {fbDone ? (
            <div className="flex flex-col items-center gap-4 py-12 text-center">
              <span className="text-5xl">❤️</span>
              <div className={`font-bold text-lg ${C.tx(d)}`}>謝謝你的回饋 ❤️</div>
              <p className={`text-sm ${C.tx2(d)}`}>你的意見已成功送出。</p>
            </div>
          ) : (
            <>
              <Field label="類型" d={d}>
                <div className="flex gap-2">
                  {typeOpts.map(({ v, l }) => (
                    <button key={v} onClick={() => setFbType(v)}
                      className={`flex-1 py-2.5 rounded-2xl border-2 text-xs font-semibold transition-all ${fbType === v ? C.activeFilter(d) : C.inactFilter(d)}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="標題" d={d}>
                <Input d={d} placeholder="一句話描述問題或建議" value={fbTitle}
                  onChange={e => setFbTitle(e.target.value)} />
              </Field>

              <Field label="內容" d={d}>
                <Textarea d={d} rows={4} placeholder="詳細描述…" value={fbContent}
                  onChange={e => setFbContent(e.target.value)} />
              </Field>

              <Field label="Email（選填）" hint="方便我回覆你" d={d}>
                <Input d={d} type="email" placeholder="you@example.com" value={fbEmail}
                  onChange={e => setFbEmail(e.target.value)} />
              </Field>

              <PBtn d={d} onClick={submitFeedback} disabled={fbBusy}>
                {fbBusy ? "送出中…" : "送出回饋"}
              </PBtn>
            </>
          )}
        </div>
      </Sheet>
    );
  }

  // ── About main ─────────────────────────────────────────────
  const rows = [
    { icon: "💬", label: "回報問題／功能建議", sub: "告訴我哪裡可以更好",       action: () => setPanel("feedback")  },
    { icon: "🧋", label: "支持 HaiBack",       sub: "請作者喝杯奶茶",           action: () => setPanel("support")   },
    { icon: "📜", label: "更新日誌",            sub: `目前版本 v${APP_VERSION}`, action: () => setPanel("changelog") },
  ];

  return (
    <Sheet title="關於" onClose={onClose} d={d}>
      <div className="flex flex-col gap-8">
        <button onClick={onBack}
          className={`flex items-center gap-2 text-sm font-medium ${C.tx2(d)} hover:opacity-70 transition-opacity w-fit`}>
          {I.back} 返回設定
        </button>

        <div className="flex flex-col items-center gap-3 py-4">
          <div className={`w-16 h-16 rounded-3xl flex items-center justify-center shadow-sm ${d ? "bg-zinc-100" : "bg-zinc-900"}`}>
            <span className={`font-bold text-2xl ${d ? "text-zinc-900" : "text-white"}`}>還</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className={`text-lg font-bold ${C.tx(d)}`}>HaiBack｜還袂</div>
            <p className={`text-sm text-center leading-relaxed ${C.tx3(d)}`}>
              專為報銷與公司代墊設計。<br/>讓你不用再自己算公司還欠多少。
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {rows.map(({ icon, label, sub, action }) => (
            <div key={label} onClick={action}
              className={`flex items-center gap-4 px-4 py-4 rounded-2xl cursor-pointer hover:opacity-75 transition-opacity ${C.card(d)}`}>
              <span className="text-xl w-7 text-center">{icon}</span>
              <div className="flex-1">
                <div className={`text-sm font-semibold ${C.tx(d)}`}>{label}</div>
                <div className={`text-xs mt-0.5 ${C.tx3(d)}`}>{sub}</div>
              </div>
              <span className={C.tx3(d)}>{I.chevR}</span>
            </div>
          ))}
        </div>

        <p className={`text-center text-xs pt-6 pb-4 ${d ? "text-zinc-600" : "text-zinc-400"}`}>
          Designed &amp; Developed by CyM
        </p>
      </div>
    </Sheet>
  );
}

// ─── Export Data Page ─────────────────────────────────────────
function ExportDataPage({ d, records, onBack, onClose }) {
  const isEmpty = records.length === 0;
  const todayStr = today(); // YYYY-MM-DD, from domain/records.js

  const exportJson = () => {
    const payload = {
      app: "HaiBack",
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      records: records.map(strip),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `haiback-backup-${todayStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Escape a single CSV field: wrap in quotes if it contains a comma,
  // newline, or double-quote; double any internal quotes.
  const csvEscape = (val) => {
    const s = String(val ?? "");
    if (/[",\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const exportCsv = () => {
    const headers = ["狀態","類型","名稱","日期","金額","預支金額","實際花費","已入帳/已處理","剩餘金額","結算日期","標籤","備註"];
    const rows = records.map(r => [
      r.status ?? "",
      r.kind === KIND.R ? "純報銷" : "需結算",
      r.title ?? "",
      r.date ?? "",
      toN(r.amount),
      toN(r.advanceReceived),
      toN(r.actualSpent),
      toN(r.paid),
      toN(r.remaining),
      r.settlementDate ?? "",
      (r.tags || []).join("、"),
      r.note ?? "",
    ]);

    const csvBody = [headers, ...rows]
      .map(row => row.map(csvEscape).join(","))
      .join("\n");

    // UTF-8 BOM so Excel/Google Sheets render Chinese characters correctly
    const blob = new Blob(["\uFEFF" + csvBody], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `haiback-records-${todayStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Sheet title="匯出資料" onClose={onClose} d={d}>
      <div className="flex flex-col gap-6">
        <button onClick={onBack}
          className={`flex items-center gap-2 text-sm font-medium ${C.tx2(d)} hover:opacity-70 transition-opacity w-fit`}>
          {I.back} 返回設定
        </button>

        <p className={`text-sm leading-relaxed ${C.tx2(d)}`}>
          你可以匯出目前所有 HaiBack 紀錄，<br/>
          作為個人備份或整理使用。<br/><br/>
          JSON 適合完整備份，<br/>
          CSV 適合用 Excel 或試算表查看。
        </p>

        {isEmpty && (
          <div className={`rounded-2xl px-4 py-4 text-center text-sm ${C.card2(d)} ${C.tx3(d)}`}>
            目前還沒有可以匯出的紀錄。
          </div>
        )}

        <PBtn d={d} onClick={exportJson} disabled={isEmpty}>
          匯出 JSON 備份
        </PBtn>
        <PBtn d={d} onClick={exportCsv} disabled={isEmpty}>
          匯出 CSV 表格
        </PBtn>
      </div>
    </Sheet>
  );
}

// ─── Legal Text Sheet (shared by terms / privacy / contact) ────
function LegalTextSheet({ d, title, onBack, onClose, children }) {
  return (
    <Sheet title={title} onClose={onClose} d={d}>
      <div className="flex flex-col gap-5">
        <button onClick={onBack}
          className={`flex items-center gap-2 text-sm font-medium ${C.tx2(d)} hover:opacity-70 transition-opacity w-fit`}>
          {I.back} 返回設定
        </button>
        <div className={`flex flex-col gap-3 text-sm leading-relaxed ${C.tx2(d)}`}>
          {children}
        </div>
      </div>
    </Sheet>
  );
}

// ─── Account Sheet ────────────────────────────────────────────
function AccountSheet({ user, records, dispatch, onLogout, onClose, d }) {
  const { pref, setPref } = useTheme();
  const [editingTags, setEditingTags]   = useState(false);
  const [tagList, setTagListState]      = useState(() => getTagList());
  const [newTag,  setNewTag]            = useState("");
  const [renamingTag, setRenamingTag]   = useState(null);
  const [renameInput, setRenameInput]   = useState("");
  const [confirmTag,  setConfirmTag]    = useState(null);
  const [showAbout,   setShowAbout]     = useState(false);
  const [showExport,  setShowExport]    = useState(false);
  const [legalPanel,  setLegalPanel]    = useState(null); // null | "terms" | "privacy" | "contact"

  const opts = [
    { k: "light",  l: "淺色模式", ic: I.sun   },
    { k: "dark",   l: "深色模式", ic: I.moon  },
  ];

  // Save tags to localStorage always, and cloud if logged in
  const syncTags = (next) => {
    saveTagList(next);
    if (user) userSettings.saveTags(next).catch(e => console.warn("tag sync failed:", e.message));
  };

  const addTag = () => {
    const t = newTag.trim();
    if (!t) return;
    if (tagList.includes(t)) { setNewTag(""); return; }
    if (tagList.length >= MAX_TAGS) { alert(`最多只能建立 ${MAX_TAGS} 個標籤`); return; }
    const next = [...tagList, t];
    setTagListState(next);
    syncTags(next);
    setNewTag("");
  };

  const removeTag = (tag) => { setConfirmTag(tag); };

  const confirmRemoveTag = () => {
    const tag = confirmTag;
    setConfirmTag(null);
    const next = tagList.filter(t => t !== tag);
    setTagListState(next);
    syncTags(next);
    records.forEach(r => {
      if (r.tags && r.tags.includes(tag)) {
        dispatch({
          type: RECORDS_ACTION.UPDATE_RECORD,
          payload: derive({ ...strip(r), tags: r.tags.filter(t => t !== tag) }),
        });
      }
    });
  };

  const startRename = (tag) => { setRenamingTag(tag); setRenameInput(tag); };

  const confirmRename = () => {
    const newName = renameInput.trim();
    if (!newName || newName === renamingTag) { setRenamingTag(null); return; }
    if (tagList.includes(newName)) { alert("已有相同名稱的標籤"); return; }

    const next = tagList.map(t => t === renamingTag ? newName : t);
    setTagListState(next);
    syncTags(next);

    // Propagate the rename to every record that has the old tag name
    records.forEach(r => {
      if (r.tags && r.tags.includes(renamingTag)) {
        dispatch({
          type: RECORDS_ACTION.UPDATE_RECORD,
          payload: derive({ ...strip(r), tags: r.tags.map(t => t === renamingTag ? newName : t) }),
        });
      }
    });

    setRenamingTag(null);
  };

  // ── Export data page ─────────────────────────────────────────
  if (showExport) {
    return <ExportDataPage d={d} records={records} onBack={() => setShowExport(false)} onClose={onClose} />;
  }

  // ── About page ──────────────────────────────────────────────
  if (showAbout) {
    return <AboutPage d={d} user={user} onBack={() => setShowAbout(false)} onClose={onClose} />;
  }

  // ── Legal panels (terms / privacy / contact) ──────────────────
  if (legalPanel === "terms") {
    return (
      <LegalTextSheet d={d} title="使用條款" onClose={onClose} onBack={() => setLegalPanel(null)}>
        <p>HaiBack｜還袂 是一個協助使用者紀錄公司代墊款、報銷進度與結算狀態的小工具。</p>
        <p>使用 HaiBack 時，代表你理解並同意：</p>
        <ol className="list-decimal pl-5 flex flex-col gap-2">
          <li>HaiBack 僅提供紀錄、整理與提醒用途，不構成正式會計、法律或稅務建議。</li>
          <li>使用者需自行確認輸入資料的正確性，包含金額、日期、款項狀態與備註內容。</li>
          <li>HaiBack 會盡力維持服務穩定，但不保證服務永不中斷或資料永不遺失。</li>
          <li>使用者可自行透過「匯出資料」功能備份紀錄。</li>
          <li>若因使用者輸入錯誤、裝置問題、網路異常或第三方服務異常造成資料不一致，HaiBack 不負擔因此產生的帳務或金錢責任。</li>
          <li>HaiBack 目前為免費工具，未來若有重大功能、收費方式或條款變更，將於更新日誌或相關頁面中說明。</li>
        </ol>
        <p className={C.tx3(d)}>最後更新：2026 年 7 月</p>
      </LegalTextSheet>
    );
  }

  if (legalPanel === "privacy") {
    return (
      <LegalTextSheet d={d} title="隱私權政策" onClose={onClose} onBack={() => setLegalPanel(null)}>
        <p>HaiBack｜還袂 重視你的資料與隱私。</p>
        <p>當你使用 HaiBack 時，可能會儲存以下資料：</p>
        <ol className="list-decimal pl-5 flex flex-col gap-2">
          <li>Google 登入資訊：包含你的帳號識別資訊、顯示名稱或 Email，用於登入與雲端同步。</li>
          <li>報銷與代墊紀錄：包含款項名稱、日期、金額、預支金額、實際花費、入帳紀錄、標籤與備註。</li>
          <li>使用者設定：包含標籤列表、外觀偏好與部分本機提示狀態。</li>
          <li>回饋內容：當你送出問題回報或功能建議時，HaiBack 會儲存你填寫的標題、內容、類型與選填 Email。</li>
        </ol>
        <p>這些資料僅用於：</p>
        <ul className="list-disc pl-5 flex flex-col gap-1">
          <li>提供紀錄與雲端同步功能</li>
          <li>顯示與整理你的報銷資料</li>
          <li>匯出個人備份</li>
          <li>處理使用者回饋</li>
          <li>改善 HaiBack 的功能與穩定性</li>
        </ul>
        <p>HaiBack 不會主動販售、出租或公開你的個人資料。</p>
        <p>資料儲存於 Supabase 提供的雲端資料庫中，並透過 Row Level Security 限制使用者僅能讀取與管理自己的紀錄。</p>
        <p>你可以透過「匯出資料」功能自行備份紀錄。如需刪除帳號或相關資料，可透過「聯絡作者」與 CyM 聯繫。</p>
        <p className={C.tx3(d)}>最後更新：2026 年 7 月</p>
      </LegalTextSheet>
    );
  }

  if (legalPanel === "contact") {
    return (
      <LegalTextSheet d={d} title="聯絡作者" onClose={onClose} onBack={() => setLegalPanel(null)}>
        <p>HaiBack｜還袂 由 CyM 設計與開發。</p>
        <p>如果你有以下需求，歡迎聯絡我：</p>
        <ul className="list-disc pl-5 flex flex-col gap-1">
          <li>回報無法正常使用的問題</li>
          <li>提供功能建議</li>
          <li>詢問資料刪除或隱私相關事項</li>
          <li>其他合作或聯絡需求</li>
        </ul>
        <p className="mt-2">
          <span className={`block text-xs font-semibold uppercase tracking-wider ${C.tx3(d)} mb-1`}>Email</span>
          請填入作者信箱
        </p>
      </LegalTextSheet>
    );
  }

  if (editingTags) {
    return (
      <Sheet title="編輯標籤" onClose={onClose} d={d}>
        <div className="flex flex-col gap-6">
          <button onClick={() => setEditingTags(false)}
            className={`flex items-center gap-2 text-sm font-medium ${C.tx2(d)} hover:opacity-70 transition-opacity w-fit`}>
            {I.back} 返回設定
          </button>

          <div>
            <SecTitle d={d}>目前的標籤（{tagList.length}/{MAX_TAGS}）</SecTitle>
            {tagList.length === 0 ? (
              <p className={`text-xs ${C.tx3(d)}`}>還沒有任何標籤</p>
            ) : (
              <div className="flex flex-col gap-2">
                {tagList.map(tag => (
                  <div key={tag} className={`flex items-center justify-between gap-2 px-4 py-3 rounded-2xl ${C.card(d)}`}>
                    {renamingTag === tag ? (
                      <input
                        autoFocus
                        value={renameInput}
                        onChange={e => setRenameInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") confirmRename(); if (e.key === "Escape") setRenamingTag(null); }}
                        onBlur={confirmRename}
                        maxLength={10}
                        className={`flex-1 text-sm font-semibold bg-transparent focus:outline-none border-b ${d ? "border-zinc-600 text-zinc-100" : "border-zinc-300 text-zinc-900"}`}
                      />
                    ) : (
                      <span className={`text-sm font-semibold ${C.tx(d)}`}>{tag}</span>
                    )}
                    <div className="flex items-center gap-3 shrink-0">
                      <button onClick={() => startRename(tag)}
                        className={`${C.tx3(d)} hover:opacity-70 transition-opacity`}>
                        {I.edit}
                      </button>
                      <button onClick={() => removeTag(tag)}
                        className="text-red-500 hover:opacity-70 transition-opacity">
                        {I.trash}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {tagList.length < MAX_TAGS && (
            <Field label="新增標籤" d={d}>
              <div className="flex gap-2">
                <Input d={d} value={newTag} onChange={e => setNewTag(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addTag(); }}
                  placeholder="標籤名稱" maxLength={10} className="flex-1" />
                <button onClick={addTag}
                  className={`px-4 rounded-2xl text-sm font-semibold transition-all ${C.btn(d)}`}>
                  新增
                </button>
              </div>
            </Field>
          )}

          {/* Custom confirm dialog — replaces native confirm() */}
          {confirmTag && (
            <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
              <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmTag(null)} />
              <div className={`relative w-full max-w-xs rounded-3xl p-6 flex flex-col gap-4 shadow-2xl ${d ? "bg-zinc-900" : "bg-white"}`}>
                <div className={`font-bold text-base ${C.tx(d)}`}>刪除標籤「{confirmTag}」？</div>
                <p className={`text-sm ${C.tx2(d)} leading-relaxed`}>已套用此標籤的紀錄不會被刪除，只會移除標籤。</p>
                <div className="flex gap-3">
                  <button onClick={() => setConfirmTag(null)}
                    className={`flex-1 py-3 rounded-2xl border text-sm font-semibold transition-all ${C.btnGhost(d)}`}>
                    取消
                  </button>
                  <button onClick={confirmRemoveTag}
                    className="flex-1 py-3 rounded-2xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition-colors">
                    刪除
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="設定" onClose={onClose} d={d}>
      <div className="flex flex-col gap-6">
        <div>
          <SecTitle d={d}>帳號</SecTitle>
          <SettingRow d={d}
            icon={<div className={`w-7 h-7 rounded-full flex items-center justify-center ${d ? "bg-zinc-100" : "bg-zinc-900"}`}>
              <span className={`font-bold text-xs ${d ? "text-zinc-900" : "text-white"}`}>{auth.displayName(user)?.[0]?.toUpperCase() || "?"}</span>
            </div>}
            label={auth.displayName(user)} value="雲端帳號"
          />
        </div>

        <div>
          <SecTitle d={d}>顯示</SecTitle>
          <div className={`flex p-1 rounded-2xl gap-1 ${C.card(d)}`}>
            {opts.map(({ k, l, ic }) => {
              const active = pref === k;
              return (
                <button key={k} onClick={() => setPref(k)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    active ? C.activeFilter(d) : `${C.tx2(d)} hover:opacity-70`
                  }`}>
                  {ic}
                  {l}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <SecTitle d={d}>資料管理</SecTitle>
          <div className="flex flex-col gap-1">
            <SettingRow d={d} label="編輯標籤" value={`${tagList.length} 個`} right={I.chevR}
              onClick={() => setEditingTags(true)} />
            <SettingRow d={d} label="匯出資料" value="JSON / CSV" right={I.chevR}
              onClick={() => setShowExport(true)} />
          </div>
        </div>

        <div>
          <SecTitle d={d}>其他</SecTitle>
          <div className="flex flex-col gap-1">
            <SettingRow d={d} icon={I.info} label="關於" right={I.chevR}
              onClick={() => setShowAbout(true)} />
            <SettingRow d={d} label="登出" danger onClick={() => { onLogout(); onClose(); }} />
          </div>
        </div>

        <div className={`text-center text-xs pt-2 pb-4 ${d ? "text-zinc-600" : "text-zinc-400"}`}>
          <p>HaiBack｜還袂</p>
          <p>Version {APP_VERSION}</p>
          <p className="mt-1 flex items-center justify-center gap-1.5">
            <button onClick={() => setLegalPanel("terms")} className="hover:opacity-70 active:opacity-50 transition-opacity">使用條款</button>
            <span>·</span>
            <button onClick={() => setLegalPanel("privacy")} className="hover:opacity-70 active:opacity-50 transition-opacity">隱私權政策</button>
            <span>·</span>
            <button onClick={() => setLegalPanel("contact")} className="hover:opacity-70 active:opacity-50 transition-opacity">聯絡作者</button>
          </p>
        </div>
      </div>
    </Sheet>
  );
}

// ─── Login Sheet (Google OAuth) ───────────────────────────────
function LoginSheet({ onClose, d }) {
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState("");

  const login = async () => {
    setErr("");
    setBusy(true);
    try {
      await auth.loginWithGoogle();
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  };

  return (
    <Sheet title="登入 HaiBack" onClose={onClose} d={d}>
      <div className="flex flex-col gap-6">

        {/* Brand */}
        <div className="flex items-center gap-3 pb-1">
          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${d ? "bg-zinc-100" : "bg-zinc-900"}`}>
            <span className={`font-bold text-base ${d ? "text-zinc-900" : "text-white"}`}>還</span>
          </div>
          <div>
            <div className={`font-bold ${C.tx(d)}`}>HaiBack｜還袂</div>
            <div className={`text-xs ${C.tx3(d)}`}>用 Google 一鍵登入</div>
          </div>
        </div>

        {/* Error */}
        {err && (
          <div className={`text-sm rounded-2xl px-4 py-3 ${d ? "bg-red-900/30 text-red-300" : "bg-red-50 text-red-600"}`}>
            {err}
          </div>
        )}

        {/* Google Button */}
        <button
          onClick={login}
          disabled={busy}
          className={`rounded-2xl px-4 py-3 font-medium transition ${d ? "bg-white text-black" : "bg-black text-white"}`}
        >
          {busy ? "跳轉中…" : "Continue with Google"}
        </button>

        <p className={`text-xs text-center leading-relaxed ${C.tx3(d)}`}>
          使用 Google 帳號登入，不需要密碼、不需要信箱驗證連結。
        </p>

      </div>
    </Sheet>
  );
}

// ─── Tag Picker ───────────────────────────────────────────────
// Lets the user pick from up to 5 self-defined tags, or create new ones
// inline (capped at 5 total).
//
// Tag names are a personal UI preference. They are cached in
// localStorage and synced to hb_user_settings for logged-in users
// (see userSettings.saveTags in the db layer above).
const MAX_TAGS = 5;

function TagPicker({ selected, onChange, d, user }) {
  const [allTags, setAllTags] = useState(() => getTagList());
  const [adding, setAdding]   = useState(false);
  const [newTag, setNewTag]   = useState("");

  const toggle = (tag) => {
    const next = selected.includes(tag)
      ? selected.filter(t => t !== tag)
      : [...selected, tag];
    onChange(next);
  };

  const addTag = () => {
    const t = newTag.trim();
    if (!t) return setAdding(false);
    if (allTags.includes(t)) { setNewTag(""); setAdding(false); return; }
    if (allTags.length >= MAX_TAGS) { alert(`最多只能建立 ${MAX_TAGS} 個標籤`); return; }
    const next = [...allTags, t];
    setAllTags(next);
    saveTagList(next);
    // Sync to cloud immediately for logged-in users — not just when
    // editing tags from the settings page.
    if (user) userSettings.saveTags(next).catch(e => console.warn("tag sync failed:", e.message));
    onChange([...selected, t]);
    setNewTag("");
    setAdding(false);
  };

  return (
    <Field label="標籤" d={d}>
      <div className="flex flex-wrap gap-2">
        {allTags.map(tag => {
          const on = selected.includes(tag);
          return (
            <button key={tag} type="button" onClick={() => toggle(tag)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border-2 transition-all ${on ? C.tagFilled(d) : C.tagUnselected(d)}`}>
              {tag}
            </button>
          );
        })}

        {!adding ? (
          allTags.length < MAX_TAGS && (
            <button type="button" onClick={() => setAdding(true)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border border-dashed transition-all ${C.tagEmpty(d)}`}>
              + 新增標籤
            </button>
          )
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") addTag(); if (e.key === "Escape") { setAdding(false); setNewTag(""); } }}
              onBlur={addTag}
              placeholder="標籤名稱"
              maxLength={10}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border w-24 focus:outline-none ${C.input(d)}`}
            />
          </div>
        )}
      </div>
      {allTags.length === 0 && !adding && (
        <p className={`text-xs ${C.tx3(d)}`}>還沒有標籤，點「+ 新增標籤」建立第一個（最多 {MAX_TAGS} 個）</p>
      )}
    </Field>
  );
}

// ─── Record Sheet ─────────────────────────────────────────────
function RecordSheet({ initial, onSave, onClose, user, d }) {
  const isEdit = !!initial;

  // "reimburse" | "advance" — maps directly to KIND.R / KIND.A
  const initKind = (!initial || initial.kind === KIND.R) ? "reimburse" : "advance";
  const [kind,    setKindState] = useState(initKind);
  const [step,    setStep]      = useState(isEdit ? 2 : 1);
  const [form,    setForm]      = useState({
    title:           initial?.title           ?? "",
    date:            initial?.date            ?? today(),
    amount:          initial?.amount          ?? "",
    advanceReceived: initial?.advanceReceived ?? "",
    note:            initial?.note            ?? "",
    tags:            initial?.tags            ?? [],
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Switch kind and reset amount fields to avoid stale values
  const switchKind = (k) => {
    setKindState(k);
    setForm(f => ({
      ...f,
      amount:          "",
      advanceReceived: "",
    }));
  };

  const save = () => {
    if (!form.title.trim()) return alert("請輸入欠款名稱");
    if (form.amount === "" || form.amount === null) return alert("請輸入金額");

    onSave(buildRaw({
      ...form,
      id:             initial?.id,
      kind:           kind === "reimburse" ? KIND.R : KIND.A,
      // 報銷款：無預支概念，全部歸零
      // 預支款：advanceReceived 可為空（後續流程填實際花費）
      advStatus:      kind === "advance" ? ADV.APPROVED : null,
      advanceReceived: kind === "advance" ? toN(form.advanceReceived) : 0,
      actualSpent:    0,   // always filled in later via SettleSheet
      settlementDate: initial?.settlementDate ?? "",
      paymentRecords: initial?.paymentRecords ?? [],
    }, user?.id));
  };

  const sheetTitle = isEdit ? "編輯紀錄" : step === 1 ? "記一筆" : kind === "reimburse" ? "純報銷" : "需結算";

  const selBg  = d ? "border-zinc-100 bg-zinc-100" : "border-zinc-900 bg-zinc-900";
  const selTx  = d ? "text-zinc-900" : "text-white";
  const unselBg= d ? "border-zinc-700 bg-zinc-800 hover:border-zinc-500" : "border-zinc-200 bg-zinc-50 hover:border-zinc-400";

  return (
    <Sheet title={sheetTitle} onClose={onClose} d={d}>
      <div className="flex flex-col gap-5">

        {/* ── Step 1: title + date + kind toggle ── */}
        {step === 1 && !isEdit && (
          <>
            <Field label="欠款名稱" d={d}>
              <Input d={d} placeholder="e.g. 五月出差費用"
                value={form.title} onChange={e => set("title", e.target.value)} />
            </Field>

            <Field label="日期" d={d}>
              <DateInput d={d} value={form.date} onChange={v => set("date", v)} />
            </Field>

            <Field label="款項類型" d={d}>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { v: "reimburse", t: "純報銷", s: "自行墊付，全額報帳" },
                  { v: "advance",   t: "需結算", s: "可申請預支，後續結算差額" },
                ].map(({ v, t, s }) => (
                  <button key={v} onClick={() => switchKind(v)}
                    className={`p-3.5 rounded-2xl border-2 text-left transition-all ${kind === v ? selBg : unselBg}`}>
                    <div className={`text-sm font-semibold ${kind === v ? selTx : C.tx(d)}`}>{t}</div>
                    <div className={`text-xs mt-0.5 ${kind === v ? (d ? "text-zinc-500" : "text-white/60") : C.tx3(d)}`}>{s}</div>
                  </button>
                ))}
              </div>
            </Field>

            <PBtn d={d} onClick={() => { if (!form.title.trim()) return alert("請輸入欠款名稱"); setStep(2); }}>
              下一步 →
            </PBtn>
          </>
        )}

        {/* ── Step 2 / Edit: amount fields ── */}
        {(step === 2 || isEdit) && (
          <>
            {isEdit && (
              <>
                <Field label="欠款名稱" d={d}>
                  <Input d={d} value={form.title} onChange={e => set("title", e.target.value)} />
                </Field>
                <Field label="日期" d={d}>
                  <DateInput d={d} value={form.date} onChange={v => set("date", v)} />
                </Field>
                <div className={`h-px ${C.divider(d)}`} />
              </>
            )}

            {/* 純報銷：只填金額 */}
            {kind === "reimburse" && (
              <Field label="金額 ($)" hint="你向公司報銷的總金額，亦即你的單筆費用全額" d={d}>
                <Input d={d} type="number" placeholder="0" autoFocus={!isEdit}
                  value={form.amount} onChange={e => set("amount", e.target.value)} />
              </Field>
            )}

            {/* 需結算：核定金額 + 預支金額（可空） */}
            {kind === "advance" && (
              <>
                <Field label="核定金額 ($)" hint="此項目預計花費的金額" d={d}>
                  <Input d={d} type="number" placeholder="0" autoFocus={!isEdit}
                    value={form.amount} onChange={e => set("amount", e.target.value)} />
                </Field>
                <Field label="預支金額 ($)" hint="此項目預先向公司請領之費用（未申請預支費用可留空或填 0）" d={d}>
                  <Input d={d} type="number" placeholder="0"
                    value={form.advanceReceived} onChange={e => set("advanceReceived", e.target.value)} />
                </Field>
                <p className={`text-xs ${C.tx3(d)} -mt-2`}>
                  ✦ 實際花費在活動結束後填寫
                </p>
              </>
            )}

            <TagPicker d={d} user={user} selected={form.tags} onChange={tags => set("tags", tags)} />

            <Field label="備註" d={d}>
              <Textarea d={d} rows={2} placeholder="選填"
                value={form.note} onChange={e => set("note", e.target.value)} />
            </Field>

            <div className="flex gap-3">
              {!isEdit && <GBtn d={d} onClick={() => setStep(1)}>← 上一步</GBtn>}
              <PBtn d={d} className="flex-1" onClick={save}>{isEdit ? "儲存" : "記一筆"}</PBtn>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

// ─── Advance Status Sheet ──────────────────────────────────────
function AdvStatusSheet({ rec, onSave, onClose, d }) {
  const [choice, setChoice] = useState("");
  const [advRec, setAdvRec] = useState("");
  const selBg = d ? "border-zinc-100 bg-zinc-100 text-zinc-900" : "border-zinc-900 bg-zinc-900 text-white";
  return (
    <Sheet title="更新申請結果" onClose={onClose} d={d}>
      <div className="flex flex-col gap-5">
        <div className={`rounded-2xl p-4 flex flex-col gap-1.5 ${C.card2(d)}`}>
          <p className={`text-sm font-semibold ${C.tx(d)} mb-1`}>{rec.title}</p>
          <SRow d={d} l="申請金額" v={fmt(rec.amount)} />
        </div>
        <Field label="核准結果" d={d}>
          <div className="flex gap-2">
            {[{ v: "approved", l: "核准撥款" }, { v: "rejected", l: "未通過" }].map(({ v, l }) => (
              <button key={v} onClick={() => setChoice(v)}
                className={`flex-1 py-3 rounded-2xl border-2 text-sm font-semibold transition-all ${choice === v ? selBg : `${C.btnGhost(d)} border-2`}`}>
                {l}
              </button>
            ))}
          </div>
        </Field>
        {choice === "approved" && (
          <Field label="實際撥款金額 ($)" d={d}>
            <Input d={d} type="number" placeholder="0" autoFocus value={advRec} onChange={e => setAdvRec(e.target.value)} />
          </Field>
        )}
        {choice === "rejected" && (
          <p className={`text-xs ${C.tx3(d)} px-1`}>未通過將轉為純報銷，公司之後補款給你。</p>
        )}
        <PBtn d={d} onClick={() => {
          if (!choice) return alert("請選擇結果");
          onSave({ advStatus: choice === "approved" ? ADV.APPROVED : ADV.REJECTED, kind: choice === "rejected" ? KIND.R : KIND.A, advanceReceived: choice === "approved" ? toN(advRec) : 0 });
        }}>確認</PBtn>
      </div>
    </Sheet>
  );
}

// ─── Settle Sheet (kept for quick-action card path) ───────────
function SettleSheet({ rec, onSave, onClose, d }) {
  const [spent, setSpent] = useState(rec.actualSpent > 0 ? String(rec.actualSpent) : "");
  const [date,  setDate]  = useState(today());
  const advRec = toN(rec.advanceReceived);
  return (
    <Sheet title="填寫實際花費" onClose={onClose} d={d}>
      <div className="flex flex-col gap-5">
        <div className={`rounded-2xl p-4 flex flex-col gap-1.5 ${C.card2(d)}`}>
          <SRow d={d} l="核定金額" v={fmt(rec.amount)} />
          {advRec > 0 && <SRow d={d} l="預支金額" v={fmt(advRec)} />}
        </div>
        <Field label="實際花費 ($)" d={d}>
          <Input d={d} type="number" placeholder="0" autoFocus value={spent} onChange={e => setSpent(e.target.value)} />
        </Field>
        <Field label="結算日期" d={d}>
          <DateInput d={d} value={date} onChange={setDate} />
        </Field>
        <PBtn d={d} onClick={() => { if (spent === "") return alert("請輸入實際花費"); onSave({ actualSpent: toN(spent), settlementDate: date }); }}>確認結算</PBtn>
      </div>
    </Sheet>
  );
}

// ─── Payment Sheet ─────────────────────────────────────────────
function PaymentSheet({ rec, onSave, onClose, d }) {
  const [amount, setAmount] = useState("");
  const [date,   setDate]   = useState(today());
  const isR  = rec.effectiveKind === KIND.R;
  const label = isR ? "入帳" : rec.iOwe ? "繳回公司" : "收到補款";
  return (
    <Sheet title={`記錄${label}`} onClose={onClose} d={d}>
      <div className="flex flex-col gap-5">
        <div className={`rounded-2xl p-4 flex flex-col gap-1.5 ${C.card2(d)}`}>
          <p className={`text-sm font-semibold ${C.tx(d)} truncate mb-1`}>{rec.title}</p>
          {isR
            ? <><SRow d={d} l="欠款金額" v={fmt(rec.amount)}/><SRow d={d} l="公司已還" v={fmt(rec.paid)}/><div className={`h-px my-1 ${C.divider(d)}`}/><SRow d={d} l="剩餘" v={fmt(rec.remaining)}/></>
            : <><SRow d={d} l={rec.iOwe ? "需繳回" : "公司已還"} v={fmt(rec.absDiff)}/><SRow d={d} l="已處理" v={fmt(rec.paid)}/><div className={`h-px my-1 ${C.divider(d)}`}/><SRow d={d} l="剩餘" v={fmt(rec.remaining)}/></>
          }
        </div>
        <Field label={`${label}金額 ($)`} d={d}>
          <div className="flex gap-2">
            <Input d={d} type="number" placeholder="0" className="flex-1" autoFocus
              value={amount} onChange={e => setAmount(e.target.value)} />
            {rec.remaining > 0 && (
              <button onClick={() => setAmount(String(rec.remaining))}
                className={`px-4 rounded-2xl border text-xs font-semibold whitespace-nowrap transition-colors ${C.btnGhost(d)}`}>
                全額
              </button>
            )}
          </div>
        </Field>
        <Field label="日期" d={d}><DateInput d={d} value={date} onChange={setDate} /></Field>
        <PBtn d={d} onClick={() => { const v = toN(amount); if (!v || v <= 0) return alert("請輸入金額"); onSave({ date, amount: v }); }}>確認{label}</PBtn>
      </div>
    </Sheet>
  );
}

// ─── Record Card ──────────────────────────────────────────────
function RecordCard({ rec, onSelect, onAction, d }) {
  const isPending = rec.advStatus === ADV.PENDING;
  const actionLabel = (() => {
    if (isPending) return "更新申請結果";
    if (rec.effectiveKind === KIND.R && rec.remaining > 0) return "入帳";
    if (rec.stage === STAGE.WAITING)  return "填寫實際花費";
    if (rec.stage === STAGE.SETTLING) return rec.iOwe ? "繳回公司" : "記錄補款";
    return null;
  })();
  const focal = (() => {
    if (isPending) return { l: "等待審核", v: fmt(rec.amount) };
    if (rec.effectiveKind === KIND.R) return rec.remaining > 0 ? { l: "剩餘未收", v: fmt(rec.remaining) } : { l: "已完成", v: "✓" };
    switch (rec.stage) {
      case STAGE.WAITING:  return { l: "等待填費", v: "" };
      case STAGE.SETTLING: return { l: rec.iOwe ? "需繳回" : "公司應補", v: fmt(rec.absDiff) };
      case STAGE.DONE:     return { l: "已結清", v: "✓" };
      default: return { l: fmt(rec.amount), v: "" };
    }
  })();

  const actionBorder = d ? "border-zinc-600 text-zinc-400 hover:border-zinc-400 hover:text-zinc-200 hover:bg-zinc-800" : "border-zinc-300 text-zinc-500 hover:border-zinc-600 hover:text-zinc-800 hover:bg-zinc-50";

  return (
    <div className={`rounded-3xl overflow-hidden cursor-pointer transition-all hover:shadow-lg ${C.card(d)}`}
      onClick={() => onSelect(rec.id)}>
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <KindPill rec={rec} d={d} />
            <span className={`text-xs ${C.tx3(d)}`}>{fmtD(rec.date)}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className={`font-semibold text-sm leading-snug ${C.tx(d)}`}>{rec.title}</div>
            <div onClick={e => e.stopPropagation()} className="flex items-center gap-1 flex-wrap">
              {(rec.tags && rec.tags.length > 0) ? (
                rec.tags.map(tag => (
                  <span key={tag} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${C.tagFilled(d)}`}>{tag}</span>
                ))
              ) : (
                <button onClick={() => onSelect(rec.id)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border border-dashed transition-all ${C.tagEmpty(d)}`}>
                  + 新增標籤
                </button>
              )}
            </div>
          </div>
          {rec.note && <div className={`text-xs ${C.tx3(d)} mt-0.5 truncate`}>{rec.note}</div>}
        </div>
        <StatusPill status={rec.status} d={d} />
      </div>
      <div className="px-4 pb-3 flex items-center gap-4">
        {!isPending && rec.effectiveKind === KIND.A && <div className="shrink-0"><Timeline rec={rec} compact d={d} /></div>}
        <div>
          {focal.l && <div className={`text-[10px] font-medium uppercase tracking-wide ${C.tx3(d)}`}>{focal.l}</div>}
          {focal.v && <div className={`text-lg font-bold mt-0.5 ${C.tx(d)}`}>{focal.v}</div>}
        </div>
      </div>
      {actionLabel && (
        <div className="px-4 pb-4" onClick={e => { e.stopPropagation(); onAction(rec.id); }}>
          <div className={`py-2 rounded-2xl border border-dashed text-center text-xs font-semibold transition-all ${actionBorder}`}>
            + {actionLabel}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Detail Page ──────────────────────────────────────────────
function DetailPage({ recId, records, dispatch, onBack, user, d }) {
  const [sheet, setSheet] = useState(null);
  const [inlineSettle, setInlineSettle] = useState(false);
  const [spentInput, setSpentInput] = useState("");
  const [settleDateInput, setSettleDateInput] = useState(today());
  const [inlinePay, setInlinePay] = useState(false);
  const [payAmountInput, setPayAmountInput] = useState("");
  const [payDateInput, setPayDateInput] = useState(today());
  const [inlineStatus, setInlineStatus] = useState(false);
  const [statusChoice, setStatusChoice] = useState("");
  const [statusAdvRecInput, setStatusAdvRecInput] = useState("");
  const rec = records.find(r => r.id === recId);
  if (!rec) { onBack(); return null; }
  const isPending = rec.advStatus === ADV.PENDING;
  const isR = rec.effectiveKind === KIND.R;

  const ctaLabel = (() => {
    if (isPending) return "更新申請結果";
    if (isR && rec.remaining > 0) return "入帳";
    if (rec.stage === STAGE.WAITING) return "填寫實際花費";
    if (rec.stage === STAGE.SETTLING) return rec.iOwe ? "新增繳回" : "記錄補款";
    return null;
  })();

  const handleCta = () => {
    if (isPending) { setStatusChoice(""); setStatusAdvRecInput(""); return setInlineStatus(true); }
    if (isR) { setPayAmountInput(""); setPayDateInput(today()); return setInlinePay(true); }
    if (rec.stage === STAGE.WAITING) { setSpentInput(""); setSettleDateInput(today()); return setInlineSettle(true); }
    if (rec.stage === STAGE.SETTLING) { setPayAmountInput(""); setPayDateInput(today()); return setInlinePay(true); }
  };

  const submitInlinePay = () => {
    const v = toN(payAmountInput);
    if (!v || v <= 0) return alert("請輸入金額");
    dispatch({ type: RECORDS_ACTION.UPDATE_RECORD, payload: derive({ ...strip(rec), paymentRecords: [...rec.pr, { date: payDateInput, amount: v }] }) });
    setInlinePay(false);
  };

  const submitInlineStatus = () => {
    if (!statusChoice) return alert("請選擇結果");
    dispatch({
      type: RECORDS_ACTION.UPDATE_RECORD,
      payload: derive({
        ...strip(rec),
        advStatus: statusChoice === "approved" ? ADV.APPROVED : ADV.REJECTED,
        kind: statusChoice === "rejected" ? KIND.R : KIND.A,
        advanceReceived: statusChoice === "approved" ? toN(statusAdvRecInput) : 0,
      }),
    });
    setInlineStatus(false);
  };

  const submitInlineSettle = () => {
    if (spentInput === "") return alert("請輸入實際花費");
    dispatch({ type: RECORDS_ACTION.UPDATE_RECORD, payload: derive({ ...strip(rec), actualSpent: toN(spentInput), settlementDate: settleDateInput }) });
    setInlineSettle(false);
  };

  return (
    <div className={`min-h-screen ${C.page(d)}`} style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="max-w-lg mx-auto px-4 pt-4 pb-28">
        {/* Nav */}
        <div className={`sticky top-0 z-20 pt-2 pb-4 flex items-center justify-between ${C.page(d)}`}>
          <button onClick={onBack} className={`flex items-center gap-2 text-sm font-medium ${C.tx2(d)} hover:opacity-70 transition-opacity`}>{I.back} 返回</button>
          <div className="flex gap-2">
            <button onClick={() => setSheet("edit")}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-colors ${C.card(d)} ${C.tx2(d)}`}>
              {I.edit} 編輯
            </button>
            <button onClick={() => setSheet("del")}
              className={`p-2 rounded-xl border text-red-500 hover:opacity-70 transition-opacity ${C.card(d)}`}>
              {I.trash}
            </button>
          </div>
        </div>

        {/* Title card */}
        <div className={`rounded-3xl p-5 mb-4 shadow-sm ${C.card(d)}`}>
          <div className="flex items-start justify-between gap-2 mb-2">
            <KindPill rec={rec} d={d}/>
            <StatusPill status={rec.status} d={d}/>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            <h1 className={`text-2xl font-bold leading-tight ${C.tx(d)}`}>{rec.title}</h1>
            {rec.tags && rec.tags.length > 0 && rec.tags.map(tag => (
              <span key={tag} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${C.tagFilled(d)}`}>{tag}</span>
            ))}
          </div>
          <div className={`flex items-center gap-1.5 text-xs ${C.tx3(d)}`}>{I.clock} {fmtD(rec.date)}</div>
          {rec.note && <p className={`mt-3 pt-3 border-t ${C.border(d)} text-sm ${C.tx2(d)}`}>{rec.note}</p>}
        </div>

        {/* Amounts */}
        {isR || isPending ? (
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[{ l: "欠款金額", v: fmt(rec.amount) }, { l: "公司已還", v: fmt(rec.paid) }, { l: "剩餘", v: fmt(rec.remaining) }].map(({ l, v }) => (
              <div key={l} className={`rounded-2xl p-3.5 ${C.card(d)}`}>
                <div className={`text-xs ${C.tx3(d)} mb-1`}>{l}</div>
                <div className={`text-lg font-bold ${C.tx(d)}`}>{v}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3 mb-4">
            <div className={`rounded-3xl p-5 ${C.card(d)}`}>
              <p className={`text-xs font-bold uppercase tracking-wider ${C.tx3(d)} mb-4`}>流程</p>
              <Timeline rec={rec} d={d} />
            </div>
            {rec.actualSpent > 0 && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { l: "欠款金額", v: fmt(rec.actualSpent) },
                  { l: rec.iOwe ? "需繳回" : "公司已還", v: fmt(rec.absDiff) },
                  { l: "剩餘", v: fmt(rec.remaining) },
                ].map(({ l, v }) => (
                  <div key={l} className={`rounded-2xl p-3.5 ${C.card(d)}`}>
                    <div className={`text-xs ${C.tx3(d)} mb-1`}>{l}</div>
                    <div className={`text-lg font-bold ${C.tx(d)}`}>{v}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* CTA */}
        {ctaLabel && (
          <div className={`rounded-3xl p-5 mb-4 ${d ? "bg-zinc-100" : "bg-zinc-900"}`}>
            {!inlineSettle && !inlinePay && !inlineStatus && (
              <div className="flex items-center justify-between">
                <div>
                  <div className={`text-xs mb-1 ${d ? "text-zinc-500" : "text-white/50"}`}>{isR ? "剩餘未入帳" : rec.stage === STAGE.SETTLING ? "剩餘" : "下一步"}</div>
                  {(isR || rec.stage === STAGE.SETTLING) && <div className={`text-2xl font-bold ${d ? "text-zinc-900" : "text-white"}`}>{fmt(rec.remaining)}</div>}
                  {rec.stage === STAGE.WAITING && <div className={`text-sm font-semibold ${d ? "text-zinc-900" : "text-white"}`}>活動結束了嗎？</div>}
                  {isPending && <div className={`text-sm font-semibold ${d ? "text-zinc-900" : "text-white"}`}>等待公司批准</div>}
                </div>
                <button onClick={handleCta}
                  className={`flex items-center gap-1.5 px-5 py-3 rounded-2xl text-sm font-bold hover:opacity-90 active:scale-95 transition-all ${d ? "bg-zinc-900 text-white" : "bg-white text-zinc-900"}`}>
                  {I.plus} {ctaLabel}
                </button>
              </div>
            )}

            {inlineSettle && (
              /* Inline expansion — fills in actualSpent without opening a separate sheet */
              <div className="flex flex-col gap-4">
                <div className={`text-sm font-semibold ${d ? "text-zinc-900" : "text-white"}`}>填寫實際花費</div>
                <div className="flex flex-col gap-1.5">
                  <label className={`text-xs font-semibold uppercase tracking-wider ${d ? "text-zinc-500" : "text-white/50"}`}>實際花費 ($)</label>
                  <input
                    type="number" placeholder="0" autoFocus
                    value={spentInput} onChange={e => setSpentInput(e.target.value)}
                    className={`w-full px-4 py-3 rounded-2xl border text-sm focus:outline-none focus:ring-2 ${d ? "bg-white border-zinc-200 text-zinc-900 focus:ring-black/10" : "bg-zinc-800 border-zinc-700 text-white focus:ring-white/10"}`}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={`text-xs font-semibold uppercase tracking-wider ${d ? "text-zinc-500" : "text-white/50"}`}>結算日期</label>
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border ${d ? "bg-white border-zinc-200" : "bg-zinc-800 border-zinc-700"}`}>
                    <span className={d ? "text-zinc-400" : "text-white/40"}>{I.cal}</span>
                    <input type="date" value={settleDateInput} onChange={e => setSettleDateInput(e.target.value)}
                      className={`flex-1 text-sm font-medium bg-transparent focus:outline-none ${d ? "text-zinc-900" : "text-white"}`} />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setInlineSettle(false)}
                    className={`flex-1 py-3 rounded-2xl border text-sm font-semibold transition-all ${d ? "border-zinc-300 text-zinc-600 hover:bg-zinc-200" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}>
                    取消
                  </button>
                  <button onClick={submitInlineSettle}
                    className={`flex-1 py-3 rounded-2xl text-sm font-bold hover:opacity-90 active:scale-95 transition-all ${d ? "bg-zinc-900 text-white" : "bg-white text-zinc-900"}`}>
                    確認結算
                  </button>
                </div>
              </div>
            )}

            {inlinePay && (
              /* Inline expansion — records a 入帳 payment without opening a separate sheet */
              <div className="flex flex-col gap-4">
                <div className={`text-sm font-semibold ${d ? "text-zinc-900" : "text-white"}`}>入帳金額</div>
                <div className="flex flex-col gap-1.5">
                  <label className={`text-xs font-semibold uppercase tracking-wider ${d ? "text-zinc-500" : "text-white/50"}`}>入帳金額 ($)</label>
                  <div className="flex gap-2">
                    <input
                      type="number" placeholder="0" autoFocus
                      value={payAmountInput} onChange={e => setPayAmountInput(e.target.value)}
                      className={`flex-1 px-4 py-3 rounded-2xl border text-sm focus:outline-none focus:ring-2 ${d ? "bg-white border-zinc-200 text-zinc-900 focus:ring-black/10" : "bg-zinc-800 border-zinc-700 text-white focus:ring-white/10"}`}
                    />
                    {rec.remaining > 0 && (
                      <button onClick={() => setPayAmountInput(String(rec.remaining))}
                        className={`px-4 rounded-2xl border text-xs font-semibold whitespace-nowrap transition-colors ${d ? "border-zinc-300 text-zinc-600 hover:bg-zinc-200" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}>
                        全額
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={`text-xs font-semibold uppercase tracking-wider ${d ? "text-zinc-500" : "text-white/50"}`}>日期</label>
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border ${d ? "bg-white border-zinc-200" : "bg-zinc-800 border-zinc-700"}`}>
                    <span className={d ? "text-zinc-400" : "text-white/40"}>{I.cal}</span>
                    <input type="date" value={payDateInput} onChange={e => setPayDateInput(e.target.value)}
                      className={`flex-1 text-sm font-medium bg-transparent focus:outline-none ${d ? "text-zinc-900" : "text-white"}`} />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setInlinePay(false)}
                    className={`flex-1 py-3 rounded-2xl border text-sm font-semibold transition-all ${d ? "border-zinc-300 text-zinc-600 hover:bg-zinc-200" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}>
                    取消
                  </button>
                  <button onClick={submitInlinePay}
                    className={`flex-1 py-3 rounded-2xl text-sm font-bold hover:opacity-90 active:scale-95 transition-all ${d ? "bg-zinc-900 text-white" : "bg-white text-zinc-900"}`}>
                    確認入帳
                  </button>
                </div>
              </div>
            )}

            {inlineStatus && (
              /* Inline expansion — update advance approval result without opening a separate sheet */
              <div className="flex flex-col gap-4">
                <div className={`text-sm font-semibold ${d ? "text-zinc-900" : "text-white"}`}>更新申請結果</div>
                <div className="flex flex-col gap-1.5">
                  <label className={`text-xs font-semibold uppercase tracking-wider ${d ? "text-zinc-500" : "text-white/50"}`}>核准結果</label>
                  <div className="flex gap-2">
                    {[{ v: "approved", l: "核准撥款" }, { v: "rejected", l: "未通過" }].map(({ v, l }) => (
                      <button key={v} onClick={() => setStatusChoice(v)}
                        className={`flex-1 py-3 rounded-2xl border-2 text-sm font-semibold transition-all ${
                          statusChoice === v
                            ? (d ? "border-zinc-900 bg-zinc-900 text-white" : "border-white bg-white text-zinc-900")
                            : (d ? "border-zinc-300 text-zinc-600" : "border-zinc-700 text-zinc-300")
                        }`}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                {statusChoice === "approved" && (
                  <div className="flex flex-col gap-1.5">
                    <label className={`text-xs font-semibold uppercase tracking-wider ${d ? "text-zinc-500" : "text-white/50"}`}>實際撥款金額 ($)</label>
                    <input
                      type="number" placeholder="0" autoFocus
                      value={statusAdvRecInput} onChange={e => setStatusAdvRecInput(e.target.value)}
                      className={`w-full px-4 py-3 rounded-2xl border text-sm focus:outline-none focus:ring-2 ${d ? "bg-white border-zinc-200 text-zinc-900 focus:ring-black/10" : "bg-zinc-800 border-zinc-700 text-white focus:ring-white/10"}`}
                    />
                  </div>
                )}
                {statusChoice === "rejected" && (
                  <p className={`text-xs ${d ? "text-zinc-500" : "text-white/50"}`}>未通過將轉為純報銷，公司之後補款給你。</p>
                )}
                <div className="flex gap-3">
                  <button onClick={() => setInlineStatus(false)}
                    className={`flex-1 py-3 rounded-2xl border text-sm font-semibold transition-all ${d ? "border-zinc-300 text-zinc-600 hover:bg-zinc-200" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}>
                    取消
                  </button>
                  <button onClick={submitInlineStatus}
                    className={`flex-1 py-3 rounded-2xl text-sm font-bold hover:opacity-90 active:scale-95 transition-all ${d ? "bg-zinc-900 text-white" : "bg-white text-zinc-900"}`}>
                    確認
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {rec.status === "完成" && (
          <div className={`rounded-3xl p-5 mb-4 flex items-center gap-3 ${C.card(d)}`}>
            <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${C.card2(d)} ${C.tx(d)}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div>
              <div className={`font-bold text-sm ${C.tx(d)}`}>完成</div>
              <div className={`text-xs ${C.tx3(d)} mt-0.5`}>所有款項已處理完畢</div>
            </div>
          </div>
        )}

        {rec.pr.length > 0 && (
          <div className={`rounded-3xl p-5 ${C.card(d)}`}>
            <p className={`text-xs font-bold uppercase tracking-wider ${C.tx3(d)} mb-4`}>入帳紀錄</p>
            <div className={`flex flex-col divide-y ${C.border(d)}`}>
              {rec.pr.map((r, i) => (
                <div key={i} className="flex items-center justify-between py-3">
                  <div className={`flex items-center gap-2 text-xs ${C.tx3(d)}`}>{I.clock} {fmtD(r.date)}</div>
                  <span className={`text-sm font-bold ${C.tx(d)}`}>{fmt(r.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {sheet === "edit" && <RecordSheet d={d} initial={rec} user={user} onSave={f => { dispatch({ type: RECORDS_ACTION.UPDATE_RECORD, payload: derive({ ...strip(rec), ...strip(buildRaw(f, user?.id)) }) }); setSheet(null); }} onClose={() => setSheet(null)} />}
      {sheet === "settle" && <SettleSheet d={d} rec={rec} onSave={({ actualSpent, settlementDate }) => { dispatch({ type: RECORDS_ACTION.UPDATE_RECORD, payload: derive({ ...strip(rec), actualSpent, settlementDate }) }); setSheet(null); }} onClose={() => setSheet(null)} />}
      {sheet === "del" && (
        <Sheet title="清掉這筆" onClose={() => setSheet(null)} d={d}>
          <div className="flex flex-col gap-5">
            <p className={`text-sm ${C.tx2(d)}`}>確定要清掉「<strong>{rec.title}</strong>」嗎？無法復原。</p>
            <div className="flex gap-3">
              <GBtn d={d} onClick={() => setSheet(null)}>取消</GBtn>
              <button onClick={() => dispatch({ type: RECORDS_ACTION.DELETE_RECORD, payload: rec.id })}
                className="flex-1 py-4 rounded-2xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition-colors">清掉</button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────
// ─── Login Reminder Modal ─────────────────────────────────────
function LoginReminderModal({ onLogin, onDismiss, d }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onDismiss} />

      {/* Modal card */}
      <div className={`relative w-full max-w-sm rounded-3xl shadow-2xl p-6 flex flex-col gap-4 ${d ? "bg-zinc-900" : "bg-white"}`}>
        {/* Close */}
        <button onClick={onDismiss}
          className={`absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-xl transition-colors ${d ? "bg-zinc-800 text-zinc-400 hover:bg-zinc-700" : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"}`}>
          ×
        </button>

        {/* Content */}
        <div className="flex flex-col gap-3 pr-6">
          <div className={`text-lg font-bold ${C.tx(d)}`}>🔒 保護你的紀錄</div>
          <p className={`text-sm leading-relaxed ${C.tx2(d)}`}>
            HaiBack 已開始累積你的報銷紀錄。<br/>
            登入 Google 帳號後，<br/>
            資料將自動同步至雲端，<br/>
            即使更換裝置或清除瀏覽資料，也不用擔心資料遺失。
          </p>
        </div>

        {/* CTA */}
        <button onClick={onLogin}
          className={`w-full py-4 rounded-2xl font-semibold text-sm active:scale-[0.98] transition-all ${d ? "bg-white text-zinc-900 hover:bg-zinc-100" : "bg-zinc-900 text-white hover:bg-zinc-800"}`}>
          立即登入
        </button>
      </div>
    </div>
  );
}

// ─── First Recovery Modal ──────────────────────────────────────
function FirstRecoveryModal({ onViewDone, onDismiss, d }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onDismiss} />

      <div className={`relative w-full max-w-sm rounded-3xl shadow-2xl p-6 flex flex-col gap-4 ${d ? "bg-zinc-900" : "bg-white"}`}>
        <button onClick={onDismiss}
          className={`absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-xl transition-colors ${d ? "bg-zinc-800 text-zinc-400 hover:bg-zinc-700" : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"}`}>
          ×
        </button>

        <div className="flex flex-col gap-3 pr-6">
          <div className={`text-lg font-bold ${C.tx(d)}`}>🎉 恭喜你追回第一筆款項</div>
          <p className={`text-sm leading-relaxed ${C.tx2(d)}`}>
            已完成的紀錄不會消失。<br/>
            你可以在上方篩選切換至「完成」，<br/>
            查看所有已追回的款項與歷史紀錄。
          </p>
        </div>

        <button onClick={onViewDone}
          className={`w-full py-4 rounded-2xl font-semibold text-sm active:scale-[0.98] transition-all ${d ? "bg-white text-zinc-900 hover:bg-zinc-100" : "bg-zinc-900 text-white hover:bg-zinc-800"}`}>
          查看已完成
        </button>
        <button onClick={onDismiss}
          className={`w-full py-3 rounded-2xl text-sm font-semibold transition-all ${C.tx2(d)} hover:opacity-70`}>
          知道了
        </button>
      </div>
    </div>
  );
}

function MainApp() {
  const { dark: d } = useTheme();
  const [records,    dispatchRecords] = useReducer(recordsReducer, []);
  const [user,       setUser]       = useState(null);
  const [authReady,  setAuthReady]  = useState(false);
  const [loadingRec, setLoadingRec] = useState(false);
  const [selId,      setSelId]      = useState(null);
  const [sheet,      setSheet]      = useState(null);
  const [quickId,    setQuickId]    = useState(null);
  const [search,     setSearch]     = useState("");
  const [fStatus,    setFStatus]    = useState("處理中");
  const [fKind,      setFKind]      = useState("全部");
  const [fTag,       setFTag]       = useState("全部");
  const [sort,       setSort]       = useState("date_desc");
  const [guestOk,       setGuestOk]       = useState(() => getGuestDismissed());
  const [tagList,       setTagList]       = useState(() => getTagList());
  const [showLoginReminder, setShowLoginReminder] = useState(false);
  const [pendingFirstRecovery, setPendingFirstRecovery] = useState(false);
  const [showFirstRecoveryModal, setShowFirstRecoveryModal] = useState(false);

  // ── Auth: listen for session changes ──────────────────────
  useEffect(() => {
    // Initial session check
    auth.getSession().then((u) => {
      setUser(u);
      setAuthReady(true);
    });
    // Subscribe to login/logout events
    const sub = auth.onAuthChange((u) => {
      setUser(u);
      if (!u) {
        // Logged out → restore guest cache instead of wiping the screen blank
        const cached = loadRecords();
        dispatchRecords({ type: RECORDS_ACTION.LOAD_RECORDS, payload: cached.map(derive) });
      }
    });
    return () => sub.unsubscribe();
  }, []);

  // ── First-visit date tracking (guest only) ────────────────
  useEffect(() => {
    if (!user) ensureFirstVisit();
  }, [user]);

  // ── Login reminder trigger ─────────────────────────────────
  // Fires once when records are loaded in guest mode.
  // Conditions: not logged in + not shown yet + (≥5 records OR ≥3 days since first visit)
  useEffect(() => {
    if (user) return;                        // logged in — never show
    if (getLoginReminderShown()) return;     // already shown once — never show again

    const records5    = records.length >= 5;
    const days3       = daysSinceFirstVisit() >= 3;
    if (records5 || days3) {
      setShowLoginReminder(true);
    }
  }, [records, user]);

  // ── First recovery prompt display ──────────────────────────
  // A transition (non-完成 → 完成) was detected in dispatch(), which set
  // pendingFirstRecovery = true. We wait until the user is back at the
  // home screen (selId === null, i.e. any detail-page/sheet is closed),
  // then show the modal after a short delay so it never fights with
  // a closing Sheet's own transition.
  useEffect(() => {
    if (!pendingFirstRecovery) return;
    // Wait until fully back at the home screen — no detail page,
    // no open Sheet, no quick-action Sheet — so this modal never
    // fights with something the user is still interacting with.
    if (selId !== null || sheet !== null || quickId !== null) return;

    const timer = setTimeout(() => {
      setShowFirstRecoveryModal(true);
      setPendingFirstRecovery(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [pendingFirstRecovery, selId, sheet, quickId]);

  // ── Load records + tags when user changes ─────────────────
  useEffect(() => {
    if (!user) {
      // Guest mode: load from localStorage
      const cached = loadRecords();
      dispatchRecords({
        type: RECORDS_ACTION.LOAD_RECORDS,
        payload: cached.map(derive),
      });
      setTagList(getTagList()); // use local tag list for guests
      return;
    }

    setLoadingRec(true);

    // Load records and tags in parallel
    Promise.all([
      db.load(),
      userSettings.load(),
    ])
      .then(([raws, cloudTags]) => {
        dispatchRecords({
          type: RECORDS_ACTION.LOAD_RECORDS,
          payload: raws.map(derive),
        });

        if (cloudTags !== null) {
          // Cloud has tags — use them, sync to localStorage as cache
          setTagList(cloudTags);
          saveTagList(cloudTags);
        } else {
          // No cloud tags yet — migrate from localStorage if any exist
          const localTags = getTagList();
          if (localTags.length > 0) {
            userSettings.saveTags(localTags).catch(e => console.warn("tag migration failed:", e.message));
          }
          setTagList(localTags);
        }
      })
      .catch((e) => { console.warn("載入失敗:", e.message); })
      .finally(() => { setLoadingRec(false); });
  }, [user?.id]);

  // ── dispatch — pure state update via reducer, side-effects here ──
  const dispatch = useCallback((action) => {
    // ── First recovery detection ────────────────────────────
    // Must happen BEFORE dispatchRecords, while `records` still
    // holds the pre-update state, so we can compare old vs new status.
    //
    // Only trigger when money was ACTUALLY recovered, not just any
    // completion:
    //   1. 純報銷款完成，且 paid > 0
    //   2. 需結算款完成，公司欠我（iOwe !== true），且 paid > 0
    // Does NOT trigger for:
    //   - 我欠公司並完成繳回（iOwe === true）
    //   - 沒有追回金額的完成紀錄（paid === 0）
    if (action.type === RECORDS_ACTION.UPDATE_RECORD && !getFirstRecoveryPromptShown()) {
      const prev = records.find(r => r.id === action.payload.id);
      const wasNotDone = prev && prev.status !== "完成";
      const isNowDone  = action.payload.status === "完成";

      if (wasNotDone && isNowDone) {
        const p = action.payload;
        const isReimburseRecovery = p.effectiveKind === KIND.R && p.paid > 0;
        const isAdvanceRecovery   = p.kind === KIND.A && p.iOwe !== true && p.paid > 0;

        if (isReimburseRecovery || isAdvanceRecovery) {
          setPendingFirstRecovery(true);
        }
      }
    }

    // Optimistic local update first
    dispatchRecords(action);

    // Clear selected detail view on delete, regardless of guest/logged-in mode
    if (action.type === RECORDS_ACTION.DELETE_RECORD) {
      setSelId(null);
    }

    if (!user) {
      // Guest mode: no cloud sync needed here —
      // the useEffect below persists `records` to localStorage on every change.
      return;
    }

    // Logged in: async cloud sync — alert user if it fails (don't fail silently)
    const onSyncFail = (e) => {
      console.warn("sync error:", e.message);
      alert("⚠️ 雲端同步失敗，這筆紀錄可能只存在本機：\n" + e.message);
    };

    if (action.type === RECORDS_ACTION.ADD_RECORD) {
      db.upsert(strip(action.payload)).catch(onSyncFail);
    } else if (action.type === RECORDS_ACTION.UPDATE_RECORD) {
      db.upsert(strip(action.payload)).catch(onSyncFail);
    } else if (action.type === RECORDS_ACTION.DELETE_RECORD) {
      db.delete(action.payload).catch(onSyncFail);
    }
  }, [user, records]);

  // ── Guest mode persistence: mirror records to localStorage on every change ──
  useEffect(() => {
    if (user) return; // logged-in users rely on Supabase, not this cache
    saveRecords(records.map(strip));
  }, [records, user]);


  const login  = (u) => { setUser(u); setSheet(null); };
  const logout = async () => { await auth.logout(); setUser(null); setSheet(null); };

  const visible = useMemo(() => records, [records]); // Supabase RLS already filters by user

  const filtered = useMemo(() => visible
    .filter(r => {
      if (fStatus !== "全部" && r.status !== fStatus) return false;
      if (fKind !== "全部" && r.kind !== fKind) return false;
      if (fTag !== "全部") {
        if (fTag === "__none__") {
          if (r.tags && r.tags.length > 0) return false;
        } else if (!r.tags || !r.tags.includes(fTag)) {
          return false;
        }
      }
      if (search && !r.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      if (sort === "date_desc")   return b.date.localeCompare(a.date);
      if (sort === "date_asc")    return a.date.localeCompare(b.date);
      if (sort === "amount_desc") return toN(b.amount) - toN(a.amount);
      if (sort === "amount_asc")  return toN(a.amount) - toN(b.amount);
      return 0;
    }), [visible, fStatus, fKind, fTag, search, sort]);

  const stats = useMemo(() => {
    // ── 欠款總額規則 ──────────────────────────────────────────
    // 只累計「公司欠我」的金額，多筆累加（例：500 + 800 = 1300）
    // 「我欠公司」的金額絕對不扣除，也不列入計算
    // 領取預支金額（STAGE.WAITING 階段）本身不影響此數字，
    // 只有填完實際花費、進入 STAGE.SETTLING 且公司欠我時才計入
    //
    // 此計算現在套用目前的篩選條件（狀態/類型/標籤/搜尋）：
    // 例如選「純報銷」分類時，欠款總額只計算純報銷的部分。
    const owed = filtered.reduce((s, r) => {
      // Case 1: 純報銷款 — 尚未入帳的全額，全部算公司欠我
      if (r.effectiveKind === KIND.R) {
        return s + r.remaining;
      }

      // Case 2 & 3: 預支款 — 只在已填實際花費（SETTLING）且公司欠我時累加
      if (r.kind === KIND.A && r.stage === STAGE.SETTLING) {
        // !r.iOwe → 公司欠我（actualSpent > advanceReceived）→ 累加
        if (!r.iOwe) return s + clamp(r.absDiff - r.paid);
        // r.iOwe → 我欠公司（advanceReceived > actualSpent）→ 不扣、不列入，直接跳過
      }

      // 其他情況（如 STAGE.WAITING 領預支階段）完全不影響欠款總額
      return s;
    }, 0);

    // ── 已追回總額規則 ──────────────────────────────────────────
    // 只計算「已完成」紀錄中，實際從公司追回／收到的金額
    // 1. 純報銷款完成 → 計入已入帳金額（r.paid）
    // 2. 需結算款完成 + 公司欠我（!r.iOwe） → 計入公司補款（r.paid）
    // 3. 需結算款完成 + 我欠公司（r.iOwe） → 不計入（那是我繳回公司，不是追回）
    const recovered = filtered.reduce((s, r) => {
      if (r.status !== "完成") return s;

      if (r.effectiveKind === KIND.R) {
        return s + r.paid;
      }

      if (r.kind === KIND.A && !r.iOwe) {
        return s + r.paid;
      }

      // r.iOwe === true（我欠公司）→ 不計入
      return s;
    }, 0);

    return {
      owed:      Math.max(owed, 0),
      recovered: Math.max(recovered, 0),
      pending:   filtered.filter(r => r.status !== "完成").length,
      total:     filtered.length,
    };
  }, [filtered]);

  const isDoneView = fStatus === "完成";
  const hasFilter  = fStatus !== "處理中" || fKind !== "全部" || fTag !== "全部" || sort !== "date_desc";
  const quickRec  = quickId ? records.find(r => r.id === quickId) : null;
  const quickType = (() => {
    if (!quickRec) return null;
    if (quickRec.advStatus === ADV.PENDING) return "status";
    if (quickRec.effectiveKind === KIND.R && quickRec.remaining > 0) return "pay";
    if (quickRec.stage === STAGE.WAITING) return "settle";
    if (quickRec.stage === STAGE.SETTLING && quickRec.remaining > 0) return "pay";
    return null;
  })();

  // ── Auth loading screen ────────────────────────────────────
  if (!authReady) {
    return (
      <div className={`min-h-screen flex items-center justify-center font-sans ${C.page(d)}`}>
        <div className={`text-sm ${C.tx3(d)}`}>載入中…</div>
      </div>
    );
  }

  if (selId) return <DetailPage d={d} recId={selId} records={records} dispatch={dispatch} onBack={() => setSelId(null)} user={user} />;

  const searchBg = d ? "bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500" : "bg-white border-zinc-200 text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400";

  return (
    <div className={`min-h-screen font-sans ${C.page(d)}`} style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="max-w-lg mx-auto">

        {/* Header */}
        <div className={`sticky top-0 z-30 px-4 pt-3 pb-3 ${C.page(d)}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 ${d ? "bg-zinc-100" : "bg-zinc-900"}`}>
                <span className={`font-bold text-sm leading-none ${d ? "text-zinc-900" : "text-white"}`}>還</span>
              </div>
              <div>
                <div className={`text-base font-bold leading-tight ${C.tx(d)}`}>HaiBack｜還袂</div>
                <div className={`text-[11px] leading-none ${C.tx3(d)}`}>你這裡欠我的，用什麼還？</div>
              </div>
            </div>
            <button onClick={() => setSheet(user ? "account" : "login")}
              className={`w-9 h-9 rounded-full flex items-center justify-center hover:opacity-80 transition-opacity ${d ? "bg-zinc-100" : "bg-zinc-900"}`}>
              {user
                ? <span className={`font-bold text-sm ${d ? "text-zinc-900" : "text-white"}`}>{auth.displayName(user)?.[0]?.toUpperCase()}</span>
                : <span className={d ? "text-zinc-900" : "text-white"}>{I.user}</span>
              }
            </button>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${C.tx3(d)}`}>{I.search}</span>
              <input className={`w-full pl-10 pr-4 py-2.5 rounded-2xl border text-sm focus:outline-none focus:ring-2 focus:ring-black/10 transition-all ${searchBg}`}
                placeholder="搜尋紀錄…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button onClick={() => setSheet(s => s === "filter" ? null : "filter")}
              className={`w-10 h-10 flex items-center justify-center rounded-2xl border transition-all shrink-0 ${sheet === "filter" || hasFilter ? C.activeFilter(d) : C.inactFilter(d)}`}>
              {I.filter}
            </button>
          </div>
          {sheet === "filter" && (
            <div className={`mt-2 rounded-2xl overflow-hidden divide-y ${C.border(d)} ${C.card(d)}`}>
              {[
                ["狀態", ["全部","處理中","完成"], fStatus, setFStatus],
                ["類型", [["全部","全部"],[KIND.R,"純報銷"],[KIND.A,"需結算"]], fKind, setFKind],
                ["標籤", [["全部","全部"], ...tagList.map(t => [t, t]), ["__none__","無標籤"]], fTag, setFTag],
                ["排序", [["date_desc","最新"],["date_asc","最舊"],["amount_desc","金額↓"],["amount_asc","金額↑"]], sort, setSort],
              ].map(([label, opts, val, setter]) => (
                <div key={label} className="flex items-center gap-3 px-3 py-2.5">
                  <span className={`text-xs ${C.tx3(d)} w-8 shrink-0`}>{label}</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {opts.map(o => {
                      const v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
                      const isActive = val === v;
                      return (
                        <button key={v} onClick={() => setter(v)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border-2 ${isActive ? C.activeFilter(d) : C.inactFilter(d)}`}>
                          {l}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="px-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            <div className={`rounded-3xl px-4 py-4 ${d ? "bg-zinc-100 text-zinc-900" : "bg-zinc-900 text-white"}`}>
              <div className={`text-xs font-medium uppercase tracking-wide mb-1 ${d ? "text-zinc-500" : "text-white/50"}`}>{isDoneView ? "已追回總額" : "欠款總額"}</div>
              <div className="text-2xl font-bold tracking-tight">{fmt(isDoneView ? stats.recovered : stats.owed)}</div>
            </div>
            <div className={`rounded-3xl px-4 py-4 ${C.card(d)}`}>
              <div className={`text-xs font-medium uppercase tracking-wide ${C.tx3(d)} mb-1`}>{isDoneView ? "已完成" : "待結算"}</div>
              <div className={`text-2xl font-bold tracking-tight ${C.tx(d)}`}>{isDoneView ? stats.total : stats.pending}</div>
              <div className={`text-xs ${C.tx3(d)} mt-1`}>共 {stats.total} 筆</div>
            </div>
          </div>
          {!user && !guestOk && (
            <div className={`mt-3 rounded-2xl px-4 py-3 flex items-start gap-3 ${d ? "bg-zinc-800" : "bg-zinc-100"}`}>
              <span className={`shrink-0 mt-0.5 ${C.tx3(d)}`}>{I.info}</span>
              <p className={`text-xs flex-1 leading-relaxed ${C.tx2(d)}`}>
                訪客模式，資料僅存在此裝置。
                <button onClick={() => setSheet("login")} className={`ml-1 underline underline-offset-2 font-semibold ${C.tx(d)}`}>登入帳號</button>可跨裝置同步。
              </p>
              <button onClick={() => { setGuestDismissed(); setGuestOk(true); }} className={`text-xs ${C.tx3(d)} hover:opacity-60 shrink-0 mt-0.5`}>✕</button>
            </div>
          )}
        </div>

        {/* List */}
        <div className="px-4 pb-32">
          {loadingRec ? (
            <div className="text-center py-24">
              <div className={`text-sm ${C.tx3(d)}`}>載入資料中…</div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-24">
              <div className="text-5xl mb-4">📋</div>
              <div className={`text-sm font-semibold ${C.tx2(d)} mb-1`}>{search || hasFilter ? "沒有符合的紀錄" : "記帳不是麻煩，只是還沒被整理好。"}</div>
              {!search && !hasFilter && <p className={`text-xs ${C.tx3(d)}`}>點右下角 + 開始記帳</p>}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filtered.map(r => <RecordCard key={r.id} rec={r} d={d} onSelect={setSelId} onAction={setQuickId} />)}
            </div>
          )}
        </div>
      </div>

      {/* Login Reminder Modal */}
      {showLoginReminder && (
        <LoginReminderModal
          d={d}
          onDismiss={() => {
            setLoginReminderShown();
            setShowLoginReminder(false);
          }}
          onLogin={() => {
            setLoginReminderShown();
            setShowLoginReminder(false);
            setSheet("login");
          }}
        />
      )}

      {/* First Recovery Modal */}
      {showFirstRecoveryModal && (
        <FirstRecoveryModal
          d={d}
          onDismiss={() => {
            setFirstRecoveryPromptShown();
            setShowFirstRecoveryModal(false);
          }}
          onViewDone={() => {
            setFirstRecoveryPromptShown();
            setShowFirstRecoveryModal(false);
            setFStatus("完成");
          }}
        />
      )}

      {/* FAB */}
      <button onClick={() => setSheet("add")}
        style={{ bottom: "max(1.5rem, env(safe-area-inset-bottom, 1.5rem))" }}
        className={`fixed right-5 z-40 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center hover:opacity-90 active:scale-95 transition-all ${C.fabBg(d)} ${C.fabTx(d)}`}>
        {I.plus}
      </button>

      {/* Sheets */}
      {sheet === "add"     && <RecordSheet d={d} user={user} onSave={f => { dispatch({ type: RECORDS_ACTION.ADD_RECORD, payload: derive(buildRaw(f, user?.id)) }); setSheet(null); }} onClose={() => setSheet(null)} />}
      {sheet === "login"   && <LoginSheet  d={d} onClose={() => setSheet(null)} />}
      {sheet === "account" && <AccountSheet d={d} user={user} records={records} dispatch={dispatch} onLogout={logout} onClose={() => { setTagList(getTagList()); setSheet(null); }} />}
      {quickRec && quickType === "status" && <AdvStatusSheet d={d} rec={quickRec} onSave={u => { dispatch({ type: RECORDS_ACTION.UPDATE_RECORD, payload: derive({ ...strip(quickRec), ...u }) }); setQuickId(null); }} onClose={() => setQuickId(null)} />}
      {quickRec && quickType === "settle" && <SettleSheet d={d} rec={quickRec} onSave={({ actualSpent, settlementDate }) => { dispatch({ type: RECORDS_ACTION.UPDATE_RECORD, payload: derive({ ...strip(quickRec), actualSpent, settlementDate }) }); setQuickId(null); }} onClose={() => setQuickId(null)} />}
      {quickRec && quickType === "pay"    && <PaymentSheet d={d} rec={quickRec} onSave={p => { dispatch({ type: RECORDS_ACTION.UPDATE_RECORD, payload: derive({ ...strip(quickRec), paymentRecords: [...quickRec.pr, p] }) }); setQuickId(null); }} onClose={() => setQuickId(null)} />}
    </div>
  );
}

// ── Auto-update: detect stale version and force one silent reload ──
// Runs once, synchronously, before React mounts. If the version stored
// in localStorage differs from the version baked into this build,
// the user is on a stale cached page — reload once to fetch the latest
// JS bundle (whose filename has a fresh content hash, so it can't be
// served from cache even if the browser tries).
(function autoUpdateCheck() {
  try {
    const seen = localStorage.getItem(VERSION_KEY);
    if (seen !== APP_VERSION) {
      localStorage.setItem(VERSION_KEY, APP_VERSION);
      if (seen !== null) {
        // Only force-reload if this isn't the very first visit
        // (seen === null means brand new user, nothing stale to clear)
        window.location.reload();
      }
    }
  } catch (e) {
    // localStorage unavailable (private mode edge cases) — skip silently
  }
})();

export default function App() {
  return <ThemeProvider><MainApp /></ThemeProvider>;
}
