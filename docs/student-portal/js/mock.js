// お試しモード：Supabase の代わりにこのブラウザの localStorage にデータを置く。
// ルール（定員・受付期限・同じ週のみ など）は supabase/schema.sql の関数と同じにしてある。
// 生徒のタブと先生のタブを並べて開くと、振替が先生の画面にすぐ反映される様子を試せる。

import { addDays, dow, mondayOf, todayStr, weekInfo } from "./common.js";

const KEY = "furikae-demo-v3";
const USER_KEY = "furikae-demo-user";
const DEMO_PASSWORD = "demo1234";

function seed() {
  const db = {
    seq: 1,
    settings: { id: 1, capacity: 6, deadline_minutes: 180, same_week_only: true, weeks_ahead: 4, quiz_max: 20 },
    classes: [{ id: "A1", name: "A1クラス", sort: 1 }, { id: "A2", name: "A2クラス", sort: 2 }],
    schedule: [
      { class_id: "A1", weekday: 2, start_time: "16:00:00", end_time: "17:00:00" },
      { class_id: "A1", weekday: 3, start_time: "16:00:00", end_time: "17:00:00" },
      { class_id: "A1", weekday: 5, start_time: "16:00:00", end_time: "17:00:00" },
      { class_id: "A2", weekday: 2, start_time: "17:15:00", end_time: "18:15:00" },
      { class_id: "A2", weekday: 3, start_time: "17:15:00", end_time: "18:15:00" },
      { class_id: "A2", weekday: 5, start_time: "17:15:00", end_time: "18:15:00" },
    ],
    sessions: [],
    students: [],
    admins: [{ id: "t1", login_id: "teacher", name: "先生（お試し）" }],
    changes: [],
    grades: [],
    materials: [],
    // 仮の年間予定（schema.sql と同じ）
    years: [{ id: 2026, start_date: "2026-03-02", note: "仮の予定" }],
    holidays: [
      { week_start: "2026-05-04", note: "ゴールデンウィーク" }, { week_start: "2026-08-10", note: "夏休み" },
      { week_start: "2026-08-17", note: "夏休み" }, { week_start: "2026-12-28", note: "年末年始" },
    ],
    test_results: [],
    test_publish: [],
  };
  // 架空の生徒。[クラス, 曜日, 人数]
  const names = ["青木 はると", "石井 ゆい", "上田 そうた", "江藤 めい", "大野 りく", "加藤 さくら", "木村 ひなた",
    "工藤 あおい", "小林 ゆうと", "佐藤 りん", "清水 こはる", "鈴木 いつき", "高橋 みお", "田中 れん", "中村 ゆな",
    "西田 かいと", "野口 つむぎ", "橋本 あさひ", "藤田 えま", "前田 そら", "松本 ことね", "森 たいが", "山本 ひまり",
    "吉田 あやと", "渡辺 ゆずき", "伊藤 みなと", "岡田 のあ", "近藤 はるき"];
  let n = 0;
  for (const [cls, wd, count] of [["A1", 2, 6], ["A1", 3, 4], ["A1", 5, 5], ["A2", 2, 3], ["A2", 3, 5], ["A2", 5, 5]]) {
    for (let i = 0; i < count; i++) {
      n++;
      db.students.push({ id: "u" + n, login_id: "s" + String(n).padStart(3, "0"), name: names[n - 1],
        class_id: cls, weekday: wd, active: true, note: "" });
    }
  }
  const start = addDays(mondayOf(todayStr()), -14);
  generate(db, start, addDays(start, 7 * 9 - 1));
  // 見本：終わった授業の週の教材と、成績・テスト結果
  const done = [...new Set(db.sessions.filter(x => endsAt(x) < Date.now()).map(x => weekInfo(x.date, db)))
    .values()].filter(i => i.kind === "lesson");
  const seen = new Set();
  for (const info of done) {
    const k = info.term + info.week;
    if (seen.has(k)) continue;
    seen.add(k);
    for (const cls of ["A1", "A2"]) {
      for (const kind of ["next_homework", "next_quiz_range", "quiz_answer", "homework_answer"]) {
        db.materials.push({ class_id: cls, term: info.term, week: info.week, kind,
          path: `${cls}/${info.term}/${String(info.week).padStart(2, "0")}/${kind}.pdf`, updated_at: new Date().toISOString() });
      }
    }
  }
  for (const st of db.students) {
    for (const term of ["A", "B"]) {
      db.test_results.push({ school_year: 2026, term, student_id: st.id, path: `2026/${term}/${st.id}.pdf`, uploaded_at: new Date().toISOString() });
    }
  }
  db.test_publish.push({ school_year: 2026, term: "A", published: true, published_at: new Date().toISOString() },
    { school_year: 2026, term: "B", published: false, published_at: null });
  const grades = ["S", "A", "A", "B"];
  for (const s of db.sessions.filter(x => endsAt(x) < Date.now())) {
    db.students.filter(st => st.class_id === s.class_id && st.weekday === dow(s.date)).forEach((st, i) => {
      db.grades.push({ session_id: s.id, student_id: st.id, quiz_score: 12 + ((i * 3 + s.id) % 9),
        participation: grades[(i + s.id) % 4], homework: grades[(i + 2 * s.id) % 4] });
    });
  }
  return db;
}

