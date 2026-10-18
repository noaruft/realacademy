// データの読み書き。config.js に Supabase の値があれば本番、なければお試しモード（mock.js）。
// 生徒用ページ・先生用ページはこのファイルの関数だけを使う。

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

export async function createApi() {
  const cfg = window.PORTAL_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    const { createMockApi } = await import("./mock.js");
    return createMockApi();
  }
  const { createClient } = await import(SUPABASE_JS);
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const unwrap = ({ data, error }) => {
    if (error) throw error;
    return data;
  };
  const toEmail = id => `${id.trim().toLowerCase()}@${cfg.loginDomain}`;

  return {
    demo: false,

    async signIn(loginId, password) {
      const { error } = await sb.auth.signInWithPassword({ email: toEmail(loginId), password });
      if (error) throw new Error("ログインIDまたはパスワードが正しくありません");
    },
    async signOut() {
      await sb.auth.signOut();
    },
    // ログイン中の人。null=未ログイン / role: "student" | "admin" | "none"（名簿にない）
    async me() {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return null;
      const uid = session.user.id;
      const a = await sb.from("admins").select("*").eq("id", uid).maybeSingle();
      if (a.data) return { role: "admin", admin: a.data };
      const s = await sb.from("students").select("*, classes(name)").eq("id", uid).maybeSingle();
      if (s.data && s.data.active) return { role: "student", student: { ...s.data, class_name: s.data.classes?.name } };
      return { role: "none" };
    },
    async changePassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
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
    // 登録済みの教材PDFの一覧
    async materials() {
      return unwrap(await sb.from("materials").select("class_id,term,week,kind,path,updated_at")
        .order("class_id").order("term").order("week"));
    },
    // ---------- 年間予定 ----------
    async saveYear(row) {
      unwrap(await sb.from("school_years").upsert(row, { onConflict: "id" }));
    },
    async setHoliday(weekStart, on, note = null) {
      unwrap(await sb.rpc("set_holiday_week", { p_week: weekStart, p_on: on, p_note: note }));
    },
    // ---------- Test Week の結果 ----------
    async testData(year, term) {
      const [pub, results] = await Promise.all([
        sb.from("test_publish").select("*").eq("school_year", year).eq("term", term).maybeSingle().then(unwrap),
        sb.from("test_results").select("*").eq("school_year", year).eq("term", term).then(unwrap),
      ]);
      return { published: !!pub?.published, published_at: pub?.published_at ?? null, results };
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
