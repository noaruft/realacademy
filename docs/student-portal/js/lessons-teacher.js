// 個人レッスン（専用コース）：先生のページ（管理者はチケットの配布と全体の予約も）
import { createApi } from "./api.js?v=f7684c6f";
import { errMsg, esc, page, startIdleLogout, stopIdleLogout, toast } from "./common.js?v=f7684c6f";
import { createLessonApi } from "./lesson-api.js?v=f7684c6f";
import { createChat } from "./lesson-chat.js?v=f7684c6f";
import { FIRST_HOUR, LAST_HOUR, PHASE_TAG, PROFILE_FIELDS, ZOOM_OPEN_MINUTES, addDaysJ, fmtDay, fmtWhen,
  fmtUk, jst, jstIso, jstToday, mondayJ, ms, phase, phaseLabel, uk, ukStatus } from "./lesson-common.js?v=f7684c6f";

const IDLE_MINUTES = 120;  // 先生：操作がないと120分で自動ログアウト
const $ = id => document.getElementById(id);
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const md = date => { const [, m, d] = date.split("-").map(Number); return `${m}/${d}`; };

const api = await createApi();
if (api.demo) $("demoBar").hidden = false;

let me = null;
let L = null;
let isTeacher = false, isManager = false;
let teacher = null;      // 自分（先生）の情報
let tab = "lessons";
let tMonth = jstToday().slice(0, 7);  // 日ごとの調整：表示している月
let tDay = jstToday();                // 日ごとの調整：選んでいる日
let weeklySaved = null;               // 毎週の空き時間：反映済みのもの（"曜日|時" の Set）
let weeklyDraft = null;               // 毎週の空き時間：画面で選んでいるもの（反映を押すまで生徒には見えない）
let weeklyAllHours = false;           // 毎週の空き時間：深夜・早朝（0:00〜6:00）の行も出すか
let chat = null;