function generate(db, from, to) {
  let made = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const sc of db.schedule.filter(x => x.weekday === dow(d))) {
      if (db.sessions.some(s => s.class_id === sc.class_id && s.date === d)) continue;
      const hol = (db.holidays || []).find(h => h.week_start === mondayOf(d));
      db.sessions.push({ id: db.seq++, class_id: sc.class_id, date: d, start_time: sc.start_time,
        end_time: sc.end_time, cancelled: !!hol, holiday: !!hol, note: hol ? hol.note || "お休み" : null });
      made++;
    }
  }
  db.sessions.sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
  return made;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const db = seed();
  save(db);
  return db;
}
function save(db) {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {}
}

const startsAt = s => {
  const [y, m, d] = s.date.split("-").map(Number);
  const [hh, mm] = s.start_time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm);
};
const endsAt = s => {
  const [y, m, d] = s.date.split("-").map(Number);
  const [hh, mm] = s.end_time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
};
// お試し用のPDF（英字のみ）
function demoPdf(title) {
  const text = title.replace(/[()\\]/g, "");
  const content = `BT /F1 20 Tf 60 760 Td (REAL ACADEMY - demo material) Tj 0 -40 Td /F1 14 Tf (${text}) Tj ET`;
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
}
const isClosed = (db, s) => Date.now() > startsAt(s).getTime() - db.settings.deadline_minutes * 60000;
const active = c => !c.cancelled_at;

function sessionCount(db, sid) {
  const s = db.sessions.find(x => x.id === sid);
  const regular = db.students.filter(st => st.active && st.class_id === s.class_id && st.weekday === dow(s.date)
    && !db.changes.some(c => active(c) && c.student_id === st.id && c.from_session_id === s.id)).length;
  const joined = db.changes.filter(c => active(c) && c.to_session_id === sid
    && db.students.find(st => st.id === c.student_id)?.active).length;
  return regular + joined;
}

const fail = msg => { throw new Error(msg); };
const wait = () => new Promise(r => setTimeout(r, 120));

