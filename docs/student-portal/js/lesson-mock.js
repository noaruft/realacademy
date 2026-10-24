// 個人レッスン（専用コース）のお試しモード：Supabase の代わりにこのブラウザの localStorage にデータを置く。
// ルール（24時間前の締め切り・チケットの期限・先生のキャンセルで返すチケットなど）は本番と同じにする。
// 生徒のタブと先生のタブを並べて開くと、予約やメッセージがもう一方の画面にすぐ反映される。

import { BOOK_AHEAD_MONTHS, DEADLINE_HOURS, FILE_MAX_MB, LESSON_MINUTES, TICKET_MONTHS, addDaysJ, addMonthsJ, dowJ, fileGone, jst, jstIso, jstToday, ms, phase, uk } from "./lesson-common.js?v=58bc780a";

const KEY = "lesson-demo-v6";
const USER_KEY = "furikae-demo-user";  // 生徒用ページのお試しモードと同じ（ログインは共通）
const FILE_KEY = "lesson-demo-file-";   // 添付ファイル（1つずつ別の場所に置く）

const HOUR = 3600e3;

function seed() {
  const today = jstToday();
  const now = Date.now();
  const db = {
    seq: 1,
    students: [
      { id: "p1", login_id: "p001", name: "山田 花子", email: "p001@example.com", active: true },
      { id: "p2", login_id: "p002", name: "小池 健太", email: "p002@example.com", active: true },
      { id: "p3", login_id: "p003", name: "森川 あや", email: "p003@example.com", active: true },
      { id: "p4", login_id: "p004", name: "石田 りょう", email: "p004@example.com", active: true },
    ],
    // 先生（名前・Zoom のリンクは名簿で、紹介文は先生が自分のページで設定する）。t1 は Scholars' の先生（お試しの「teacher」）と同じ人
    teachers: [
      // tz：毎週の空き時間の基準（"uk"＝イギリス時間／"jp"＝日本時間）。先生が自分の画面で切り替えられる
      { id: "lt1", login_id: "lt001", name: "Emily Carter", email: "lt001@example.com", zoom_url: "https://zoom.us/j/1000000001", active: true, tz: "uk",
        profile: "イギリス・オックスフォード出身。発音と日常会話が得意です。はじめての方も、ゆっくり話すところから一緒に練習しましょう。" },
      { id: "lt2", login_id: "lt002", name: "James Wilson", email: "lt002@example.com", zoom_url: "https://zoom.us/j/1000000002", active: true, tz: "uk",
        profile: "ロンドン在住。英検・IELTS の対策と、イギリス留学の準備（面接・エッセイ）をサポートしています。" },
      { id: "t1", login_id: "teacher", name: "佐藤 由紀", email: "teacher@example.com", zoom_url: "https://zoom.us/j/1000000003", active: true, tz: "jp",
        profile: "Scholars' でも教えています。文法を基礎から丁寧に説明します。学校の英語の復習にもどうぞ。" },
    ],
    // チケットを配れる人（事業主さまなど）。t1 は先生と兼任、m1 は配るだけの人
    managers: [{ id: "t1", name: "佐藤 由紀" }, { id: "m1", login_id: "owner", name: "事業主（お試し）" }],
    weekly: [], overrides: [], bookings: [], tickets: [], grants: [], messages: [],
  };
  const id = () => db.seq++;
  // 先生ごとの毎週の空き時間（曜日 → 開始時刻）。lt1・lt2 はイギリス時間（冬時間なら日本時間は＋9時間、夏時間なら＋8時間）、t1 は日本時間
  const pattern = {
    lt1: { 1: [8, 9], 3: [8, 9], 5: [8, 9, 10] },
    lt2: { 2: [10, 11, 12], 4: [10, 11, 12], 6: [0, 1] },
    t1: { 6: [10, 11, 13], 3: [20] },
  };
  for (const [tid, days] of Object.entries(pattern)) {
    for (const [w, hours] of Object.entries(days)) for (const h of hours) db.weekly.push({ teacher_id: tid, weekday: Number(w), hour: h });
  }
  const dowOf = d => new Date(d + "T00:00:00Z").getUTCDay();
  // n 日前／n 日後の、その先生の毎週の空き時間にある最初の時間
  const slotNear = (tid, fromDay, dir) => {
    for (let k = 0; k < 30; k++) {
      const d = addDaysJ(today, fromDay + k * dir);
      for (let h = 0; h < 24; h++) if (inWeekly(db, tid, d, h)) return { teacher_id: tid, starts_at: jstIso(d, h) };
    }
  };
  // 毎週の型にない時間（この日だけ追加）
  const extra = (tid, iso) => {
    const j = jst(iso);
    db.overrides.push({ teacher_id: tid, date: j.date, hour: j.hour, open: true });
    return { teacher_id: tid, starts_at: iso };
  };
  const grant = (sid, count, daysAgo, note) => {
    const date = addDaysJ(today, -daysAgo);
    const g = { id: id(), student_id: sid, count, note, granted_by: "m1", created_at: jstIso(date, 10), expires_on: addMonthsJ(date, TICKET_MONTHS) };
    db.grants.push(g);
    return Array.from({ length: count }, () => {
      const t = { id: id(), student_id: sid, grant_id: g.id, source: "grant", expires_on: g.expires_on, booking_id: null,
        created_at: g.created_at, revoked_at: null, from_booking: null, refunded_by: null };
      db.tickets.push(t);
      return t;
    });
  };
  const book = (sid, slot, ticket, status = "booked", extra = {}) => {
    const b = { id: id(), student_id: sid, teacher_id: slot.teacher_id, starts_at: slot.starts_at,
      ticket_id: ticket.id, status, created_at: new Date(ms(slot.starts_at) - 5 * 24 * HOUR).toISOString(), cancelled_at: null, cancel_note: null, ...extra };
    db.bookings.push(b);
    ticket.booking_id = b.id;
    return b;
  };

  // 山田さん：受講済み・欠席・授業中（Zoom に入れる）・24時間以内（欠席のみ）・予約中、残り1枚
  const t1 = grant("p1", 6, 20, "6回分（お試し）");
  book("p1", slotNear("lt1", -10, -1), t1[0]);
  book("p1", slotNear("lt2", -6, -1), t1[1], "absent");
  const nowHour = new Date(Math.floor(now / HOUR) * HOUR).toISOString();
  book("p1", extra("t1", nowHour), t1[2]);
  book("p1", extra("lt2", new Date(Math.floor(now / HOUR) * HOUR + 6 * HOUR).toISOString()), t1[3]);
  book("p1", slotNear("lt1", 4, 1), t1[4]);
  // 小池さん：期限まもなくのチケットと、先生の都合でキャンセルされて返ってきたチケット
  const t2 = grant("p2", 4, 50, "4回分（お試し）");
  book("p2", slotNear("lt2", -30, -1), t2[0]);
  const cancelled = slotNear("lt2", -5, -1);
  const cb = book("p2", cancelled, t2[1], "teacher_cancelled",
    { cancelled_at: new Date(ms(cancelled.starts_at) - 2 * 24 * HOUR).toISOString(), cancel_note: "体調不良のため" });
  db.overrides.push({ teacher_id: "lt2", date: jst(cancelled.starts_at).date, hour: jst(cancelled.starts_at).hour, open: false });
  const cday = jst(cb.cancelled_at).date;
  const refund = { id: id(), student_id: "p2", grant_id: null, source: "refund", expires_on: addMonthsJ(cday, TICKET_MONTHS),
    booking_id: null, created_at: cb.cancelled_at, revoked_at: null, from_booking: cb.id, refunded_by: null };
  db.tickets.push(refund);
  t2[1].refunded_by = refund.id;
  book("p2", slotNear("lt2", 6, 1), t2[2]);
  // 森川さん：期限切れのチケットだけ
  grant("p3", 2, 75, "2回分（お試し）");

  // メッセージ
  const msg = (sid, tid, from, body, hoursAgo, read = true) => db.messages.push({ id: id(), student_id: sid, teacher_id: tid, from, body,
    created_at: new Date(now - hoursAgo * HOUR).toISOString(), read_at: read ? new Date(now - (hoursAgo - 0.5) * HOUR).toISOString() : null });
  msg("p1", "lt1", "student", "Emily 先生、こんにちは。次のレッスンでは旅行で使う英語を練習したいです。", 50);
  msg("p1", "lt1", "teacher", "Hi Hanako! いいですね。空港とホテルの場面を用意しておきます。", 48);
  // 添付ファイルの見本（PDF）
  const key = FILE_KEY + "seed1";
  try { localStorage.setItem(key, "data:application/pdf;base64," + btoa(samplePdf("Travel English - Airport & Hotel"))); } catch {}
  msg("p1", "lt1", "teacher", "次回使うプリントです。目を通しておいてください。", 47);
  Object.assign(db.messages.at(-1), { file_path: key, file_name: "travel-english.pdf", file_type: "application/pdf", file_size: 900 });
  msg("p1", "lt2", "teacher", "明日のレッスンでは、前回の続きから始めましょう。教科書の p.24 を見ておいてください。", 3, false);
  msg("p2", "lt2", "student", "先日はキャンセルの連絡ありがとうございました。お大事になさってください。", 40);
  // 日ごとの調整の見本：Emily 先生は来週の水曜をお休みにし、土曜に1枠だけ追加
  const nextWed = addDaysJ(today, ((3 - dowOf(today) + 7) % 7) + 7);
  for (let h = 0; h < 24; h++) if (inWeekly(db, "lt1", nextWed, h)) db.overrides.push({ teacher_id: "lt1", date: nextWed, hour: h, open: false });
  db.overrides.push({ teacher_id: "lt1", date: addDaysJ(nextWed, 3), hour: 10, open: true });
  return db;
}

