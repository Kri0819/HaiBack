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
import {
  useState,
  useMemo,
  useCallback,
  createContext,
  useContext,
  useEffect,
  useRef,
  useReducer
} from "react";

import { createClient } from "@supabase/supabase-js";

import { KIND, ADV, STAGE } from "./domain/constants.js";
import { uid, today, toN, clamp, strip, buildRaw } from "./domain/records.js";
import { derive } from "./domain/derive.js";
import { recordsReducer, RECORDS_ACTION } from "./store/recordsReducer_v1.js";

import {
  getTheme,
  saveTheme,
  getGuestDismissed,
  setGuestDismissed
} from "./services/storage_v1.js";

// ── PASTE YOUR SUPABASE CREDENTIALS HERE ─────────────────────
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  || "https://YOUR_PROJECT.supabase.co";
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || "YOUR_ANON_KEY";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
// ─────────────────────────────────────────────────────────────

// ── Supabase auth helpers (sign In With google) ───────────
const auth = {

  loginWithGoogle: async () => {
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });

    if (error) throw new Error(error.message);
  },

  getSession: async () => {
    const { data } = await sb.auth.getSession();
    return data?.session?.user ?? null;
  },

  onAuthChange: (cb) => {
    const { data } = sb.auth.onAuthStateChange((_event, session) => {
      cb(session?.user ?? null);
    });
    return data.subscription;
  },

  logout: () => sb.auth.signOut(),


  /** Display name: email prefix */
  displayName: (user) => user?.email?.split("@")[0] ?? "使用者",
};

// ── Supabase records helpers ──────────────────────────────────
const db = {
  /** Fetch all records for current user */
  load: async () => {
    const { data, error } = await sb
      .from("hb_records")
      .select("*")
      .order("date", { ascending: false });
    if (error) { console.error("load error", error); return []; }
    return (data || []).map(dbRowToRaw);
  },

  /** Upsert a single record */
  upsert: async (raw) => {
    const { error } = await sb
      .from("hb_records")
      .upsert(rawToDbRow(raw), { onConflict: "id" });
    if (error) console.error("upsert error", error);
  },

  /** Delete a record */
  delete: async (id) => {
    const { error } = await sb.from("hb_records").delete().eq("id", id);
    if (error) console.error("delete error", error);
  },
};

// ── Row ↔ raw conversion ──────────────────────────────────────
const rawToDbRow = (r) => ({
  id:               r.id,
  user_id:          r.userId,        // set by RLS, but we pass it for upsert
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
});

