import { createApi } from "./api.js";
import { TERMS, WEEKDAYS, addDays, dow, esc, errMsg, fmtDate, fmtTime, mondayOf, todayStr, toast, weekInfo, weekLabel, yearPlan } from "./common.js";

const $ = id => document.getElementById(id);
const cfg = window.PORTAL_CONFIG || {};
if (cfg.homeUrl) $("homeLink").href = cfg.homeUrl;

const api = await createApi();
if (api.demo) $("demoBar").hidden = false;

let tab = "week";
// 日曜日は授業がないので、次の週を「今週」として出す
const currentWeek = () => mondayOf(dow(todayStr()) === 0 ? addDays(todayStr(), 1) : todayStr());
let weekStart = currentWeek();
let gradeDay = todayStr();
let calYear = null;
let testYear = null;
let testTerm = "A";
let data = null;

$("logoutBtn").addEventListener("click", async () => {
  await api.signOut();
  location.href = "index.html";
});
$("resetDemo")?.addEventListener("click", () => {
  if (confirm("お試しデータを最初の状態に戻しますか？")) api.resetDemo?.();
});

// ---------- タブ ----------
for (const b of document.querySelectorAll("[data-tab]")) {
  b.addEventListener("click", () => {
    tab = b.dataset.tab;
    for (const x of document.querySelectorAll("[data-tab]")) x.setAttribute("aria-selected", String(x === b));
    for (const p of document.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== tab;
    reload();
  });
}

let cal = { years: [], holidays: [] };
const wk = date => weekInfo(date, cal);

async function reload() {
  try {
    cal = await api.calendar();
    if (tab === "week") {
      data = await api.adminData(weekStart, addDays(weekStart, 6));
      renderWeek();
    } else if (tab === "grades") {
      data = await api.adminData(gradeDay, gradeDay);
      data.gd = await api.gradeData(gradeDay, gradeDay);
      renderGrades();
    } else if (tab === "calendar") {
      renderCalendar();
    } else if (tab === "tests") {
      data = await api.adminData(todayStr(), todayStr());
      fillYearSelect($("testYear"), testYear);
      testYear = Number($("testYear").value) || null;
      data.td = testYear ? await api.testData(testYear, testTerm) : null;
      renderTests();
    } else if (tab === "materials") {
      data = await api.adminData(todayStr(), todayStr());
      data.mats = await api.materials();
      renderMaterials();
    } else if (tab === "sessions") {
      const from = currentWeek();
      data = await api.adminData(from, addDays(from, 7 * 12 - 1));
      renderSessions();
    } else {
      data = await api.adminData(todayStr(), todayStr());
      if (tab === "students") renderStudents();
      if (tab === "settings") renderSettings();
    }
  } catch (err) {
    toast(errMsg(err), true);
  }
}

const studentById = id => data.students.find(s => s.id === id);
const className = id => data.classes.find(c => c.id === id)?.name ?? id;

// ある授業に来る生徒・来ない生徒
function rosterOf(s) {
  const present = [], away = [];
  const regs = data.students.filter(st => st.active && st.class_id === s.class_id && st.weekday === dow(s.date));
  for (const st of regs) {
    const c = data.changes.find(x => x.student_id === st.id && x.from_session_id === s.id);
    if (!c) present.push({ st, kind: "regular" });
    else away.push({ st, kind: c.to_session_id ? "moved" : "absent", change: c });
  }
  for (const c of data.changes.filter(x => x.to_session_id === s.id)) {
    const st = studentById(c.student_id);
    if (st?.active) present.push({ st, kind: "joined", change: c });
  }
  const byName = (a, b) => a.st.name.localeCompare(b.st.name, "ja");
  return { present: present.sort(byName), away: away.sort(byName) };
}

// ---------- 出席表 ----------
$("prevWeek").addEventListener("click", () => { weekStart = addDays(weekStart, -7); reload(); });
$("nextWeek").addEventListener("click", () => { weekStart = addDays(weekStart, 7); reload(); });
$("thisWeek").addEventListener("click", () => { weekStart = currentWeek(); reload(); });

function renderWeek() {
  const lbl = weekLabel(wk(weekStart));
  $("weekRange").textContent = `${fmtDate(weekStart)} 〜 ${fmtDate(addDays(weekStart, 6))}${lbl ? `　${lbl}` : ""}`;
  $("updatedAt").textContent = "最終更新 " + new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dates = [...new Set(data.sessions.map(s => s.date))];
  if (!dates.length) {
    $("days").innerHTML = `<p class="card muted">この週の授業日がありません。「授業日・休校」タブで作成してください。</p>`;
    return;
  }
  const cap = data.settings.capacity;
  const today = todayStr();
  $("days").innerHTML = dates.map(d => `
    <article class="day${d === today ? " is-today" : ""}">
      <div class="day-head"><span class="d">${fmtDate(d)}</span>${d === today ? `<span class="today">今日</span>` : ""}</div>
      ${data.sessions.filter(s => s.date === d).map(s => {
        const head = `<span class="n">${esc(className(s.class_id))}<span class="muted" style="margin-left:8px">${fmtTime(s.start_time)}〜${fmtTime(s.end_time)}</span></span>`;
        if (s.cancelled) {
          return `<div class="klass"><div class="klass-head">${head}<span class="tag tag-ng">休校</span></div>
            ${s.note ? `<div class="cancelled-box">${esc(s.note)}</div>` : ""}</div>`;
        }
        const { present, away } = rosterOf(s);
        const n = present.length, full = n >= cap;
        return `<div class="klass">
          <div class="klass-head">${head}<span class="count${full ? " full" : ""}">${n} / ${cap}</span></div>
          <div class="meter${full ? " full" : ""}"><i style="width:${Math.min(100, n / cap * 100)}%"></i></div>
          <ul class="roster">
            ${present.map(p => rowHtml(p, s)).join("")}
            ${away.map(p => rowHtml(p, s)).join("")}
            ${!present.length && !away.length ? `<li class="muted">生徒はいません</li>` : ""}
          </ul>
        </div>`;
      }).join("")}
    </article>`).join("");
}

function rowHtml(p, s) {
  const other = p.kind === "joined" ? p.change.from_s : p.kind === "moved" ? p.change.to_s : null;
  const otherTxt = other ? fmtDate(other.date) : "";
  const tag = {
    regular: `<span class="tag tag-ok">通常</span>`,
    joined: `<span class="tag tag-move">振替</span>`,
    moved: `<span class="tag tag-mute">振替済</span>`,
    absent: `<span class="tag tag-warn">欠席</span>`,
  }[p.kind];
  const sub = p.kind === "joined" ? `${otherTxt}から` : p.kind === "moved" ? `→ ${otherTxt}へ` : "";
  const btn = p.kind === "regular"
    ? `<button class="mini" data-absent="${s.id}" data-st="${p.st.id}" title="電話などで連絡があったとき">欠席にする</button>`
    : `<button class="mini" data-undo="${p.change.id}">取消</button>`;
  const out = p.kind === "moved" || p.kind === "absent";
  return `<li class="${out ? "out" : ""}"><span><span class="nm">${esc(p.st.name)}</span>${sub ? `<small class="from">${sub}</small>` : ""}</span><span class="right">${tag}${btn}</span></li>`;
}

$("days").addEventListener("click", async e => {
  const a = e.target.closest("[data-absent]");
  const u = e.target.closest("[data-undo]");
  try {
    if (a) {
      const st = studentById(a.dataset.st);
      if (!confirm(`${st.name} さんを欠席にしますか？`)) return;
      await api.requestChange(Number(a.dataset.absent), null, st.id);
      toast("欠席にしました");
    } else if (u) {
      if (!confirm("この振替・欠席を取り消して、通常の曜日に戻しますか？")) return;
      await api.cancelChange(Number(u.dataset.undo));
      toast("取り消しました");
    } else return;
  } catch (err) {
    toast(errMsg(err), true);
  }
  reload();
});

// ---------- 成績入力 ----------
const LEVELS = ["S", "A", "B"];
const KINDS = [
  ["next_homework", "次回までの宿題"], ["next_quiz_range", "次回の小テスト範囲"],
  ["quiz_answer", "小テストの模範解答"], ["homework_answer", "宿題の模範解答"],
];
$("prevDay").addEventListener("click", () => { gradeDay = addDays(gradeDay, -1); reload(); });
$("nextDay").addEventListener("click", () => { gradeDay = addDays(gradeDay, 1); reload(); });
$("gradeToday").addEventListener("click", () => { gradeDay = todayStr(); reload(); });
$("gradeDate").addEventListener("change", e => { if (e.target.value) { gradeDay = e.target.value; reload(); } });

function renderGrades() {
  const max = data.settings.quiz_max ?? 20;
  $("gradeDate").value = gradeDay;
  $("gradeNote").textContent = `小テストは${max}点満点です。積極性・宿題は S・A・B の3段階で入力してください（S：とてもよくできた　A：よくできた　B：もう少し）。入力すると自動で保存され、生徒のMyページにはその授業が終わったあとに表示されます。`;
  const sessions = data.sessions.filter(s => s.date === gradeDay && !s.cancelled);
  if (!sessions.length) {
    $("gradeDays").innerHTML = `<p class="card muted">${fmtDate(gradeDay)} は授業がありません。</p>`;
    return;
  }
  const gradeOf = (sid, stid) => data.gd.grades.find(g => g.session_id === sid && g.student_id === stid) || {};
  const sel = (f, v) => `<select class="input" data-f="${f}"><option value="">—</option>${LEVELS.map(l =>
    `<option ${v === l ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  $("gradeDays").innerHTML = sessions.map(s => {
    const { present, away } = rosterOf(s);
    const info = wk(s.date);
    const head = `<div class="day-head"><span class="d">${esc(className(s.class_id))}</span><span>${fmtTime(s.start_time)}〜${fmtTime(s.end_time)}</span></div>
      <div class="week-chip ${info.kind}">${esc(weekLabel(info) || "年間予定の範囲外")}</div>`;
    if (info.kind === "test") {
      return `<article class="day">${head}<div class="klass"><p class="muted" style="margin:0">Test Week のため、この日の成績入力はありません。結果は「テスト結果」タブでPDFを登録してください。</p></div></article>`;
    }
    return `<article class="day" data-session="${s.id}">
      ${head}
      <div class="klass">
        ${present.length ? `<table class="list grade-table">
          <thead><tr><th>名前</th><th>小テスト<small>／${max}</small></th><th>積極性</th><th>宿題</th></tr></thead>
          <tbody>${present.map(p => {
            const g = gradeOf(s.id, p.st.id);
            return `<tr data-st="${p.st.id}">
              <td><span class="nm">${esc(p.st.name)}</span>${p.kind === "joined" ? `<small class="from">振替で参加</small>` : ""}</td>
              <td><input class="input score" type="number" inputmode="decimal" min="0" max="${max}" step="0.5" data-f="quiz_score" value="${g.quiz_score ?? ""}" aria-label="小テストの点数"></td>
              <td>${sel("participation", g.participation)}</td>
              <td>${sel("homework", g.homework)}</td>
            </tr>`;
          }).join("")}</tbody></table>` : `<p class="muted">出席する生徒はいません</p>`}
        ${away.length ? `<p class="muted" style="margin:10px 0 0">欠席・振替：${away.map(p => esc(p.st.name)).join("、")}</p>` : ""}
      </div>
    </article>`;
  }).join("");
}

$("gradeDays").addEventListener("change", async e => {
  const el = e.target.closest("[data-f]");
  const tr = e.target.closest("tr[data-st]");
  const card = e.target.closest("[data-session]");
  if (!el || !tr || !card) return;
  const f = el.dataset.f;
  let v = el.value === "" ? null : el.value;
  if (f === "quiz_score" && v !== null) {
    v = Number(v);
    const max = data.settings.quiz_max ?? 20;
    if (!(v >= 0 && v <= max)) { toast(`点数は0〜${max}で入力してください`, true); el.focus(); return; }
  }
  try {
    await api.saveGrade(Number(card.dataset.session), tr.dataset.st, { [f]: v });
    toast("保存しました");
  } catch (err) {
    toast(errMsg(err), true);
  }
});

// ---------- 年間予定 ----------
function fillYearSelect(sel, current) {
  const years = [...cal.years].sort((a, b) => b.start_date.localeCompare(a.start_date));
  const now = wk(todayStr()).year;
  const value = String(current ?? now ?? years[0]?.id ?? "");
  sel.innerHTML = years.map(y => `<option value="${y.id}" ${String(y.id) === value ? "selected" : ""}>${y.id}年度${y.note ? `（${esc(y.note)}）` : ""}</option>`).join("")
    + (sel.id === "calYear" ? `<option value="new" ${value === "new" ? "selected" : ""}>＋ 新しい年度を追加</option>` : "");
}

function renderCalendar() {
  fillYearSelect($("calYear"), calYear);
  const v = $("calYear").value;
  const f = $("yearForm");
  if (v === "new" || !cal.years.length) {
    calYear = "new";
    f.id.value = ""; f.start_date.value = ""; f.note.value = "";
    $("calSummary").textContent = "新しい年度の数字と、Term A Week 1 の週を入れて「年度を保存」を押してください。";
    $("calTable").innerHTML = "";
    return;
  }
  calYear = Number(v);
  const y = cal.years.find(x => x.id === calYear);
  f.id.value = y.id; f.start_date.value = y.start_date; f.note.value = y.note || "";
  const plan = yearPlan(calYear, cal);
  const last = plan[plan.length - 1];
  $("calSummary").textContent = plan.length
    ? `${fmtDate(plan[0].week_start)} から ${fmtDate(addDays(last.week_start, 6))} まで（休み ${plan.filter(p => p.kind === "holiday").length} 週）`
    : "";
  const today = mondayOf(todayStr());
  $("calTable").innerHTML = `
    <thead><tr><th>週</th><th>区分</th><th>休み</th><th>休みの名前（生徒に表示）</th></tr></thead>
    <tbody>${plan.map(p => `
      <tr class="cal-${p.kind}${p.week_start === today ? " is-now" : ""}" data-week="${p.week_start}">
        <td>${fmtDate(p.week_start)} 〜 ${fmtDate(addDays(p.week_start, 6))}${p.week_start === today ? ` <span class="tag tag-move">今週</span>` : ""}</td>
        <td><span class="week-chip ${p.kind}">${esc(p.kind === "holiday" ? "お休み" : weekLabel(p))}</span></td>
        <td><input type="checkbox" data-f="holiday" ${p.kind === "holiday" ? "checked" : ""} aria-label="休み"></td>
        <td>${p.kind === "holiday" ? `<input class="input" data-f="note" value="${esc(p.note)}" placeholder="例：夏休み" style="width:100%">` : ""}</td>
      </tr>`).join("")}</tbody>`;
}

$("calYear").addEventListener("change", e => {
  calYear = e.target.value === "new" ? "new" : Number(e.target.value);
  renderCalendar();
});

$("yearForm").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  if (!f.id.value || !f.start_date.value) return toast("年度と Term A Week 1 の週を入れてください", true);
  try {
    await api.saveYear({ id: Number(f.id.value), start_date: f.start_date.value, note: f.note.value.trim() || null });
    calYear = Number(f.id.value);
    toast("年度を保存しました");
  } catch (err) {
    toast(errMsg(err), true);
  }
  reload();
});