// ---------- タブ ----------
function showTab(name) {
  const ok = [...document.querySelectorAll("[data-tab]")].filter(b => !b.hidden).map(b => b.dataset.tab);
  if (!ok.includes(name)) name = ok[0];
  tab = name;
  for (const b of document.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  for (const p of document.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== name;
  history.replaceState(null, "", "#" + name);
  renderTab();
}
for (const b of document.querySelectorAll("[data-tab]")) b.addEventListener("click", () => showTab(b.dataset.tab));

// ---------- 起動 ----------
async function start() {
  me = await api.me().catch(() => null);
  const lf = me?.lesson;
  if (!me || !lf || !(lf.teacher || lf.manager) || !["lesson", "admin"].includes(me.role)) {
    location.href = page("index");
    return;
  }
  isTeacher = lf.teacher;
  isManager = lf.manager;
  L = await createLessonApi();
  $("whoName").textContent = lf.name;
  if (me.role === "admin") { $("scholarsLink").href = page("admin"); $("scholarsLink").hidden = false; }
  $("heroSub").textContent = isTeacher ? "個人レッスン（先生用）" : "個人レッスン（管理）";
  for (const b of document.querySelectorAll("[data-tab]")) b.hidden = b.dataset.for === "teacher" ? !isTeacher : !isManager;
  $("headerUser").hidden = false;
  $("loading").hidden = true;
  $("app").hidden = false;
  startIdleLogout(IDLE_MINUTES, async () => {
    await api.signOut();
    location.replace(page("index") + "?timeout=1");
  });
  if (isTeacher) {
    teacher = await L.myTeacher();
    chat = createChat(L, $("chatRoot"), {
      side: "teacher", title: n => n + " さん",
      lockedNote: "この生徒とはまだ予約がないため、こちらからは送れません（生徒から届いたメッセージは読めます）。",
      onUnread: n => { $("unreadBadge").hidden = !n; $("unreadBadge").textContent = n; },
    });
  }
  if (isTeacher) applyTz();
  showTab(location.hash.slice(1));
  if (chat) await chat.refresh();
  let timer;
  L.subscribe(() => { clearTimeout(timer); timer = setTimeout(refresh, 200); });
  setInterval(() => { if (tab === "lessons") renderTab(); if (isUk()) renderUkBar(); }, 60e3);
}

async function refresh() {
  await renderTab();
  if (chat) await chat.refresh();
}

function renderTab() {
  if (tab === "lessons") return renderLessons();
  if (tab === "slots") return renderAvail();
  if (tab === "profile") return $("profileForm") ? undefined : renderProfile();
  if (tab === "tickets") return renderTickets();
  if (tab === "all") return renderAll();
}

// ---------- レッスン（自分の予約） ----------
async function renderLessons() {
  const list = await L.teacherBookings();
  const live = ["open", "locked", "live"];
  const up = list.filter(b => live.includes(phase(b)));
  const past = list.filter(b => !live.includes(phase(b))).reverse();
  const byDay = new Map();
  for (const b of up) {
    const d = jst(b.starts_at).date;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(b);
  }
  $("tUpcoming").innerHTML = byDay.size ? [...byDay].map(([d, l]) => `
    <div class="week">
      <div class="week-head"><span>${esc(fmtDay(d))}${d === jstToday() ? "　<b>今日</b>" : ""}</span><span>${l.length} 件</span></div>
      ${l.map(b => tLessonRow(b)).join("")}
    </div>`).join("") : `<div class="card muted">予約はまだありません。「空き時間」で予約できる時間を設定してください。</div>`;
  $("tPast").innerHTML = past.length ? past.map(b => tLessonRow(b, true)).join("") : `<p class="muted">まだありません。</p>`;
  $("tPastBox").hidden = !past.length;
}

function tLessonRow(b, withDate = false) {
  const ph = phase(b);
  const j = jst(b.starts_at), e = jst(new Date(ms(b.starts_at) + 3600e3).toISOString());
  const time = `${j.hour}:00〜${e.hour}:00`;
  const acts = [];
  if (ph === "live") acts.push(teacher?.zoom_url ? `<a class="btn btn-sm zoom-btn" href="${esc(teacher.zoom_url)}" target="_blank" rel="noopener">Zoom を開く</a>`
    : `<span class="muted">Zoom のリンクが未登録です</span>`);
  if (["open", "locked", "live"].includes(ph)) {
    acts.push(`<button class="btn-text" type="button" data-msg="${esc(b.student_id)}">メッセージ</button>`);
    acts.push(`<button class="btn btn-line btn-sm" type="button" data-tcancel="${b.id}">キャンセル</button>`);
  }
  const label = phaseLabel(b);
  const notes = [];
  if (ph === "teacher_cancelled" && b.cancel_note) notes.push(`理由：${esc(b.cancel_note)}`);
  if (ph === "open") notes.push(`開始${ZOOM_OPEN_MINUTES}分前に「Zoom を開く」が出ます`);
  return `
    <div class="lesson ${["cancelled", "teacher_cancelled"].includes(ph) ? "is-off" : ""}">
      <div>
        <div class="when">${withDate ? esc(fmtWhen(b.starts_at)) : time}<small>JST</small>${isUk() ? `<span class="uk-time">${esc(fmtUk(b.starts_at, true))}</span>` : ""}</div>
        <div class="sub">${esc(b.student_name)} さん　<span class="tag ${PHASE_TAG[ph]}">${esc(label)}</span></div>
        ${notes.length ? `<div class="sub">${notes.join("<br>")}</div>` : ""}
      </div>
      <div class="actions">${acts.join("")}</div>
    </div>`;
}

let cancelTarget = null;
document.addEventListener("click", async e => {
  const m = e.target.closest("[data-msg]");
  if (m) { showTab("chat"); chat.open(m.dataset.msg); return; }
  const c = e.target.closest("[data-tcancel]");
  if (c) {
    const list = tab === "all" ? await L.allBookings() : await L.teacherBookings();
    cancelTarget = list.find(b => String(b.id) === c.dataset.tcancel);
    if (!cancelTarget) return;
    $("cancelWhat").innerHTML = `<b>${esc(fmtWhen(cancelTarget.starts_at))} JST</b>　${esc(cancelTarget.student_name)} さん` +
      (cancelTarget.teacher_name ? `（${esc(cancelTarget.teacher_name)}）` : "");
    $("cancelForm").reset();
    $("cancelDlg").showModal();
  }
});
$("cancelDlg").addEventListener("close", async () => {
  if ($("cancelDlg").returnValue !== "ok" || !cancelTarget) return;
  const note = $("cancelForm").note.value;
  const b = cancelTarget;
  cancelTarget = null;
  try {
    await L.teacherCancel(b.id, note);
    toast("キャンセルしました。生徒にチケットを1枚戻しました");
  } catch (err) {
    toast(errMsg(err), true);
  }
  renderTab();
});

// ---------- 空き時間：毎週の型＋カレンダーで日ごとの調整 ----------
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];  // 月曜はじまり
const hourList = () => Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i);
const monthAdd = (ym, n) => { const [y, m] = ym.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`; };
const monthEnd = ym => addDaysJ(monthAdd(ym, 1) + "-01", -1);

async function renderAvail() {
  const minM = jstToday().slice(0, 7), maxM = monthAdd(minM, 3);
  if (tMonth < minM) tMonth = minM;
  if (tMonth > maxM) tMonth = maxM;
  const from = mondayJ(tMonth + "-01"), to = addDaysJ(mondayJ(monthEnd(tMonth)), 6);
  const [weekly, days] = await Promise.all([L.weekly(), L.teacherDays(from < tDay ? from : tDay, to > tDay ? to : tDay)]);
  renderWeekly(weekly);
  renderDayCal(days, minM, maxM);
}

// ---------- イギリス時間 ----------
// 毎週の空き時間・予約は日本時間で扱う。先生の画面には、イギリス時間も添えて夏時間・冬時間を知らせる
const isUk = () => isTeacher;
function applyTz() {
  for (const el of document.querySelectorAll("[data-uk]")) el.hidden = !isUk();
  if (isUk()) renderUkBar(); else $("ukBar").hidden = true;
}
const zoneText = u => (u.summer ? `夏時間（BST）・日本との時差 ${u.diff}時間` : `冬時間（GMT）・日本との時差 ${u.diff}時間`);
// その日（日本時間の正午）のイギリスの時間帯
const dayZone = d => zoneText(uk(jstIso(d, 12)));
// その日にイギリスの夏時間・冬時間が切り替わるなら「冬時間（GMT）」などを返す
function dstSwitch(d) {
  const a = uk(jstIso(addDaysJ(d, -1), 12)), b = uk(jstIso(d, 12));
  return a.summer !== b.summer ? (b.summer ? "夏時間（BST）" : "冬時間（GMT）") : "";
}
// 画面上部のお知らせ：いま夏時間か冬時間か、次はいつ切り替わるか
function renderUkBar() {
  const st = ukStatus();
  const n = st.next;
  const days = n ? Math.round((new Date(n.date + "T12:00:00Z") - new Date(jstToday() + "T12:00:00Z")) / 864e5) : null;
  $("ukBar").innerHTML = `<span class="uk-now ${st.summer ? "summer" : "winter"}">${st.summer ? "夏時間" : "冬時間"}</span>
    <span>イギリスはいま <b>${zoneText(st)}</b>（自動で切り替わります）。</span>
    ${n ? `<span class="${days <= 14 ? "uk-soon" : ""}">${md(n.date)}（${WD[new Date(n.date + "T12:00:00Z").getUTCDay()]}）から${n.summer ? "夏時間（BST）・時差 8時間" : "冬時間（GMT）・時差 9時間"}になります${days <= 14 ? `（あと${days}日）` : ""}。毎週の空き時間（日本時間）は、イギリス時間では1時間${n.summer ? "遅く" : "早く"}なります。</span>` : ""}`;
  $("ukBar").hidden = false;
}

// 毎週の空き時間（曜日×時刻の表）。マスを押しても下書きが変わるだけで、「反映」を押すと保存される
const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
const weeklyDirty = () => weeklyDraft && weeklySaved && !sameSet(weeklyDraft, weeklySaved);
function renderWeekly(weekly) {
  if (weekly) {
    weeklySaved = new Set(weekly.map(w => `${w.weekday}|${w.hour}`));
    if (!weeklyDirty()) weeklyDraft = new Set(weeklySaved);  // 下書きの途中なら、そのまま残す
  }
  const on = weeklyDraft;
  const dirty = weeklyDirty();
  $("weeklyCount").textContent = `反映中：毎週 ${weeklySaved.size} 枠`;
  $("weeklyFlag").hidden = !dirty;
  if (dirty) $("weeklyBox").open = true;
  $("weeklyApply").disabled = !dirty;
  $("weeklyUndo").hidden = !dirty;
  $("weeklyState").textContent = dirty ? "まだ反映していない変更があります" : "";
  $("weeklyBar").classList.toggle("dirty", dirty);
  // 行・曜日とも日本時間。いつもの 7:00〜23:00 と、ほかに設定のある時間（深夜・早朝はボタンで出す）
  const used = h => WEEK_ORDER.some(w => on.has(`${w}|${h}`) || weeklySaved.has(`${w}|${h}`));
  const nightRows = Array.from({ length: FIRST_HOUR }, (_, h) => h).filter(h => !used(h)).length;
  const hours = Array.from({ length: 24 }, (_, h) => h).filter(h => h >= FIRST_HOUR || weeklyAllHours || used(h));
  // イギリス時間を小さく添える（来週の時差で）
  const nextWeek = uk(new Date(Date.now() + 7 * 864e5).toISOString());
  const ukOf = h => { const u = h - nextWeek.diff; return `${(u + 24) % 24}:00${u < 0 ? "<i>前日</i>" : ""}`; };
  $("weeklyUkNote").innerHTML = "曜日と時刻は日本時間です。" +
    (isUk() ? `小さい数字は来週のイギリス時間（${nextWeek.summer ? "夏時間 BST・時差 8時間" : "冬時間 GMT・時差 9時間"}）。` : "") +
    (nightRows ? ` <button class="btn-text" type="button" id="weeklyAllBtn">${weeklyAllHours ? "深夜・早朝の行を隠す" : `深夜・早朝（0:00〜${FIRST_HOUR - 1}:00）の行も出す`}</button>` : "");
  let html = `<thead><tr><th class="hr">JST${isUk() ? "<small>UK</small>" : ""}</th>${WEEK_ORDER.map(w => `<th>${WD[w]}</th>`).join("")}</tr></thead><tbody>`;
  for (const h of hours) {
    html += `<tr class="${h < FIRST_HOUR ? "night" : ""}"><th class="hr">${h}:00${isUk() ? `<small>${ukOf(h)}</small>` : ""}</th>` +
      WEEK_ORDER.map(w => weeklyCell(w, h, `${h}:00〜${h + 1}:00`)).join("") + "</tr>";
  }
  $("weeklyGrid").innerHTML = html + "</tbody>";
}
// 表のマス（空きは色だけで示す。変えたマスは枠で示す）
function weeklyCell(w, h, label) {
  const k = `${w}|${h}`, o = weeklyDraft.has(k), changed = o !== weeklySaved.has(k);
  return `<td><button class="cell ${o ? "open" : "none"}${changed ? " changed" : ""}" type="button" data-wk="${k}" aria-pressed="${o}"
    aria-label="毎週${WD[w]}曜 ${label}"></button></td>`;
}
// マスを押すと切り替わる。マウスで押したままなぞると、なぞったマスを同じ状態（空き／なし）にそろえる
let paint = null;  // なぞっている間：true=空きにする / false=外す
let lastPointer = "";  // 最後に押した道具（マウスで押したときは、続く click では何もしない）
function paintCell(c) {
  const k = c.dataset.wk;
  if (paint) weeklyDraft.add(k); else weeklyDraft.delete(k);
  const changed = paint !== weeklySaved.has(k);
  c.className = `cell ${paint ? "open" : "none"}${changed ? " changed" : ""}`;
  c.setAttribute("aria-pressed", String(paint));
}
$("weeklyGrid").addEventListener("pointerdown", e => {
  const c = e.target.closest("[data-wk]");
  lastPointer = e.pointerType;
  if (!c || e.pointerType !== "mouse" || e.button !== 0) return;  // スマホは1マスずつ（なぞるとページが動くように）
  e.preventDefault();
  paint = !weeklyDraft.has(c.dataset.wk);
  paintCell(c);
});
$("weeklyGrid").addEventListener("pointerover", e => {
  const c = paint !== null && e.target.closest("[data-wk]");
  if (c) paintCell(c);
});
document.addEventListener("pointerup", () => {
  if (paint === null) return;
  paint = null;
  renderWeekly();
});
// スマホで押したとき・キーボード（Enter・スペース）で押したとき
$("weeklyGrid").addEventListener("click", e => {
  const c = e.target.closest("[data-wk]");
  if (!c) return;
  if (e.detail !== 0 && lastPointer === "mouse") return;
  const k = c.dataset.wk;
  if (weeklyDraft.has(k)) weeklyDraft.delete(k); else weeklyDraft.add(k);
  renderWeekly();
});
$("weeklyUkNote").addEventListener("click", e => {
  if (!e.target.closest("#weeklyAllBtn")) return;
  weeklyAllHours = !weeklyAllHours;
  renderWeekly();
});
$("weeklyUndo").addEventListener("click", () => { weeklyDraft = new Set(weeklySaved); renderWeekly(); });
$("weeklyApply").addEventListener("click", async () => {
  const add = [...weeklyDraft].filter(k => !weeklySaved.has(k)).length, del = [...weeklySaved].filter(k => !weeklyDraft.has(k)).length;
  if (!await ask("毎週の空き時間を反映しますか？",
    `<p>${add ? `追加 ${add} 枠` : ""}${add && del ? "・" : ""}${del ? `取り消し ${del} 枠` : ""}。反映すると、生徒の予約画面にすぐ表示されます。</p>
     <p class="muted">すでに入っている予約はそのまま残ります。カレンダーで「この日だけ」変えた日も、その設定のままです。</p>`, "反映する")) return;
  $("weeklyApply").disabled = true;
  try {
    await L.saveWeekly([...weeklyDraft].map(k => { const [weekday, hour] = k.split("|").map(Number); return { weekday, hour }; }));
    weeklySaved = new Set(weeklyDraft);
    toast("毎週の空き時間を反映しました");
  } catch (err) {
    toast(errMsg(err), true);
  }
  renderAvail();
});
// 反映していない変更があるままページを離れようとしたら確かめる
window.addEventListener("beforeunload", e => {
  const pf = document.getElementById("profileForm");
  const profileDirty = pf && teacher && Object.entries(profileNow()).some(([k, v]) => pf[k].value !== v);
  if (weeklyDirty() || profileDirty) { e.preventDefault(); e.returnValue = ""; }
});

// 日ごとの調整（月のカレンダー＋選んだ日の時間）
function renderDayCal(days, minM, maxM) {
  const today = jstToday(), now = Date.now();
  const byDate = new Map();
  for (const x of days) {
    if (!byDate.has(x.date)) byDate.set(x.date, []);
    byDate.get(x.date).push(x);
  }
  const [y, m] = tMonth.split("-").map(Number);
  let rows = "";
  for (let d = mondayJ(tMonth + "-01"); d <= monthEnd(tMonth); ) {
    rows += "<tr>";
    for (let i = 0; i < 7; i++, d = addDaysJ(d, 1)) {
      if (d.slice(0, 7) !== tMonth) { rows += `<td class="out"></td>`; continue; }
      const list = byDate.get(d) || [];
      const open = list.filter(x => x.open && !x.booking && ms(x.starts_at) > now).length;  // これから先の空きだけ数える
      const booked = list.filter(x => x.booking).length;
      const adj = list.some(x => x.adjusted);
      const past = d < today;
      const cls = ["cal-day", "t-day", past ? "past" : "", open || booked ? "has" : "", d === tDay ? "sel" : "", d === today ? "today" : "", adj ? "adj" : ""].filter(Boolean).join(" ");
      const sw = isUk() ? dstSwitch(d) : "";
      rows += `<td><button class="${cls}${sw ? " dst" : ""}" type="button" data-tday="${d}" aria-pressed="${d === tDay}" ${past ? "disabled" : ""}
        ${sw ? `title="この日からイギリスは${sw}"` : ""}>
        <span class="d">${Number(d.slice(8))}</span>${sw ? `<span class="n sw">${sw.slice(0, 3)}</span>` : ""}${open ? `<span class="n">空き${open}</span>` : ""}${booked ? `<span class="n bk">予約${booked}</span>` : ""}</button></td>`;
    }
    rows += "</tr>";
  }
  // 選んだ日の時間
  const sel = new Map((byDate.get(tDay) || []).map(x => [x.hour, x]));
  // いつもの時間帯（日本時間 7:00〜23:00）に、それ以外で空き時間・予約のある時間を足す
  const dayHours = [...new Set([...hourList(), ...sel.keys()])].sort((a, b) => a - b);
  const dayRows = dayHours.map(h => {
    const x = sel.get(h);
    const past = jstIso(tDay, h) <= new Date(now).toISOString();
    const time = `${h}:00〜${h + 1}:00${isUk() ? `<small class="uk-time">${fmtUk(jstIso(tDay, h))}</small>` : ""}`;
    if (x?.booking) {
      return `<li class="day-row"><span class="t">${time}</span><span class="day-booked">予約：${esc(x.booking.student_name)} さん${x.booking.status === "absent" ? "（欠席）" : ""}</span></li>`;
    }
    const open = !!x?.open;
    const note = x?.adjusted ? (open ? `<span class="tag tag-move">この日だけ追加</span>` : `<span class="tag tag-warn">この日だけお休み</span>`) : "";
    return `<li class="day-row${past ? " past" : ""}"><span class="t">${time}</span>
      <button class="day-tog ${open ? "open" : "none"}" type="button" data-th="${h}" data-open="${open}" ${past ? "disabled" : ""}>${open ? "空き" : "なし"}</button>${note}</li>`;
  }).join("");
  const adjusted = (byDate.get(tDay) || []).some(x => x.adjusted && !x.booking);
  $("dayWrap").innerHTML = `
    <div class="cal-wrap">
      <div class="cal">
        <div class="cal-nav">
          <button class="btn btn-line btn-sm" type="button" data-tcal="-1" ${tMonth <= minM ? "disabled" : ""} aria-label="前の月">‹</button>
          <span class="cal-month">${y}年 ${m}月</span>
          <button class="btn btn-line btn-sm" type="button" data-tcal="1" ${tMonth >= maxM ? "disabled" : ""} aria-label="次の月">›</button>
        </div>
        <table class="cal-grid">
          <thead><tr>${WEEK_ORDER.map((w, i) => `<th class="${i === 5 ? "sat" : i === 6 ? "sun" : ""}">${WD[w]}</th>`).join("")}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="cal-legend"><span class="lg has"></span>空き時間のある日　<span class="lg adj"></span>その日だけ変えた日</p>
      </div>
      <div class="cal-times">
        <h4>${esc(fmtDay(tDay))}${isUk() ? `<small>この日のイギリス：${dayZone(tDay)}</small>` : ""}<small>${tDay < today ? "" : "押すと、この日だけ「空き」と「なし」が切り替わります"}</small></h4>
        <ul class="day-list" style="--rows:${Math.ceil(dayHours.length / 2)}">${dayRows}</ul>
        ${tDay >= today ? `<div class="day-acts">
          <button class="btn btn-line btn-sm" type="button" id="closeDayBtn">この日をすべてお休みにする</button>
          ${adjusted ? `<button class="btn-text" type="button" id="resetDayBtn">毎週の空き時間に戻す</button>` : ""}
        </div>` : ""}
      </div>
    </div>`;
}
$("dayWrap").addEventListener("click", async e => {
  const nav = e.target.closest("[data-tcal]"), day = e.target.closest("[data-tday]"), tog = e.target.closest("[data-th]");
  if (nav) { tMonth = monthAdd(tMonth, Number(nav.dataset.tcal)); return renderAvail(); }
  if (day) { tDay = day.dataset.tday; return renderAvail(); }
  try {
    if (tog) {
      tog.disabled = true;
      await L.setDay(tDay, Number(tog.dataset.th), tog.dataset.open !== "true");
    } else if (e.target.closest("#closeDayBtn")) {
      if (!await ask("この日をすべてお休みにしますか？", `<p>${esc(fmtDay(tDay))} の空き時間（予約の入っていないもの）を、この日だけお休みにします。毎週の空き時間は変わりません。</p>`, "お休みにする")) return;
      const n = await L.closeDay(tDay);
      toast(n ? `${n} 枠をお休みにしました` : "お休みにできる空き時間はありません");
    } else if (e.target.closest("#resetDayBtn")) {
      await L.resetDay(tDay);
      toast("毎週の空き時間に戻しました");
    } else return;
  } catch (err) {
    toast(errMsg(err), true);
  }
  renderAvail();
});

// ---------- プロフィール ----------
// 名前・出身・趣味・一言を書いて「反映」すると、生徒の「先生の紹介」に出る（名前は予約やメッセージなど生徒の画面すべてに出る）
const profileNow = () => ({ name: teacher.display_name || "", origin: teacher.origin || "", hobby: teacher.hobby || "", message: teacher.message || "" });
// 入力欄の例（名前の欄には名簿の名前を薄く出す）
const PROFILE_HINT = {
  origin: "例：イギリス・ロンドン",
  hobby: "例：紅茶、サッカー観戦",
  message: "例：はじめての方も、ゆっくり話すところから一緒に練習しましょう。",
};
function renderProfile() {
  const now = profileNow();
  const input = k => {
    const { name, max } = PROFILE_FIELDS[k];
    const ph = k === "name" ? teacher.name : PROFILE_HINT[k];
    return `<label class="field"><span>${name}<small class="muted" data-count="${k}"></small></span>
      ${k === "message"  // 一言は1行に収まらないので2行
        ? `<textarea class="input" name="${k}" rows="2" maxlength="${max}" placeholder="${esc(ph)}">${esc(now[k])}</textarea>`
        : `<input class="input" name="${k}" maxlength="${max}" placeholder="${esc(ph)}" value="${esc(now[k])}">`}
      ${k === "name" ? `<small class="muted">生徒の画面（予約・メッセージ・先生の紹介）に出る名前です。空欄なら名簿の名前（${esc(teacher.name)}）が出ます。</small>` : ""}</label>`;
  };
  $("profileBox").innerHTML = `
    <h3 class="mat-title" style="margin-top:0">プロフィール</h3>
    <form id="profileForm" class="profile-form">
      ${Object.keys(PROFILE_FIELDS).map(input).join("")}
      <div class="weekly-bar" id="profileBar">
        <span class="weekly-state" id="profileState"></span>
        <button class="btn" type="submit" id="profileApply" disabled>反映</button>
      </div>
    </form>
    <dl class="kv">
      <dt>Zoom のリンク</dt><dd>${teacher.zoom_url ? `<a href="${esc(teacher.zoom_url)}" target="_blank" rel="noopener">${esc(teacher.zoom_url)}</a>` : "未登録"}</dd>
      <dt>お知らせメールの送り先</dt><dd>${esc(teacher.email || "未登録")}</dd>
    </dl>
    <p class="muted" style="margin:16px 0 0">プロフィールは、ここで書き換えて「反映」を押すと生徒の画面に表示されます。Zoom のリンク・メールアドレスは教室の名簿で管理しています。変更したいときは教室にお知らせください。Zoom のリンクは、予約した生徒にだけ、開始${ZOOM_OPEN_MINUTES}分前から表示されます。</p>`;
  const f = $("profileForm");
  const sync = () => {
    const was = profileNow();
    const dirty = Object.keys(PROFILE_FIELDS).some(k => f[k].value !== was[k]);
    $("profileApply").disabled = !dirty;
    $("profileState").textContent = dirty ? "まだ反映していない変更があります" : "";
    $("profileBar").classList.toggle("dirty", dirty);
    for (const [k, { max }] of Object.entries(PROFILE_FIELDS)) f.querySelector(`[data-count="${k}"]`).textContent = `${f[k].value.length} / ${max}文字`;
  };
  f.addEventListener("input", sync);
  f.addEventListener("submit", async e => {
    e.preventDefault();
    $("profileApply").disabled = true;
    try {
      await L.updateProfile(Object.fromEntries(Object.keys(PROFILE_FIELDS).map(k => [k, f[k].value])));
      teacher = await L.myTeacher();
      $("whoName").textContent = teacher.display_name || teacher.name;
      toast("プロフィールを反映しました");
    } catch (err) {
      toast(errMsg(err), true);
    }
    sync();
  });
  sync();
}

// ---------- チケット（管理者） ----------
// 生徒ごとに、選んだ月の購入枚数（月末の精算用）・購入の合計・使用済み・予約中・未使用・期限切れ
let ticketMonth = jstToday().slice(0, 7);  // 購入を数える月（"2026-10"）
let ticketRows = [];
async function renderTickets() {
  ticketRows = await L.ticketOverview(ticketMonth + "-01");
  const [y, m] = ticketMonth.split("-").map(Number);
  const sum = k => ticketRows.reduce((n, s) => n + s[k], 0);
  const num = n => `<td class="n${n ? "" : " zero"}">${n}</td>`;
  $("ticketMonth").innerHTML = `
    <button class="btn btn-line btn-sm" type="button" data-tm="-1" aria-label="前の月">‹</button>
    <span class="cal-month">${y}年 ${m}月</span>
    <button class="btn btn-line btn-sm" type="button" data-tm="1" aria-label="次の月" ${ticketMonth >= jstToday().slice(0, 7) ? "disabled" : ""}>›</button>
    <span class="tm-sum">${m}月の購入　合計 <b>${sum("bought_month")}</b> 枚</span>`;
  $("ticketTable").innerHTML = `
    <thead><tr><th>生徒</th><th>ログインID</th><th class="n hl">${m}月の購入</th><th class="n">購入の合計</th><th class="n">使用済み</th><th class="n">予約中</th><th class="n">未使用</th><th class="n">期限切れ</th><th></th></tr></thead>
    <tbody>${ticketRows.map(s => `
      <tr>
        <td>${esc(s.name)}${s.active ? "" : ` <span class="tag tag-mute">停止中</span>`}</td>
        <td>${esc(s.login_id)}</td>
        ${num(s.bought_month).replace('class="n', 'class="n hl')}${num(s.bought_total)}${num(s.used)}${num(s.booked)}
        <td class="n${s.unused ? "" : " zero"}">${s.unused}${s.next_expiry ? `<small>${md(s.next_expiry)} まで</small>` : ""}</td>${num(s.expired)}
        <td class="row-acts"><button class="mini" type="button" data-hist="${esc(s.id)}">記録</button></td>
      </tr>`).join("")}</tbody>
    <tfoot><tr><th colspan="2">合計</th>${["bought_month", "bought_total", "used", "booked", "unused", "expired"].map(k => `<th class="n${k === "bought_month" ? " hl" : ""}">${sum(k)}</th>`).join("")}<th></th></tr></tfoot>`;
}
$("ticketMonth").addEventListener("click", e => {
  const b = e.target.closest("[data-tm]");
  if (!b) return;
  ticketMonth = monthAdd(ticketMonth, Number(b.dataset.tm));
  renderTickets();
});
$("ticketTable").addEventListener("click", e => {
  const h = e.target.closest("[data-hist]");
  if (h) showHistory(ticketRows.find(s => s.id === h.dataset.hist));
});

let histStudent = null;
async function showHistory(st) {
  histStudent = st;
  const { tickets, grants } = await L.studentTickets(st.id);
  const t0 = jstToday();
  const state = t => {
    if (t.revoked_at) return ["取り消し", "tag-mute"];
    if (t.booking) {
      const ph = phase(t.booking);
      if (ph === "teacher_cancelled") return ["先生の都合でキャンセル → 返却", "tag-mute"];
      const who = t.booking.teacher_name ? `・${t.booking.teacher_name}` : "";
      if (["open", "locked", "live"].includes(ph)) return [`予約に使用中（${fmtDay(jst(t.booking.starts_at).date)}${who}）`, "tag-move"];
      return [`使用済み（${fmtDay(jst(t.booking.starts_at).date)}${who}${ph === "absent" ? "・欠席" : ""}）`, "tag-mute"];
    }
    if (t.expires_on < t0) return ["期限切れ", "tag-ng"];
    return ["未使用", "tag-ok"];
  };
  const list = [...tickets].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
  $("historyWho").textContent = `${st.name} さんのチケット`;
  $("historyBody").innerHTML = `
    <h3 class="mat-title">購入の記録</h3>
    ${grants.length ? `<ul class="plain">${[...grants].reverse().map(g => `<li>${md(jst(g.created_at).date)}　${g.count} 枚（${md(g.expires_on)} まで）${g.granted_by === st.id ? "" : `　<span class="tag tag-mute">教室が配布</span>`}${g.note ? `　<span class="muted">${esc(g.note)}</span>` : ""}</li>`).join("")}</ul>` : `<p class="muted">まだありません。</p>`}
    <h3 class="mat-title">チケット1枚ごと</h3>
    ${list.length ? `<div class="table-wrap"><table class="list">
      <thead><tr><th>受け取った日</th><th>種類</th><th>期限</th><th>状態</th><th></th></tr></thead>
      <tbody>${list.map(t => {
        const [label, cls] = state(t);
        const can = !t.booking_id && !t.revoked_at && t.expires_on >= t0;
        return `<tr><td>${md(jst(t.created_at).date)}</td><td>${t.source === "refund" ? "返却" : "購入"}</td><td>${md(t.expires_on)}</td>
          <td><span class="tag ${cls}">${esc(label)}</span></td><td>${can ? `<button class="mini" type="button" data-revoke="${t.id}">取り消す</button>` : ""}</td></tr>`;
      }).join("")}</tbody></table></div>` : `<p class="muted">まだありません。</p>`}`;
  if (!$("historyDlg").open) $("historyDlg").showModal();
}
$("historyBody").addEventListener("click", async e => {
  const r = e.target.closest("[data-revoke]");
  if (!r) return;
  if (!confirm("このチケットを取り消しますか？（まちがって購入したときなどに使います。取り消すと購入の数からも外れます）")) return;
  try {
    await L.revokeTicket(Number(r.dataset.revoke));
    toast("取り消しました");
  } catch (err) {
    toast(errMsg(err), true);
  }
  showHistory(histStudent);
  renderTab();
});

// ---------- 全体の予約（管理者） ----------
async function renderAll() {
  const list = await L.allBookings();
  const sel = $("allTeacher");
  if (!sel.options.length) {
    const names = [...new Map(list.map(b => [b.teacher_id, b.teacher_name])).entries()];
    sel.innerHTML = `<option value="">すべての先生</option>` + names.map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join("");
  }
  const live = ["open", "locked", "live"];
  const up = $("allWhen").value === "up";
  const rows = list.filter(b => (!sel.value || b.teacher_id === sel.value) && (up ? live.includes(phase(b)) : !live.includes(phase(b))));
  if (!up) rows.reverse();
  $("allTable").innerHTML = rows.length ? `
    <thead><tr><th>日時（JST）</th><th>先生</th><th>生徒</th><th>状態</th><th></th></tr></thead>
    <tbody>${rows.map(b => {
      const ph = phase(b);
      return `<tr><td>${esc(fmtWhen(b.starts_at))}</td><td>${esc(b.teacher_name)}</td><td>${esc(b.student_name)}</td>
        <td><span class="tag ${PHASE_TAG[ph]}">${esc(phaseLabel(b))}</span></td>
        <td>${live.includes(ph) ? `<button class="mini" type="button" data-tcancel="${b.id}">キャンセル</button>` : ""}</td></tr>`;
    }).join("")}</tbody>` : `<tbody><tr><td class="muted">該当する予約はありません。</td></tr></tbody>`;
}
$("allTeacher").addEventListener("change", renderAll);
$("allWhen").addEventListener("change", renderAll);

// ---------- 確認ダイアログ ----------
function ask(title, html, okLabel = "確定する") {
  return new Promise(resolve => {
    const dlg = $("confirmDlg");
    $("confirmTitle").textContent = title;
    $("confirmText").innerHTML = html;
    $("confirmOk").textContent = okLabel;
    dlg.returnValue = "";
    dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true });
    dlg.showModal();
  });
}
for (const b of document.querySelectorAll("[data-close]")) b.addEventListener("click", () => b.closest("dialog").close());

// ---------- パスワード（変えると、次の名簿の反映でスプレッドシートにも書き戻される） ----------
$("pwBtn").addEventListener("click", () => {
  $("pwForm").reset();
  $("pwError").hidden = true;
  $("pwDlg").showModal();
});
$("pwForm").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  const fail = m => { $("pwError").textContent = m; $("pwError").hidden = false; };
  if (f.pw1.value.length < 8) return fail("8文字以上で入力してください");
  if (f.pw1.value !== f.pw2.value) return fail("2回の入力が一致しません");
  try {
    await api.changePassword(f.pw1.value);
    $("pwDlg").close();
    toast("パスワードを変更しました");
  } catch (err) {
    fail(errMsg(err));
  }
});

$("logoutBtn").addEventListener("click", async () => {
  stopIdleLogout();
  await api.signOut();
  location.href = page("index");
});
$("resetDemo")?.addEventListener("click", () => {
  if (confirm("お試しデータ（個人レッスン）を最初の状態に戻しますか？")) L?.resetDemo?.();
});
document.addEventListener("visibilitychange", () => { if (!document.hidden && L) refresh(); });

start().catch(err => { $("loading").textContent = errMsg(err); });
