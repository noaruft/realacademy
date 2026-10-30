// 個人レッスン（専用コース）：生徒のページ
import { createApi } from "./api.js?v=f7684c6f";
import { errMsg, esc, page, startIdleLogout, stopIdleLogout, toast } from "./common.js?v=f7684c6f";
import { createLessonApi } from "./lesson-api.js?v=f7684c6f";
import { createChat } from "./lesson-chat.js?v=f7684c6f";
import { DEADLINE_HOURS, PHASE_TAG, TICKET_MONTHS, TICKET_PACKS, ZOOM_OPEN_MINUTES, addMonthsJ, fmtDay, fmtWhen, jst, jstToday, phase, phaseLabel } from "./lesson-common.js?v=f7684c6f";

const IDLE_MINUTES = 30;  // 操作がないと30分で自動ログアウト
const $ = id => document.getElementById(id);

const api = await createApi();
if (api.demo) $("demoBar").hidden = false;

let me = null;
let L = null;           // 個人レッスンのデータの読み書き
let teachers = [];
let bookings = [];
let tickets = [];
let chat = null;

const md = date => { const [, m, d] = date.split("-").map(Number); return `${m}/${d}`; };
const sensei = name => name;  // 先生の名前は「先生」を付けず、名前だけで出す

// ---------- タブ ----------
function showTab(name) {
  if (!["mine", "book", "chat", "tickets"].includes(name)) name = "mine";
  for (const b of document.querySelectorAll("[data-mytab]")) b.setAttribute("aria-selected", String(b.dataset.mytab === name));
  for (const p of document.querySelectorAll("[data-mypanel]")) p.hidden = p.dataset.mypanel !== name;
}
for (const b of document.querySelectorAll("[data-mytab]")) {
  b.addEventListener("click", () => { history.replaceState(null, "", "#" + b.dataset.mytab); showTab(b.dataset.mytab); });
}

// ---------- 起動 ----------
async function start() {
  me = await api.me().catch(() => null);
  if (!me || me.role !== "lesson" || !me.lesson?.student) {
    location.href = page("index");
    return;
  }
  L = await createLessonApi();
  $("whoName").textContent = me.lesson.name + " さん";
  $("pName").textContent = me.lesson.name + " さん";
  $("headerUser").hidden = false;
  $("loading").hidden = true;
  $("myView").hidden = false;
  showTab(location.hash.slice(1));
  startIdleLogout(IDLE_MINUTES, async () => {
    await api.signOut();
    location.replace(page("index") + "?timeout=1");
  });
  chat = createChat(L, $("chatRoot"), {
    side: "student", title: sensei,
    onUnread: n => { $("unreadBadge").hidden = !n; $("unreadBadge").textContent = n; },
  });
  teachers = await L.teachers();
  await refresh();
  let timer;
  L.subscribe(() => { clearTimeout(timer); timer = setTimeout(refresh, 200); });
  setInterval(render, 60e3);  // 時間がたつと「Zoom に入る」「欠席する」などが切り替わる
}

async function refresh() {
  [bookings, tickets] = await Promise.all([L.myBookings(), L.myTickets()]);
  render();
  await renderSlots();
  await chat.refresh();
}

function render() {
  renderDash();
  renderMine();
  renderTeachers();
  renderTickets();
}

// 使えるチケット（未使用・期限内）を期限の近い順に
const today = () => jstToday();
const usable = () => tickets.filter(t => !t.booking_id && !t.revoked_at && t.expires_on >= today())
  .sort((a, b) => a.expires_on.localeCompare(b.expires_on));
const ticketFor = date => usable().find(t => t.expires_on >= date);

// ---------- いまの状況 ----------
function renderDash() {
  const valid = usable();
  const next = bookings.filter(b => ["open", "locked", "live"].includes(phase(b))).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  $("dashNow").innerHTML = `
    <div class="now-label">残り ${valid.length} 枚<small class="now-unit">チケット</small></div>
    <div class="now-sub">${valid.length ? `いちばん近い期限：${md(valid[0].expires_on)} まで` : "使えるチケットがありません"}</div>
    <div class="next-lesson stack">
      <span class="k">次のレッスン</span>
      <div class="nl-box">
        <span class="v">${next ? `${esc(fmtWhen(next.starts_at))} JST　${esc(sensei(next.teacher_name))}` : "予約はありません"}</span>
        ${next && phase(next) === "live" ? zoomBtn(next, "btn-sm") : ""}
      </div>
    </div>`;
}

