/**
 * HaiBack｜還袂  —  v5
 * 「我只是來看誰還沒把錢還我。」
 *
 * Single-file React app. Paste into src/App.jsx of a Vite + Tailwind project.
 * tailwind.config.js must have:  darkMode: 'class'
 */
import { useState, useMemo, useCallback, createContext, useContext, useEffect } from "react";

// ═══════════════════════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════════════════════
const KEYS = {
  RECORDS: "hb_records_v5",
  USER:    "hb_user_v5",
  USERS:   "hb_users_v5",
  THEME:   "hb_theme_v5",
  GUEST_NOTICE_DISMISSED: "hb_guest_dismissed",
};

const storage = {
  loadRecords:    ()  => { try { return JSON.parse(localStorage.getItem(KEYS.RECORDS) || "[]"); } catch { return []; } },
  saveRecords:    (l) => localStorage.setItem(KEYS.RECORDS, JSON.stringify(l)),
  getUser:        ()  => { try { return JSON.parse(localStorage.getItem(KEYS.USER) || "null"); } catch { return null; } },
  saveUser:       (u) => localStorage.setItem(KEYS.USER, JSON.stringify(u)),
  logout:         ()  => localStorage.removeItem(KEYS.USER),
  getUsers:       ()  => { try { return JSON.parse(localStorage.getItem(KEYS.USERS) || "{}"); } catch { return {}; } },
  saveUsers:      (m) => localStorage.setItem(KEYS.USERS, JSON.stringify(m)),
  getTheme:       ()  => localStorage.getItem(KEYS.THEME) || "system",
  saveTheme:      (t) => localStorage.setItem(KEYS.THEME, t),
  getGuestDismissed: () => localStorage.getItem(KEYS.GUEST_NOTICE_DISMISSED) === "1",
  setGuestDismissed: () => localStorage.setItem(KEYS.GUEST_NOTICE_DISMISSED, "1"),
};

// ═══════════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════════
const ThemeCtx = createContext({ dark: false, themePref: "system", setThemePref: () => {} });
const useTheme = () => useContext(ThemeCtx);