$("calTable").addEventListener("change", async e => {
  const tr = e.target.closest("tr[data-week]");
  if (!tr) return;
  const week = tr.dataset.week;
  try {
    if (e.target.dataset.f === "holiday") {
      const on = e.target.checked;
      if (on && !confirm(`${fmtDate(week)} の週を休みにします。この週の授業は休校になり、それ以降の Term・Week が1週ずつ後ろにずれます。よろしいですか？`)) {
        e.target.checked = false; return;
      }
      if (!on && !confirm(`${fmtDate(week)} の週の休みを解除します。それ以降の Term・Week が1週ずつ前にずれます。よろしいですか？`)) {
        e.target.checked = true; return;
      }
      await api.setHoliday(week, on, null);
      toast(on ? "休みにしました" : "休みを解除しました");
    } else if (e.target.dataset.f === "note") {
      await api.setHoliday(week, true, e.target.value.trim() || null);
      toast("保存しました");
    }
  } catch (err) {
    toast(errMsg(err), true);
  }
  reload();
});

// ---------- テスト結果 ----------
$("testYear").addEventListener("change", e => { testYear = Number(e.target.value); reload(); });
$("testTerm").addEventListener("change", e => { testTerm = e.target.value; reload(); });

function renderTests() {
  $("testTerm").value = testTerm;
  if (!testYear || !data.td) {
    $("publishBox").innerHTML = "";
    $("testGroups").innerHTML = `<p class="card muted">年間予定に年度がありません。「年間予定」タブで作成してください。</p>`;
    return;
  }
  const plan = yearPlan(testYear, cal);
  const tw = plan.find(p => p.kind === "test" && p.term === testTerm);
  const { published, published_at, results } = data.td;
  $("publishBox").innerHTML = `
    <span class="muted">${tw ? `Test Week · Term ${testTerm}：${fmtDate(tw.week_start)}〜${fmtDate(addDays(tw.week_start, 6))}` : ""}</span>
    ${published ? `<span class="tag tag-ok">公開中</span>` : `<span class="tag tag-mute">非公開</span>`}
    <button class="btn btn-sm ${published ? "btn-line" : ""}" type="button" id="publishBtn">${published ? "非公開に戻す" : "公開する"}</button>`;
  const active = data.students.filter(st => st.active);
  $("testCount").textContent = `アップロード済み ${results.filter(r => active.some(st => st.id === r.student_id)).length} / ${active.length} 人`;
  $("testGroups").innerHTML = data.classes.map(c => {
    const list = active.filter(st => st.class_id === c.id).sort((a, b) => a.login_id.localeCompare(b.login_id));
    if (!list.length) return "";
    return `<article class="day">
      <div class="day-head"><span class="d">${esc(c.name)}</span><span>${list.length}名</span></div>
      <div class="klass"><ul class="roster">${list.map(st => {
        const r = results.find(x => x.student_id === st.id);
        return `<li data-st="${st.id}">
          <span><span class="nm">${esc(st.name)}</span><small class="from">${esc(st.login_id)}・${WEEKDAYS[st.weekday]}曜${r ? `・${new Date(r.uploaded_at).toLocaleDateString("ja-JP")} 登録` : ""}</small></span>
          <span class="right">
            ${r ? `<span class="tag tag-ok">登録済み</span><button class="mini" type="button" data-open="${esc(r.path)}">開く</button><button class="mini" type="button" data-del="1">削除</button>`
                : `<span class="tag tag-mute">未登録</span>`}
            <label class="mini" style="cursor:pointer">${r ? "差し替え" : "PDFを選ぶ"}<input type="file" accept="application/pdf" data-up="1" hidden></label>
          </span>
        </li>`;
      }).join("")}</ul></div>
    </article>`;
  }).join("");
}