function zoomBtn(b, cls = "") {
  return b.zoom_url
    ? `<a class="btn ${cls} zoom-btn" href="${esc(b.zoom_url)}" target="_blank" rel="noopener">Zoom に入る</a>`
    : `<span class="muted">Zoom のリンクが未登録です。先生にメッセージで確認してください。</span>`;
}

// ---------- 予約一覧 ----------
function lessonRow(b) {
  const ph = phase(b);
  const acts = [];
  if (ph === "live") acts.push(zoomBtn(b));
  if (ph === "open") {
    acts.push(`<button class="btn btn-line btn-sm" type="button" data-cancel="${b.id}">キャンセル</button>`);
  }
  if (ph === "locked") acts.push(`<button class="btn btn-line btn-sm" type="button" data-absent="${b.id}">欠席する</button>`);
  if (["open", "locked", "live"].includes(ph)) acts.push(`<button class="btn-text" type="button" data-msg="${esc(b.teacher_id)}">メッセージ</button>`);
  const t = tickets.find(x => x.id === b.ticket_id);
  const refund = t?.refunded_by ? tickets.find(x => x.id === t.refunded_by) : null;
  const sub = [];
  if (ph === "open") sub.push(`開始${ZOOM_OPEN_MINUTES}分前に Zoom のボタンが出ます`);
  if (ph === "locked") sub.push(`開始${DEADLINE_HOURS}時間前を過ぎたため、キャンセルはできません`);
  if (ph === "teacher_cancelled") {
    if (b.cancel_note) sub.push(`理由：${esc(b.cancel_note)}`);
    if (refund) sub.push(`チケットを1枚お返ししました（${md(refund.expires_on)} まで）`);
  }
  if (ph === "cancelled" && b.cancel_note) sub.push(esc(b.cancel_note));
  return `
    <div class="lesson ${["cancelled", "teacher_cancelled"].includes(ph) ? "is-off" : ""}">
      <div>
        <div class="when">${esc(fmtWhen(b.starts_at))}<small>JST</small></div>
        <div class="sub">${esc(sensei(b.teacher_name))}　<span class="tag ${PHASE_TAG[ph]}">${phaseLabel(b)}</span></div>
        ${sub.length ? `<div class="sub">${sub.join("<br>")}</div>` : ""}
      </div>
      <div class="actions">${acts.join("")}</div>
    </div>`;
}

function renderMine() {
  const up = bookings.filter(b => ["open", "locked", "live"].includes(phase(b))).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = bookings.filter(b => !up.includes(b));
  $("upcoming").innerHTML = up.length ? up.map(lessonRow).join("")
    : `<div class="card muted">予約しているレッスンはありません。「予約する」から先生と時間を選んでください。</div>`;
  $("past").innerHTML = past.length ? past.map(lessonRow).join("") : `<p class="muted">まだありません。</p>`;
  $("pastBox").hidden = !past.length;
}

