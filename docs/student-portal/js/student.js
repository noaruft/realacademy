import { createApi } from "./api.js?v=e253aa7d";
import { TEST_TERMS, WEEKDAYS, addDays, page, esc, errMsg, fmtDate, fmtTime, mondayOf, startIdleLogout, stopIdleLogout, termName, testName, toast, todayStr, weekInfo, weekLabel, yearPlan } from "./common.js?v=e253aa7d";

const IDLE_MINUTES = 30;  // 生徒：操作がないと30分で自動ログアウト

const $ = id => document.getElementById(id);
const cfg = window.PORTAL_CONFIG || {};

const api = await createApi();
if (api.demo) { $("demoBar").hidden = false; $("demoHint").hidden = false; }

let me = null;
let settings = null;
let rows = [];
let lessons = [];
let tests = [];
let cal = { years: [], holidays: [] };
const wk = date => weekInfo(date, cal);

// ---------- マイページのタブ ----------
function showTab(name) {
  if (!["schedule", "records", "tests"].includes(name)) name = "schedule";
  for (const b of document.querySelectorAll("[data-mytab]")) b.setAttribute("aria-selected", String(b.dataset.mytab === name));
  for (const p of document.querySelectorAll("[data-mypanel]")) p.hidden = p.dataset.mypanel !== name;
}
for (const b of document.querySelectorAll("[data-mytab]")) {
  b.addEventListener("click", () => { history.replaceState(null, "", "#" + b.dataset.mytab); showTab(b.dataset.mytab); });
}
showTab(location.hash.slice(1));

function show(view) {
  for (const id of ["loading", "loginView", "noneView", "myView"]) $(id).hidden = id !== view;
}

async function start() {
  me = await api.me();
  if (!me) {
    stopIdleLogout();
    show("loginView"); $("headerUser").hidden = true;
    if (/[?&]timeout=1/.test(location.search)) {
      $("loginError").textContent = "一定時間操作がなかったため、自動でログアウトしました。もう一度ログインしてください。";
      $("loginError").hidden = false;
      history.replaceState(null, "", location.pathname + location.hash);
    }
    return;
  }
  // 先生：開こうとしていたクラス・曜日のページがあれば、そこへ（新しいタブでログインし直したとき）
  if (me.role === "admin") {
    const q = new URLSearchParams(location.search);
    location.href = page("admin") + (q.has("class") ? `?class=${encodeURIComponent(q.get("class"))}&day=${Number(q.get("day"))}` : "");
    return;
  }
  // 個人レッスン（専用コース）の生徒・先生・管理者は、個人レッスンのページへ
  if (me.role === "lesson") {
    location.href = page(me.lesson.student ? "lessons" : "lesson-teacher");
    return;
  }
  $("headerUser").hidden = false;
  if (me.role !== "student") { $("whoName").textContent = ""; show("noneView"); return; }
  $("whoName").textContent = me.student.name + " さん";
  show("myView");
  startIdleLogout(IDLE_MINUTES, async () => {
    await api.signOut();
    location.replace(page("index") + "?timeout=1");
  });
  [settings, cal] = await Promise.all([api.settings(), api.calendar()]);
  await refresh();
}

async function refresh() {
  [rows, lessons, tests] = await Promise.all([api.mySchedule(), api.myLessons(), api.myTests()]);
  render();
  renderDash();
  renderResults();
  renderTests();
}

// ---------- ログイン ----------
$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("button[type=submit]");
  $("loginError").hidden = true;
  if (!f.loginId.value.trim() || !f.password.value) {
    $("loginError").textContent = "ログインIDとパスワードを入力してください";
    $("loginError").hidden = false;
    return;
  }
  btn.disabled = true;
  try {
    await api.signIn(f.loginId.value, f.password.value);
    f.reset();
    await start();
  } catch (err) {
    show("loginView");
    $("loginError").textContent = errMsg(err);
    $("loginError").hidden = false;
  } finally {
    btn.disabled = false;
  }
});

$("logoutBtn").addEventListener("click", async () => {
  stopIdleLogout();
  await api.signOut();
  me = null;
  start();
});