export function createMockApi() {
  const listeners = new Set();
  const notify = () => listeners.forEach(fn => fn());
  window.addEventListener("storage", e => { if (e.key === KEY) notify(); });

  const user = () => {
    try { return sessionStorage.getItem(USER_KEY); } catch { return null; }
  };
  const isAdmin = db => db.admins.some(a => a.id === user());
  const commit = db => { save(db); notify(); };

  return {
    demo: true,

    async signIn(loginId, password) {
      await wait();
      const db = load();
      const id = loginId.trim().toLowerCase();
      const who = db.admins.find(a => a.login_id === id) || db.students.find(s => s.login_id === id && s.active);
      if (!who || password !== DEMO_PASSWORD) fail("ログインIDまたはパスワードが正しくありません");
      try { sessionStorage.setItem(USER_KEY, who.id); } catch {}
    },
    async signOut() {
      try { sessionStorage.removeItem(USER_KEY); } catch {}
    },
    async me() {
      const db = load();
      const uid = user();
      if (!uid) return null;
      const a = db.admins.find(x => x.id === uid);
      if (a) return { role: "admin", admin: a };
      const s = db.students.find(x => x.id === uid);
      if (s && s.active) return { role: "student", student: { ...s, class_name: db.classes.find(c => c.id === s.class_id)?.name } };
      return { role: "none" };
    },
    async changePassword() {
      await wait();
      fail("お試しモードではパスワードを変更できません");
    },

    // ---------- 生徒 ----------
    async settings() {
      return load().settings;
    },
    async mySchedule() {
      await wait();
      const db = load();
      const me = db.students.find(s => s.id === user() && s.active);
      if (!me) return [];
      const today = todayStr();
      const until = addDays(today, db.settings.weeks_ahead * 7);
      return db.sessions
        .filter(s => s.class_id === me.class_id && s.date >= today && s.date <= until)
        .map(s => {
          const regular = dow(s.date) === me.weekday;
          const co = db.changes.find(c => active(c) && c.student_id === me.id && c.from_session_id === s.id);
          const ci = db.changes.find(c => active(c) && c.student_id === me.id && c.to_session_id === s.id);
          const other = db.sessions.find(x => x.id === (co ? co.to_session_id : ci?.from_session_id));
          return {
            session_id: s.id, date: s.date, start_time: s.start_time, end_time: s.end_time,
            cancelled: s.cancelled, note: s.note, is_regular: regular,
            seats_left: Math.max(db.settings.capacity - sessionCount(db, s.id), 0),
            status: regular ? (!co ? "attend" : co.to_session_id == null ? "absent" : "moved") : ci ? "joined" : null,
            change_id: co?.id ?? ci?.id ?? null,
            other_session_id: other?.id ?? null, other_date: other?.date ?? null, other_start_time: other?.start_time ?? null,
            closed: isClosed(db, s),
          };
        });
    },
    async requestChange(fromId, toId = null, studentId = null) {
      await wait();
      const db = load();
      const admin = isAdmin(db);
      if (studentId && !admin) fail("権限がありません");
      const st = db.students.find(s => s.id === (studentId || user()));
      if (!st || !st.active) fail("生徒情報が見つかりません");
      const from = db.sessions.find(s => s.id === fromId);
      if (!from || from.class_id !== st.class_id || dow(from.date) !== st.weekday) fail("この授業は通常の授業ではありません");
      if (from.cancelled) fail("この日は休校です");
      if (!admin && isClosed(db, from)) fail("受付期限を過ぎています");
      const existing = db.changes.find(c => active(c) && c.student_id === st.id && c.from_session_id === fromId);
      if (existing && existing.to_session_id === toId) return existing.id;
      if (toId != null) {
        const to = db.sessions.find(s => s.id === toId);
        if (!to || to.class_id !== st.class_id) fail("振替先の授業が見つかりません");
        if (dow(to.date) === st.weekday) fail("通常の曜日には振り替えられません");
        if (to.cancelled) fail("振替先は休校です");
        if (!admin && isClosed(db, to)) fail("振替先の受付期限を過ぎています");
        if (db.settings.same_week_only && mondayOf(to.date) !== mondayOf(from.date)) fail("振替は同じ週の中でのみできます");
        if (db.changes.some(c => active(c) && c.student_id === st.id && c.to_session_id === toId)) fail("この授業にはすでに振替で参加予定です");
        if (sessionCount(db, toId) >= db.settings.capacity) fail("満席のため振り替えられません");
      }
      if (existing) existing.cancelled_at = new Date().toISOString();
      const id = db.seq++;
      db.changes.push({ id, student_id: st.id, from_session_id: fromId, to_session_id: toId,
        created_at: new Date().toISOString(), created_by: user(), cancelled_at: null });
      commit(db);
      return id;
    },
    async myLessons() {
      await wait();
      const db = load();
      const me = db.students.find(s => s.id === user() && s.active);
      if (!me) return [];
      return db.sessions
        .filter(s => s.class_id === me.class_id && !s.cancelled && endsAt(s) <= Date.now())
        .map(s => {
          const co = db.changes.find(c => active(c) && c.student_id === me.id && c.from_session_id === s.id);
          const ci = db.changes.find(c => active(c) && c.student_id === me.id && c.to_session_id === s.id);
          const regular = dow(s.date) === me.weekday;
          if (!(ci || (regular && (!co || co.to_session_id == null)))) return null;
          const wi = weekInfo(s.date, db);
          const g = db.grades.find(x => x.session_id === s.id && x.student_id === me.id) || {};
          const materials = {};
          db.materials.filter(m => m.class_id === s.class_id && m.term === wi.term && m.week === wi.week)
            .forEach(m => { materials[m.kind] = m.path; });
          return { session_id: s.id, date: s.date, start_time: s.start_time, end_time: s.end_time,
            school_year: wi.year ?? null, term: wi.term ?? null, week: wi.week ?? null, week_kind: wi.kind,
            status: ci ? "joined" : co ? "absent" : "attend", quiz_score: g.quiz_score ?? null,
            participation: g.participation ?? null, homework: g.homework ?? null, materials };
        })
        .filter(Boolean)
        .sort((a, b) => (b.date + b.start_time).localeCompare(a.date + a.start_time));
    },
    async materialUrl(path) {
      const db = load();
      const m = db.materials.find(x => x.path === path);
      if (!m) fail("この教材はまだ見られません");
      const label = { next_homework: "Homework for next lesson", next_quiz_range: "Next quiz range",
        quiz_answer: "Quiz model answers", homework_answer: "Homework model answers" }[m.kind];
      return demoPdf(`${m.class_id} Term ${m.term} Week ${m.week}: ${label}`);
    },
    async calendar() {
      const db = load();
      return { years: db.years, holidays: db.holidays };
    },
    async myTests() {
      const db = load();
      return db.test_results.filter(r => r.student_id === user()).map(r => {
        const p = db.test_publish.find(x => x.school_year === r.school_year && x.term === r.term);
        return { school_year: r.school_year, term: r.term, published: !!p?.published, path: p?.published ? r.path : null };
      });
    },
    async testUrl(path) {
      const db = load();
      const r = db.test_results.find(x => x.path === path);
      const p = r && db.test_publish.find(x => x.school_year === r.school_year && x.term === r.term);
      if (!r || (!isAdmin(db) && (!p?.published || r.student_id !== user()))) fail("このテスト結果はまだ見られません");
      const st = db.students.find(x => x.id === r.student_id);
      return demoPdf(`Test Week Term ${r.term} (${r.school_year}) result: ${st?.login_id ?? ""}`);
    },
    async cancelChange(changeId) {
      await wait();
      const db = load();
      const admin = isAdmin(db);
      const c = db.changes.find(x => x.id === changeId && active(x));
      if (!c || (!admin && c.student_id !== user())) fail("申し込みが見つかりません");
      const from = db.sessions.find(s => s.id === c.from_session_id);
      const to = db.sessions.find(s => s.id === c.to_session_id);
      if (!admin && (isClosed(db, from) || (to && isClosed(db, to)))) fail("受付期限を過ぎているため取り消せません");
      if (!from.cancelled && sessionCount(db, from.id) >= db.settings.capacity) {
        fail("元の授業が満席になったため取り消せません。別の曜日を選んでください");
      }
      c.cancelled_at = new Date().toISOString();
      commit(db);
    },

    // ---------- 先生 ----------
    async adminData(from, to) {
      await wait();
      const db = load();
      if (!isAdmin(db)) fail("権限がありません");
      const sessions = db.sessions.filter(s => s.date >= from && s.date <= to);
      const ids = new Set(sessions.map(s => s.id));
      const pick = id => {
        const s = db.sessions.find(x => x.id === id);
        return s ? { id: s.id, date: s.date, start_time: s.start_time } : null;
      };
      const changes = db.changes
        .filter(c => active(c) && (ids.has(c.from_session_id) || ids.has(c.to_session_id)))
        .map(c => ({ ...c, from_s: pick(c.from_session_id), to_s: pick(c.to_session_id) }));
      return { settings: db.settings, classes: db.classes, schedule: db.schedule, students: db.students, sessions, changes };
    },
    async gradeData(from, to) {
      await wait();
      const db = load();
      if (!isAdmin(db)) fail("権限がありません");
      const sessions = db.sessions.filter(s => s.date >= from && s.date <= to);
      const ids = new Set(sessions.map(s => s.id));
      return { grades: db.grades.filter(g => ids.has(g.session_id)) };
    },
    async saveGrade(sessionId, studentId, patch) {
      const db = load();
      if (!isAdmin(db)) fail("権限がありません");
      let g = db.grades.find(x => x.session_id === sessionId && x.student_id === studentId);
      if (!g) db.grades.push(g = { session_id: sessionId, student_id: studentId });
      Object.assign(g, patch, { updated_at: new Date().toISOString() });
      commit(db);
    },
    async materials() {
      return load().materials;
    },
    async saveYear(row) {
      const db = load();
      if (!isAdmin(db)) fail("権限がありません");
      const y = db.years.find(x => x.id === row.id);
      if (y) Object.assign(y, row); else db.years.push(row);
      commit(db);
    },
    async setHoliday(weekStart, on, note = null) {
      const db = load();
      if (!isAdmin(db)) fail("権限がありません");
      const w = mondayOf(weekStart);
      const inWeek = s => s.date >= w && s.date <= addDays(w, 6);
      db.holidays = db.holidays.filter(h => h.week_start !== w);
      if (on) {
        db.holidays.push({ week_start: w, note: note || null });
        db.sessions.filter(s => inWeek(s) && (!s.cancelled || s.holiday))
          .forEach(s => Object.assign(s, { cancelled: true, holiday: true, note: note || "お休み" }));
      } else {
        db.sessions.filter(s => inWeek(s) && s.holiday).forEach(s => Object.assign(s, { cancelled: false, holiday: false, note: null }));
      }
      db.holidays.sort((a, b) => a.week_start.localeCompare(b.week_start));
      commit(db);
    },
    async testData(year, term) {
      const db = load();
      if (!isAdmin(db)) fail("権限がありません");
      const p = db.test_publish.find(x => x.school_year === year && x.term === term);
      return { published: !!p?.published, published_at: p?.published_at ?? null,
        results: db.test_results.filter(r => r.school_year === year && r.term === term) };
    },
    async setTestPublished(year, term, on) {
      const db = load();
      let p = db.test_publish.find(x => x.school_year === year && x.term === term);
      if (!p) db.test_publish.push(p = { school_year: year, term });
      Object.assign(p, { published: on, published_at: on ? new Date().toISOString() : null });
      commit(db);
    },
    async uploadTest(year, term, studentId, file) {
      await wait();
      const db = load();
      if (file && file.type && file.type !== "application/pdf") fail("PDFファイルを選んでください");
      db.test_results = db.test_results.filter(r => !(r.school_year === year && r.term === term && r.student_id === studentId));
      db.test_results.push({ school_year: year, term, student_id: studentId, path: `${year}/${term}/${studentId}.pdf`,
        uploaded_at: new Date().toISOString() });
      commit(db);
    },
    async deleteTest(year, term, studentId) {
      const db = load();
      db.test_results = db.test_results.filter(r => !(r.school_year === year && r.term === term && r.student_id === studentId));
      commit(db);
    },
    async generateSessions(from, to) {
      const db = load();
      const n = generate(db, from, to);
      commit(db);
      return n;
    },
    async updateSession(id, patch) {
      const db = load();
      Object.assign(db.sessions.find(s => s.id === id), patch);
      commit(db);
    },
    async updateStudent(id, patch) {
      const db = load();
      Object.assign(db.students.find(s => s.id === id), patch);
      commit(db);
    },
    async updateSettings(patch) {
      const db = load();
      Object.assign(db.settings, patch);
      commit(db);
    },
    async updateSchedule(row) {
      const db = load();
      Object.assign(db.schedule.find(x => x.class_id === row.class_id && x.weekday === row.weekday),
        { start_time: row.start_time, end_time: row.end_time });
      commit(db);
    },
    subscribe(onChange, onStatus = () => {}) {
      listeners.add(onChange);
      onStatus(true);
      return () => listeners.delete(onChange);
    },

    // お試しデータを最初の状態に戻す
    resetDemo() {
      try { localStorage.removeItem(KEY); } catch {}
      load();
      notify();
    },
  };
}