document.addEventListener("click", async e => {
  const t = e.target.closest("[data-cancel],[data-absent],[data-msg]");
  if (!t) return;
  if (t.dataset.msg) {
    showTab("chat");
    history.replaceState(null, "", "#chat");
    chat.open(t.dataset.msg);
    return;
  }
  const b = bookings.find(x => String(x.id) === (t.dataset.cancel || t.dataset.absent));
  if (!b) return;
  if (t.dataset.cancel) {
    const tk = tickets.find(x => x.id === b.ticket_id);
    if (!await ask("予約をキャンセルしますか？",
      `<p>${esc(fmtWhen(b.starts_at))} JST　${esc(sensei(b.teacher_name))}</p>
       <p class="muted">チケットは1枚戻ります${tk ? `（期限は元のまま ${md(tk.expires_on)} まで${tk.expires_on < today() ? "。すでに期限が過ぎているため使えません" : ""}）` : ""}。先生にお知らせが届きます。</p>`, "キャンセルする")) return;
    return act(() => L.cancel(b.id), "キャンセルしました");
  }
  if (t.dataset.absent) {
    if (!await ask("欠席にしますか？",
      `<p>${esc(fmtWhen(b.starts_at))} JST　${esc(sensei(b.teacher_name))}</p>
       <p class="muted">開始${DEADLINE_HOURS}時間前を過ぎているため、チケットは戻りません。先生にお知らせが届きます。</p>`, "欠席にする")) return;
    return act(() => L.absent(b.id), "欠席にしました");
  }
});

async function act(fn, okMsg) {
  try {
    await fn();
    toast(okMsg);
  } catch (err) {
    toast(errMsg(err), true);
  }
  await refresh();
}

// ---------- 予約する：空きのある日を日付の順に並べ、その日の予約できる時間をボタンで出す ----------
// 担当の先生が決まっている生徒は先生が1人なので、時間だけを並べる（先生が複数いるときは、日ごとに先生の名前と時間）
let slotIndex = new Map();  // id → 空き時間（予約するときに使う）

// 先生の紹介（タブの下に畳んで置く。メッセージもここから）
function renderTeachers() {
  $("teacherGrid").innerHTML = teachers.length ? teachers.map(t => `
    <article class="teacher-card">
      <h3>${esc(sensei(t.name))}</h3>
      ${t.origin || t.hobby ? `<dl class="t-prof">${t.origin ? `<dt>出身</dt><dd>${esc(t.origin)}</dd>` : ""}${t.hobby ? `<dt>趣味</dt><dd>${esc(t.hobby)}</dd>` : ""}</dl>` : ""}
      <p>${t.message ? `<span class="t-msg">${esc(t.message)}</span>` : ""}</p>
      <div class="teacher-acts"><button class="btn-text" type="button" data-msg="${esc(t.id)}">メッセージを送る</button></div>
    </article>`).join("") : `<p class="card muted">先生がまだ登録されていません。</p>`;
}

async function renderSlots() {
  const all = (await Promise.all(teachers.map(t => L.openSlots(t.id)))).flat();
  slotIndex = new Map(all.map(x => [String(x.id), x]));
  const mineAt = new Set(bookings.filter(b => b.status === "booked").map(b => b.starts_at));
  // チケットの期限より後の日は選べない
  const exps = usable().map(t => t.expires_on).sort();
  const maxExp = exps.at(-1) || "";
  const why = x => mineAt.has(x.starts_at) ? "同じ時間にほかのレッスンを予約しています" : jst(x.starts_at).date > maxExp ? "チケットの期限が過ぎた日です" : "";
  // 日 → 先生 → 空き時間
  const byDay = new Map();
  for (const x of all) {
    const d = jst(x.starts_at).date;
    if (!byDay.has(d)) byDay.set(d, new Map());
    const m = byDay.get(d);
    if (!m.has(x.teacher_id)) m.set(x.teacher_id, []);
    m.get(x.teacher_id).push(x);
  }
  for (const m of byDay.values()) for (const l of m.values()) l.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  if (!byDay.size) {
    $("slotList").innerHTML = `<p class="card muted">いま予約できる時間はありません。先生が時間を追加すると、ここに表示されます。</p>`;
    return;
  }
  const days = [...byDay.keys()].sort();
  const tname = id => teachers.find(t => t.id === id)?.name || "";
  const many = teachers.length > 1;
  const hm = iso => { const t = jst(iso); return `${t.hour}:${String(t.minute).padStart(2, "0")}`; };
  const btns = list => `<div class="slot-times">${list.map(x => {
    const w = why(x);
    return `<button class="slot-btn" type="button" data-slot="${esc(x.id)}" ${w ? `disabled title="${w}"` : ""}>${hm(x.starts_at)}<small>〜${hm(new Date(new Date(x.starts_at).getTime() + 3600e3).toISOString())}</small></button>`;
  }).join("")}</div>`;
  const lead = !maxExp ? `<p class="error">使えるチケットがありません。「チケット」タブから追加してください。</p>`
    : days.some(x => x > maxExp) ? `<p class="muted">お持ちのチケットは ${md(maxExp)} までです。それより後の日は予約できません。</p>` : "";
  const head = many ? "" : `<p class="slot-who">担当の先生：<b>${esc(sensei(tname(teachers[0].id)))}</b></p>`;
  const rows = days.map(d => {
    const tm = byDay.get(d), dow = new Date(d + "T00:00:00Z").getUTCDay();
    const off = !!maxExp && d > maxExp;  // チケットはあるが、その期限より後の日
    return `<div class="slot-day${off ? " off" : ""}">
      <div class="sd-date${dow === 6 ? " sat" : dow === 0 ? " sun" : ""}">${esc(fmtDay(d))}${off ? `<small>期限外</small>` : ""}</div>
      <div class="sd-times">${many
        ? [...tm].map(([tid, list]) => `<div class="day-teacher"><div class="dt-name">${esc(sensei(tname(tid)))}</div>${btns(list)}</div>`).join("")
        : btns([...tm.values()].flat())}</div>
    </div>`;
  }).join("");
  $("slotList").innerHTML = lead + head + `<div class="slot-days">${rows}</div>`;
}