$("publishBox").addEventListener("click", async e => {
  if (e.target.id !== "publishBtn") return;
  const on = !data.td.published;
  const msg = on ? `${testYear}年度 Term ${testTerm} のテスト結果を公開します。アップロード済みの生徒は、自分の結果を見られるようになります。よろしいですか？`
    : `${testYear}年度 Term ${testTerm} のテスト結果を非公開に戻します。よろしいですか？`;
  if (!confirm(msg)) return;
  try {
    await api.setTestPublished(testYear, testTerm, on);
    toast(on ? "公開しました" : "非公開に戻しました");
  } catch (err) {
    toast(errMsg(err), true);
  }
  reload();
});

async function uploadOne(studentId, file) {
  if (file.type && file.type !== "application/pdf") throw new Error(`${file.name} はPDFではありません`);
  await api.uploadTest(testYear, testTerm, studentId, file);
}

$("testGroups").addEventListener("change", async e => {
  if (!e.target.matches("input[data-up]")) return;
  const li = e.target.closest("li[data-st]");
  const file = e.target.files[0];
  if (!file) return;
  try {
    await uploadOne(li.dataset.st, file);
    toast("アップロードしました");
  } catch (err) {
    toast(errMsg(err), true);
  }
  reload();
});

$("testGroups").addEventListener("click", async e => {
  const li = e.target.closest("li[data-st]");
  if (!li) return;
  if (e.target.dataset.open) {
    const w = window.open("", "_blank");
    try {
      const url = await api.testUrl(e.target.dataset.open);
      if (w) w.location.href = url; else location.href = url;
    } catch (err) {
      if (w) w.close();
      toast(errMsg(err), true);
    }
  } else if (e.target.dataset.del) {
    if (!confirm("このPDFを削除しますか？")) return;
    try {
      await api.deleteTest(testYear, testTerm, li.dataset.st);
      toast("削除しました");
    } catch (err) {
      toast(errMsg(err), true);
    }
    reload();
  }
});