// ---------- 予定の表示 ----------
function render() {
  const st = me.student;
  const regular = rows.find(r => r.is_regular);
  $("pName").textContent = st.name + " さん";
  $("pMeta").textContent = `${st.class_name}　通常：毎週${WEEKDAYS[st.weekday]}曜` +
    (regular ? ` ${fmtTime(regular.start_time)}〜${fmtTime(regular.end_time)}` : "");
  const h = settings.deadline_minutes;
  const deadline = h % 60 === 0 ? `${h / 60}時間前` : `${h}分前`;
  $("rules").textContent = `振替・欠席の連絡は、授業開始の${deadline}まで受け付けます。` +
    (settings.same_week_only ? "振替先は同じ週の、空きのある授業から選べます。" : "振替先は空きのある授業から選べます。") +
    `1クラスの定員は${settings.capacity}名です。`;

  // 自分に関係のある授業（通常の曜日と、振替で参加する授業）を週ごとに
  const mine = rows.filter(r => r.is_regular || r.status === "joined");
  if (!mine.length) {
    $("weeks").innerHTML = `<p class="card muted">表示できる授業がありません。</p>`;
    return;
  }
  const byWeek = new Map();
  for (const r of mine) {
    const wk = mondayOf(r.date);
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk).push(r);
  }
  $("weeks").innerHTML = [...byWeek].map(([wk, list]) => `
    <section class="week">
      <h3 class="week-head"><span>${fmtDate(wk)} からの週</span>${weekChip(myDay(wk))}</h3>
      ${list.map(lessonHtml).join("")}
    </section>`).join("");
}

function lessonHtml(r) {
  const when = `${fmtDate(r.date)}<small>${fmtTime(r.start_time)}〜${fmtTime(r.end_time)}</small>`;
  const otherWhen = r.other_date ? `${fmtDate(r.other_date)} ${fmtTime(r.other_start_time)}` : "";
  let tag = "", sub = "", actions = "";
  const id = r.session_id;

  if (r.cancelled) {
    tag = `<span class="tag tag-ng">休校</span>`;
    sub = r.note ? esc(r.note) : "この日はお休みです";
  } else if (r.status === "joined") {
    tag = `<span class="tag tag-move">振替で参加</span>`;
    sub = `${otherWhen} の授業からの振替`;
  } else if (r.status === "attend") {
    tag = `<span class="tag tag-ok">出席予定</span>`;
    if (!r.closed) actions = `
      <button class="btn btn-sm" data-act="pick" data-id="${id}">振替する</button>
      <button class="btn btn-line btn-sm" data-act="absent" data-id="${id}">欠席する</button>`;
  } else if (r.status === "moved") {
    tag = `<span class="tag tag-move">振替済み</span>`;
    sub = `→ ${otherWhen} に振替`;
    if (!r.closed) actions = `
      <button class="btn btn-line btn-sm" data-act="pick" data-id="${id}">振替先を変える</button>
      <button class="btn-text" data-act="undo" data-id="${id}">取り消す</button>`;
  } else if (r.status === "absent") {
    tag = `<span class="tag tag-warn">欠席</span>`;
    if (!r.closed) actions = `
      <button class="btn btn-line btn-sm" data-act="pick" data-id="${id}">振替する</button>
      <button class="btn-text" data-act="undo" data-id="${id}">取り消す</button>`;
  }
  if (r.closed && !r.cancelled && r.status !== "joined") sub = sub ? `${sub}（受付終了）` : "受付は終了しました";

  return `
    <div class="lesson${r.cancelled ? " is-off" : ""}">
      <div>
        <div class="when">${when}</div>
        <div class="sub">${tag} ${sub ? `<span>${sub}</span>` : ""}</div>
      </div>
      <div class="actions">${actions}</div>
    </div>`;
}

const weekChip = info => {
  const l = weekLabel(info);
  return l ? `<span class="week-chip ${info.kind}">${esc(l)}</span>` : "";
};

// ---------- いまの状況（ページ上部） ----------
// その週の、自分の通常の曜日の日のターム・週（GW などで曜日によって授業の週が分かれるため）
function myDay(date) {
  return wk(addDays(mondayOf(date), (me.student.weekday + 6) % 7));
}