$("slotList").addEventListener("click", async e => {
  const b = e.target.closest("[data-slot]");
  if (!b) return;
  const picked = slotIndex.get(b.dataset.slot);
  if (!picked) return;
  // 押した時点でまだ空いているか確かめる
  const s = (await L.openSlots(picked.teacher_id)).find(x => String(x.id) === b.dataset.slot);
  if (!s) { toast("この時間はすでに埋まっています", true); return renderSlots(); }
  const teacherName = teachers.find(t => t.id === s.teacher_id)?.name || "";
  const date = jst(s.starts_at).date;
  const when = `<p><b>${esc(fmtWhen(s.starts_at))} JST</b>　${esc(sensei(teacherName))}</p>`;
  const tk = ticketFor(date);
  if (!tk) return toast(noTicketMsg(date), true);
  if (!await ask("この時間を予約しますか？",
    `${when}<p class="muted">チケットを1枚使います（${md(tk.expires_on)} までのチケット）。先生にお知らせが届きます。</p>`, "予約する")) return;
  await act(() => L.book(s.id), "予約しました");
  showTab("mine");
  history.replaceState(null, "", "#mine");
});

function noTicketMsg(date) {
  const v = usable();
  return v.length ? `お持ちのチケットは ${md(v.at(-1).expires_on)} までのため、${md(date)} のレッスンには使えません`
    : "使えるチケットがありません。「チケット」タブから追加してください";
}