// ファイル名にログインIDが入っているPDFを、まとめて登録する
$("bulkTest").addEventListener("change", async e => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length || !testYear) return;
  const active = data.students.filter(st => st.active);
  const matched = [], unknown = [];
  for (const f of files) {
    const base = f.name.replace(/\.pdf$/i, "").toLowerCase();
    const st = active.find(x => base === x.login_id) || active.find(x => base.includes(x.login_id));
    if (st) matched.push([st, f]); else unknown.push(f.name);
  }
  if (!matched.length) return toast("ファイル名からログインIDが見つかりませんでした（例：s26001.pdf）", true);
  if (!confirm(`${matched.length}件を Term ${testTerm} の結果として登録します。` + (unknown.length ? `\n登録できないファイル：${unknown.join("、")}` : ""))) return;
  let ok = 0;
  for (const [st, f] of matched) {
    try { await uploadOne(st.id, f); ok++; } catch (err) { toast(errMsg(err), true); }
  }
  toast(`${ok}件をアップロードしました`);
  reload();
});

// ---------- 教材 ----------
function renderMaterials() {
  const mats = data.mats || [];
  if (!mats.length) {
    $("matTables").innerHTML = `<p class="card muted">まだ教材PDFが登録されていません。</p>`;
    return;
  }
  $("matTables").innerHTML = data.classes.map(c => {
    const list = mats.filter(m => m.class_id === c.id);
    if (!list.length) return "";
    const keys = [...new Set(list.map(m => `${m.term}|${m.week}`))]
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    const rows = [];
    for (const key of keys) {
      const [term, week] = [key.split("|")[0], Number(key.split("|")[1])];
      rows.push(`<tr><td style="white-space:nowrap">Term ${term} · Week ${week}</td>${KINDS.map(([k]) => {
        const m = list.find(x => x.term === term && x.week === week && x.kind === k);
        return `<td>${m ? `<button class="mini" type="button" data-path="${esc(m.path)}">✓ 開く</button>` : `<span class="muted">—</span>`}</td>`;
      }).join("")}</tr>`);
    }
    return `<h3 class="mat-title">${esc(c.name)}</h3>
      <div class="table-wrap"><table class="list">
        <thead><tr><th>週</th>${KINDS.map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead>
        <tbody>${rows.join("")}</tbody></table></div>`;
  }).join("");
}