function renderDash() {
  const today = todayStr();
  const info = myDay(today);
  let now = "";
  if (info.kind === "lesson") {
    const plan = yearPlan(info.year, cal);
    const tt = info.term === "A" || info.term === "B" ? "B" : "D";   // 次のAssessment（Spring・Summer→Term、Autumn・Winter→Final）
    const tw = plan.find(p => p.kind === "test" && p.term === tt);
    now = `<div class="now-label">${esc(weekLabel(info))}</div>
      <div class="progress" role="img" aria-label="${termName(info.term)} の ${info.week} 週目（全10週）">${
        Array.from({ length: 10 }, (_, i) => `<i class="${i < info.week ? "on" : ""}${i === info.week - 1 ? " cur" : ""}"></i>`).join("")}</div>
      <div class="now-sub">${termName(info.term)} の ${info.week} 週目（全10週）${tw ? `・${testName(tt)} は ${fmtDate(tw.week_start)} からの週` : ""}</div>`;
  } else if (info.kind === "test") {
    now = `<div class="now-label">${esc(weekLabel(info))}</div><div class="now-sub">今週は ${testName(info.term)} の週です。</div>`;
  } else if (info.kind === "holiday") {
    now = `<div class="now-label">${esc(weekLabel(info))}</div><div class="now-sub">今週はお休みです。</div>`;
  }
  const next = rows.find(r => !r.cancelled && (r.status === "attend" || r.status === "joined")
    && (r.date > today || (r.date === today && r.end_time > new Date().toTimeString().slice(0, 8))));
  const nextHtml = next ? `<div class="next-lesson"><span class="k">次の授業</span>
      <span class="v">${fmtDate(next.date)} ${fmtTime(next.start_time)}〜${fmtTime(next.end_time)}</span>${weekChip(wk(next.date))}</div>` : "";
  $("dashNow").innerHTML = now + nextHtml;
}

// ---------- テスト結果 ----------
function renderTests() {
  const today = todayStr();
  const year = wk(today).year ?? [...cal.years].sort((a, b) => b.start_date.localeCompare(a.start_date))[0]?.id;
  if (!year) {
    $("tests").innerHTML = `<p class="card muted">年間予定がまだ登録されていません。</p>`;
    return;
  }
  const plan = yearPlan(year, cal);
  const item = (y, term, tw) => {
    const r = tests.find(t => t.school_year === y && t.term === term);
    let state;
    if (r?.published && (r.path || r.level)) {
      // 結果はアルファベットだけ（基準は上の説明文に書く）
      state = (r.level ? `<span class="level-badge" aria-label="結果 ${esc(r.level)}"><span class="k">結果</span><span class="v">${esc(r.level)}</span></span>` : "")
        + (r.path ? `<button class="mat-btn" type="button" data-test="${esc(r.path)}">結果を見る</button>` : "");
    } else if (r) state = `<span class="tag tag-move">準備中</span><small class="muted">公開までお待ちください</small>`;
    else if (tw && tw.week_start > today) state = `<span class="tag tag-mute">実施予定</span>`;
    else state = `<span class="tag tag-mute">結果はまだありません</span>`;
    return `<div class="test-row">
      <div><div class="when">${testName(term)}</div>
        <div class="muted">${tw ? `実施週：${fmtDate(tw.week_start)}〜${fmtDate(addDays(tw.week_start, 6))}` : ""}</div></div>
      <div class="actions">${state}</div>
    </div>`;
  };
  const older = tests.filter(t => t.school_year !== year && t.published && (t.path || t.level));
  $("tests").innerHTML = `<h3 class="year-head">${year}年度</h3>`
    + TEST_TERMS.map(term => item(year, term, plan.find(p => p.kind === "test" && p.term === term))).join("")
    + (older.length ? `<h3 class="year-head">これまでの年度</h3>` + older
      .sort((a, b) => b.school_year - a.school_year || a.term.localeCompare(b.term))
      .map(t => item(t.school_year, t.term, null).replace(testName(t.term), `${t.school_year}年度 ${testName(t.term)}`)).join("") : "");
}
$("tests").addEventListener("click", async e => {
  const b = e.target.closest("button[data-test]");
  if (!b) return;
  const w = window.open("", "_blank");
  try {
    const url = await api.testUrl(b.dataset.test);
    if (w) w.location.href = url; else location.href = url;
  } catch (err) {
    if (w) w.close();
    toast(errMsg(err), true);
  }
});

