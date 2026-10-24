// 個人レッスン（専用コース）：先生のページ（管理者はチケットの配布と全体の予約も）
import { createApi } from "./api.js?v=58bc780a";
import { errMsg, esc, page, startIdleLogout, stopIdleLogout, toast } from "./common.js?v=58bc780a";
import { createLessonApi } from "./lesson-api.js?v=58bc780a";
import { createChat } from "./lesson-chat.js?v=58bc780a";
import { FIRST_HOUR, LAST_HOUR, PHASE_TAG, TICKET_MONTHS, ZOOM_OPEN_MINUTES, addDaysJ, addMonthsJ, fmtDay, fmtWhen,
  fmtUk, jst, jstIso, jstToday, mondayJ, ms, phase, phaseLabel, uk, ukStatus } from "./lesson-common.js?v=58bc780a";

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
// 先生ごとの「時間の基準」。"uk"（イギリスから教える）なら、イギリス時間を添えて夏時間・冬時間を知らせる。"jp" なら日本時間だけ
const isUk = () => isTeacher && teacher?.tz !== "jp";
function applyTz() {
  for (const el of document.querySelectorAll("[data-uk]")) el.hidden = !isUk();
  for (const r of document.querySelectorAll("#tzPick input")) r.checked = r.value === (isUk() ? "uk" : "jp");
  if (isUk()) renderUkBar(); else $("ukBar").hidden = true;
}
$("tzPick").addEventListener("change", async e => {
  const tz = e.target.value;
  if (weeklyDirty()) {
    toast("先に、毎週の空き時間を「反映」するか「変更を取り消す」を押してください", true);
    return applyTz();
  }
  const name = tz === "uk" ? "イギリス時間" : "日本時間";
  if (!await ask(`時間の基準を${name}にしますか？`,
    `<p>毎週の空き時間を${name}で決めるようにします。いま設定している空き時間は、来週の時差で${name}に直します（来週の日本時間は変わりません）。</p>` +
    (tz === "uk" ? `<p class="muted">これからは、夏時間・冬時間が切り替わると、イギリス時間はそのままで日本時間が1時間ずれます。</p>`
      : `<p class="muted">これからは、夏時間・冬時間が切り替わっても日本時間はそのままです。</p>`), "切り替える")) return applyTz();
  try {
    await L.setTimezone(tz);
    teacher = await L.myTeacher();
    weeklySaved = weeklyDraft = null;  // 曜日・時の数え方が変わったので、表を読み直す
    toast(`時間の基準を${name}にしました`);
  } catch (err) {
    toast(errMsg(err), true);
  }
  applyTz();
  renderTab();
});
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
    ${n ? `<span class="${days <= 14 ? "uk-soon" : ""}">${md(n.date)}（${WD[new Date(n.date + "T12:00:00Z").getUTCDay()]}）から${n.summer ? "夏時間（BST）・時差 8時間" : "冬時間（GMT）・時差 9時間"}になります${days <= 14 ? `（あと${days}日）` : ""}。毎週の空き時間（イギリス時間）は、日本時間が自動で1時間${n.summer ? "早く" : "遅く"}なります。</span>` : ""}`;
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
  $("weeklyApply").disabled = !dirty;
  $("weeklyUndo").hidden = !dirty;
  $("weeklyState").textContent = dirty ? "まだ反映していない変更があります" : "";
  $("weeklyBar").classList.toggle("dirty", dirty);
  if (!isUk()) return renderWeeklyJp(on);
  // イギリス時間が基準：行・曜日ともイギリス時間。左の列に、来週の日本時間を添える
  const nextWeek = uk(new Date(Date.now() + 7 * 864e5).toISOString());
  const diff = nextWeek.diff;
  $("weeklyUkNote").textContent = `表の曜日と時刻はイギリス時間です。左の列の JST は、来週の日本時間（イギリスが${nextWeek.summer ? "夏時間 BST・時差 8時間" : "冬時間 GMT・時差 9時間"}）です。` +
    "夏時間・冬時間が切り替わると、イギリス時間はそのままで、日本時間が自動で1時間ずれます。日本時間が深夜・早朝になる行は薄くしています。";
  let html = `<thead><tr><th class="hr">UK<small>JST</small></th>${WEEK_ORDER.map(w => `<th>${WD[w]}</th>`).join("")}</tr></thead><tbody>`;
  for (let h = 0; h < 24; h++) {
    const jh = h + diff;
    const night = jh % 24 < FIRST_HOUR;
    html += `<tr class="${night ? "night" : ""}"><th class="hr">${h}:00<small>${jh % 24}:00${jh >= 24 ? "<i>翌日</i>" : ""}</small></th>` + WEEK_ORDER.map(w => {
      const o = on.has(`${w}|${h}`);
      const changed = o !== weeklySaved.has(`${w}|${h}`);
      return `<td><button class="cell ${o ? "open" : "none"}${changed ? " changed" : ""}" type="button" data-wk="${w}|${h}" aria-pressed="${o}"
        aria-label="毎週${WD[w]}曜 イギリス時間 ${h}:00〜${h + 1}:00">${o ? "空き" : ""}</button></td>`;
    }).join("") + "</tr>";
  }
  $("weeklyGrid").innerHTML = html + "</tbody>";
}
// 日本時間が基準：行・曜日とも日本時間（いつもの 7:00〜23:00 と、ほかに設定のある時間）
function renderWeeklyJp(on) {
  $("weeklyUkNote").textContent = "表の曜日と時刻は日本時間です。";
  const hours = [...new Set([...hourList(), ...[...on, ...weeklySaved].map(k => Number(k.split("|")[1]))])].sort((a, b) => a - b);
  let html = `<thead><tr><th class="hr">JST</th>${WEEK_ORDER.map(w => `<th>${WD[w]}</th>`).join("")}</tr></thead><tbody>`;
  for (const h of hours) {
    html += `<tr><th class="hr">${h}:00</th>` + WEEK_ORDER.map(w => {
      const o = on.has(`${w}|${h}`);
      const changed = o !== weeklySaved.has(`${w}|${h}`);
      return `<td><button class="cell ${o ? "open" : "none"}${changed ? " changed" : ""}" type="button" data-wk="${w}|${h}" aria-pressed="${o}"
        aria-label="毎週${WD[w]}曜 ${h}:00〜${h + 1}:00">${o ? "空き" : ""}</button></td>`;
    }).join("") + "</tr>";
  }
  $("weeklyGrid").innerHTML = html + "</tbody>";
}
$("weeklyGrid").addEventListener("click", e => {
  const c = e.target.closest("[data-wk]");
  if (!c) return;
  const k = c.dataset.wk;
  if (weeklyDraft.has(k)) weeklyDraft.delete(k); else weeklyDraft.add(k);
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
  const profileDirty = pf && teacher && pf.profile.value !== (teacher.profile || "");
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
        <ul class="day-list">${dayRows}</ul>
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
const PROFILE_MAX = 400;  // 紹介文の文字数の上限
function renderProfile() {
  $("profileBox").innerHTML = `
    <h3 class="mat-title" style="margin-top:0">${esc(teacher.name)}</h3>
    <form id="profileForm">
      <label class="field"><span>紹介文（生徒が予約するときの「先生の紹介」に表示されます。${PROFILE_MAX}文字まで）</span>
        <textarea class="input" name="profile" rows="6" maxlength="${PROFILE_MAX}" placeholder="例：出身地、得意な分野、レッスンの進め方など">${esc(teacher.profile || "")}</textarea></label>
      <div class="weekly-bar" id="profileBar">
        <span class="weekly-state" id="profileState"></span>
        <span class="muted" id="profileCount"></span>
        <button class="btn" type="submit" id="profileApply" disabled>反映</button>
      </div>
    </form>
    <dl class="kv">
      <dt>Zoom のリンク</dt><dd>${teacher.zoom_url ? `<a href="${esc(teacher.zoom_url)}" target="_blank" rel="noopener">${esc(teacher.zoom_url)}</a>` : "未登録"}</dd>
      <dt>お知らせメールの送り先</dt><dd>${esc(teacher.email || "未登録")}</dd>
    </dl>
    <p class="muted" style="margin:16px 0 0">紹介文は、ここで書き換えて「反映」を押すと生徒の画面に表示されます。名前・Zoom のリンク・メールアドレスは教室の名簿で管理しています。変更したいときは教室にお知らせください。Zoom のリンクは、予約した生徒にだけ、開始${ZOOM_OPEN_MINUTES}分前から表示されます。</p>`;
  const f = $("profileForm");
  const sync = () => {
    const dirty = f.profile.value !== (teacher.profile || "");
    $("profileApply").disabled = !dirty;
    $("profileState").textContent = dirty ? "まだ反映していない変更があります" : "";
    $("profileBar").classList.toggle("dirty", dirty);
    $("profileCount").textContent = `${f.profile.value.length} / ${PROFILE_MAX}文字`;
  };
  f.profile.addEventListener("input", sync);
  f.addEventListener("submit", async e => {
    e.preventDefault();
    $("profileApply").disabled = true;
    try {
      await L.updateProfile(f.profile.value);
      teacher = await L.myTeacher();
      toast("紹介文を反映しました");
    } catch (err) {
      toast(errMsg(err), true);
    }
    sync();
  });
  sync();
}

// ---------- チケット（管理者） ----------
async function renderTickets() {
  const rows = await L.ticketOverview();
  $("ticketTable").innerHTML = `
    <thead><tr><th>生徒</th><th>ログインID</th><th>使えるチケット</th><th>いちばん近い期限</th><th>予約中</th><th></th></tr></thead>
    <tbody>${rows.map(s => `
      <tr>
        <td>${esc(s.name)}${s.active ? "" : ` <span class="tag tag-mute">停止中</span>`}</td>
        <td>${esc(s.login_id)}</td>
        <td><b class="num">${s.valid}</b> 枚</td>
        <td>${s.next_expiry ? md(s.next_expiry) : "—"}</td>
        <td>${s.upcoming} 件</td>
        <td class="row-acts"><button class="btn btn-sm" type="button" data-grant="${esc(s.id)}">チケットを配る</button>
          <button class="mini" type="button" data-hist="${esc(s.id)}">記録</button></td>
      </tr>`).join("")}</tbody>`;
}
let grantTarget = null;
$("ticketTable").addEventListener("click", async e => {
  const g = e.target.closest("[data-grant]"), h = e.target.closest("[data-hist]");
  const rows = (g || h) ? await L.ticketOverview() : [];
  if (g) {
    grantTarget = rows.find(s => s.id === g.dataset.grant);
    $("grantWho").innerHTML = `<b>${esc(grantTarget.name)}</b> さん（${esc(grantTarget.login_id)}）　いま使えるチケット ${grantTarget.valid} 枚`;
    $("grantForm").reset();
    $("grantError").hidden = true;
    $("grantExp").textContent = `期限：${md(addMonthsJ(jstToday(), TICKET_MONTHS))} まで（今日から${TICKET_MONTHS}か月）`;
    $("grantDlg").showModal();
  }
  if (h) showHistory(rows.find(s => s.id === h.dataset.hist));
});
$("grantForm").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  const n = Number(f.count.value);
  if (!Number.isInteger(n) || n < 1 || n > 50) { $("grantError").textContent = "枚数は1〜50で入力してください"; $("grantError").hidden = false; return; }
  try {
    await L.grant(grantTarget.id, n, f.note.value);
    $("grantDlg").close();
    toast(`${grantTarget.name} さんにチケットを ${n} 枚配りました`);
  } catch (err) {
    $("grantError").textContent = errMsg(err);
    $("grantError").hidden = false;
  }
  renderTab();
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
    <h3 class="mat-title">配った記録</h3>
    ${grants.length ? `<ul class="plain">${[...grants].reverse().map(g => `<li>${md(jst(g.created_at).date)}　${g.count} 枚（${md(g.expires_on)} まで）${g.note ? `　<span class="muted">${esc(g.note)}</span>` : ""}</li>`).join("")}</ul>` : `<p class="muted">まだありません。</p>`}
    <h3 class="mat-title">チケット1枚ごと</h3>
    ${list.length ? `<div class="table-wrap"><table class="list">
      <thead><tr><th>受け取った日</th><th>種類</th><th>期限</th><th>状態</th><th></th></tr></thead>
      <tbody>${list.map(t => {
        const [label, cls] = state(t);
        const can = !t.booking_id && !t.revoked_at && t.expires_on >= t0;
        return `<tr><td>${md(jst(t.created_at).date)}</td><td>${t.source === "refund" ? "返却" : "配布"}</td><td>${md(t.expires_on)}</td>
          <td><span class="tag ${cls}">${esc(label)}</span></td><td>${can ? `<button class="mini" type="button" data-revoke="${t.id}">取り消す</button>` : ""}</td></tr>`;
      }).join("")}</tbody></table></div>` : `<p class="muted">まだありません。</p>`}`;
  if (!$("historyDlg").open) $("historyDlg").showModal();
}
$("historyBody").addEventListener("click", async e => {
  const r = e.target.closest("[data-revoke]");
  if (!r) return;
  if (!confirm("このチケットを取り消しますか？（配りまちがいのときに使います）")) return;
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
