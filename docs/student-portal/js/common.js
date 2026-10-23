// 生徒用ページと先生用ページで共通の小物

export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// ページのファイル名（index / admin）。確認用のお試しページ（_demo_*.html）は config の pages で差し替える
export const page = name => (window.PORTAL_CONFIG?.pages || {})[name] || `${name}.html`;

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

// ---------- 操作がないときの自動ログアウト ----------
// minutes 分のあいだ操作（クリック・キー入力・スクロール・タップ）がなければ onTimeout を呼ぶ。
// 切れる2分前に「まもなくログアウトします」と知らせ、「続ける」で延長できる。
// 最後の操作の時刻はタブの中（sessionStorage）に置くので、同じタブでページを移っても引き継がれる。
const IDLE_KEY = "portal-last-active";
let idleTimer = null;
export function startIdleLogout(minutes, onTimeout) {
  stopIdleLogout();
  const limit = minutes * 60 * 1000, warnAt = limit - 2 * 60 * 1000;
  const mark = () => { try { sessionStorage.setItem(IDLE_KEY, String(Date.now())); } catch {} };
  const last = () => { try { return Number(sessionStorage.getItem(IDLE_KEY)) || Date.now(); } catch { return Date.now(); } };
  mark();
  let bar = null;
  const hideBar = () => { bar?.remove(); bar = null; };
  const onActivity = () => { if (!bar) mark(); };  // 警告が出ているあいだは「続ける」を押したときだけ延長
  const events = ["pointerdown", "keydown", "scroll", "touchstart", "wheel"];
  events.forEach(ev => window.addEventListener(ev, onActivity, { passive: true, capture: true }));
  const check = () => {
    const idle = Date.now() - last();
    if (idle >= limit) { stopIdleLogout(); hideBar(); onTimeout(); return; }
    if (idle >= warnAt && !bar) {
      bar = document.createElement("div");
      bar.className = "idle-warn";
      bar.setAttribute("role", "alertdialog");
      bar.innerHTML = '<span>しばらく操作がないため、まもなく自動でログアウトします。</span><button type="button" class="btn btn-sm">ログインを続ける</button>';
      bar.querySelector("button").addEventListener("click", () => { mark(); hideBar(); });
      document.body.append(bar);
    }
  };
  document.addEventListener("visibilitychange", check);
  idleTimer = { id: setInterval(check, 15000), events, onActivity, check, hideBar };
}
export function stopIdleLogout() {
  if (!idleTimer) return;
  clearInterval(idleTimer.id);
  idleTimer.events.forEach(ev => window.removeEventListener(ev, idleTimer.onActivity, { capture: true }));
  document.removeEventListener("visibilitychange", idleTimer.check);
  idleTimer.hideBar();
  idleTimer = null;
}

export function errMsg(e) {
  return (e && (e.message || e.error_description)) || "エラーが発生しました。時間をおいてもう一度お試しください。";
}

// ---------- 年間予定（Term Spring〜Winter × Week 1〜10 ＋ Term Assessment・Final Assessment） ----------
// supabase/schema.sql の week_info と同じ数え方。cal = { years: [{id, start_date}], holidays: [{week_start, note, carry_days}] }
// 年度の「Term Spring Week 1 の週」から、休みでない週を順に数える（全42週）。
//   1〜10週目 Spring、11〜20週目 Summer、21週目 Term Assessment、22〜31週目 Autumn、32〜41週目 Winter、42週目 Final Assessment。
// 内部のターム記号は A〜D（A=Spring, B=Summer, C=Autumn, D=Winter）。Assessment の記号は直前のターム（B・D）。
export const TERMS = ["A", "B", "C", "D"];
export const TERM_NAMES = { A: "Spring", B: "Summer", C: "Autumn", D: "Winter" };
export const termName = t => `Term ${TERM_NAMES[t] || t}`;
export const TEST_TERMS = ["B", "D"];
// テスト結果の4段階（先生が得点を見て選ぶ）。基準（range）は画面の説明文に書き、結果の欄にはアルファベットだけを出す
export const TEST_LEVELS = [
  { level: "S", range: "90%以上" }, { level: "A", range: "70%以上90%未満" },
  { level: "B", range: "50%以上70%未満" }, { level: "C", range: "50%未満" },
];
export const testName = t => (t === "B" ? "Term Assessment" : t === "D" ? "Final Assessment" : `Assessment ${t}`);

function currentYear(m, cal) {
  return [...(cal.years || [])]
    .filter(y => mondayOf(y.start_date) <= m)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
}

// その日が何年度のどのターム・どの週か。
// 休みの週の carry_days の曜日（例：GW の木・金）は前の週の授業として数え、その前の週の同じ曜日は休みにする
export function weekInfo(date, cal) {
  const m = mondayOf(date), d = dow(date);
  const hols = cal.holidays || [];
  if (hols.some(h => h.week_start === m && (h.carry_days || []).includes(d))) return weekOf(addDays(date, -7), cal);
  const next = hols.find(h => h.week_start === addDays(m, 7) && (h.carry_days || []).includes(d));
  if (next) return { year: weekOf(date, cal).year, kind: "holiday", note: next.note || "" };
  return weekOf(date, cal);
}

// その日が年間予定の休みなら、その名前（名前がなければ「お休み」）。休みでなければ null
export function holidayOn(date, cal) {
  const m = mondayOf(date), d = dow(date);
  for (const h of cal.holidays || []) {
    const carry = h.carry_days || [];
    if (h.week_start === m && !carry.includes(d)) return h.note || "お休み";
    if (h.week_start === addDays(m, 7) && carry.includes(d)) return h.note || "お休み";
  }
  return null;
}

// 週単位のターム・週（休みの週は holiday）
function weekOf(date, cal) {
  const m = mondayOf(date);
  const y = currentYear(m, cal);
  if (!y) return { kind: "off" };
  const hol = new Map((cal.holidays || []).map(h => [h.week_start, h.note]));
  if (hol.has(m)) return { year: y.id, kind: "holiday", note: hol.get(m) || "" };
  let idx = 0;
  for (let w = mondayOf(y.start_date); w < m; w = addDays(w, 7)) if (!hol.has(w)) idx++;
  if (idx >= 42) return { year: y.id, kind: "off" };
  if (idx === 20) return { year: y.id, kind: "test", term: "B" };
  if (idx === 41) return { year: y.id, kind: "test", term: "D" };
  const lessonNo = idx < 20 ? idx : idx - 1;   // Assessment の週を除いた授業週の通し番号（0〜39）
  return { year: y.id, kind: "lesson", term: TERMS[Math.floor(lessonNo / 10)], week: lessonNo % 10 + 1 };
}

export function weekLabel(info) {
  if (!info) return "";
  if (info.kind === "lesson") return `${termName(info.term)} · Week ${info.week}`;
  if (info.kind === "test") return testName(info.term);
  if (info.kind === "holiday") return `お休み${info.note ? `（${info.note}）` : ""}`;
  return "";
}

// ある年度の全週（Term Spring Week 1 の週から Final Assessment まで。間の休みの週も含む）
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