// ---------- 授業の記録と教材 ----------
const MAT = {
  next_homework: "次回の宿題・小テストの範囲",
  answers: "模範解答（小テスト・宿題）",
};
const lessonLabel = l => l.week_kind === "lesson" ? `Week ${l.week}` : l.week_kind === "test" ? testName(l.term) : "";
const matBtn = (m, kind) => m[kind] ? `<button class="mat-btn" type="button" data-path="${esc(m[kind])}">${MAT[kind]}</button>` : "";

function renderResults() {
  const max = settings.quiz_max ?? 20;
  $("scaleNote").textContent = `小テストは${max}点満点です。積極性と宿題は S・A・B の3段階で評価します（S：とてもよくできた　A：よくできた　B：もう少し）。` +
    "宿題・小テストの範囲・模範解答、小テストの答案は、各回の授業が終わると見られるようになります。";

  // いちばん新しい回の「次回までに」
  const latest = lessons.find(l => l.materials && l.materials.next_homework);
  $("nextBox").innerHTML = latest ? `
    <div class="next-box">
      <h3>次回までに</h3>
      <p>${fmtDate(latest.date)}（${esc(lessonLabel(latest))}）の授業で出された宿題と、次回の小テストの範囲です。</p>
      <div class="mat-btns">${matBtn(latest.materials, "next_homework")}</div>
    </div>` : "";

  if (!lessons.length) {
    $("results").innerHTML = `<p class="card muted">まだ受けた授業の記録はありません。授業が終わると、ここに成績と教材が表示されます。</p>`;
    return;
  }
  const val = (v, suffix = "") => v == null || v === ""
    ? `<span class="v none">未入力</span>` : `<span class="v">${esc(Number.isFinite(+v) && suffix ? +v : v)}${suffix}</span>`;
  let lastTerm = null;
  $("results").innerHTML = lessons.map(l => {
    const termKey = l.term ? `${l.school_year}年度 ${l.week_kind === "test" ? testName(l.term) : termName(l.term)}` : "";
    const head = termKey && termKey !== lastTerm ? `<h3 class="year-head">${esc(termKey)}</h3>` : "";
    lastTerm = termKey || lastTerm;
    const tag = l.status === "absent" ? `<span class="tag tag-warn">欠席</span>`
      : l.status === "joined" ? `<span class="tag tag-move">振替で参加</span>` : `<span class="tag tag-ok">出席</span>`;
    const m = l.materials || {};
    const mats = Object.keys(MAT).map(k => matBtn(m, k)).join("");
    return `${head}<article class="result">
      <div class="result-head">
        <span class="when">${esc(lessonLabel(l))}<small>${fmtDate(l.date)} ${fmtTime(l.start_time)}〜${fmtTime(l.end_time)}</small></span>${tag}
      </div>
      ${l.status === "absent" || l.week_kind === "test" ? "" : `<div class="scores">
        <div class="score-box"><span class="k">小テスト</span>${l.quiz_score == null ? val(null) : `<span class="v">${+l.quiz_score}<small> / ${max}</small></span>`}${l.quiz_pdf ? `<button class="quiz-open" type="button" data-quiz="${esc(l.quiz_pdf)}">答案を見る</button>` : ""}</div>
        <div class="score-box"><span class="k">積極性</span>${val(l.participation)}</div>
        <div class="score-box"><span class="k">宿題</span>${l.homework === "なし" ? `<span class="v none">宿題なし</span>` : val(l.homework)}</div>
      </div>`}
      ${mats ? `<div class="mat-btns">${mats}</div>` : l.week_kind === "test" ? `<p class="muted" style="margin:8px 0 0">Assessment の結果は「テスト結果」タブに公開されます。</p>` : `<p class="muted" style="margin:8px 0 0">この回の教材はまだ登録されていません。</p>`}
    </article>`;
  }).join("");
}

async function openMaterial(path) {
  const w = window.open("", "_blank");
  try {
    const url = await api.materialUrl(path);
    if (w) w.location.href = url; else location.href = url;
  } catch (err) {
    if (w) w.close();
    toast(errMsg(err), true);
  }
}
for (const id of ["nextBox", "results"]) {
  $(id).addEventListener("click", e => {
    const b = e.target.closest("button[data-path]");
    if (b) openMaterial(b.dataset.path);
  });
}
// 小テストの答案PDF
$("results").addEventListener("click", async e => {
  const b = e.target.closest("button[data-quiz]");
  if (!b) return;
  const w = window.open("", "_blank");
  try {
    const url = await api.quizUrl(b.dataset.quiz);
    if (w) w.location.href = url; else location.href = url;
  } catch (err) {
    if (w) w.close();
    toast(errMsg(err), true);
  }
});

