// 個人レッスン（専用コース）のデータの読み書き。config.js に Supabase の値があれば本番、なければお試しモード（lesson-mock.js）。
// 個人レッスンのページはこのファイルの関数だけを使う（ログイン・ログアウトは api.js）。
// 本番のルール（24時間前の締め切り・チケット・空き時間など）は supabase/schema.sql の lesson_… 関数にある。

import { fileGone } from "./lesson-common.js?v=f622146d";

export async function createLessonApi() {
  const cfg = window.PORTAL_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    const { createLessonMockApi } = await import("./lesson-mock.js?v=f622146d");
    return createLessonMockApi();
  }
  const { supabaseClient } = await import("./api.js?v=f622146d");
  const sb = await supabaseClient();
  const unwrap = ({ data, error }) => {
    if (error) throw new Error(error.message || "エラーが発生しました");
    return data;
  };
  const rpc = async (fn, args) => unwrap(await sb.rpc(fn, args));
  const me = async () => (await sb.auth.getSession()).data.session?.user.id;
  let studentSide = null;  // 自分が生徒か（メッセージの向きを決める）
  const isStudent = async () => (studentSide ??= await rpc("lesson_is_student"));
  // データベースの sender を、画面で使う from に
  const toMsg = m => ({ ...m, from: m.sender });
  const signed = new Map();  // 添付ファイル → { url, until }

  return {
    demo: false,

    // ---------- 生徒 ----------
    teachers: () => rpc("lesson_teacher_list"),
    // id は「先生|開始時刻」（book に渡す）
    async openSlots(teacherId) {
      const rows = await rpc("lesson_open_slots", { p_teacher: teacherId });
      return rows.map(x => ({ id: `${x.teacher_id}|${x.starts_at}`, teacher_id: x.teacher_id, starts_at: x.starts_at }));
    },
    myBookings: () => rpc("lesson_my_bookings"),
    async myTickets() {
      return rpc("lesson_tickets_of", { p_student: await me() });
    },
    async book(slotId) {
      const [teacher, starts] = String(slotId).split("|");
      return rpc("lesson_book", { p_teacher: teacher, p_starts: starts });
    },
    cancel: id => rpc("lesson_cancel", { p_booking: id }),
    absent: id => rpc("lesson_absent", { p_booking: id }),
    // チケットを自分で追加（3・5・10枚）
    addTickets: count => rpc("lesson_add_tickets", { p_count: Number(count) }),

    // ---------- メッセージ ----------
    async threads() {
      const [partners, msgs] = await Promise.all([
        rpc("lesson_partners"),
        sb.from("lesson_messages").select("*").order("created_at").then(unwrap),
      ]);
      const stu = await isStudent();
      return partners.map(p => {
        const list = msgs.filter(m => (stu ? m.teacher_id : m.student_id) === p.other_id).map(toMsg);
        return { ...p, last: list.at(-1) || null, unread: list.filter(m => !m.read_at && m.from === (stu ? "teacher" : "student")).length };
      }).sort((a, b) => (b.last?.created_at || "").localeCompare(a.last?.created_at || "") || a.other_name.localeCompare(b.other_name));
    },
    async messages(otherId) {
      const uid = await me();
      const rows = unwrap(await sb.from("lesson_messages").select("*")
        .or(`and(student_id.eq.${uid},teacher_id.eq.${otherId}),and(teacher_id.eq.${uid},student_id.eq.${otherId})`)
        .order("created_at"));
      return rows.map(toMsg);
    },
    // file：添付（{ blob, name, type }。写真は画面側で縮めてから渡す）。lesson-files/<生徒>/<先生>/<…> に置いてから送る
    async send(otherId, body, file = null) {
      let f = {};
      if (file) {
        const uid = await me();
        const [student, teacher] = (await isStudent()) ? [uid, otherId] : [otherId, uid];
        const ext = file.type === "application/pdf" ? "pdf" : "jpg";
        const path = `${student}/${teacher}/${crypto.randomUUID()}.${ext}`;
        const { error } = await sb.storage.from("lesson-files").upload(path, file.blob, { contentType: file.type });
        if (error) throw new Error("ファイルを送れませんでした。時間をおいてもう一度お試しください");
        f = { p_file_path: path, p_file_name: file.name, p_file_type: file.type, p_file_size: file.blob.size };
      }
      await rpc("lesson_send", { p_other: otherId, p_body: String(body || ""), ...f });
    },
    markRead: otherId => rpc("lesson_mark_read", { p_other: otherId }),
    // 添付ファイルを開くための、10分間だけ有効なURL（保存期間を過ぎたものは null）
    async fileUrl(m) {
      if (!m.file_path || fileGone(m.created_at)) return null;
      const c = signed.get(m.file_path);
      if (c && c.until > Date.now()) return c.url;
      const { data, error } = await sb.storage.from("lesson-files").createSignedUrl(m.file_path, 600);
      if (error) return null;
      signed.set(m.file_path, { url: data.signedUrl, until: Date.now() + 9 * 60e3 });
      return data.signedUrl;
    },

    // ---------- 先生 ----------
    async myTeacher() {
      return unwrap(await sb.from("lesson_teachers").select("*").eq("id", await me()).single());
    },
    // プロフィール（{ name, origin, hobby, message }）。name は生徒の画面などに出す名前（空なら名簿の名前）
    updateProfile: p => rpc("lesson_update_profile", { p_name: p.name || "", p_origin: p.origin || "", p_hobby: p.hobby || "", p_message: p.message || "" }),
    async weekly() {
      return unwrap(await sb.from("lesson_weekly").select("weekday, hour").eq("teacher_id", await me()));
    },
    saveWeekly: list => rpc("lesson_save_weekly", { p_list: list }),
    teacherDays: (from, to) => rpc("lesson_teacher_days", { p_from: from, p_to: to }),
    setDay: (date, hour, open) => rpc("lesson_set_day", { p_date: date, p_hour: hour, p_open: open }),
    closeDay: date => rpc("lesson_close_day", { p_date: date }),
    resetDay: date => rpc("lesson_reset_day", { p_date: date }),
    teacherBookings: () => rpc("lesson_teacher_bookings"),
    teacherCancel: (id, note) => rpc("lesson_teacher_cancel", { p_booking: id, p_note: note || null }),

    // ---------- 管理者（チケット） ----------
    // month：購入を数える月（その月のどこかの日 "2026-10-01"）
    ticketOverview: month => rpc("lesson_ticket_overview", { p_month: month }),
    async studentTickets(studentId) {
      const [tickets, grants] = await Promise.all([
        rpc("lesson_tickets_of", { p_student: studentId }),
        sb.from("lesson_grants").select("*").eq("student_id", studentId).order("created_at").then(unwrap),
      ]);
      return { tickets, grants };
    },
    grant: (studentId, count, note) => rpc("lesson_grant", { p_student: studentId, p_count: Number(count), p_note: note || null }),
    revokeTicket: id => rpc("lesson_revoke", { p_ticket: id }),
    allBookings: () => rpc("lesson_all_bookings"),

    // 予約・メッセージ・チケットが変わったら onChange（自分が読める行だけ届く）
    subscribe(onChange) {
      const ch = sb.channel("lesson-live");
      for (const table of ["lesson_bookings", "lesson_messages", "lesson_tickets"]) {
        ch.on("postgres_changes", { event: "*", schema: "public", table }, () => onChange());
      }
      ch.subscribe();
      return () => sb.removeChannel(ch);
    },
  };
}