function ThemeProvider({ children }) {
  const [pref, setPref]     = useState(() => storage.getTheme());
  const [sysDark, setSysDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h  = (e) => setSysDark(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  const dark = pref === "dark" || (pref === "system" && sysDark);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    const bg = dark ? "#09090b" : "#fafafa";
    root.style.backgroundColor = bg;
    document.body.style.backgroundColor = bg;
    document.body.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);

  const setThemePref = (t) => { setPref(t); storage.saveTheme(t); };

  return (
    <ThemeCtx.Provider value={{ dark, themePref: pref, setThemePref }}>
      {children}
    </ThemeCtx.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════
// DOMAIN
// ═══════════════════════════════════════════════════════════════
const KIND  = { R: "reimbursement", A: "advance" };
const STAGE = { PREPARING: "preparing", WAITING: "waiting", SETTLING: "settling", DONE: "done" };

const uid   = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const fmt   = (n) => `$${Number(n || 0).toLocaleString()}`;
const today = () => new Date().toISOString().slice(0, 10);
const fmtD  = (s) => (s || "").slice(0, 10).replace(/-/g, "/");
const toN   = (v) => Number(v) || 0;

/**
 * computeStage — advance lifecycle
 *
 * PREPARING  → created, no action yet  (we skip this for now — go straight to WAITING)
 * WAITING    → waiting for actualSpent to be filled
 * SETTLING   → actualSpent filled, diff != 0 and not fully paid back
 * DONE       → settled
 *
 * advanceReceived=0 is valid (no advance taken).
 * If advanceReceived=0: diff = 0 - actualSpent < 0 → company owes me → iOwe=false always.
 */
const computeStage = (raw) => {
  const paid    = (raw.paymentRecords || []).reduce((s, r) => s + toN(r.amount), 0);
  const hasActual = toN(raw.actualSpent) > 0;
  if (!hasActual) return STAGE.WAITING;
  const diff    = toN(raw.advanceReceived) - toN(raw.actualSpent);
  const absDiff = Math.abs(diff);
  // iOwe only if advanceReceived > 0 AND diff > 0
  const iOwe    = toN(raw.advanceReceived) > 0 && diff > 0;
  const settled = absDiff === 0 || !iOwe || paid >= absDiff;
  return settled ? STAGE.DONE : STAGE.SETTLING;
};

const derive = (raw) => {
  const pr   = raw.paymentRecords ?? [];
  const paid = pr.reduce((s, r) => s + toN(r.amount), 0);

  if (raw.kind === KIND.R) {
    const rem = Math.max(toN(raw.amount) - paid, 0);
    return { ...raw, pr, paid, remaining: rem, status: rem === 0 ? "完成" : "處理中" };
  }

  // Advance
  const stage   = computeStage(raw);
  const advRec  = toN(raw.advanceReceived);
  const diff    = advRec - toN(raw.actualSpent);
  const absDiff = Math.abs(diff);
  const iOwe    = advRec > 0 && diff > 0;                // only owe back if we received money and spent less
  const rem     = (stage === STAGE.SETTLING && iOwe) ? Math.max(absDiff - paid, 0) : 0;
  return { ...raw, pr, paid, stage, diff, absDiff, iOwe, remaining: rem, status: stage === STAGE.DONE ? "完成" : "處理中" };
};

const strip = (r) => ({
  id: r.id, userId: r.userId ?? null,
  kind: r.kind, title: r.title, date: r.date,
  amount: toN(r.amount), advanceReceived: toN(r.advanceReceived),
  actualSpent: toN(r.actualSpent), settlementDate: r.settlementDate || "",
  paymentRecords: r.paymentRecords || [], note: r.note || "",
});

const buildRaw = (f, userId = null) => ({
  id:              f.id   || uid(),
  userId:          f.userId ?? userId,
  kind:            f.kind || KIND.R,
  title:           f.title  || "",
  date:            f.date   || today(),
  amount:          toN(f.amount),
  advanceReceived: toN(f.advanceReceived),
  actualSpent:     toN(f.actualSpent),
  settlementDate:  f.settlementDate || "",
  paymentRecords:  f.paymentRecords || [],
  note:            f.note || "",
});

// ═══════════════════════════════════════════════════════════════
// ICONS
// ═══════════════════════════════════════════════════════════════
const sv = (d, c = "w-4 h-4") =>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={c}>{d}</svg>;

const I = {
  back:    sv(<><path d="M19 12H5M12 5l-7 7 7 7"/></>),
  edit:    sv(<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>),
  trash:   sv(<><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></>),
  search:  sv(<><circle cx={11} cy={11} r={8}/><path d="M21 21l-4.35-4.35"/></>),
  filter:  sv(<><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></>),
  user:    sv(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>),
  plus:    sv(<><path d="M12 5v14M5 12h14"/></>, "w-5 h-5"),
  check:   sv(<><polyline points="20 6 9 17 4 12"/></>, "w-3 h-3"),
  clock:   sv(<><circle cx={12} cy={12} r={10}/><polyline points="12 6 12 12 16 14"/></>, "w-3 h-3"),
  cal:     sv(<><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>),
  eye:     sv(<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>),
  eyeOff:  sv(<><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>),
  sun:     sv(<><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></>),
  moon:    sv(<><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></>),
  phone:   sv(<><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></>),
  chevR:   sv(<><polyline points="9 18 15 12 9 6"/></>),
};

// ═══════════════════════════════════════════════════════════════
// DESIGN TOKENS  (dark mode baked in)
// ═══════════════════════════════════════════════════════════════
const page    = "bg-zinc-50 dark:bg-zinc-950";
const card    = "bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800";
const card2   = "bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-100 dark:border-zinc-700/60";
const tx      = "text-zinc-900 dark:text-zinc-100";          // primary text
const tx2     = "text-zinc-500 dark:text-zinc-400";          // secondary
const tx3     = "text-zinc-400 dark:text-zinc-500";          // muted
const inp     = `w-full px-4 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm ${tx} bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 focus:border-zinc-400 dark:focus:border-zinc-500 transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-500`;

// ═══════════════════════════════════════════════════════════════
// ATOMS
// ═══════════════════════════════════════════════════════════════
function Btn({ onClick, disabled, children, variant = "primary", className = "" }) {
  const base = "w-full py-4 rounded-2xl font-semibold text-sm active:scale-[0.98] transition-all disabled:opacity-40 cursor-pointer";
  if (variant === "primary")
    return <button onClick={onClick} disabled={disabled} className={`${base} bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 ${className}`}>{children}</button>;
  return <button onClick={onClick} disabled={disabled} className={`${base} ${card} ${tx2} hover:opacity-80 ${className}`}>{children}</button>;
}

function Field({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-2">
      <label className={`text-xs font-semibold uppercase tracking-wider ${tx3}`}>{label}</label>
      {children}
      {hint && <p className={`text-xs ${tx3}`}>{hint}</p>}
    </div>
  );
}

function DatePicker({ value, onChange }) {
  return (
    <label className={`flex items-center gap-3 px-4 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-500 transition-all`}>
      <span className={tx3}>{I.cal}</span>
      <span className={`text-sm font-medium ${tx} flex-1`}>{fmtD(value) || "選擇日期"}</span>
      <input type="date" value={value} onChange={e => onChange(e.target.value)}
        className="absolute opacity-0 w-0 h-0 pointer-events-none" />
    </label>
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full rounded-t-3xl shadow-2xl max-h-[93vh] flex flex-col ${card}`}>
        <div className={`flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-800 shrink-0`}>
          <h2 className={`text-base font-bold ${tx}`}>{title}</h2>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 ${tx2} text-xl hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors`}>×</button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-5 pb-12">{children}</div>
      </div>
    </div>
  );
}

function KindPill({ kind }) {
  return <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${kind === KIND.R ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700" : "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-transparent"}`}>{kind === KIND.R ? "報銷款" : "預支款"}</span>;
}

function StatusDot({ status }) {
  const done = status === "完成";
  return <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${done ? `bg-zinc-100 dark:bg-zinc-800 ${tx2} border-zinc-200 dark:border-zinc-700` : "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-transparent"}`}><span className={`w-1.5 h-1.5 rounded-full ${done ? "bg-zinc-400" : "bg-white dark:bg-zinc-900"}`}/>{status}</span>;
}

function SRow({ l, v, bold }) {
  return <div className="flex justify-between items-center"><span className={`text-sm ${tx2}`}>{l}</span><span className={`text-sm ${bold ? "font-bold" : "font-medium"} ${tx}`}>{v}</span></div>;
}

function SectionTitle({ children }) {
  return <p className={`text-xs font-semibold uppercase tracking-wider ${tx3} mb-2 px-1`}>{children}</p>;
}

function SettingRow({ icon, label, value, right, onClick, danger }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3.5 ${card} rounded-2xl ${onClick ? "cursor-pointer hover:opacity-80 active:scale-[0.99] transition-all" : ""}`} onClick={onClick}>
      {icon && <span className={danger ? "text-red-500" : tx2}>{icon}</span>}
      <span className={`text-sm flex-1 ${danger ? "text-red-500" : tx}`}>{label}</span>
      {value && <span className={`text-sm ${tx3}`}>{value}</span>}
      {right && <span className={tx3}>{right}</span>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DYNAMIC TIMELINE
// ═══════════════════════════════════════════════════════════════
function Timeline({ rec, compact = false }) {
  const hasAdvance = toN(rec.advanceReceived) > 0;

  // Build steps dynamically
  const steps = hasAdvance
    ? ["建立", "領款", "填費", "結算", "完成"]
    : ["建立", "填費", "補款", "完成"];

  // Map stage → active step index
  const stageToIdx = hasAdvance
    ? { [STAGE.WAITING]: 1, [STAGE.SETTLING]: 3, [STAGE.DONE]: 4 }
    : { [STAGE.WAITING]: 1, [STAGE.SETTLING]: 2, [STAGE.DONE]: 3 };

  const cur = stageToIdx[rec.stage] ?? 0;

  if (compact) {
    return (
      <div className="flex items-center gap-1">
        {steps.map((_, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className={`w-1.5 h-1.5 rounded-full ${i < cur ? "bg-zinc-900 dark:bg-zinc-100" : i === cur ? "bg-zinc-900 dark:bg-white ring-2 ring-zinc-300 dark:ring-zinc-600" : "bg-zinc-200 dark:bg-zinc-700"}`}/>
            {i < steps.length - 1 && <div className={`w-3 h-px ${i < cur ? "bg-zinc-900 dark:bg-zinc-100" : "bg-zinc-200 dark:bg-zinc-700"}`}/>}
          </div>
        ))}
      </div>
    );
  }

  const stepLabels = hasAdvance
    ? [
        "預支建立",
        rec.advanceReceived > 0 ? `已領預支 ${fmt(rec.advanceReceived)}` : "已領預支",
        rec.actualSpent > 0 ? `實際花費 ${fmt(rec.actualSpent)}` : "填寫實際花費",
        "等待結算完成",
        "已完成結算",
      ]
    : [
        "預支建立",
        rec.actualSpent > 0 ? `實際花費 ${fmt(rec.actualSpent)}` : "填寫實際花費",
        rec.stage === STAGE.DONE ? "補款完成" : "等待公司補款",
        "已完成",
      ];

  return (
    <div className="flex flex-col gap-0">
      {stepLabels.map((label, i) => {
        const done   = i < cur;
        const active = i === cur;
        return (
          <div key={i} className="flex items-start gap-3">
            <div className="flex flex-col items-center shrink-0">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center mt-0.5 ${done ? "bg-zinc-900 dark:bg-zinc-100" : active ? "bg-zinc-900 dark:bg-white ring-4 ring-zinc-100 dark:ring-zinc-800" : "bg-zinc-200 dark:bg-zinc-700"}`}>
                {done   && <span className="text-white dark:text-zinc-900">{I.check}</span>}
                {active && <div className="w-2 h-2 rounded-full bg-white dark:bg-zinc-900"/>}
              </div>
              {i < stepLabels.length - 1 && <div className={`w-px my-1 ${done ? "bg-zinc-900 dark:bg-zinc-100" : "bg-zinc-200 dark:bg-zinc-700"}`} style={{ minHeight: 16 }}/>}
            </div>
            <p className={`text-sm pb-3 pt-0.5 ${done ? `${tx3} line-through` : active ? `${tx} font-semibold` : tx3}`}>{label}</p>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ACCOUNT SHEET
// ═══════════════════════════════════════════════════════════════
function AccountSheet({ user, onLogout, onClose }) {
  const { themePref, setThemePref } = useTheme();
  const opts = [
    { key: "system", label: "跟隨系統", icon: I.phone },
    { key: "light",  label: "淺色模式", icon: I.sun   },
    { key: "dark",   label: "深色模式", icon: I.moon  },
  ];
  return (
    <Sheet title="設定" onClose={onClose}>
      <div className="flex flex-col gap-6">
        <div>
          <SectionTitle>帳號</SectionTitle>
          <SettingRow
            icon={<div className="w-7 h-7 rounded-full bg-zinc-900 dark:bg-white flex items-center justify-center"><span className="text-white dark:text-zinc-900 font-bold text-xs">{user?.username?.[0]?.toUpperCase() || "?"}</span></div>}
            label={user?.username || "訪客"}
            value="本機帳號"
          />
        </div>
        <div>
          <SectionTitle>外觀</SectionTitle>
          <div className="flex flex-col gap-1">
            {opts.map(({ key, label, icon }) => (
              <SettingRow key={key} icon={icon} label={label}
                right={themePref === key ? <span className={`text-xs font-bold ${tx}`}>✓</span> : I.chevR}
                onClick={() => setThemePref(key)} />
            ))}
          </div>
        </div>
        <div>
          <SectionTitle>其他</SectionTitle>
          <SettingRow label="登出" danger onClick={() => { onLogout(); onClose(); }} />
        </div>
      </div>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════════
// LOGIN SHEET
// ═══════════════════════════════════════════════════════════════
function LoginSheet({ onClose, onLogin }) {
  const [mode,    setMode]    = useState("login");
  const [uname,   setUname]   = useState("");
  const [pw,      setPw]      = useState("");
  const [showPw,  setShowPw]  = useState(false);
  const [err,     setErr]     = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const u = uname.trim();
    if (u.length < 3)  return setErr("帳號至少需要 3 個字");
    if (pw.length < 4) return setErr("密碼至少需要 4 個字");
    setErr(""); setLoading(true);
    await new Promise(r => setTimeout(r, 250));
    try {
      const users = storage.getUsers();
      if (mode === "register") {
        if (users[u]) throw new Error("此帳號已存在");
        users[u] = pw; storage.saveUsers(users);
        setErr("✓ 建立成功，請登入"); setMode("login");
      } else {
        if (Object.keys(users).length === 0) throw new Error("尚未建立帳號，請先註冊");
        if (!users[u] || users[u] !== pw) throw new Error("帳號或密碼不正確");
        const user = { username: u, id: btoa(u) };
        storage.saveUser(user); onLogin(user);
      }
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  const onKey = (e) => { if (e.key === "Enter") submit(); };

  return (
    <Sheet title={mode === "login" ? "登入帳號" : "建立帳號"} onClose={onClose}>
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-zinc-900 dark:bg-white flex items-center justify-center shrink-0">
            <span className="text-white dark:text-zinc-900 font-bold">還</span>
          </div>
          <div>
            <div className={`font-bold ${tx}`}>HaiBack｜還袂</div>
            <div className={`text-xs ${tx3}`}>{mode === "login" ? "登入後可保留你的紀錄資料" : "避免清除瀏覽資料後遺失紀錄"}</div>
          </div>
        </div>
        <Field label="帳號">
          <input className={inp} placeholder="至少 3 個字" value={uname} onChange={e => setUname(e.target.value)} onKeyDown={onKey} />
        </Field>
        <Field label="密碼">
          <div className="relative">
            <input type={showPw ? "text" : "password"} className={`${inp} pr-12`}
              placeholder="至少 4 個字" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={onKey} />
            <button type="button" onClick={() => setShowPw(s => !s)}
              className={`absolute right-4 top-1/2 -translate-y-1/2 ${tx3}`}>{showPw ? I.eyeOff : I.eye}</button>
          </div>
        </Field>
        {err && (
          <div className={`text-sm rounded-2xl px-4 py-3 ${err.startsWith("✓") ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300" : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"}`}>
            {err}
          </div>
        )}
        <Btn onClick={submit} disabled={loading}>{loading ? "處理中…" : mode === "login" ? "登入" : "建立帳號"}</Btn>
        <button onClick={() => { setMode(m => m === "login" ? "register" : "login"); setErr(""); }}
          className={`text-sm ${tx3} text-center py-1 hover:opacity-80 transition-opacity`}>
          {mode === "login" ? "還沒有帳號？點這裡註冊" : "已有帳號？返回登入"}
        </button>
      </div>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════════
// RECORD SHEET (Add / Edit)
// ═══════════════════════════════════════════════════════════════
function RecordSheet({ initial, onSave, onClose, user }) {
  const isEdit = !!initial;
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    kind:            initial?.kind            ?? KIND.R,
    title:           initial?.title           ?? "",
    date:            initial?.date            ?? today(),
    amount:          initial?.amount          ?? "",
    advanceReceived: initial?.advanceReceived ?? "",
    note:            initial?.note            ?? "",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = () => {
    if (!form.title.trim())                        return alert("請輸入標題");
    if (form.amount === "" || form.amount === null) return alert("請輸入金額");
    onSave(buildRaw({
      ...form, id: initial?.id,
      actualSpent:    initial?.actualSpent    ?? 0,
      settlementDate: initial?.settlementDate ?? "",
      paymentRecords: initial?.paymentRecords ?? [],
    }, user?.id));
  };

  return (
    <Sheet title={isEdit ? "編輯紀錄" : step === 1 ? "記一筆" : form.kind === KIND.R ? "填寫金額" : "填寫預支資訊"} onClose={onClose}>
      <div className="flex flex-col gap-6">

        {/* Step 1 — type + title + date */}
        {(step === 1 && !isEdit) && (
          <>
            <Field label="類型">
              <div className="grid grid-cols-2 gap-2">
                {[{ k: KIND.R, t: "報銷款", s: "事後全額報帳" }, { k: KIND.A, t: "預支款", s: "先領預支再結算" }].map(({ k, t, s }) => (
                  <button key={k} onClick={() => set("kind", k)}
                    className={`p-4 rounded-2xl border-2 text-left transition-all ${form.kind === k ? "border-zinc-900 dark:border-white bg-zinc-900 dark:bg-white" : `border-zinc-200 dark:border-zinc-700 ${card2} hover:border-zinc-400 dark:hover:border-zinc-500`}`}>
                    <div className={`text-sm font-bold ${form.kind === k ? "text-white dark:text-zinc-900" : tx}`}>{t}</div>
                    <div className={`text-xs mt-1 ${tx3}`}>{s}</div>
                  </button>
                ))}
              </div>
            </Field>
            <Field label="標題">
              <input className={inp} placeholder="e.g. 五月出差費用" value={form.title} onChange={e => set("title", e.target.value)} />
            </Field>
            <Field label="日期">
              <DatePicker value={form.date} onChange={v => set("date", v)} />
            </Field>
            <Btn onClick={() => { if (!form.title.trim()) return alert("請輸入標題"); setStep(2); }}>下一步 →</Btn>
          </>
        )}

        {/* Step 2 / Edit — amounts */}
        {(isEdit || step === 2) && (
          <>
            {isEdit && (
              <>
                <Field label="標題"><input className={inp} value={form.title} onChange={e => set("title", e.target.value)} /></Field>
                <Field label="日期"><DatePicker value={form.date} onChange={v => set("date", v)} /></Field>
                <div className={`h-px bg-zinc-100 dark:bg-zinc-800`} />
              </>
            )}

            {form.kind === KIND.R ? (
              <Field label="報銷金額 ($)" hint="事後全部報帳的總金額">
                <input type="number" className={inp} placeholder="0" value={form.amount} onChange={e => set("amount", e.target.value)} autoFocus={!isEdit} />
              </Field>
            ) : (
              <div className={`rounded-2xl p-4 flex flex-col gap-4 ${card2}`}>
                <Field label="核定預算 ($)" hint="公司核准的活動預算">
                  <input type="number" className={inp} placeholder="0" value={form.amount} onChange={e => set("amount", e.target.value)} />
                </Field>
                <Field label="已領預支 ($)" hint="可留空 —— 沒領預支填 0 即可">
                  <input type="number" className={inp} placeholder="0" value={form.advanceReceived} onChange={e => set("advanceReceived", e.target.value)} />
                </Field>
                <p className={`text-xs ${tx3}`}>✦ 實際花費活動結束後再填</p>
              </div>
            )}

            <Field label="備註">
              <textarea className={`${inp} resize-none`} rows={2} placeholder="選填" value={form.note} onChange={e => set("note", e.target.value)} />
            </Field>

            <div className="flex gap-3">
              {!isEdit && <Btn variant="ghost" className="flex-1" onClick={() => setStep(1)}>← 上一步</Btn>}
              <Btn className="flex-1" onClick={save}>{isEdit ? "儲存" : "記一筆"}</Btn>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════════
// SETTLE SHEET
// ═══════════════════════════════════════════════════════════════
function SettleSheet({ rec, onSave, onClose }) {
  const [spent, setSpent] = useState(rec.actualSpent > 0 ? String(rec.actualSpent) : "");
  const [date,  setDate]  = useState(today());
  const advRec = toN(rec.advanceReceived);
  const diff   = advRec - toN(spent);
  // if no advance received, company always owes me (diff negative or zero)
  const iOweResult = advRec > 0 && diff > 0;

  return (
    <Sheet title="填寫實際花費" onClose={onClose}>
      <div className="flex flex-col gap-6">
        <div className={`rounded-2xl p-4 flex flex-col gap-2 ${card2}`}>
          <SRow l="核定預算" v={fmt(rec.amount)} />
          <SRow l="已領預支" v={fmt(rec.advanceReceived)} />
        </div>

        <Field label="實際花費 ($)">
          <input type="number" className={inp} placeholder="0" value={spent} onChange={e => setSpent(e.target.value)} autoFocus />
        </Field>

        <Field label="結算日期">
          <DatePicker value={date} onChange={setDate} />
        </Field>

        {spent !== "" && (
          <div className={`rounded-2xl p-4 flex items-center justify-between ${card2}`}>
            <span className={`text-sm ${tx2}`}>{iOweResult ? "需繳回公司" : diff < 0 || advRec === 0 ? "公司補我" : "剛好平衡 🎉"}</span>
            <span className={`text-xl font-bold ${tx}`}>{Math.abs(diff) === 0 ? "—" : fmt(Math.abs(diff))}</span>
          </div>
        )}

        <Btn onClick={() => {
          if (spent === "") return alert("請輸入實際花費");
          onSave({ actualSpent: toN(spent), settlementDate: date });
        }}>確認結算</Btn>
      </div>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════════
// PAYMENT SHEET
// ═══════════════════════════════════════════════════════════════
function PaymentSheet({ rec, onSave, onClose }) {
  const [amount, setAmount] = useState("");
  const [date,   setDate]   = useState(today());
  const isR    = rec.kind === KIND.R;
  const label  = isR ? "入帳" : rec.iOwe ? "繳回" : "補款";

  return (
    <Sheet title={`新增${label}紀錄`} onClose={onClose}>
      <div className="flex flex-col gap-6">
        <div className={`rounded-2xl p-4 flex flex-col gap-2 ${card2}`}>
          <p className={`text-sm font-semibold truncate ${tx} mb-1`}>{rec.title}</p>
          {isR ? <>
            <SRow l="應收金額" v={fmt(rec.amount)} />
            <SRow l="已入帳"   v={fmt(rec.paid)} />
            <div className={`h-px bg-zinc-200 dark:bg-zinc-700 my-1`} />
            <SRow l="剩餘" v={fmt(rec.remaining)} bold />
          </> : <>
            <SRow l={rec.iOwe ? "需繳回" : "公司補我"} v={fmt(rec.absDiff)} />
            <SRow l="已處理" v={fmt(rec.paid)} />
            <div className={`h-px bg-zinc-200 dark:bg-zinc-700 my-1`} />
            <SRow l="剩餘" v={fmt(rec.remaining)} bold />
          </>}
        </div>
        <Field label={`${label}金額 ($)`}>
          <div className="flex gap-2">
            <input type="number" className={`${inp} flex-1`} placeholder="0" value={amount} onChange={e => setAmount(e.target.value)} autoFocus />
            {rec.remaining > 0 && (
              <button onClick={() => setAmount(String(rec.remaining))}
                className={`px-4 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold ${tx2} bg-white dark:bg-zinc-800 whitespace-nowrap hover:border-zinc-400 transition-colors`}>
                全額
              </button>
            )}
          </div>
        </Field>
        <Field label="日期"><DatePicker value={date} onChange={setDate} /></Field>
        <Btn onClick={() => { const v = toN(amount); if (!v || v <= 0) return alert("請輸入金額"); onSave({ date, amount: v }); }}>
          確認{label}
        </Btn>
      </div>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════════
// RECORD CARD
// ═══════════════════════════════════════════════════════════════
function RecordCard({ rec, onSelect, onAction }) {
  const isR = rec.kind === KIND.R;

  const actionLabel = (() => {
    if (isR  && rec.remaining > 0)             return "入帳";
    if (!isR && rec.stage === STAGE.WAITING)   return "填寫實際花費";
    if (!isR && rec.stage === STAGE.SETTLING && rec.iOwe) return "繳回";
    if (!isR && rec.stage === STAGE.SETTLING && !rec.iOwe) return "補款";
    return null;
  })();

  const focal = (() => {
    if (isR) return { label: rec.remaining > 0 ? "剩餘未收" : "已完成", value: fmt(rec.remaining > 0 ? rec.remaining : rec.amount) };
    switch (rec.stage) {
      case STAGE.WAITING:  return { label: "等待填寫實際花費", value: "" };
      case STAGE.SETTLING: return { label: rec.iOwe ? "需繳回" : "公司補我", value: fmt(rec.absDiff) };
      case STAGE.DONE:     return { label: "已完成結算", value: "✓" };
      default:             return { label: fmt(rec.amount), value: "" };
    }
  })();

  return (
    <div className={`rounded-3xl overflow-hidden ${card} hover:shadow-md transition-all cursor-pointer`}
      onClick={() => onSelect(rec.id)}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <KindPill kind={rec.kind} />
            <span className={`text-xs ${tx3}`}>{fmtD(rec.date)}</span>
          </div>
          <div className={`font-semibold text-sm leading-snug ${tx}`}>{rec.title}</div>
          {rec.note && <div className={`text-xs ${tx3} mt-0.5 truncate`}>{rec.note}</div>}
        </div>
        <StatusDot status={rec.status} />
      </div>

      {/* Body */}
      <div className="px-4 pb-3 flex items-center gap-4">
        {!isR && <div className="shrink-0 py-1"><Timeline rec={rec} compact /></div>}
        <div className={isR ? "ml-auto text-right" : ""}>
          {focal.label && <div className={`text-[10px] font-medium uppercase tracking-wide ${tx3}`}>{focal.label}</div>}
          {focal.value && <div className={`text-lg font-bold mt-0.5 ${tx}`}>{focal.value}</div>}
        </div>
      </div>

      {/* Action strip — always visible, low-key */}
      {actionLabel && (
        <div className="px-4 pb-4"
          onClick={e => { e.stopPropagation(); onAction(rec.id); }}>
          <div className={`py-2 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-600 text-center text-xs font-semibold ${tx2} hover:border-zinc-500 dark:hover:border-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-all`}>
            + {actionLabel}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DETAIL PAGE
// ═══════════════════════════════════════════════════════════════
function DetailPage({ recId, records, dispatch, onBack, user }) {
  const [sheet, setSheet] = useState(null);
  const rec = records.find(r => r.id === recId);
  if (!rec) { onBack(); return null; }
  const isR = rec.kind === KIND.R;

  const ctaLabel = (() => {
    if (isR)                                           return rec.remaining > 0 ? "入帳" : null;
    if (rec.stage === STAGE.WAITING)                   return "填寫實際花費";
    if (rec.stage === STAGE.SETTLING && rec.iOwe)      return "新增繳回";
    if (rec.stage === STAGE.SETTLING && !rec.iOwe)     return "新增補款";
    return null;
  })();

  const handleCta = () => {
    if (isR)                             return setSheet("pay");
    if (rec.stage === STAGE.WAITING)     return setSheet("settle");
    if (rec.stage === STAGE.SETTLING)    return setSheet("pay");
  };

  return (
    <div className={`min-h-screen ${page}`} style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="max-w-lg mx-auto px-4 pt-4 pb-28">

        {/* Nav */}
        <div className={`sticky top-0 z-20 ${page} pt-2 pb-4 flex items-center justify-between`}>
          <button onClick={onBack} className={`flex items-center gap-2 text-sm font-medium ${tx2} hover:${tx} transition-colors`}>
            {I.back} 返回
          </button>
          <div className="flex gap-2">
            <button onClick={() => setSheet("edit")}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold ${tx2} bg-white dark:bg-zinc-900 hover:border-zinc-400 transition-colors`}>
              {I.edit} 編輯
            </button>
            <button onClick={() => setSheet("del")}
              className={`p-2 rounded-xl border border-zinc-100 dark:border-zinc-800 ${tx3} hover:border-red-200 hover:text-red-500 bg-white dark:bg-zinc-900 transition-colors`}>
              {I.trash}
            </button>
          </div>
        </div>

        {/* Title card */}
        <div className={`rounded-3xl ${card} p-5 mb-4 shadow-sm`}>
          <div className="flex items-center gap-2 mb-3 flex-wrap"><KindPill kind={rec.kind} /><StatusDot status={rec.status} /></div>
          <h1 className={`text-2xl font-bold leading-tight mb-2 ${tx}`}>{rec.title}</h1>
          <div className={`flex items-center gap-1.5 text-xs ${tx3}`}>{I.clock} {fmtD(rec.date)}</div>
          {rec.note && <p className={`mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 text-sm ${tx2}`}>{rec.note}</p>}
        </div>

        {/* Amounts */}
        {isR ? (
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[{ l: "應收金額", v: fmt(rec.amount) }, { l: "已入帳", v: fmt(rec.paid) }, { l: "剩餘", v: fmt(rec.remaining) }].map(({ l, v }) => (
              <div key={l} className={`rounded-2xl ${card} p-3.5`}>
                <div className={`text-xs ${tx3} mb-1`}>{l}</div>
                <div className={`text-lg font-bold ${tx}`}>{v}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3 mb-4">
            <div className={`rounded-3xl ${card} p-5`}>
              <p className={`text-xs font-bold uppercase tracking-wider ${tx3} mb-4`}>預支流程</p>
              <div className="flex gap-5">
                <div className="shrink-0"><Timeline rec={rec} /></div>
                <div className="flex flex-col gap-2 flex-1">
                  <div className={`rounded-2xl ${card2} p-3`}>
                    <div className={`text-[10px] uppercase tracking-wide ${tx3} mb-0.5`}>核定預算</div>
                    <div className={`text-base font-bold ${tx}`}>{fmt(rec.amount)}</div>
                  </div>
                  {toN(rec.advanceReceived) > 0 && (
                    <div className={`rounded-2xl ${card2} p-3`}>
                      <div className={`text-[10px] uppercase tracking-wide ${tx3} mb-0.5`}>已領預支</div>
                      <div className={`text-base font-bold ${tx}`}>{fmt(rec.advanceReceived)}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {rec.actualSpent > 0 && (
              <div className={`rounded-3xl ${card} p-5`}>
                <p className={`text-xs font-bold uppercase tracking-wider ${tx3} mb-3`}>結算結果</p>
                <div className="flex flex-col gap-2">
                  <div className={`rounded-2xl ${card2} p-3`}>
                    <div className={`text-[10px] uppercase tracking-wide ${tx3} mb-0.5`}>實際花費</div>
                    <div className={`text-base font-bold ${tx}`}>{fmt(rec.actualSpent)}</div>
                  </div>
                  <div className={`rounded-2xl ${card2} p-3`}>
                    <div className={`text-[10px] uppercase tracking-wide ${tx3} mb-0.5`}>{rec.iOwe ? "需繳回公司" : "公司補我"}</div>
                    <div className={`text-base font-bold ${tx}`}>{fmt(rec.absDiff)}</div>
                  </div>
                  {rec.remaining > 0 && (
                    <div className={`rounded-2xl ${card2} p-3`}>
                      <div className={`text-[10px] uppercase tracking-wide ${tx3} mb-0.5`}>剩餘未處理</div>
                      <div className={`text-base font-bold ${tx}`}>{fmt(rec.remaining)}</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* CTA */}
        {ctaLabel && (
          <div className="bg-zinc-900 dark:bg-white rounded-3xl p-5 mb-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-white/50 dark:text-zinc-500 mb-1">
                {isR ? "剩餘未入帳" : rec.stage === STAGE.SETTLING ? "剩餘未處理" : "下一步"}
              </div>
              {(isR || rec.stage === STAGE.SETTLING) && <div className="text-2xl font-bold text-white dark:text-zinc-900">{fmt(rec.remaining)}</div>}
              {rec.stage === STAGE.WAITING && <div className="text-sm font-semibold text-white dark:text-zinc-900">活動結束了嗎？</div>}
            </div>
            <button onClick={handleCta}
              className="flex items-center gap-1.5 px-5 py-3 rounded-2xl bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white text-sm font-bold hover:opacity-90 active:scale-95 transition-all">
              {I.plus} {ctaLabel}
            </button>
          </div>
        )}

        {rec.status === "完成" && (
          <div className={`rounded-3xl ${card} p-5 mb-4 flex items-center gap-3`}>
            <div className={`w-9 h-9 rounded-full ${card2} flex items-center justify-center shrink-0 ${tx}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div><div className={`font-bold text-sm ${tx}`}>完成</div><div className={`text-xs ${tx3} mt-0.5`}>所有款項已處理完畢</div></div>
          </div>
        )}

        {/* Payment history */}
        {rec.pr.length > 0 && (
          <div className={`rounded-3xl ${card} p-5`}>
            <p className={`text-xs font-bold uppercase tracking-wider ${tx3} mb-4`}>入帳紀錄</p>
            <div className={`flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800`}>
              {rec.pr.map((r, i) => (
                <div key={i} className="flex items-center justify-between py-3">
                  <div className={`flex items-center gap-2 text-xs ${tx3}`}>{I.clock} {fmtD(r.date)}</div>
                  <span className={`text-sm font-bold ${tx}`}>{fmt(r.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sheets */}
      {sheet === "edit" && (
        <RecordSheet initial={rec} user={user}
          onSave={f => { dispatch({ type: "UPDATE", payload: derive({ ...strip(rec), ...strip(buildRaw(f, user?.id)) }) }); setSheet(null); }}
          onClose={() => setSheet(null)} />
      )}
      {sheet === "settle" && (
        <SettleSheet rec={rec}
          onSave={({ actualSpent, settlementDate }) => { dispatch({ type: "UPDATE", payload: derive({ ...strip(rec), actualSpent, settlementDate }) }); setSheet(null); }}
          onClose={() => setSheet(null)} />
      )}
      {sheet === "pay" && rec.remaining > 0 && (
        <PaymentSheet rec={rec}
          onSave={p => { dispatch({ type: "UPDATE", payload: derive({ ...strip(rec), paymentRecords: [...rec.pr, p] }) }); setSheet(null); }}
          onClose={() => setSheet(null)} />
      )}
      {sheet === "del" && (
        <Sheet title="清掉這筆" onClose={() => setSheet(null)}>
          <div className="flex flex-col gap-6">
            <p className={`text-sm ${tx2}`}>確定要清掉「<strong>{rec.title}</strong>」嗎？無法復原。</p>
            <div className="flex gap-3">
              <Btn variant="ghost" className="flex-1" onClick={() => setSheet(null)}>取消</Btn>
              <button onClick={() => dispatch({ type: "DELETE", payload: rec.id })}
                className="flex-1 py-4 rounded-2xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition-colors">清掉</button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
function MainApp() {
  const [records, setRecords] = useState(() => storage.loadRecords().map(derive));
  const [selId,   setSelId]   = useState(null);
  const [sheet,   setSheet]   = useState(null);  // "add"|"login"|"account"|"filter"
  const [quickId, setQuickId] = useState(null);
  const [search,  setSearch]  = useState("");
  const [fStatus, setFStatus] = useState("全部");
  const [fKind,   setFKind]   = useState("全部");
  const [sort,    setSort]    = useState("date_desc");
  const [user,    setUser]    = useState(() => storage.getUser());
  const [guestDismissed, setGuestDismissed] = useState(() => storage.getGuestDismissed());

  const dispatch = useCallback((action) => {
    setRecords(prev => {
      let next;
      if      (action.type === "ADD")    next = [action.payload, ...prev];
      else if (action.type === "UPDATE") next = prev.map(r => r.id === action.payload.id ? action.payload : r);
      else if (action.type === "DELETE") { next = prev.filter(r => r.id !== action.payload); setSelId(null); }
      else next = prev;
      storage.saveRecords(next.map(strip));
      return next;
    });
  }, []);

  const login  = (u) => { setUser(u); storage.saveUser(u); setSheet(null); };
  const logout = () => { setUser(null); storage.logout(); };

  const dismissGuest = () => { storage.setGuestDismissed(); setGuestDismissed(true); };

  // Only show records belonging to current user or guest records (no userId)
  const visible = useMemo(() =>
    records.filter(r => !r.userId || !user || r.userId === user.id),
    [records, user]
  );

  const stats = useMemo(() => ({
    owed:    visible.filter(r => r.kind === KIND.R).reduce((s, r) => s + r.remaining, 0),
    pending: visible.filter(r => r.status !== "完成").length,
    total:   visible.length,
  }), [visible]);

  const filtered = useMemo(() => visible
    .filter(r => {
      if (fStatus !== "全部" && r.status !== fStatus) return false;
      if (fKind   !== "全部" && r.kind   !== fKind)   return false;
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

  // Quick action type from card strip
  const quickRec  = quickId ? records.find(r => r.id === quickId) : null;
  const quickType = (() => {
    if (!quickRec) return null;
    if (quickRec.kind === KIND.R && quickRec.remaining > 0)         return "pay";
    if (quickRec.stage === STAGE.WAITING)                            return "settle";
    if (quickRec.stage === STAGE.SETTLING && quickRec.remaining > 0) return "pay";
    return null;
  })();

  if (selId) return (
    <DetailPage recId={selId} records={records} dispatch={dispatch} onBack={() => setSelId(null)} user={user} />
  );

  return (
    <div className={`min-h-screen ${page} font-sans`} style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="max-w-lg mx-auto">

        {/* HEADER */}
        <div className={`sticky top-0 z-30 ${page} px-4 pt-3 pb-3`}>
          {/* Row 1: brand + avatar */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-zinc-900 dark:bg-white flex items-center justify-center shrink-0">
                <span className="text-white dark:text-zinc-900 font-bold text-sm leading-none">還</span>
              </div>
              <div>
                <div className={`text-base font-bold leading-tight ${tx}`}>HaiBack｜還袂</div>
                <div className={`text-[11px] leading-none ${tx3}`}>你這裡欠我的，用什麼還？</div>
              </div>
            </div>
            <button onClick={() => setSheet(user ? "account" : "login")}
              className="w-9 h-9 rounded-full bg-zinc-900 dark:bg-white flex items-center justify-center hover:opacity-80 transition-opacity">
              {user
                ? <span className="text-white dark:text-zinc-900 font-bold text-sm">{user.username?.[0]?.toUpperCase()}</span>
                : <span className="text-white dark:text-zinc-900">{I.user}</span>
              }
            </button>
          </div>

          {/* Row 2: search + filter toggle */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${tx3}`}>{I.search}</span>
              <input
                className={`w-full pl-10 pr-4 py-2.5 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm ${tx} focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-500`}
                placeholder="搜尋紀錄…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button onClick={() => setSheet(s => s === "filter" ? null : "filter")}
              className={`w-10 h-10 flex items-center justify-center rounded-2xl border transition-all shrink-0 ${
                sheet === "filter" || hasFilter
                  ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-zinc-900 dark:border-white"
                  : `bg-white dark:bg-zinc-900 ${tx3} border-zinc-200 dark:border-zinc-700 hover:border-zinc-400`
              }`}>
              {I.filter}
            </button>
          </div>

          {/* Filter panel */}
          {sheet === "filter" && (
            <div className={`mt-2 rounded-2xl overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800 ${card}`}>
              {[
                ["狀態", ["全部", "處理中", "完成"],                                         fStatus, setFStatus],
                ["類型", [["全部","全部"], [KIND.R,"報銷款"], [KIND.A,"預支款"]],             fKind,   setFKind],
                ["排序", [["date_desc","最新"],["date_asc","最舊"],["amount_desc","金額↓"],["amount_asc","金額↑"]], sort, setSort],
              ].map(([label, opts, val, setter]) => (
                <div key={label} className="flex items-center gap-3 px-3 py-2.5">
                  <span className={`text-xs ${tx3} w-8 shrink-0`}>{label}</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {opts.map(o => {
                      const v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
                      return (
                        <button key={v} onClick={() => setter(v)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${val === v ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-zinc-900 dark:border-white" : `bg-white dark:bg-zinc-800 ${tx2} border-zinc-200 dark:border-zinc-700 hover:border-zinc-400`}`}>
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

        {/* STATS */}
        <div className="px-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-900 dark:bg-white rounded-3xl px-4 py-4">
              <div className="text-xs font-medium uppercase tracking-wide text-white/50 dark:text-zinc-500 mb-1">待回收</div>
              <div className="text-2xl font-bold tracking-tight text-white dark:text-zinc-900">{fmt(stats.owed)}</div>
              <div className="text-xs text-white/40 dark:text-zinc-500 mt-1">報銷款剩餘</div>
            </div>
            <div className={`rounded-3xl px-4 py-4 ${card}`}>
              <div className={`text-xs font-medium uppercase tracking-wide ${tx3} mb-1`}>處理中</div>
              <div className={`text-2xl font-bold tracking-tight ${tx}`}>{stats.pending}</div>
              <div className={`text-xs ${tx3} mt-1`}>共 {stats.total} 筆</div>
            </div>
          </div>

          {/* Guest notice */}
          {!user && !guestDismissed && (
            <div className={`mt-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800 px-4 py-3 flex items-start gap-3`}>
              <p className={`text-xs flex-1 leading-relaxed ${tx2}`}>
                目前為訪客模式，資料僅儲存在此裝置。若清除瀏覽資料、換手機或重裝 App，紀錄可能遺失。
                <button onClick={() => setSheet("login")} className={`ml-1 underline underline-offset-2 font-semibold ${tx}`}>登入帳號</button>可保留資料。
              </p>
              <button onClick={dismissGuest} className={`text-xs ${tx3} hover:opacity-60 shrink-0 mt-0.5`}>✕</button>
            </div>
          )}
        </div>

        {/* LIST */}
        <div className="px-4 pb-32">
          {filtered.length === 0 ? (
            <div className="text-center py-24">
              <div className="text-5xl mb-4">📋</div>
              <div className={`text-sm font-semibold ${tx2} mb-1`}>
                {search || hasFilter ? "沒有符合的紀錄" : "你這裡欠我的，用什麼還？"}
              </div>
              {!search && !hasFilter && <p className={`text-xs ${tx3}`}>點右下角 + 開始記帳</p>}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filtered.map(r => <RecordCard key={r.id} rec={r} onSelect={setSelId} onAction={setQuickId} />)}
            </div>
          )}
        </div>
      </div>

      {/* FAB */}
      <button onClick={() => setSheet("add")}
        style={{ bottom: "max(1.5rem, env(safe-area-inset-bottom, 1.5rem))" }}
        className="fixed right-5 z-40 w-14 h-14 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-full shadow-2xl flex items-center justify-center hover:opacity-90 active:scale-95 transition-all">
        {I.plus}
      </button>

      {/* SHEETS */}
      {sheet === "add"     && <RecordSheet user={user} onSave={f => { dispatch({ type: "ADD", payload: derive(buildRaw(f, user?.id)) }); setSheet(null); }} onClose={() => setSheet(null)} />}
      {sheet === "login"   && <LoginSheet onClose={() => setSheet(null)} onLogin={login} />}
      {sheet === "account" && <AccountSheet user={user} onLogout={logout} onClose={() => setSheet(null)} />}

      {/* Quick actions from card strips */}
      {quickRec && quickType === "settle" && (
        <SettleSheet rec={quickRec}
          onSave={({ actualSpent, settlementDate }) => { dispatch({ type: "UPDATE", payload: derive({ ...strip(quickRec), actualSpent, settlementDate }) }); setQuickId(null); }}
          onClose={() => setQuickId(null)} />
      )}
      {quickRec && quickType === "pay" && (
        <PaymentSheet rec={quickRec}
          onSave={p => { dispatch({ type: "UPDATE", payload: derive({ ...strip(quickRec), paymentRecords: [...quickRec.pr, p] }) }); setQuickId(null); }}
          onClose={() => setQuickId(null)} />
      )}
    </div>
  );
}

export default function App() {
  return <ThemeProvider><MainApp /></ThemeProvider>;
}
