// データの読み書き。config.js に Supabase の値があれば本番、なければお試しモード（mock.js）。
// 生徒用ページ・先生用ページはこのファイルの関数だけを使う。

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

// Supabase の接続（1つのページで1つだけ作り、個人レッスンの lesson-api.js とも共有する）
let client = null;
export async function supabaseClient() {
  if (client) return client;
  const cfg = window.PORTAL_CONFIG || {};
  const { createClient } = await import(SUPABASE_JS);
  // ログインの記録はタブを閉じると消える場所（sessionStorage）に置く＝ブラウザ（タブ）を閉じるとログアウト。
  // 以前の形（localStorage）に残っているログインの記録は消しておく。
  try {
    Object.keys(localStorage).filter(k => /^sb-.*-auth-token/.test(k)).forEach(k => localStorage.removeItem(k));
  } catch {}
  client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true },
  });
  return client;
}

export async function createApi() {
  const cfg = window.PORTAL_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    const { createMockApi } = await import("./mock.js?v=19888956");
    return createMockApi();
  }
  const sb = await supabaseClient();
  const unwrap = ({ data, error }) => {
    if (error) throw error;
    return data;
  };
  // 個人レッスン（専用コース）で何ができるか。表がまだない（schema.sql 未実行）ときは何もできない扱い
  async function lessonFlags(uid) {
    try {
      const [ls, lt] = await Promise.all([
        sb.from("lesson_students").select("name, active").eq("id", uid).maybeSingle(),
        sb.from("lesson_teachers").select("*").eq("id", uid).maybeSingle(),
      ]);
      const st = ls.data?.active ? ls.data : null, te = lt.data?.active ? lt.data : null;
      return { student: !!st, teacher: !!te?.is_teacher, manager: !!te?.is_manager, name: st?.name || te?.display_name || te?.name || "" };
    } catch {
      return { student: false, teacher: false, manager: false, name: "" };
    }
  }
  const toEmail = id => `${id.trim().toLowerCase()}@${cfg.loginDomain}`;

  return {
    demo: false,

    async signIn(loginId, password) {
      const { error } = await sb.auth.signInWithPassword({ email: toEmail(loginId), password });
      if (error) throw new Error("ログインIDまたはパスワードが正しくありません");
    },
    async signOut() {
      // この端末だけログアウトする（同じアカウントでログイン中のほかの端末はそのまま）
      await sb.auth.signOut({ scope: "local" });
    },
    // ログイン中の人。null=未ログイン / role: "student" | "admin" | "none"（名簿にない）
    async me() {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return null;
      const uid = session.user.id;
      const lesson = await lessonFlags(uid);
      const a = await sb.from("admins").select("*").eq("id", uid).maybeSingle();
      if (a.data) return { role: "admin", admin: a.data, lesson };
      const s = await sb.from("students").select("*, classes(name)").eq("id", uid).maybeSingle();
      if (s.data && s.data.active) return { role: "student", student: { ...s.data, class_name: s.data.classes?.name } };
      if (lesson.student || lesson.teacher || lesson.manager) return { role: "lesson", lesson };
      return { role: "none" };
    },
    async changePassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
      // 名簿スプレッドシートにも新しいパスワードを表示するため、控えを残す（同期で書き戻される）
      const rec = await sb.rpc("record_my_password", { p_password: password });
      if (rec.error) throw new Error("パスワードは変更されましたが、名簿への記録に失敗しました。先生に新しいパスワードをお伝えください");
    },

    // ---------- 生徒 ----------
    async settings() {
      return unwrap(await sb.from("settings").select("*").eq("id", 1).single());
    },
    async mySchedule() {
      return unwrap(await sb.rpc("my_schedule"));
    },
    // toId が null なら欠席。studentId は先生が代わりに登録するときだけ
    async requestChange(fromId, toId = null, studentId = null) {
      return unwrap(await sb.rpc("request_change", { p_from: fromId, p_to: toId, p_student: studentId }));
    },
    async cancelChange(changeId) {
      unwrap(await sb.rpc("cancel_change", { p_change: changeId }));
    },
    // 受けた授業（終わったもの）と成績・教材。新しい順
    async myLessons() {
      return unwrap(await sb.rpc("my_lessons"));
    },
    // 年間予定（年度と休みの週）。生徒・先生とも読める
    async calendar() {
      const [years, holidays] = await Promise.all([
        sb.from("school_years").select("*").order("start_date").then(unwrap),
        sb.from("holiday_weeks").select("*").order("week_start").then(unwrap),
      ]);
      return { years, holidays };
    },
    // 自分のテスト結果（公開済みのものは path あり）
    async myTests() {
      return unwrap(await sb.rpc("my_tests"));
    },
    // 小テストの答案PDFを開くための、10分間だけ有効なURL
    async quizUrl(path) {
      const { data, error } = await sb.storage.from("tests").createSignedUrl(path, 600);
      if (error) throw new Error("この答案はまだ見られません");
      return data.signedUrl;
    },
    async testUrl(path) {
      const { data, error } = await sb.storage.from("tests").createSignedUrl(path, 600);
      if (error) throw new Error("このテスト結果はまだ見られません");
      return data.signedUrl;
    },
    // 教材PDFを開くための、10分間だけ有効なURL
    async materialUrl(path) {
      const { data, error } = await sb.storage.from("materials").createSignedUrl(path, 600);
      if (error) throw new Error("この教材はまだ見られません");
      return data.signedUrl;
    },

    // ---------- 先生 ----------
    // from〜to の授業と、その授業に関わる有効な振替・欠席、名簿など一式
    async adminData(from, to) {
      const [settings, classes, schedule, students, sessions] = await Promise.all([
        sb.from("settings").select("*").eq("id", 1).single().then(unwrap),
        sb.from("classes").select("*").order("sort").then(unwrap),
        sb.from("schedule").select("*").order("weekday").then(unwrap),
        sb.from("students").select("*").order("login_id").then(unwrap),
        sb.from("sessions").select("*").gte("date", from).lte("date", to).order("date").order("start_time").then(unwrap),
      ]);
      let changes = [];
      if (sessions.length) {
        const ids = sessions.map(s => s.id).join(",");
        changes = unwrap(await sb.from("changes")
          .select("*, from_s:from_session_id(id,date,start_time), to_s:to_session_id(id,date,start_time)")
          .is("cancelled_at", null)
          .or(`from_session_id.in.(${ids}),to_session_id.in.(${ids})`));
      }
      return { settings, classes, schedule, students, sessions, changes };
    },
    // from〜to の授業と入力済みの成績
    async gradeData(from, to) {
      const sessions = unwrap(await sb.from("sessions").select("id").gte("date", from).lte("date", to));
      const ids = sessions.map(s => s.id);
      const grades = ids.length ? unwrap(await sb.from("grades").select("*").in("session_id", ids)) : [];
      return { grades };
    },
    async saveGrade(sessionId, studentId, patch) {
      const { data: { session } } = await sb.auth.getSession();
      unwrap(await sb.from("grades").upsert(
        { session_id: sessionId, student_id: studentId, ...patch, updated_at: new Date().toISOString(), updated_by: session?.user.id },
        { onConflict: "session_id,student_id" }));
    },
    // 小テストの答案PDF（授業×生徒）
    async uploadQuiz(sessionId, studentId, file) {
      const path = `quiz/${sessionId}/${studentId}.pdf`;
      const { error } = await sb.storage.from("tests").upload(path, file, { upsert: true, contentType: "application/pdf" });
      if (error) throw error;
      await this.saveGrade(sessionId, studentId, { quiz_pdf: path });
    },
    async deleteQuiz(sessionId, studentId) {
      await sb.storage.from("tests").remove([`quiz/${sessionId}/${studentId}.pdf`]);
      await this.saveGrade(sessionId, studentId, { quiz_pdf: null });
    },
    // 登録済みの教材PDFの一覧
    async materials() {
      return unwrap(await sb.from("materials").select("class_id,term,week,kind,path,updated_at")
        .order("class_id").order("term").order("week"));
    },
    // ---------- 年間予定 ----------
    async saveYear(row) {
      unwrap(await sb.from("school_years").upsert(row, { onConflict: "id" }));
    },
    // carry：休みの週でも授業をする曜日（前の週の分）。null なら今の設定のまま
    async setHoliday(weekStart, on, note = null, carry = null) {
      unwrap(await sb.rpc("set_holiday_week", { p_week: weekStart, p_on: on, p_note: note, p_carry: carry }));
    },
    // ---------- Term Assessment・Final Assessment の結果 ----------
    async testData(year, term) {
      const [pub, results, levels] = await Promise.all([
        sb.from("test_publish").select("*").eq("school_year", year).eq("term", term).maybeSingle().then(unwrap),
        sb.from("test_results").select("*").eq("school_year", year).eq("term", term).then(unwrap),
        sb.from("test_levels").select("*").eq("school_year", year).eq("term", term).then(unwrap),
      ]);
      return { published: !!pub?.published, published_at: pub?.published_at ?? null, results, levels };
    },
    // 結果（S・A・B）。level が null なら消す
    async saveTestLevel(year, term, studentId, level) {
      if (!level) {
        unwrap(await sb.from("test_levels").delete().eq("school_year", year).eq("term", term).eq("student_id", studentId));
        return;
      }
      unwrap(await sb.from("test_levels").upsert(
        { school_year: year, term, student_id: studentId, level, updated_at: new Date().toISOString() },
        { onConflict: "school_year,term,student_id" }));
    },
    async setTestPublished(year, term, on) {
      unwrap(await sb.from("test_publish").upsert(
        { school_year: year, term, published: on, published_at: on ? new Date().toISOString() : null },
        { onConflict: "school_year,term" }));
    },
    async uploadTest(year, term, studentId, file) {
      const path = `${year}/${term}/${studentId}.pdf`;
      const { error } = await sb.storage.from("tests").upload(path, file, { upsert: true, contentType: "application/pdf" });
      if (error) throw error;
      unwrap(await sb.from("test_results").upsert(
        { school_year: year, term, student_id: studentId, path, uploaded_at: new Date().toISOString() },
        { onConflict: "school_year,term,student_id" }));
    },
    async deleteTest(year, term, studentId) {
      const path = `${year}/${term}/${studentId}.pdf`;
      await sb.storage.from("tests").remove([path]);
      unwrap(await sb.from("test_results").delete().eq("school_year", year).eq("term", term).eq("student_id", studentId));
    },
    async generateSessions(from, to) {
      return unwrap(await sb.rpc("generate_sessions", { p_from: from, p_to: to }));
    },
    async updateSession(id, patch) {
      unwrap(await sb.from("sessions").update(patch).eq("id", id));
    },
    async updateStudent(id, patch) {
      unwrap(await sb.from("students").update(patch).eq("id", id));
    },
    async updateSettings(patch) {
      unwrap(await sb.from("settings").update(patch).eq("id", 1));
    },
    async updateSchedule(row) {
      unwrap(await sb.from("schedule").update({ start_time: row.start_time, end_time: row.end_time })
        .eq("class_id", row.class_id).eq("weekday", row.weekday));
    },
    // 誰かが振替・欠席したら onChange を呼ぶ。onStatus(true/false) で接続状態
    subscribe(onChange, onStatus = () => {}) {
      const ch = sb.channel("admin-live");
      for (const table of ["changes", "sessions", "students", "grades", "holiday_weeks", "school_years"]) {
        ch.on("postgres_changes", { event: "*", schema: "public", table }, () => onChange());
      }
      ch.subscribe(status => onStatus(status === "SUBSCRIBED"));
      return () => sb.removeChannel(ch);
    },
  };
}
