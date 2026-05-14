import { useState, useMemo } from "react";

// ─── Types & Constants ────────────────────────────────────────────────────────
const STATUS = { UNSETTLED: "還未", PARTIAL: "還一半", SETTLED: "清了" };
const TYPE_REIMBURSE = "報銷型（Reimbursement）";
const TYPE_ADVANCE   = "預支結算型（Advance Settlement）";
const TYPE_EXPENSE   = "一般支出（Expense）";
const TYPES = [TYPE_REIMBURSE, TYPE_ADVANCE, TYPE_EXPENSE];

const TYPE_LABELS = {
  [TYPE_REIMBURSE]: "報銷型",
  [TYPE_ADVANCE]:   "預支結算",
  [TYPE_EXPENSE]:   "一般支出",
};

const statusColors = {
  [STATUS.UNSETTLED]: { bg: "bg-zinc-100",  text: "text-zinc-500",    dot: "bg-zinc-400" },
  [STATUS.PARTIAL]:   { bg: "bg-amber-50",   text: "text-amber-600",   dot: "bg-amber-400" },
  [STATUS.SETTLED]:   { bg: "bg-emerald-50", text: "text-emerald-600", dot: "bg-emerald-400" },
};

// ─── Pure Helpers ─────────────────────────────────────────────────────────────
const newId = () => Math.random().toString(36).slice(2, 10);
const fmt   = (n) => `$${Number(n || 0).toLocaleString()}`;
const today = () => new Date().toISOString().slice(0, 10);

const computeShouldReceive = (type, advancedByMe, prepayReceived) => {
  if (type === TYPE_REIMBURSE) return Math.max(advancedByMe, 0);
  if (type === TYPE_ADVANCE)   return Math.max(advancedByMe - prepayReceived, 0);
  if (type === TYPE_EXPENSE)   return 0;
  return 0;
};

const computeStatus = (shouldReceive, repaidAmount) => {
  if (shouldReceive === 0)           return STATUS.SETTLED;
  if (repaidAmount <= 0)             return STATUS.UNSETTLED;
  if (repaidAmount >= shouldReceive) return STATUS.SETTLED;
  return STATUS.PARTIAL;
};

/**
 * enrichTransaction — adds derived fields to a raw (stored) record.
 * Migrates legacy repayDates → repayRecords on read.
 * shouldReceive, status, remaining are NEVER stored — always computed here.
 */
const enrichTransaction = (raw) => {
  const repayRecords = raw.repayRecords
    ?? (raw.repayDates || []).map(d => ({ date: d, amount: null }));

  const repaidAmount    = raw.repaidAmount ?? repayRecords.reduce((s, r) => s + (r.amount || 0), 0);
  const prepayReceived  = raw.type === TYPE_ADVANCE ? (raw.prepayReceived || 0) : 0;
  const shouldReceive   = computeShouldReceive(raw.type, raw.advancedByMe || 0, prepayReceived);
  const status          = computeStatus(shouldReceive, repaidAmount);

  return {
    id:             raw.id,
    type:           raw.type  || TYPE_REIMBURSE,
    title:          raw.title || "",
    date:           raw.date  || today(),
    advancedByMe:   raw.advancedByMe || 0,
    prepayReceived,
    note:           raw.note  || "",
    repayRecords,
    repaidAmount,
    // derived — computed, not stored
    shouldReceive,
    status,
    remaining: Math.max(shouldReceive - repaidAmount, 0),
  };
};

/** Strip derived fields → only primitives go to localStorage */
const toStorable = (enriched) => ({
  id:             enriched.id,
  type:           enriched.type,
  title:          enriched.title,
  date:           enriched.date,
  advancedByMe:   enriched.advancedByMe,
  prepayReceived: enriched.prepayReceived,
  note:           enriched.note,
  repayRecords:   enriched.repayRecords,
  repaidAmount:   enriched.repaidAmount,
});