// お試し用のPDF（英字のみ・1ページ）
function samplePdf(title) {
  const content = `BT /F1 22 Tf 60 760 Td (REAL ACADEMY - sample handout) Tj 0 -40 Td /F1 15 Tf (${title}) Tj ET`;
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
  return pdf + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
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
const uid = () => { try { return sessionStorage.getItem(USER_KEY); } catch { return null; } };
const fail = msg => { throw new Error(msg); };
const wait = () => new Promise(r => setTimeout(r, 120));

// ---------- 生徒用ページのお試しログイン（mock.js）から使う ----------
// ログインID → 個人レッスンの人の id（いなければ null）
export function findLessonLogin(loginId) {
  const db = load();
  const who = db.students.find(s => s.login_id === loginId && s.active) || db.teachers.find(t => t.login_id === loginId && t.active)
    || db.managers.find(m => m.login_id === loginId);
  return who?.id ?? null;
}
// その人が個人レッスンで何をできるか
export function lessonFlags(id) {
  const db = load();
  const st = db.students.find(s => s.id === id && s.active);
  const te = db.teachers.find(t => t.id === id && t.active);
  const ma = db.managers.find(m => m.id === id);
  return { student: !!st, teacher: !!te, manager: !!ma, name: st?.name || te?.name || ma?.name || "" };
}

// 使えるチケット（未使用・取り消しなし・レッスン日まで期限がある）を期限の近い順に
const usable = (db, sid, date, except = null) => db.tickets
  .filter(t => t.student_id === sid && !t.booking_id && !t.revoked_at && t.expires_on >= date && t.id !== except)
  .sort((a, b) => a.expires_on.localeCompare(b.expires_on) || a.id - b.id);
// 空き時間＝毎週の型（weekly）に、日ごとの調整（overrides：open=true でこの日だけ追加・false でこの日だけお休み）を重ねたもの
const override = (db, tid, date, hour) => db.overrides.find(o => o.teacher_id === tid && o.date === date && o.hour === hour);
// 毎週の型は、先生ごとの基準（tz）の曜日・時で持つ。
//   "uk"：日本時間のその日・その時がイギリスで何曜の何時かに直して調べる（夏時間・冬時間が切り替わると、日本時間が自動で1時間ずれる）
//   "jp"：日本時間のまま調べる
const localOf = (tz, date, hour) => {
  if (tz !== "uk") return { weekday: dowJ(date), hour };
  const u = uk(jstIso(date, hour));
  return { weekday: dowJ(u.date), hour: u.hour };
};
const tzOf = (db, tid) => db.teachers.find(t => t.id === tid)?.tz === "jp" ? "jp" : "uk";
function inWeekly(db, tid, date, hour) {
  const l = localOf(tzOf(db, tid), date, hour);
  return db.weekly.some(w => w.teacher_id === tid && w.weekday === l.weekday && w.hour === l.hour);
}
function isOpen(db, tid, iso) {
  const j = jst(iso);
  const o = override(db, tid, j.date, j.hour);
  return o ? o.open : inWeekly(db, tid, j.date, j.hour);
}
const takenBy = (db, tid, iso) => db.bookings.find(b => b.teacher_id === tid && b.starts_at === iso && (b.status === "booked" || b.status === "absent"));
const horizon = () => addMonthsJ(jstToday(), BOOK_AHEAD_MONTHS);
// 生徒が予約できる時間か（空き時間・予約なし・開始24時間より前・1か月先まで）
const bookable = (db, tid, iso) => isOpen(db, tid, iso) && !takenBy(db, tid, iso)
  && ms(iso) - Date.now() >= DEADLINE_HOURS * HOUR && jst(iso).date <= horizon();
const slotId = (tid, iso) => `${tid}|${iso}`;

function noTicket(db, sid, date) {
  const later = db.tickets.filter(t => t.student_id === sid && !t.booking_id && !t.revoked_at && t.expires_on >= jstToday());
  if (later.length) {
    const last = later.map(t => t.expires_on).sort().pop();
    const [, m, d] = last.split("-").map(Number);
    fail(`お持ちのチケットは ${m}/${d} までのため、この日のレッスンには使えません`);
  }
  fail("使えるチケットがありません。教室にお問い合わせください");
}

export function createLessonMockApi() {
  const blobUrls = new Map();  // 添付ファイル → ブラウザの中だけのアドレス
  const listeners = new Set();
  const notify = () => listeners.forEach(fn => fn());
  window.addEventListener("storage", e => { if (e.key === KEY) notify(); });
  const commit = db => { save(db); notify(); };
  const meStudent = db => db.students.find(s => s.id === uid() && s.active) || fail("生徒情報が見つかりません");
  const meTeacher = db => db.teachers.find(t => t.id === uid() && t.active) || fail("先生の情報が見つかりません");
  const isManager = db => db.managers.some(m => m.id === uid()) || fail("権限がありません");
  const teacherName = (db, id) => db.teachers.find(t => t.id === id)?.name || "";
  const studentName = (db, id) => db.students.find(s => s.id === id)?.name || "";
  const newTicket = (db, fields) => {
    const t = { id: db.seq++, grant_id: null, booking_id: null, created_at: new Date().toISOString(), revoked_at: null,
      from_booking: null, refunded_by: null, ...fields };
    db.tickets.push(t);
    return t;
  };

  return {
    demo: true,

    // ---------- 生徒 ----------
    async teachers() {
      return load().teachers.filter(t => t.active).map(({ id, name, profile }) => ({ id, name, profile }));
    },
    // 予約できる時間（24時間より先〜1か月先・空いている）。id は「先生|開始時刻」
    async openSlots(teacherId) {
      await wait();
      const db = load();
      const out = [];
      for (let d = jstToday(); d <= horizon(); d = addDaysJ(d, 1)) {
        for (let h = 0; h < 24; h++) {
          const iso = jstIso(d, h);
          if (bookable(db, teacherId, iso)) out.push({ id: slotId(teacherId, iso), teacher_id: teacherId, starts_at: iso });
        }
      }
      return out;
    },
    // 自分の予約（新しい順）。Zoom のリンクは開始10分前から終わるまでだけ渡す
    async myBookings() {
      const db = load();
      const me = meStudent(db);
      return db.bookings.filter(b => b.student_id === me.id).map(b => ({ ...b, teacher_name: teacherName(db, b.teacher_id),
        zoom_url: phase(b) === "live" ? db.teachers.find(t => t.id === b.teacher_id)?.zoom_url : null }))
        .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
    },
    async myTickets() {
      const db = load();
      const me = meStudent(db);
      return db.tickets.filter(t => t.student_id === me.id).map(t => ({ ...t,
        booking: t.booking_id ? db.bookings.find(b => b.id === t.booking_id) : null }));
    },
    async book(slotId) {
      await wait();
      const db = load();
      const me = meStudent(db);
      const [tid, iso] = String(slotId).split("|");
      const s = { teacher_id: tid, starts_at: iso };
      if (!isOpen(db, tid, iso) || takenBy(db, tid, iso)) fail("この時間はすでに埋まっています");
      if (ms(iso) - Date.now() < DEADLINE_HOURS * HOUR) fail(`レッスン開始の${DEADLINE_HOURS}時間前を過ぎた時間は予約できません`);
      if (jst(iso).date > horizon()) fail("予約できるのは1か月先までです");
      if (db.bookings.some(b => b.student_id === me.id && b.status === "booked" && b.starts_at === s.starts_at)) fail("同じ時間にほかのレッスンを予約しています");
      const date = jst(s.starts_at).date;
      const t = usable(db, me.id, date)[0] || noTicket(db, me.id, date);
      const b = { id: db.seq++, student_id: me.id, teacher_id: s.teacher_id, starts_at: s.starts_at, ticket_id: t.id,
        status: "booked", created_at: new Date().toISOString(), cancelled_at: null, cancel_note: null };
      db.bookings.push(b);
      t.booking_id = b.id;
      commit(db);
      return b.id;
    },
    // 24時間前まで：キャンセル（チケットは元の期限のまま戻る）
    async cancel(bookingId) {
      await wait();
      const db = load();
      const me = meStudent(db);
      const b = db.bookings.find(x => x.id === bookingId && x.student_id === me.id && x.status === "booked") || fail("予約が見つかりません");
      if (phase(b) !== "open") fail(`レッスン開始の${DEADLINE_HOURS}時間前を過ぎたため、キャンセルできません`);
      b.status = "cancelled";
      b.cancelled_at = new Date().toISOString();
      const t = db.tickets.find(x => x.id === b.ticket_id);
      if (t) t.booking_id = null;
      commit(db);
    },
    // 24時間前を過ぎてから：欠席（チケットは使ったことになる）
    async absent(bookingId) {
      await wait();
      const db = load();
      const me = meStudent(db);
      const b = db.bookings.find(x => x.id === bookingId && x.student_id === me.id && x.status === "booked") || fail("予約が見つかりません");
      if (phase(b) !== "locked") fail("この予約は欠席にできません");
      b.status = "absent";
      b.cancelled_at = new Date().toISOString();
      commit(db);
    },

    // ---------- メッセージ（生徒 ⇔ 先生の1対1） ----------
    // 生徒：すべての先生と話せる／先生：予約したことのある生徒とだけ（生徒から届いたときも表示）
    async threads() {
      const db = load();
      const me = uid();
      const isStudent = db.students.some(s => s.id === me);
      const pairs = isStudent
        ? db.teachers.filter(t => t.active).map(t => ({ other_id: t.id, other_name: t.name, can_send: true }))
        : [...new Set([...db.bookings.filter(b => b.teacher_id === me).map(b => b.student_id),
          ...db.messages.filter(m => m.teacher_id === me).map(m => m.student_id)])]
          .map(sid => ({ other_id: sid, other_name: studentName(db, sid), can_send: db.bookings.some(b => b.teacher_id === me && b.student_id === sid) }));
      return pairs.map(p => {
        const list = db.messages.filter(m => isStudent ? m.student_id === me && m.teacher_id === p.other_id : m.teacher_id === me && m.student_id === p.other_id);
        const last = list.sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1) || null;
        return { ...p, last, unread: list.filter(m => !m.read_at && m.from === (isStudent ? "teacher" : "student")).length };
      }).sort((a, b) => (b.last?.created_at || "").localeCompare(a.last?.created_at || "") || a.other_name.localeCompare(b.other_name));
    },
    async messages(otherId) {
      const db = load();
      const me = uid();
      const isStudent = db.students.some(s => s.id === me);
      return db.messages.filter(m => isStudent ? m.student_id === me && m.teacher_id === otherId : m.teacher_id === me && m.student_id === otherId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
    // file：添付（{ blob, name, type }。写真は画面側で縮めてから渡す）
    async send(otherId, body, file = null) {
      await wait();
      const text = String(body || "").trim();
      if (!text && !file) fail("メッセージを入力してください");
      if (text.length > 2000) fail("メッセージは2000文字までです");
      let att = null;
      if (file) {
        if (!/^image\/|^application\/pdf$/.test(file.type)) fail("送れるのは写真とPDFだけです");
        if (file.blob.size > FILE_MAX_MB * 1024 * 1024) fail(`ファイルは${FILE_MAX_MB}MBまでです`);
        const dataUrl = await new Promise((ok, ng) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ng; r.readAsDataURL(file.blob); });
        att = { key: FILE_KEY + Date.now() + Math.random().toString(36).slice(2, 7), name: file.name, type: file.type, size: file.blob.size };
        try { localStorage.setItem(att.key, dataUrl); } catch { fail("お試しモードの保存容量がいっぱいです。上の「お試しデータを初期化」を押してください"); }
      }
      const db = load();
      const me = uid();
      const isStudent = db.students.some(s => s.id === me);
      if (isStudent) {
        meStudent(db);
        if (!db.teachers.some(t => t.id === otherId && t.active)) fail("この先生には送れません");
      } else {
        meTeacher(db);
        if (!db.bookings.some(b => b.teacher_id === me && b.student_id === otherId)) fail("予約のある生徒にだけメッセージを送れます");
      }
      db.messages.push({ id: db.seq++, student_id: isStudent ? me : otherId, teacher_id: isStudent ? otherId : me,
        from: isStudent ? "student" : "teacher", body: text, created_at: new Date().toISOString(), read_at: null,
        file_path: att?.key ?? null, file_name: att?.name ?? null, file_type: att?.type ?? null, file_size: att?.size ?? null });
      commit(db);
    },
    // 添付ファイルを開くためのアドレス（本番は10分間だけ有効なURL）。保存期間を過ぎたものは null
    async fileUrl(m) {
      if (!m.file_path || fileGone(m.created_at)) return null;
      if (blobUrls.has(m.file_path)) return blobUrls.get(m.file_path);
      let dataUrl = null;
      try { dataUrl = localStorage.getItem(m.file_path); } catch {}
      if (!dataUrl) return null;
      const url = URL.createObjectURL(await (await fetch(dataUrl)).blob());
      blobUrls.set(m.file_path, url);
      return url;
    },
    async markRead(otherId) {
      const db = load();
      const me = uid();
      const isStudent = db.students.some(s => s.id === me);
      let n = 0;
      for (const m of db.messages) {
        const mine = isStudent ? m.student_id === me && m.teacher_id === otherId && m.from === "teacher"
          : m.teacher_id === me && m.student_id === otherId && m.from === "student";
        if (mine && !m.read_at) { m.read_at = new Date().toISOString(); n++; }
      }
      if (n) commit(db);
    },

    // ---------- 先生 ----------
    async myTeacher() {
      const db = load();
      return { ...meTeacher(db) };
    },
    // 紹介文（先生が自分のページで書き換える）
    async updateProfile(text) {
      await wait();
      const db = load();
      const me = meTeacher(db);
      const t = String(text || "").trim();
      if (t.length > 400) fail("紹介文は400文字までです");
      db.teachers.find(x => x.id === me.id).profile = t;
      commit(db);
    },
    // 毎週の空き時間（[{ weekday, hour }]。その先生の基準の時間）
    async weekly() {
      const db = load();
      const me = meTeacher(db);
      return db.weekly.filter(w => w.teacher_id === me.id).map(({ weekday, hour }) => ({ weekday, hour }));
    },
    // 毎週の空き時間の基準を切り替える（"uk"⇔"jp"）。今の空き時間は、来週の時差で新しい基準の曜日・時に直す
    async setTimezone(tz) {
      await wait();
      const db = load();
      const me = meTeacher(db);
      if (!["uk", "jp"].includes(tz)) fail("基準の時間が正しくありません");
      const from = tzOf(db, me.id);
      if (from === tz) return;
      const base = addDaysJ(jstToday(), 7);  // 来週のある日（どの曜日も含む1週間を探す）
      db.weekly = db.weekly.map(w => {
        if (w.teacher_id !== me.id) return w;
        for (let i = 0; i < 8; i++) for (let h = 0; h < 24; h++) {
          const d = addDaysJ(base, i);
          const l = localOf(from, d, h);
          if (l.weekday === w.weekday && l.hour === w.hour) return { ...w, ...localOf(tz, d, h) };
        }
        return w;
      });
      db.teachers.find(t => t.id === me.id).tz = tz;
      db.overrides = db.overrides.filter(o => !(o.teacher_id === me.id && o.open === inWeekly(db, me.id, o.date, o.hour)));
      commit(db);
    },
    // 毎週の空き時間をまとめて置き換える（先生が「反映」を押したとき）。list：[{ weekday, hour }]（その先生の基準の時間）
    async saveWeekly(list) {
      await wait();
      const db = load();
      const me = meTeacher(db);
      db.weekly = db.weekly.filter(w => w.teacher_id !== me.id)
        .concat(list.map(({ weekday, hour }) => ({ teacher_id: me.id, weekday: Number(weekday), hour: Number(hour) })));
      // 新しい毎週の型と同じになった日ごとの調整は、もう要らないので消す
      db.overrides = db.overrides.filter(o => !(o.teacher_id === me.id && o.open === inWeekly(db, me.id, o.date, o.hour)));
      commit(db);
    },
    // from〜to（日本時間の日付）の、日ごと・時間ごとの空き状況（空き・この日だけの調整・予約のあるものだけ）
    //   { date, hour, starts_at, weekly, open, adjusted, booking }
    async teacherDays(from, to) {
      const db = load();
      const me = meTeacher(db);
      const out = [];
      for (let d = from; d <= to; d = addDaysJ(d, 1)) {
        for (let h = 0; h < 24; h++) {
          const iso = jstIso(d, h);
          const o = override(db, me.id, d, h);
          const weekly = inWeekly(db, me.id, d, h);
          const b = takenBy(db, me.id, iso);
          if (!weekly && !o && !b) continue;
          out.push({ date: d, hour: h, starts_at: iso, weekly, open: o ? o.open : weekly, adjusted: !!o,
            booking: b ? { ...b, student_name: studentName(db, b.student_id) } : null });
        }
      }
      return out;
    },
    // その日のその時間だけ、空き（open=true）／お休み（false）にする。予約の入った時間はお休みにできない
    async setDay(date, hour, open) {
      await wait();
      const db = load();
      const me = meTeacher(db);
      const iso = jstIso(date, hour);
      if (ms(iso) <= Date.now()) fail("過ぎた時間は変えられません");
      if (!open && takenBy(db, me.id, iso)) fail("予約が入っている時間はお休みにできません。先にレッスンをキャンセルしてください");
      db.overrides = db.overrides.filter(o => !(o.teacher_id === me.id && o.date === date && o.hour === hour));
      if (open !== inWeekly(db, me.id, date, hour)) db.overrides.push({ teacher_id: me.id, date, hour, open });
      commit(db);
    },
    // その日をすべてお休みに（予約の入った時間はそのまま）。お休みにした数を返す
    async closeDay(date) {
      await wait();
      const db = load();
      const me = meTeacher(db);
      let n = 0;
      for (let h = 0; h < 24; h++) {
        const iso = jstIso(date, h);
        if (ms(iso) <= Date.now() || !isOpen(db, me.id, iso) || takenBy(db, me.id, iso)) continue;
        db.overrides = db.overrides.filter(o => !(o.teacher_id === me.id && o.date === date && o.hour === h));
        if (inWeekly(db, me.id, date, h)) db.overrides.push({ teacher_id: me.id, date, hour: h, open: false });
        n++;
      }
      commit(db);
      return n;
    },
    // その日の調整をやめて、毎週の空き時間に戻す（予約の入った時間の調整は残す）
    async resetDay(date) {
      await wait();
      const db = load();
      const me = meTeacher(db);
      db.overrides = db.overrides.filter(o => !(o.teacher_id === me.id && o.date === date && !takenBy(db, me.id, jstIso(date, o.hour))
        && ms(jstIso(date, o.hour)) > Date.now()));
      commit(db);
    },
    // 自分のレッスン（予約・キャンセル・欠席すべて）
    async teacherBookings() {
      const db = load();
      const me = meTeacher(db);
      return db.bookings.filter(b => b.teacher_id === me.id).map(b => ({ ...b, student_name: studentName(db, b.student_id) }))
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    },
    // 先生（または管理者）がキャンセル：いつでもできる。生徒には新しい期限（今日から2か月）のチケットを返す
    async teacherCancel(bookingId, note) {
      await wait();
      const db = load();
      const b = db.bookings.find(x => x.id === bookingId && x.status === "booked") || fail("予約が見つかりません");
      const mgr = db.managers.some(m => m.id === uid());
      if (b.teacher_id !== uid() && !mgr) fail("権限がありません");
      if (Date.now() >= ms(b.starts_at) + LESSON_MINUTES * 60e3) fail("終わったレッスンはキャンセルできません");
      b.status = "teacher_cancelled";
      b.cancelled_at = new Date().toISOString();
      b.cancel_note = String(note || "").trim() || null;
      // 先生の都合で空かない時間なので、この日だけお休みにして、ほかの生徒にも出さない
      const j = jst(b.starts_at);
      db.overrides = db.overrides.filter(o => !(o.teacher_id === b.teacher_id && o.date === j.date && o.hour === j.hour));
      db.overrides.push({ teacher_id: b.teacher_id, date: j.date, hour: j.hour, open: false });
      const old = db.tickets.find(x => x.id === b.ticket_id);
      const t = newTicket(db, { student_id: b.student_id, source: "refund", from_booking: b.id,
        expires_on: addMonthsJ(jstToday(), TICKET_MONTHS) });
      if (old) old.refunded_by = t.id;
      commit(db);
    },

    // ---------- 管理者（チケット） ----------
    async ticketOverview() {
      const db = load();
      isManager(db);
      const today = jstToday();
      return db.students.map(s => {
        const mine = db.tickets.filter(t => t.student_id === s.id);
        const valid = mine.filter(t => !t.booking_id && !t.revoked_at && t.expires_on >= today).sort((a, b) => a.expires_on.localeCompare(b.expires_on));
        return { ...s, valid: valid.length, next_expiry: valid[0]?.expires_on ?? null,
          upcoming: db.bookings.filter(b => b.student_id === s.id && b.status === "booked" && ms(b.starts_at) > Date.now()).length };
      });
    },
    async studentTickets(studentId) {
      const db = load();
      isManager(db);
      return {
        tickets: db.tickets.filter(t => t.student_id === studentId).map(t => ({ ...t,
          booking: t.booking_id ? { ...db.bookings.find(b => b.id === t.booking_id), teacher_name: teacherName(db, db.bookings.find(b => b.id === t.booking_id)?.teacher_id) } : null })),
        grants: db.grants.filter(g => g.student_id === studentId),
      };
    },
    // 配る：今日から2か月の期限で count 枚
    async grant(studentId, count, note) {
      await wait();
      const db = load();
      isManager(db);
      count = Number(count);
      if (!Number.isInteger(count) || count < 1 || count > 50) fail("枚数は1〜50で入力してください");
      if (!db.students.some(s => s.id === studentId)) fail("生徒が見つかりません");
      const today = jstToday();
      const g = { id: db.seq++, student_id: studentId, count, note: String(note || "").trim() || null, granted_by: uid(),
        created_at: new Date().toISOString(), expires_on: addMonthsJ(today, TICKET_MONTHS) };
      db.grants.push(g);
      for (let i = 0; i < count; i++) newTicket(db, { student_id: studentId, grant_id: g.id, source: "grant", expires_on: g.expires_on });
      commit(db);
    },
    // 配りまちがいの取り消し（使っていないチケットだけ）
    async revokeTicket(ticketId) {
      await wait();
      const db = load();
      isManager(db);
      const t = db.tickets.find(x => x.id === ticketId) || fail("チケットが見つかりません");
      if (t.booking_id) fail("予約に使われているチケットは取り消せません");
      t.revoked_at = new Date().toISOString();
      commit(db);
    },
    async allBookings() {
      const db = load();
      isManager(db);
      return db.bookings.map(b => ({ ...b, student_name: studentName(db, b.student_id), teacher_name: teacherName(db, b.teacher_id) }))
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    },

    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    resetDemo() {
      try {
        localStorage.removeItem(KEY);
        Object.keys(localStorage).filter(k => k.startsWith(FILE_KEY)).forEach(k => localStorage.removeItem(k));
      } catch {}
      load();
      notify();
    },
  };
}