$("matTables").addEventListener("click", async e => {
  const b = e.target.closest("button[data-path]");
  if (!b) return;
  const w = window.open("", "_blank");
  try {
    const url = await api.materialUrl(b.dataset.path);
    if (w) w.location.href = url; else location.href = url;
  } catch (err) {
    if (w) w.close();
    toast(errMsg(err), true);
  }
});

// ---------- 授業日・休校 ----------
{
  const f = $("genForm");
  const from = currentWeek();
  f.from.value = from;
  f.to.value = addDays(from, 7 * 12 - 1);
  f.addEventListener("submit", async e => {
    e.preventDefault();
    if (!f.from.value || !f.to.value || f.to.value < f.from.value) return toast("期間を正しく入力してください", true);
    try {
      const n = await api.generateSessions(f.from.value, f.to.value);
      toast(`${n}件の授業日を作成しました`);
    } catch (err) {
      toast(errMsg(err), true);
    }
    reload();
  });
}

function renderSessions() {
  if (!data.sessions.length) {
    $("sessTable").innerHTML = `<tr><td class="muted">これから12週間の授業日がありません。上のフォームで作成してください。</td></tr>`;
    return;
  }
  $("sessTable").innerHTML = `
    <thead><tr><th>日付</th><th>週</th><th>クラス</th><th>時間</th><th>休校</th><th>生徒へのお知らせ（休校の理由など）</th></tr></thead>
    <tbody>${data.sessions.map(s => `
      <tr data-id="${s.id}">
        <td>${fmtDate(s.date)}</td>
        <td style="white-space:nowrap">${esc(weekLabel(wk(s.date)))}</td>
        <td>${esc(className(s.class_id))}</td>
        <td>${fmtTime(s.start_time)}〜${fmtTime(s.end_time)}</td>
        <td><input type="checkbox" data-f="cancelled" ${s.cancelled ? "checked" : ""} aria-label="休校"></td>
        <td><input class="input" data-f="note" value="${esc(s.note)}" placeholder="例：祝日のため休校" style="width:100%"></td>
      </tr>`).join("")}</tbody>`;
}