/** Build a new raw record from form fields */
const createRaw = (fields) => ({
  id:             fields.id || newId(),
  type:           fields.type           || TYPE_REIMBURSE,
  title:          fields.title          || "",
  date:           fields.date           || today(),
  advancedByMe:   Number(fields.advancedByMe)  || 0,
  prepayReceived: fields.type === TYPE_ADVANCE ? (Number(fields.prepayReceived) || 0) : 0,
  note:           fields.note           || "",
  repayRecords:   fields.repayRecords   || [],
  repaidAmount:   fields.repaidAmount   || 0,
});

// ─── Storage ──────────────────────────────────────────────────────────────────
const STORAGE_KEY = "owetrack_v1";

const loadData = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    return raw.map(enrichTransaction);
  } catch { return []; }
};

const saveData = (enrichedList) =>
  localStorage.setItem(STORAGE_KEY, JSON.stringify(enrichedList.map(toStorable)));

// ─── Icons ────────────────────────────────────────────────────────────────────
const Icon = {
  plus:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M12 5v14M5 12h14"/></svg>,
  back:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>,
  edit:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  trash:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>,
  search:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><circle cx={11} cy={11} r={8}/><path d="M21 21l-4.35-4.35"/></svg>,
  wallet:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><rect x={1} y={4} width={22} height={16} rx={2}/><path d="M1 10h22"/></svg>,
  coin:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><circle cx={12} cy={12} r={10}/><path d="M12 6v2M12 16v2M9 12h6"/></svg>,
  check:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><polyline points="20 6 9 17 4 12"/></svg>,
  clock:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><circle cx={12} cy={12} r={10}/><polyline points="12 6 12 12 16 14"/></svg>,
  sort:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M3 6h18M7 12h10M11 18h2"/></svg>,
  sliders: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>,
  receipt: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z"/><path d="M9 7h6M9 11h6M9 15h4"/></svg>,
};

// ─── UI Components ────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub }) {
  return (
    <div className="rounded-2xl p-5 flex flex-col gap-1 bg-white border border-zinc-100">
      <div className="flex items-center gap-2 text-zinc-400 mb-1">
        {icon}
        <span className="text-xs font-medium tracking-wide uppercase">{label}</span>
      </div>
      <div className="text-2xl font-bold text-zinc-900 tracking-tight">{value}</div>
      {sub && <div className="text-xs text-zinc-400">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }) {
  const c = statusColors[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {status}
    </span>
  );
}