// ---------- 操作 ----------
$("weeks").addEventListener("click", e => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const r = rows.find(x => x.session_id === Number(b.dataset.id));
  if (!r) return;
  if (b.dataset.act === "pick") openPicker(r);
  if (b.dataset.act === "absent") confirmAbsent(r);
  if (b.dataset.act === "undo") confirmUndo(r);
});

function openPicker(from) {
  $("pickSub").textContent = `${fmtDate(from.date)} ${fmtTime(from.start_time)} の授業を休んで、次の授業に参加します`;
  const wk = mondayOf(from.date);
  const cands = rows.filter(r => !r.is_regular && (!settings.same_week_only || mondayOf(r.date) === wk));
  if (!cands.length) {
    $("pickList").innerHTML = `<p class="muted" style="margin-top:16px">振替できる授業がありません。</p>`;
  } else {
    $("pickList").innerHTML = cands.map(c => {
      let state, ok = false;
      if (c.cancelled) state = `<span class="tag tag-ng">休校</span>`;
      else if (c.session_id === from.other_session_id) state = `<span class="tag tag-move">いまの振替先</span>`;
      else if (c.status === "joined") state = `<span class="tag tag-mute">参加予定</span>`;
      else if (c.closed) state = `<span class="tag tag-mute">受付終了</span>`;
      else if (c.seats_left <= 0) state = `<span class="tag tag-ng">満席</span>`;
      else { state = `<span class="tag tag-ok">残り${c.seats_left}席</span>`; ok = true; }
      return `<button class="choice" type="button" data-to="${c.session_id}" ${ok ? "" : "disabled"}>
        <span class="d">${fmtDate(c.date)}<small>${fmtTime(c.start_time)}〜${fmtTime(c.end_time)}</small></span>${state}</button>`;
    }).join("");
  }
  $("pickList").onclick = async e => {
    const b = e.target.closest("button[data-to]");
    if (!b || b.disabled) return;
    const to = rows.find(x => x.session_id === Number(b.dataset.to));
    $("pickDlg").close();
    const ok = await ask("振替の確認",
      `${fmtDate(from.date)} ${fmtTime(from.start_time)} を休んで、${fmtDate(to.date)} ${fmtTime(to.start_time)} の授業に参加します。`);
    if (!ok) return;
    await run(() => api.requestChange(from.session_id, to.session_id), `${fmtDate(to.date)} に振り替えました`);
  };
  $("pickDlg").showModal();
}

async function confirmAbsent(r) {
  const ok = await ask("欠席の確認", `${fmtDate(r.date)} ${fmtTime(r.start_time)} の授業を欠席します。あとから振替することもできます。`);
  if (ok) await run(() => api.requestChange(r.session_id, null), "欠席を登録しました");
}

async function confirmUndo(r) {
  const what = r.status === "moved" ? "振替" : "欠席";
  const ok = await ask(`${what}の取り消し`, `${what}を取り消して、${fmtDate(r.date)} ${fmtTime(r.start_time)} の通常の授業に戻します。`);
  if (ok) await run(() => api.cancelChange(r.change_id), "通常の授業に戻しました");
}

async function run(fn, okMsg) {
  try {
    await fn();
    toast(okMsg);
  } catch (err) {
    toast(errMsg(err), true);
  }
  await refresh();
}

function ask(title, text) {
  return new Promise(resolve => {
    const dlg = $("confirmDlg");
    $("confirmTitle").textContent = title;
    $("confirmText").textContent = text;
    dlg.returnValue = "";
    dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true });
    dlg.showModal();
  });
}

for (const b of document.querySelectorAll("[data-close]")) {
  b.addEventListener("click", () => b.closest("dialog").close());
}

// ---------- パスワード変更 ----------
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

// ほかの画面に戻ってきたときに最新にする
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && me?.role === "student") refresh();
});

start().catch(err => { show("loginView"); toast(errMsg(err), true); });