$("sessTable").addEventListener("change", async e => {
  const tr = e.target.closest("tr[data-id]");
  if (!tr) return;
  const f = e.target.dataset.f;
  const v = f === "cancelled" ? e.target.checked : e.target.value.trim() || null;
  if (f === "cancelled" && v) {
    const s = data.sessions.find(x => x.id === Number(tr.dataset.id));
    if (!confirm(`${fmtDate(s.date)} ${className(s.class_id)} を休校にしますか？`)) { e.target.checked = false; return; }
  }
  try {
    await api.updateSession(Number(tr.dataset.id), { [f]: v });
    toast("保存しました");
  } catch (err) {
    toast(errMsg(err), true);
    reload();
  }
});

// ---------- 生徒名簿 ----------
// 名簿の正本は Google スプレッドシート（tools/google-sheets-sync.gs で同期）。ここでは表示だけ行う。
// クラスごとのカードに、時間割の曜日ごとに在籍の生徒を並べる。退会・休会の生徒は最後にまとめる。
function renderStudents() {
  const byName = (a, b) => a.name.localeCompare(b.name, "en");
  const active = data.students.filter(st => st.active);
  const inactive = data.students.filter(st => !st.active).sort(byName);
  const item = st => `<li><span><span class="nm">${esc(st.name)}</span><small class="from">${esc(st.login_id)}</small></span></li>`;
  const shown = new Set();

  const cards = [...data.classes].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map(c => {
    const slots = data.schedule.filter(x => x.class_id === c.id).sort((a, b) => a.weekday - b.weekday);
    const total = active.filter(st => st.class_id === c.id).length;
    const sections = slots.map(x => {
      const list = active.filter(st => st.class_id === c.id && st.weekday === x.weekday).sort(byName);
      list.forEach(st => shown.add(st.id));
      return `<div class="klass">
        <div class="klass-head"><span class="n">${WEEKDAYS[x.weekday]}曜<span class="muted" style="margin-left:8px">${fmtTime(x.start_time)}〜${fmtTime(x.end_time)}</span></span><span class="count">${list.length}名</span></div>
        <ul class="roster">${list.map(item).join("") || `<li class="muted">生徒はいません</li>`}</ul>
      </div>`;
    }).join("");
    return `<article class="day">
      <div class="day-head"><span class="d">${esc(c.name)}</span><span>${total}名</span></div>
      ${sections || `<div class="klass muted">時間割がありません</div>`}
    </article>`;
  });

  // 時間割にないクラス・曜日の生徒（念のため）
  const stray = active.filter(st => !shown.has(st.id)).sort(byName);
  if (stray.length) cards.push(`<article class="day">
    <div class="day-head"><span class="d">時間割にない曜日</span><span>${stray.length}名</span></div>
    <div class="klass"><ul class="roster">${stray.map(st =>
      `<li><span><span class="nm">${esc(st.name)}</span><small class="from">${esc(st.login_id)}・${esc(className(st.class_id))} ${WEEKDAYS[st.weekday]}曜</small></span></li>`).join("")}</ul></div>
  </article>`);

  if (inactive.length) cards.push(`<article class="day">
    <div class="day-head"><span class="d">退会・休会</span><span>${inactive.length}名</span></div>
    <div class="klass"><ul class="roster">${inactive.map(st =>
      `<li class="out"><span><span class="nm">${esc(st.name)}</span><small class="from">${esc(st.login_id)}・${esc(className(st.class_id))} ${WEEKDAYS[st.weekday]}曜</small></span></li>`).join("")}</ul></div>
  </article>`);

  $("stuGroups").innerHTML = cards.join("");
}