// ---------- チケット ----------
function renderTickets() {
  const t0 = today();
  const valid = usable();
  const groups = new Map();
  for (const t of valid) {
    const k = t.expires_on + "|" + t.source;
    groups.set(k, (groups.get(k) || 0) + 1);
  }
  const inUse = tickets.filter(t => t.booking && t.booking.status === "booked" && ["open", "locked", "live"].includes(phase(t.booking)));
  const state = t => {
    if (t.revoked_at) return ["取り消し", "tag-mute"];
    if (t.booking) {
      const ph = phase(t.booking);
      if (ph === "teacher_cancelled") return ["先生の都合でキャンセル → 返却", "tag-mute"];
      if (["open", "locked", "live"].includes(ph)) return [`予約に使用中（${fmtDay(jst(t.booking.starts_at).date)}）`, "tag-move"];
      return [`使用済み（${fmtDay(jst(t.booking.starts_at).date)}${ph === "absent" ? "・欠席" : ""}）`, "tag-mute"];
    }
    if (t.expires_on < t0) return ["期限切れ", "tag-ng"];
    return ["使えます", "tag-ok"];
  };
  const hist = [...tickets].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
  $("ticketBox").innerHTML = `
    <div class="ticket-sum">
      <div class="ticket-big"><span class="k">使えるチケット</span><span class="v">${valid.length}<small>枚</small></span></div>
      <div class="ticket-big"><span class="k">予約に使用中</span><span class="v">${inUse.length}<small>枚</small></span></div>
    </div>
    <p class="ticket-add"><button class="btn" type="button" data-add>チケットを追加する</button></p>
    ${groups.size ? `<ul class="ticket-groups">${[...groups].map(([k, n]) => {
      const [exp, src] = k.split("|");
      return `<li><span class="exp">${md(exp)} まで</span><span class="n">${n} 枚</span>${src === "refund" ? `<span class="tag tag-move">先生の都合でキャンセルされた分</span>` : ""}</li>`;
    }).join("")}</ul>` : ""}
    <h3 class="mat-title">チケットの記録</h3>
    ${hist.length ? `<div class="table-wrap"><table class="list">
      <thead><tr><th>受け取った日</th><th>種類</th><th>期限</th><th>状態</th></tr></thead>
      <tbody>${hist.map(t => {
        const [label, cls] = state(t);
        return `<tr><td>${md(jst(t.created_at).date)}</td><td>${t.source === "refund" ? "返却" : "購入"}</td><td>${md(t.expires_on)}</td><td><span class="tag ${cls}">${esc(label)}</span></td></tr>`;
      }).join("")}</tbody></table></div>` : `<p class="muted">まだチケットはありません。上の「チケットを追加する」から追加できます。</p>`}`;
}
// 「チケットを追加する」→ 枚数（3・5・10枚）を選んで追加
$("ticketBox").addEventListener("click", async e => {
  const b = e.target.closest("[data-add]");
  if (!b) return;
  const pick = ask("チケットを追加する", `
    <p class="muted">枚数を選んでください。期限は今日から${TICKET_MONTHS}か月（${md(addMonthsJ(today(), TICKET_MONTHS))} まで）です。</p>
    <div class="ticket-packs">${TICKET_PACKS.map(n => `<label><input type="radio" name="pack" value="${n}">${n}<small>枚</small></label>`).join("")}</div>`, "追加する");
  $("confirmOk").disabled = true;
  for (const r of $("confirmText").querySelectorAll("[name=pack]")) {
    r.addEventListener("change", () => { $("confirmOk").disabled = false; $("confirmOk").textContent = `${r.value}枚追加する`; });
  }
  if (!await pick) return;
  const n = Number($("confirmText").querySelector("[name=pack]:checked")?.value);
  if (!n) return;
  // もう一度確かめてから購入する
  if (!await ask("チケットを購入しますか？",
    `<p><b>${n}枚</b>　期限：${md(addMonthsJ(today(), TICKET_MONTHS))} まで</p>`, "購入する")) return;
  b.disabled = true;
  try {
    await L.addTickets(n);
    toast(`チケットを ${n} 枚追加しました`);
    await refresh();
  } catch (err) {
    toast(errMsg(err), true);
    renderTickets();
  }
});

// ---------- 確認ダイアログ ----------
function ask(title, html, okLabel = "確定する") {
  return new Promise(resolve => {
    const dlg = $("confirmDlg");
    $("confirmTitle").textContent = title;
    $("confirmText").innerHTML = html;
    $("confirmOk").textContent = okLabel;
    $("confirmOk").disabled = false;
    dlg.returnValue = "";
    dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true });
    dlg.showModal();
  });
}
for (const b of document.querySelectorAll("[data-close]")) b.addEventListener("click", () => b.closest("dialog").close());

// ---------- ログアウト・パスワード ----------
$("logoutBtn").addEventListener("click", async () => {
  stopIdleLogout();
  await api.signOut();
  location.href = page("index");
});
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
$("resetDemo")?.addEventListener("click", () => {
  if (confirm("お試しデータ（個人レッスン）を最初の状態に戻しますか？")) L?.resetDemo?.();
});
document.addEventListener("visibilitychange", () => { if (!document.hidden && L) refresh(); });

start().catch(err => { $("loading").textContent = errMsg(err); });