const dbRowToRaw = (row) => ({
  id:              row.id,
  userId:          row.user_id,
  kind:            row.kind,
  advStatus:       row.adv_status,
  title:           row.title,
  date:            row.date,
  note:            row.note || "",
  amount:          row.amount || 0,
  advanceReceived: row.advance_received || 0,
  actualSpent:     row.actual_spent || 0,
  settlementDate:  row.settlement_date || "",
  paymentRecords:  row.payment_records || [],
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
  const label = rec.kind === KIND.R ? "報銷款"
    : rec.advStatus === ADV.PENDING   ? "預支審核中"
    : rec.advStatus === ADV.REJECTED  ? "預支未通過"
    : "預支款";
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
    ? ["預支建立", rec.advanceReceived > 0 ? `已領預支 ${fmt(rec.advanceReceived)}` : "已領預支", rec.actualSpent > 0 ? `實際花費 ${fmt(rec.actualSpent)}` : "填寫實際花費", "結算中", "已結清"]
    : ["預支建立", rec.actualSpent > 0 ? `實際花費 ${fmt(rec.actualSpent)}` : "填寫實際花費", rec.stage === STAGE.DONE ? "補款完成" : "公司補款", "已完成"];

  return (
    <div className="flex flex-col">
      {labels.map((label, i) => {
        const done = i < cur, active = i === cur;
        return (
          <div key={i} className="flex items-start gap-3">
            <div className="flex flex-col items-center shrink-0">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center mt-0.5 ${done ? doneBg : active ? `${actBg} ring-4` : pendBg}`}>
                {done   && <span className={doneTx}>{I.check}</span>}
                {active && <div className={`w-2 h-2 rounded-full ${actInner}`}/>}
              </div>
              {i < labels.length-1 && <div className={`w-px my-1 ${done ? lineDone : linePend}`} style={{minHeight:14}}/>}
            </div>
            <p className={`text-sm pb-3 pt-0.5 ${done ? `${C.tx3(d)} line-through` : active ? `${C.tx(d)} font-semibold` : C.tx3(d)}`}>{label}</p>
          </div>
        );
      })}
    </div>
  );
}

// ─── Account Sheet ────────────────────────────────────────────
function AccountSheet({ user, onLogout, onClose, d }) {
  const { pref, setPref } = useTheme();
  const opts = [
    { k: "light",  l: "淺色模式", ic: I.sun   },
    { k: "dark",   l: "深色模式", ic: I.moon  },
    { k: "system", l: "跟隨系統", ic: I.phone },
  ];
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
          <SecTitle d={d}>外觀</SecTitle>
          <div className="flex flex-col gap-1">
            {opts.map(({ k, l, ic }) => (
              <SettingRow key={k} d={d} icon={ic} label={l}
                right={pref === k ? <span className={`text-xs font-bold ${C.tx(d)}`}>✓</span> : I.chevR}
                onClick={() => setPref(k)} />
            ))}
          </div>
        </div>
        <div>
          <SecTitle d={d}>其他</SecTitle>
          <SettingRow d={d} label="登出" danger onClick={() => { onLogout(); onClose(); }} />
        </div>
      </div>
    </Sheet>
  );
}

function LoginSheet({ onClose, d }) {

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

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
          className={`rounded-2xl px-4 py-3 font-medium transition ${
            d ? "bg-white text-black" : "bg-black text-white"
          }`}
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

// ─── Record Sheet ─────────────────────────────────────────────
function RecordSheet({ initial, onSave, onClose, user, d }) {
  const isEdit = !!initial;
  const initChoice = !initial || initial.kind === KIND.R ? "none"
    : initial.advStatus === ADV.PENDING ? "pending" : "approved";
  const [advChoice, setAdvChoice] = useState(initChoice);
  const [step, setStep] = useState(isEdit ? 2 : 1);
  const [form, setForm] = useState({
    title:           initial?.title           ?? "",
    date:            initial?.date            ?? today(),
    amount:          initial?.amount          ?? "",
    actualSpent:     initial?.actualSpent     ?? "",
    advanceReceived: initial?.advanceReceived ?? "",
    note:            initial?.note            ?? "",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const resolvedKind      = advChoice === "none" ? KIND.R : KIND.A;
  const resolvedAdvStatus = advChoice === "pending" ? ADV.PENDING : advChoice === "approved" ? ADV.APPROVED : null;

  const save = () => {
    if (!form.title.trim()) return alert("請輸入標題");
    if (advChoice === "none" && form.actualSpent === "") return alert("請輸入實際花費");
    if (advChoice !== "none" && form.amount === "") return alert("請輸入金額");
    onSave(buildRaw({
      ...form, id: initial?.id, kind: resolvedKind, advStatus: resolvedAdvStatus,
      amount:      advChoice === "none" ? toN(form.actualSpent) : toN(form.amount),
      actualSpent: advChoice === "none" ? toN(form.actualSpent) : toN(form.actualSpent),
      settlementDate: initial?.settlementDate ?? "",
      paymentRecords: initial?.paymentRecords ?? [],
    }, user?.id));
  };

  const scens = [
    { v: "none",     t: "未申請預支",       s: "自己先墊款，事後全額報帳" },
    { v: "pending",  t: "已申請（待核准）",  s: "已送出申請，等待公司批准" },
    { v: "approved", t: "已核准並撥款",      s: "拿到預支款，活動後結算差額" },
  ];

  const selBg  = d ? "border-zinc-100 bg-zinc-100" : "border-zinc-900 bg-zinc-900";
  const selTx  = d ? "text-zinc-900" : "text-white";
  const selSub = d ? "text-zinc-500" : "text-white/60";
  const unselBg= d ? "border-zinc-700 bg-zinc-800 hover:border-zinc-500" : "border-zinc-200 bg-zinc-50 hover:border-zinc-400";

  const title = isEdit ? "編輯紀錄" : step === 1 ? "記一筆"
    : advChoice === "none" ? "實際花費" : advChoice === "pending" ? "申請資訊" : "預支資訊";

  const liveAdv = form.advanceReceived !== "" && form.actualSpent !== "";
  const liveDiff = liveAdv ? toN(form.advanceReceived) - toN(form.actualSpent) : null;

  return (
    <Sheet title={title} onClose={onClose} d={d}>
      <div className="flex flex-col gap-5">
        {step === 1 && !isEdit && (
          <>
            <Field label="標題" d={d}>
              <Input d={d} placeholder="e.g. 五月出差費用" value={form.title} onChange={e => set("title", e.target.value)} />
            </Field>
            <Field label="日期" d={d}>
              <DateInput d={d} value={form.date} onChange={v => set("date", v)} />
            </Field>
            <Field label="預支情況" d={d}>
              <div className="flex flex-col gap-2">
                {scens.map(({ v, t, s }) => (
                  <button key={v} onClick={() => setAdvChoice(v)}
                    className={`p-3.5 rounded-2xl border-2 text-left transition-all ${advChoice === v ? selBg : unselBg}`}>
                    <div className={`text-sm font-semibold ${advChoice === v ? selTx : C.tx(d)}`}>{t}</div>
                    <div className={`text-xs mt-0.5 ${advChoice === v ? selSub : C.tx3(d)}`}>{s}</div>
                  </button>
                ))}
              </div>
            </Field>
            <PBtn d={d} onClick={() => { if (!form.title.trim()) return alert("請輸入標題"); setStep(2); }}>下一步 →</PBtn>
          </>
        )}
        {(step === 2 || isEdit) && (
          <>
            {isEdit && (
              <>
                <Field label="標題" d={d}><Input d={d} value={form.title} onChange={e => set("title", e.target.value)} /></Field>
                <Field label="日期" d={d}><DateInput d={d} value={form.date} onChange={v => set("date", v)} /></Field>
                <div className={`h-px ${C.divider(d)}`} />
              </>
            )}
            {advChoice === "none" && (
              <Field label="實際花費金額 ($)" hint="你自己墊付的金額，公司事後全額報帳" d={d}>
                <Input d={d} type="number" placeholder="0" autoFocus={!isEdit}
                  value={form.actualSpent} onChange={e => set("actualSpent", e.target.value)} />
              </Field>
            )}
            {advChoice === "pending" && (
              <Field label="申請金額 ($)" hint="你送出的預支申請金額" d={d}>
                <Input d={d} type="number" placeholder="0" autoFocus={!isEdit}
                  value={form.amount} onChange={e => set("amount", e.target.value)} />
              </Field>
            )}
            {advChoice === "approved" && (
              <div className={`rounded-2xl p-4 flex flex-col gap-4 ${C.card2(d)}`}>
                <div className={`text-xs font-semibold uppercase tracking-wider ${C.tx3(d)}`}>預支資訊</div>
                <Field label="核定預算 ($)" hint="公司核准的活動預算" d={d}>
                  <Input d={d} type="number" placeholder="0"
                    value={form.amount} onChange={e => set("amount", e.target.value)} />
                </Field>
                <Field label="已領預支 ($)" hint="實際拿到的預支款（沒拿到填 0）" d={d}>
                  <Input d={d} type="number" placeholder="0"
                    value={form.advanceReceived} onChange={e => set("advanceReceived", e.target.value)} />
                </Field>
                <div className={`h-px ${C.divider(d)}`} />
                <Field label="實際花費 ($)" hint="活動結束後填寫（可留空之後補填）" d={d}>
                  <Input d={d} type="number" placeholder="留空可之後補填"
                    value={form.actualSpent} onChange={e => set("actualSpent", e.target.value)} />
                </Field>
                {liveDiff !== null && (
                  <div className={`rounded-xl px-3 py-2.5 text-xs font-semibold text-center ${C.card(d)} ${C.tx2(d)}`}>
                    {liveDiff > 0 ? `我需繳回 ${fmt(liveDiff)}` : liveDiff < 0 ? `公司補我 ${fmt(-liveDiff)}` : "剛好平衡 🎉"}
                  </div>
                )}
              </div>
            )}
            <Field label="備註" d={d}>
              <Textarea d={d} rows={2} placeholder="選填" value={form.note} onChange={e => set("note", e.target.value)} />
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
          <p className={`text-xs ${C.tx3(d)} px-1`}>未通過將轉為報銷款，公司之後補款給你。</p>
        )}
        <PBtn d={d} onClick={() => {
          if (!choice) return alert("請選擇結果");
          onSave({ advStatus: choice === "approved" ? ADV.APPROVED : ADV.REJECTED, kind: choice === "rejected" ? KIND.R : KIND.A, advanceReceived: choice === "approved" ? toN(advRec) : 0 });
        }}>確認</PBtn>
      </div>
    </Sheet>
  );
}

// ─── Settle Sheet ──────────────────────────────────────────────
function SettleSheet({ rec, onSave, onClose, d }) {
  const [spent, setSpent] = useState(rec.actualSpent > 0 ? String(rec.actualSpent) : "");
  const [date,  setDate]  = useState(today());
  const advRec = toN(rec.advanceReceived);
  const diff   = advRec - toN(spent);
  const iOwe   = advRec > 0 && diff > 0;
  return (
    <Sheet title="填寫實際花費" onClose={onClose} d={d}>
      <div className="flex flex-col gap-5">
        <div className={`rounded-2xl p-4 flex flex-col gap-1.5 ${C.card2(d)}`}>
          <SRow d={d} l="核定預算" v={fmt(rec.amount)} />
          {advRec > 0 && <SRow d={d} l="已領預支" v={fmt(advRec)} />}
        </div>
        <Field label="實際花費 ($)" d={d}>
          <Input d={d} type="number" placeholder="0" autoFocus value={spent} onChange={e => setSpent(e.target.value)} />
        </Field>
        <Field label="結算日期" d={d}>
          <DateInput d={d} value={date} onChange={setDate} />
        </Field>
        {spent !== "" && (
          <div className={`rounded-2xl p-4 flex items-center justify-between ${C.card2(d)}`}>
            <span className={`text-sm ${C.tx2(d)}`}>{iOwe ? "需繳回公司" : "公司補我"}</span>
            <span className={`text-xl font-bold ${C.tx(d)}`}>{Math.abs(diff) === 0 ? "剛好平衡 🎉" : fmt(Math.abs(diff))}</span>
          </div>
        )}
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
            ? <><SRow d={d} l="應收" v={fmt(rec.amount)}/><SRow d={d} l="已入帳" v={fmt(rec.paid)}/><div className={`h-px my-1 ${C.divider(d)}`}/><SRow d={d} l="剩餘" v={fmt(rec.remaining)}/></>
            : <><SRow d={d} l={rec.iOwe ? "需繳回" : "公司補我"} v={fmt(rec.absDiff)}/><SRow d={d} l="已處理" v={fmt(rec.paid)}/><div className={`h-px my-1 ${C.divider(d)}`}/><SRow d={d} l="剩餘" v={fmt(rec.remaining)}/></>
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
      case STAGE.SETTLING: return { l: rec.iOwe ? "需繳回" : "公司補我", v: fmt(rec.absDiff) };
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
          <div className={`font-semibold text-sm leading-snug ${C.tx(d)}`}>{rec.title}</div>
          {rec.note && <div className={`text-xs ${C.tx3(d)} mt-0.5 truncate`}>{rec.note}</div>}
        </div>
        <StatusPill status={rec.status} d={d} />
      </div>
      <div className="px-4 pb-3 flex items-center gap-4">
        {!isPending && rec.effectiveKind === KIND.A && <div className="shrink-0"><Timeline rec={rec} compact d={d} /></div>}
        <div className={rec.effectiveKind === KIND.R && !isPending ? "ml-auto text-right" : ""}>
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
    if (isPending) return setSheet("status");
    if (isR) return setSheet("pay");
    if (rec.stage === STAGE.WAITING) return setSheet("settle");
    if (rec.stage === STAGE.SETTLING) return setSheet("pay");
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
          <div className="flex items-center gap-2 mb-3 flex-wrap"><KindPill rec={rec} d={d}/><StatusPill status={rec.status} d={d}/></div>
          <h1 className={`text-2xl font-bold leading-tight mb-2 ${C.tx(d)}`}>{rec.title}</h1>
          <div className={`flex items-center gap-1.5 text-xs ${C.tx3(d)}`}>{I.clock} {fmtD(rec.date)}</div>
          {rec.note && <p className={`mt-3 pt-3 border-t ${C.border(d)} text-sm ${C.tx2(d)}`}>{rec.note}</p>}
        </div>

        {/* Amounts */}
        {isR || isPending ? (
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[{ l: "應收金額", v: fmt(rec.amount) }, { l: "已入帳", v: fmt(rec.paid) }, { l: "剩餘", v: fmt(rec.remaining) }].map(({ l, v }) => (
              <div key={l} className={`rounded-2xl p-3.5 ${C.card(d)}`}>
                <div className={`text-xs ${C.tx3(d)} mb-1`}>{l}</div>
                <div className={`text-lg font-bold ${C.tx(d)}`}>{v}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3 mb-4">
            <div className={`rounded-3xl p-5 ${C.card(d)}`}>
              <p className={`text-xs font-bold uppercase tracking-wider ${C.tx3(d)} mb-4`}>預支流程</p>
              <div className="flex gap-5">
                <div className="shrink-0"><Timeline rec={rec} d={d} /></div>
                <div className="flex flex-col gap-2 flex-1">
                  {[{ l: "核定預算", v: fmt(rec.amount) }, toN(rec.advanceReceived) > 0 && { l: "已領預支", v: fmt(rec.advanceReceived) }].filter(Boolean).map(({ l, v }) => (
                    <div key={l} className={`rounded-2xl p-3 ${C.card2(d)}`}>
                      <div className={`text-[10px] uppercase tracking-wide ${C.tx3(d)} mb-0.5`}>{l}</div>
                      <div className={`text-base font-bold ${C.tx(d)}`}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {rec.actualSpent > 0 && (
              <div className={`rounded-3xl p-5 ${C.card(d)}`}>
                <p className={`text-xs font-bold uppercase tracking-wider ${C.tx3(d)} mb-3`}>結算結果</p>
                <div className="flex flex-col gap-2">
                  {[
                    { l: "實際花費", v: fmt(rec.actualSpent) },
                    { l: rec.iOwe ? "需繳回公司" : "公司補我", v: fmt(rec.absDiff) },
                    rec.remaining > 0 && { l: "剩餘未處理", v: fmt(rec.remaining) },
                  ].filter(Boolean).map(({ l, v }) => (
                    <div key={l} className={`rounded-2xl p-3 ${C.card2(d)}`}>
                      <div className={`text-[10px] uppercase tracking-wide ${C.tx3(d)} mb-0.5`}>{l}</div>
                      <div className={`text-base font-bold ${C.tx(d)}`}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* CTA */}
        {ctaLabel && (
          <div className={`rounded-3xl p-5 mb-4 flex items-center justify-between ${d ? "bg-zinc-100" : "bg-zinc-900"}`}>
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
      {sheet === "status" && <AdvStatusSheet d={d} rec={rec} onSave={u => { dispatch({ type: RECORDS_ACTION.UPDATE_RECORD, payload: derive({ ...strip(rec), ...u }) }); setSheet(null); }} onClose={() => setSheet(null)} />}
      {sheet === "settle" && <SettleSheet d={d} rec={rec} onSave={({ actualSpent, settlementDate }) => { dispatch({ type: RECORDS_ACTION.UPDATE_RECORD, payload: derive({ ...strip(rec), actualSpent, settlementDate }) }); setSheet(null); }} onClose={() => setSheet(null)} />}
      {sheet === "pay" && rec.remaining > 0 && <PaymentSheet d={d} rec={rec} onSave={p => { dispatch({ type: RECORDS_ACTION.UPDATE_RECORD, payload: derive({ ...strip(rec), paymentRecords: [...rec.pr, p] }) }); setSheet(null); }} onClose={() => setSheet(null)} />}
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
  const [fStatus,    setFStatus]    = useState("全部");
  const [fKind,      setFKind]      = useState("全部");
  const [sort,       setSort]       = useState("date_desc");
  const [guestOk,    setGuestOk]    = useState(() => getGuestDismissed());

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
      if (!u) dispatchRecords({ type: RECORDS_ACTION.LOAD_RECORDS, payload: [] });
    });
    return () => sub.unsubscribe();
  }, []);

  // ── Load records when user changes ────────────────────────
  useEffect(() => {
    if (!user) return;
    setLoadingRec(true);
    db.load().then((raws) => {
      dispatchRecords({
        type: RECORDS_ACTION.LOAD_RECORDS,
        payload: raws.map(derive),
      });
      setLoadingRec(false);
    });
  }, [user?.id]);

  // ── dispatch — pure state update via reducer, side-effects here ──
  const dispatch = useCallback((action) => {
    // 1. Update local state via pure reducer
    dispatchRecords(action);

    // 2. Side-effects (DB sync) — outside reducer, caller's responsibility
    if (action.type === RECORDS_ACTION.ADD_RECORD) {
      db.upsert(strip(action.payload));
    } else if (action.type === RECORDS_ACTION.UPDATE_RECORD) {
      db.upsert(strip(action.payload));
    } else if (action.type === RECORDS_ACTION.DELETE_RECORD) {
      setSelId(null);
      db.delete(action.payload);
    }
  }, []);

  const login  = (u) => { setUser(u); setSheet(null); };
  const logout = async () => { await auth.logout(); setUser(null); setSheet(null); };

  const visible = useMemo(() => records, [records]); // Supabase RLS already filters by user

  const stats = useMemo(() => {
    const owed = visible.reduce((s, r) => {
      if (r.effectiveKind === KIND.R) return s + r.remaining;
      if (r.kind === KIND.A && !r.iOwe && r.stage === STAGE.SETTLING) return s + clamp(r.absDiff - r.paid);
      return s;
    }, 0);
    return { owed: Math.max(owed, 0), pending: visible.filter(r => r.status !== "完成").length, total: visible.length };
  }, [visible]);

  const filtered = useMemo(() => visible
    .filter(r => {
      if (fStatus !== "全部" && r.status !== fStatus) return false;
      if (fKind !== "全部" && r.kind !== fKind) return false;
      if (search && !r.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      if (sort === "date_desc")   return b.date.localeCompare(a.date);
      if (sort === "date_asc")    return a.date.localeCompare(b.date);
      if (sort === "amount_desc") return toN(b.amount) - toN(a.amount);
      if (sort === "amount_asc")  return toN(a.amount) - toN(b.amount);
      return 0;
    }), [visible, fStatus, fKind, search, sort]);

  const hasFilter = fStatus !== "全部" || fKind !== "全部" || sort !== "date_desc";
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
                <div className={`text-[11px] leading-none ${C.tx3(d)}`}>記帳不是麻煩，只是還沒被整理好。</div>
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
                ["狀態", ["全部","處理中","完成","等待核准"], fStatus, setFStatus],
                ["類型", [["全部","全部"],[KIND.R,"報銷款"],[KIND.A,"預支款"]], fKind, setFKind],
                ["排序", [["date_desc","最新"],["date_asc","最舊"],["amount_desc","金額↓"],["amount_asc","金額↑"]], sort, setSort],
              ].map(([label, opts, val, setter]) => (
                <div key={label} className="flex items-center gap-3 px-3 py-2.5">
                  <span className={`text-xs ${C.tx3(d)} w-8 shrink-0`}>{label}</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {opts.map(o => {
                      const v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
                      return (
                        <button key={v} onClick={() => setter(v)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${val === v ? C.activeFilter(d) : C.inactFilter(d)}`}>
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
              <div className={`text-xs font-medium uppercase tracking-wide mb-1 ${d ? "text-zinc-500" : "text-white/50"}`}>未結清</div>
              <div className="text-2xl font-bold tracking-tight">{fmt(stats.owed)}</div>
              <div className={`text-xs mt-1 ${d ? "text-zinc-500" : "text-white/40"}`}>公司尚欠款項</div>
            </div>
            <div className={`rounded-3xl px-4 py-4 ${C.card(d)}`}>
              <div className={`text-xs font-medium uppercase tracking-wide ${C.tx3(d)} mb-1`}>待結算</div>
              <div className={`text-2xl font-bold tracking-tight ${C.tx(d)}`}>{stats.pending}</div>
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
              <div className={`text-sm font-semibold ${C.tx2(d)} mb-1`}>{search || hasFilter ? "沒有符合的紀錄" : "你這裡欠我的，用什麼還？"}</div>
              {!search && !hasFilter && <p className={`text-xs ${C.tx3(d)}`}>點右下角 + 開始記帳</p>}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-24">
              <div className="text-5xl mb-4">📋</div>
              <div className={`text-sm font-semibold ${C.tx2(d)} mb-1`}>{search || hasFilter ? "沒有符合的紀錄" : "你這裡欠我的，用什麼還？"}</div>
              {!search && !hasFilter && <p className={`text-xs ${C.tx3(d)}`}>點右下角 + 開始記帳</p>}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filtered.map(r => <RecordCard key={r.id} rec={r} d={d} onSelect={setSelId} onAction={setQuickId} />)}
            </div>
          )}
        </div>
      </div>

      {/* FAB */}
      <button onClick={() => setSheet("add")}
        style={{ bottom: "max(1.5rem, env(safe-area-inset-bottom, 1.5rem))" }}
        className={`fixed right-5 z-40 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center hover:opacity-90 active:scale-95 transition-all ${C.fabBg(d)} ${C.fabTx(d)}`}>
        {I.plus}
      </button>

      {/* Sheets */}
      {sheet === "add"     && <RecordSheet d={d} user={user} onSave={f => { dispatch({ type: RECORDS_ACTION.ADD_RECORD, payload: derive(buildRaw(f, user?.id)) }); setSheet(null); }} onClose={() => setSheet(null)} />}
      {sheet === "login"   && <LoginSheet  d={d} onClose={() => setSheet(null)} />}
      {sheet === "account" && <AccountSheet d={d} user={user} onLogout={logout} onClose={() => setSheet(null)} />}
      {quickRec && quickType === "status" && <AdvStatusSheet d={d} rec={quickRec} onSave={u => { dispatch({ type: RECORDS_ACTION.UPDATE_RECORD, payload: derive({ ...strip(quickRec), ...u }) }); setQuickId(null); }} onClose={() => setQuickId(null)} />}
      {quickRec && quickType === "settle" && <SettleSheet d={d} rec={quickRec} onSave={({ actualSpent, settlementDate }) => { dispatch({ type: RECORDS_ACTION.UPDATE_RECORD, payload: derive({ ...strip(quickRec), actualSpent, settlementDate }) }); setQuickId(null); }} onClose={() => setQuickId(null)} />}
      {quickRec && quickType === "pay"    && <PaymentSheet d={d} rec={quickRec} onSave={p => { dispatch({ type: RECORDS_ACTION.UPDATE_RECORD, payload: derive({ ...strip(quickRec), paymentRecords: [...quickRec.pr, p] }) }); setQuickId(null); }} onClose={() => setQuickId(null)} />}
    </div>
  );
}

export default function App() {
  return <ThemeProvider><MainApp /></ThemeProvider>;
}