// ---------- 設定 ----------
function renderSettings() {
  const f = $("setForm"), s = data.settings;
  f.capacity.value = s.capacity;
  f.deadline_minutes.value = s.deadline_minutes;
  f.weeks_ahead.value = s.weeks_ahead;
  f.same_week_only.checked = s.same_week_only;
  f.quiz_max.value = s.quiz_max ?? 20;
  $("schedTable").innerHTML = `
    <thead><tr><th>クラス</th><th>曜日</th><th>開始</th><th>終了</th></tr></thead>
    <tbody>${data.schedule.map(x => `
      <tr data-c="${x.class_id}" data-w="${x.weekday}">
        <td>${esc(className(x.class_id))}</td><td>${WEEKDAYS[x.weekday]}曜</td>
        <td><input class="input" type="time" data-f="start_time" value="${fmtTime(x.start_time)}"></td>
        <td><input class="input" type="time" data-f="end_time" value="${fmtTime(x.end_time)}"></td>
      </tr>`).join("")}</tbody>`;
}

$("setForm").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  try {
    await api.updateSettings({
      capacity: Number(f.capacity.value),
      deadline_minutes: Number(f.deadline_minutes.value),
      weeks_ahead: Number(f.weeks_ahead.value),
      same_week_only: f.same_week_only.checked,
      quiz_max: Number(f.quiz_max.value),
    });
    toast("設定を保存しました");
  } catch (err) {
    toast(errMsg(err), true);
  }
  reload();
});

$("schedTable").addEventListener("change", async e => {
  const tr = e.target.closest("tr[data-c]");
  if (!tr) return;
  const inputs = tr.querySelectorAll("input");
  try {
    await api.updateSchedule({ class_id: tr.dataset.c, weekday: Number(tr.dataset.w),
      start_time: inputs[0].value + ":00", end_time: inputs[1].value + ":00" });
    toast("時間割を保存しました");
  } catch (err) {
    toast(errMsg(err), true);
  }
});

// ---------- 起動 ----------
const me = await api.me().catch(() => null);
if (!me || me.role !== "admin") {
  location.href = "index.html";
} else {
  $("whoName").textContent = me.admin.name;
  $("headerUser").hidden = false;
  $("loading").hidden = true;
  $("app").hidden = false;
  await reload();
  let timer;
  api.subscribe(
    () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (tab === "grades" && $("gradeDays").contains(document.activeElement)) return;
        reload();
      }, 300);
    },
    ok => { $("live").classList.toggle("off", !ok); $("live").textContent = ok ? "リアルタイム更新中" : "接続が切れています"; },
  );
}
