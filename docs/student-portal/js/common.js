// 生徒用ページと先生用ページで共通の小物

export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// "2026-10-20" ⇔ Date（ローカル時刻の0時）
export function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function toDateStr(dt) {
  const p = n => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}
export function addDays(s, n) {
  const dt = parseDate(s);
  dt.setDate(dt.getDate() + n);
  return toDateStr(dt);
}
export function todayStr() {
  return toDateStr(new Date());
}
export function dow(s) {
  return parseDate(s).getDay();
}
// その週の月曜日
export function mondayOf(s) {
  const d = dow(s);
  return addDays(s, d === 0 ? -6 : 1 - d);
}
export function fmtDate(s) {
  const dt = parseDate(s);
  return `${dt.getMonth() + 1}/${dt.getDate()}（${WEEKDAYS[dt.getDay()]}）`;
}
export function fmtTime(t) {
  return t ? t.slice(0, 5) : "";
}

export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function toast(msg, ng = false) {
  document.querySelectorAll(".toast").forEach(e => e.remove());
  const el = document.createElement("div");
  el.className = "toast" + (ng ? " ng" : "");
  el.setAttribute("role", "status");
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}

export function errMsg(e) {
  return (e && (e.message || e.error_description)) || "エラーが発生しました。時間をおいてもう一度お試しください。";
}

// ---------- 年間予定（Term A〜D × Week 1〜10 ＋ 各タームの Test Week） ----------
// supabase/schema.sql の week_info と同じ数え方。cal = { years: [{id, start_date}], holidays: [{week_start, note}] }
// 年度の「Term A Week 1 の週」から、休みでない週を順に数える。Week 1〜10 の次の週がそのタームの Test Week。
export const TERMS = ["A", "B", "C", "D"];

function currentYear(m, cal) {
  return [...(cal.years || [])]
    .filter(y => mondayOf(y.start_date) <= m)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
}

export function weekInfo(date, cal) {
  const m = mondayOf(date);
  const y = currentYear(m, cal);
  if (!y) return { kind: "off" };
  const hol = new Map((cal.holidays || []).map(h => [h.week_start, h.note]));
  if (hol.has(m)) return { year: y.id, kind: "holiday", note: hol.get(m) || "" };
  let idx = 0;
  for (let w = mondayOf(y.start_date); w < m; w = addDays(w, 7)) if (!hol.has(w)) idx++;
  if (idx >= 44) return { year: y.id, kind: "off" };
  const term = TERMS[Math.floor(idx / 11)], pos = idx % 11;
  return pos < 10 ? { year: y.id, kind: "lesson", term, week: pos + 1 } : { year: y.id, kind: "test", term };
}

export function weekLabel(info) {
  if (!info) return "";
  if (info.kind === "lesson") return `Term ${info.term} · Week ${info.week}`;
  if (info.kind === "test") return `Test Week · Term ${info.term}`;
  if (info.kind === "holiday") return `お休み${info.note ? `（${info.note}）` : ""}`;
  return "";
}

// ある年度の全週（Term A Week 1 の週から Term D の Test Week まで。間の休みの週も含む）
export function yearPlan(yearId, cal) {
  const y = (cal.years || []).find(x => x.id === yearId);
  if (!y) return [];
  const out = [];
  for (let w = mondayOf(y.start_date), guard = 0; guard < 120; w = addDays(w, 7), guard++) {
    const info = weekInfo(w, cal);
    if (info.year !== yearId || info.kind === "off") break;
    out.push({ week_start: w, ...info });
  }
  return out;
}