function TypeTag({ type }) {
  const colors =
    type === TYPE_REIMBURSE ? "bg-blue-50 text-blue-600" :
    type === TYPE_ADVANCE   ? "bg-purple-50 text-purple-600" :
                              "bg-zinc-100 text-zinc-500";
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors}`}>
      {TYPE_LABELS[type] || type}
    </span>
  );
}

// ─── Modal Shell ──────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-zinc-100">
          <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-100 text-zinc-400 text-lg transition-colors">×</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">{label}</label>
      {children}
      {hint && <span className="text-xs text-zinc-400">{hint}</span>}
    </div>
  );
}

const inputCls = "w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400 bg-zinc-50 transition-all";

// ─── Add / Edit Modal ─────────────────────────────────────────────────────────
// Receives enriched `initial`; calls onSave(rawFields) — caller does the enrich
function TransactionModal({ initial, onSave, onClose }) {
  const [form, setForm] = useState({
    type:           initial?.type           ?? TYPE_REIMBURSE,
    title:          initial?.title          ?? "",
    date:           initial?.date           ?? today(),
    advancedByMe:   initial?.advancedByMe   ?? "",
    prepayReceived: initial?.prepayReceived ?? "",
    note:           initial?.note           ?? "",
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const adv           = Number(form.advancedByMe)  || 0;
  const pre           = form.type === TYPE_ADVANCE ? (Number(form.prepayReceived) || 0) : 0;
  const shouldReceive = computeShouldReceive(form.type, adv, pre);

  const handleSave = () => {
    if (!form.title.trim()) return alert("請輸入標題");
    onSave({
      id:           initial?.id,
      repayRecords: initial?.repayRecords ?? [],
      repaidAmount: initial?.repaidAmount ?? 0,
      ...form,
    });
  };

  const typeDesc = {
    [TYPE_REIMBURSE]: "全額報帳・車馬費・差旅費",
    [TYPE_ADVANCE]:   "活動・專案・結算差額",
    [TYPE_EXPENSE]:   "純支出・不回收",
  };

  return (
    <Modal title={initial ? "編輯紀錄" : "新增墊付"} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label="類型">
          <div className="flex flex-col gap-2">
            {TYPES.map(t => (
              <button key={t} onClick={() => set("type", t)}
                className={`w-full px-3 py-2.5 rounded-xl text-left border transition-all ${
                  form.type === t
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-zinc-50 text-zinc-600 border-zinc-200 hover:border-zinc-400"
                }`}>
                <div className="text-sm font-medium">{TYPE_LABELS[t]}</div>
                <div className="text-xs mt-0.5 text-zinc-400">{typeDesc[t]}</div>
              </button>
            ))}
          </div>
        </Field>

        <Field label="標題">
          <input className={inputCls} placeholder="e.g. 11月差旅費"
            value={form.title} onChange={e => set("title", e.target.value)} />
        </Field>

        <Field label="日期">
          <input type="date" className={inputCls}
            value={form.date} onChange={e => set("date", e.target.value)} />
        </Field>

        <div className={`grid gap-3 ${form.type === TYPE_ADVANCE ? "grid-cols-2" : "grid-cols-1"}`}>
          <Field label="我墊付 ($)">
            <input type="number" className={inputCls} placeholder="0"
              value={form.advancedByMe} onChange={e => set("advancedByMe", e.target.value)}
              disabled={form.type === TYPE_EXPENSE} />
          </Field>
          {form.type === TYPE_ADVANCE && (
            <Field label="預支金額 ($)">
              <input type="number" className={inputCls} placeholder="0"
                value={form.prepayReceived} onChange={e => set("prepayReceived", e.target.value)} />
            </Field>
          )}
        </div>

        <div className="rounded-xl bg-zinc-50 border border-zinc-100 px-4 py-3 flex justify-between items-center">
          <span className="text-sm text-zinc-500">應收金額</span>
          <span className={`text-lg font-bold ${form.type === TYPE_EXPENSE ? "text-zinc-400" : "text-zinc-900"}`}>
            {form.type === TYPE_EXPENSE ? "不回收" : fmt(shouldReceive)}
          </span>
        </div>

        <Field label="備註">
          <textarea className={`${inputCls} resize-none`} rows={2} placeholder="選填"
            value={form.note} onChange={e => set("note", e.target.value)} />
        </Field>

        <button onClick={handleSave}
          className="w-full py-3 rounded-xl bg-zinc-900 text-white font-medium text-sm hover:bg-zinc-800 active:bg-zinc-700 transition-colors mt-1">
          {initial ? "儲存修改" : "記一筆"}
        </button>
      </div>
    </Modal>
  );
}

// ─── Repay Modal ──────────────────────────────────────────────────────────────
// Receives enriched tx; calls onSave({ repayRecords, repaidAmount }) — primitive delta only
function RepayModal({ tx, onSave, onClose }) {
  const [amount, setAmount] = useState("");
  const [date,   setDate]   = useState(today());

  const handleSave = () => {
    const n = Number(amount);
    if (!n || n <= 0) return alert("請輸入入帳金額");
    onSave({
      repayRecords: [...tx.repayRecords, { date, amount: n }],
      repaidAmount: tx.repaidAmount + n,
    });
  };

  return (
    <Modal title="還錢" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="rounded-xl bg-amber-50 border border-amber-100 p-4">
          <div className="text-xs text-amber-600 font-medium mb-1">{tx.title}</div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-500">應收</span>
            <span className="font-semibold">{fmt(tx.shouldReceive)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-500">已入帳</span>
            <span className="font-semibold text-emerald-600">{fmt(tx.repaidAmount)}</span>
          </div>
          <div className="flex justify-between text-sm border-t border-amber-100 mt-2 pt-2">
            <span className="text-zinc-500">剩餘</span>
            <span className="font-bold text-amber-600">{fmt(tx.remaining)}</span>
          </div>
        </div>

        <Field label="入帳金額 ($)">
          <div className="flex gap-2">
            <input type="number" className={inputCls} placeholder="輸入金額"
              value={amount} onChange={e => setAmount(e.target.value)} autoFocus />
            <button onClick={() => setAmount(String(tx.remaining))}
              className="px-3 py-2.5 rounded-xl border border-zinc-200 text-xs text-zinc-600 whitespace-nowrap hover:border-zinc-400 transition-colors bg-zinc-50">
              全額
            </button>
          </div>
        </Field>

        <Field label="入帳日期">
          <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
        </Field>

        <button onClick={handleSave}
          className="w-full py-3 rounded-xl bg-emerald-600 text-white font-medium text-sm hover:bg-emerald-700 transition-colors">
          確認還錢
        </button>
      </div>
    </Modal>
  );
}

// ─── Transaction Card ─────────────────────────────────────────────────────────
function TransactionCard({ tx, onSelect, onRepay }) {
  return (
    <div className="bg-white rounded-2xl border border-zinc-100 p-4 hover:border-zinc-300 hover:shadow-sm transition-all cursor-pointer group"
      onClick={() => onSelect(tx.id)}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <TypeTag type={tx.type} />
            <span className="text-xs text-zinc-400">{tx.date}</span>
          </div>
          <div className="font-semibold text-zinc-900 text-sm leading-tight truncate">{tx.title}</div>
        </div>
        <StatusBadge status={tx.status} />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-zinc-50 p-2.5">
          <div className="text-xs text-zinc-400 mb-0.5">墊付</div>
          <div className="text-sm font-semibold text-zinc-700">{fmt(tx.advancedByMe)}</div>
        </div>
        <div className="rounded-xl bg-zinc-50 p-2.5">
          <div className="text-xs text-zinc-400 mb-0.5">已入帳</div>
          <div className="text-sm font-semibold text-emerald-600">{fmt(tx.repaidAmount)}</div>
        </div>
        <div className="rounded-xl bg-zinc-50 p-2.5">
          <div className="text-xs text-zinc-400 mb-0.5">剩餘</div>
          <div className={`text-sm font-semibold ${tx.remaining > 0 ? "text-amber-600" : "text-zinc-400"}`}>{fmt(tx.remaining)}</div>
        </div>
      </div>

      {tx.status !== STATUS.SETTLED && (
        <button
          onClick={(e) => { e.stopPropagation(); onRepay(tx.id); }}
          className="mt-3 w-full py-2 rounded-xl border border-dashed border-emerald-300 text-emerald-600 text-xs font-medium hover:bg-emerald-50 transition-colors opacity-0 group-hover:opacity-100">
          + 還錢
        </button>
      )}
    </div>
  );
}

// ─── Detail Page ──────────────────────────────────────────────────────────────
// Receives txId — always reads fresh from transactions (no stale object)
function DetailPage({ txId, transactions, dispatch, onBack }) {
  const [showEdit,      setShowEdit]      = useState(false);
  const [showRepay,     setShowRepay]     = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const tx = transactions.find(t => t.id === txId);
  if (!tx) { onBack(); return null; }

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="max-w-lg mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button onClick={onBack} className="flex items-center gap-2 text-zinc-500 hover:text-zinc-900 transition-colors text-sm font-medium">
            {Icon.back} 返回
          </button>
          <div className="flex gap-2">
            <button onClick={() => setShowEdit(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 text-zinc-600 text-xs font-medium hover:border-zinc-400 transition-colors bg-white">
              {Icon.edit} 編輯
            </button>
            <button onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-100 text-red-400 text-xs font-medium hover:border-red-300 hover:text-red-600 transition-colors bg-white">
              {Icon.trash}
            </button>
          </div>
        </div>

        {/* Title Card */}
        <div className="bg-white rounded-3xl border border-zinc-100 p-6 mb-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <TypeTag type={tx.type} />
            <StatusBadge status={tx.status} />
          </div>
          <h1 className="text-2xl font-bold text-zinc-900 mb-1">{tx.title}</h1>
          <div className="text-sm text-zinc-400 flex items-center gap-1.5">{Icon.clock} {tx.date}</div>
          {tx.note && (
            <div className="mt-3 pt-3 border-t border-zinc-100 text-sm text-zinc-500">{tx.note}</div>
          )}
        </div>

        {/* Amount Cards */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-white rounded-2xl border border-zinc-100 p-4">
            <div className="text-xs text-zinc-400 mb-1">我墊付</div>
            <div className="text-xl font-bold text-zinc-900">{fmt(tx.advancedByMe)}</div>
          </div>
          {tx.type === TYPE_ADVANCE && (
            <div className="bg-white rounded-2xl border border-zinc-100 p-4">
              <div className="text-xs text-zinc-400 mb-1">預支金額</div>
              <div className="text-xl font-bold text-zinc-500">{fmt(tx.prepayReceived)}</div>
            </div>
          )}
          <div className="bg-white rounded-2xl border border-zinc-100 p-4">
            <div className="text-xs text-zinc-400 mb-1">應收金額</div>
            <div className="text-xl font-bold text-zinc-900">
              {tx.type === TYPE_EXPENSE
                ? <span className="text-zinc-400 text-base font-medium">不回收</span>
                : fmt(tx.shouldReceive)}
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-zinc-100 p-4">
            <div className="text-xs text-zinc-400 mb-1">已入帳</div>
            <div className="text-xl font-bold text-emerald-600">{fmt(tx.repaidAmount)}</div>
          </div>
        </div>

        {/* Remaining / Settled banner */}
        {tx.type !== TYPE_EXPENSE && tx.status !== STATUS.SETTLED ? (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 mb-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-amber-600 font-medium mb-0.5">尚未入帳</div>
              <div className="text-2xl font-bold text-amber-700">{fmt(tx.remaining)}</div>
            </div>
            <button onClick={() => setShowRepay(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition-colors">
              {Icon.plus} 還錢
            </button>
          </div>
        ) : (
          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 mb-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
              {Icon.check}
            </div>
            <div>
              <div className="font-semibold text-emerald-700">
                {tx.type === TYPE_EXPENSE ? "純支出紀錄" : "已完全結清"}
              </div>
              <div className="text-xs text-emerald-500">
                {tx.type === TYPE_EXPENSE ? "此筆不回收" : "所有款項已入帳"}
              </div>
            </div>
          </div>
        )}

        {/* Repay History — repayRecords with amount */}
        {tx.repayRecords.length > 0 && (
          <div className="bg-white rounded-2xl border border-zinc-100 p-4">
            <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-3">入帳紀錄</div>
            <div className="flex flex-col gap-2">
              {tx.repayRecords.map((r, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-zinc-50 last:border-0">
                  <div className="flex items-center gap-2 text-zinc-400 text-xs">
                    {Icon.clock} {r.date}
                  </div>
                  <div className="flex items-center gap-2">
                    {r.amount != null && (
                      <span className="text-sm font-semibold text-emerald-600">{fmt(r.amount)}</span>
                    )}
                    <span className="text-xs text-zinc-300">#{i + 1}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showEdit && (
        <TransactionModal
          initial={tx}
          onSave={(fields) => {
            dispatch({ type: "UPDATE", payload: enrichTransaction(createRaw(fields)) });
            setShowEdit(false);
          }}
          onClose={() => setShowEdit(false)}
        />
      )}

      {showRepay && (
        <RepayModal
          tx={tx}
          onSave={(delta) => {
            dispatch({ type: "UPDATE", payload: enrichTransaction({ ...toStorable(tx), ...delta }) });
            setShowRepay(false);
          }}
          onClose={() => setShowRepay(false)}
        />
      )}

      {confirmDelete && (
        <Modal title="確認刪除" onClose={() => setConfirmDelete(false)}>
          <p className="text-sm text-zinc-600 mb-5">確定要刪除「{tx.title}」嗎？此動作無法復原。</p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmDelete(false)}
              className="flex-1 py-2.5 rounded-xl border border-zinc-200 text-sm text-zinc-600 hover:border-zinc-400 transition-colors">取消</button>
            <button onClick={() => dispatch({ type: "DELETE", payload: tx.id })}
              className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors">清掉</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [transactions, setTransactions] = useState(() => loadData());
  const [selectedTxId, setSelectedTxId] = useState(null);
  const [showAdd,      setShowAdd]      = useState(false);
  const [repayTxId,    setRepayTxId]    = useState(null);
  const [search,       setSearch]       = useState("");
  const [filterStatus, setFilterStatus] = useState("全部");
  const [filterType,   setFilterType]   = useState("全部");
  const [sort,         setSort]         = useState("date_desc");
  const [showAdvFilter, setShowAdvFilter] = useState(false);

  /** Central dispatch — single source of truth for all mutations + storage */
  const dispatch = (action) => {
    setTransactions(prev => {
      let next;
      switch (action.type) {
        case "ADD":
          next = [action.payload, ...prev]; break;
        case "UPDATE":
          next = prev.map(t => t.id === action.payload.id ? action.payload : t); break;
        case "DELETE":
          next = prev.filter(t => t.id !== action.payload);
          setSelectedTxId(null); break;
        default:
          next = prev;
      }
      saveData(next);
      return next;
    });
  };

  // ── Memoised stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    totalDebt:      transactions.reduce((s, t) => s + t.remaining, 0),
    totalAdvanced:  transactions.reduce((s, t) => s + t.advancedByMe, 0),
    totalRepaid:    transactions.reduce((s, t) => s + t.repaidAmount, 0),
    unsettledCount: transactions.filter(t => t.status !== STATUS.SETTLED).length,
  }), [transactions]);

  // ── Memoised filter + sort ──────────────────────────────────────────────────
  const filtered = useMemo(() =>
    transactions
      .filter(t => {
        if (filterStatus !== "全部" && t.status !== filterStatus) return false;
        if (filterType   !== "全部" && t.type   !== filterType)   return false;
        if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === "date_desc")   return b.date.localeCompare(a.date);
        if (sort === "date_asc")    return a.date.localeCompare(b.date);
        if (sort === "amount_desc") return b.advancedByMe - a.advancedByMe;
        if (sort === "amount_asc")  return a.advancedByMe - b.advancedByMe;
        return 0;
      }),
    [transactions, filterStatus, filterType, search, sort]
  );

  const repayTx = repayTxId ? transactions.find(t => t.id === repayTxId) : null;

  // ── Detail view ─────────────────────────────────────────────────────────────
  if (selectedTxId) {
    return (
      <DetailPage
        txId={selectedTxId}
        transactions={transactions}
        dispatch={dispatch}
        onBack={() => setSelectedTxId(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 font-sans">
      <div className="max-w-lg mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-zinc-900 flex items-center justify-center">
                <span className="text-white text-xs font-bold">還</span>
              </div>
              <h1 className="text-xl font-bold text-zinc-900 tracking-tight">還帳</h1>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5 ml-9">公司墊付款項追蹤 · Hái帳</p>
          </div>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 active:scale-95 transition-all shadow-sm">
            {Icon.plus} 記一筆
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="col-span-2 rounded-2xl bg-zinc-900 text-white p-5 flex items-center justify-between">
            <div>
              <div className="text-xs text-zinc-400 font-medium uppercase tracking-wide mb-1">總欠款</div>
              <div className="text-3xl font-bold tracking-tight">{fmt(stats.totalDebt)}</div>
              <div className="text-xs text-zinc-400 mt-1">{stats.unsettledCount} 筆未結清</div>
            </div>
            <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-zinc-300">
              {Icon.wallet}
            </div>
          </div>
          <StatCard icon={Icon.receipt} label="總墊付" value={fmt(stats.totalAdvanced)} />
          <StatCard icon={Icon.coin} label="已回收" value={fmt(stats.totalRepaid)}
            sub={stats.totalAdvanced > 0 ? `回收率 ${Math.round(stats.totalRepaid / stats.totalAdvanced * 100)}%` : undefined} />
        </div>

        {/* Search + Filter bar */}
        <div className="flex flex-col gap-2 mb-4">
          {/* Search row */}
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">{Icon.search}</span>
            <input
              className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-zinc-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400 transition-all"
              placeholder="搜尋標題…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          {/* Status row + advanced toggle */}
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5 flex-1 flex-wrap">
              {["全部", STATUS.UNSETTLED, STATUS.PARTIAL, STATUS.SETTLED].map(s => (
                <button key={s} onClick={() => setFilterStatus(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                    filterStatus === s
                      ? "bg-zinc-900 text-white border-zinc-900"
                      : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400"
                  }`}>{s}</button>
              ))}
            </div>
            {/* Advanced filter toggle */}
            <button
              onClick={() => setShowAdvFilter(f => !f)}
              className={`flex items-center justify-center w-9 h-9 rounded-xl border transition-all shrink-0 ${
                showAdvFilter || filterType !== "全部" || sort !== "date_desc"
                  ? "bg-zinc-900 text-white border-zinc-900"
                  : "bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400"
              }`}
              title="進階篩選">
              {Icon.sliders}
            </button>
          </div>

          {/* Advanced panel */}
          {showAdvFilter && (
            <div className="bg-white border border-zinc-100 rounded-2xl divide-y divide-zinc-50 animate-in">
              <div className="flex items-center gap-3 px-3 py-2.5">
                <span className="text-xs text-zinc-400 w-8 shrink-0">類型</span>
                <div className="flex gap-1.5 flex-wrap">
                  {["全部", ...TYPES].map(t => (
                    <button key={t} onClick={() => setFilterType(t)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                        filterType === t
                          ? "bg-zinc-900 text-white border-zinc-900"
                          : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400"
                      }`}>{TYPE_LABELS[t] || t}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3 px-3 py-2.5">
                <span className="text-xs text-zinc-400 w-8 shrink-0">排序</span>
                <div className="flex gap-1.5 flex-wrap">
                  {[["date_desc","最新"], ["date_asc","最舊"], ["amount_desc","金額↓"], ["amount_asc","金額↑"]].map(([v, l]) => (
                    <button key={v} onClick={() => setSort(v)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                        sort === v
                          ? "bg-zinc-900 text-white border-zinc-900"
                          : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400"
                      }`}>{l}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-zinc-400">
            <div className="text-4xl mb-3">📋</div>
            <div className="text-sm font-medium">
              {search || filterStatus !== "全部" || filterType !== "全部" ? "沒有符合的紀錄" : "還沒有任何紀錄"}
            </div>
            {!search && filterStatus === "全部" && filterType === "全部" && (
              <button onClick={() => setShowAdd(true)}
                className="mt-3 text-zinc-900 text-xs underline underline-offset-2">記第一筆</button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map(tx => (
              <TransactionCard key={tx.id} tx={tx}
                onSelect={setSelectedTxId}
                onRepay={setRepayTxId} />
            ))}
          </div>
        )}

        <div className="h-8" />
      </div>

      {/* Add Modal */}
      {showAdd && (
        <TransactionModal
          onSave={(fields) => {
            dispatch({ type: "ADD", payload: enrichTransaction(createRaw(fields)) });
            setShowAdd(false);
          }}
          onClose={() => setShowAdd(false)}
        />
      )}

      {/* Quick Repay (from list card) */}
      {repayTx && (
        <RepayModal
          tx={repayTx}
          onSave={(delta) => {
            dispatch({ type: "UPDATE", payload: enrichTransaction({ ...toStorable(repayTx), ...delta }) });
            setRepayTxId(null);
          }}
          onClose={() => setRepayTxId(null)}
        />
      )}
    </div>
  );
}

export default function App() {
  