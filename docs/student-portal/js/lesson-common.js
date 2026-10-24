// 個人レッスン（専用コース）の共通の小物。
// 時刻はすべて日本時間（JST）で扱う。先生が海外にいてもブラウザの時計に左右されないよう、
// 「UTC＋9時間」で計算する（日本に夏時間はない）。

export const LESSON_MINUTES = 60;   // レッスンの長さ
export const DEADLINE_HOURS = 24;   // 予約・キャンセルの締め切り（レッスン開始の何時間前まで）
export const ZOOM_OPEN_MINUTES = 10; // Zoom に入るボタンを出す時刻（開始の何分前から）
export const TICKET_MONTHS = 2;     // チケットの有効期限（配った日・返した日から）
export const BOOK_AHEAD_MONTHS = 1; // 生徒が予約できるのは今日から何か月先まで
export const FIRST_HOUR = 7;        // 日ごとの調整でいつも表示する時間帯（日本時間の開始 7:00〜23:00）
export const LAST_HOUR = 23;        // 　これ以外の時間も、毎週の空き時間や予約があれば表示する
export const JST = "JST（日本時間）";
export const FILE_MAX_MB = 10;       // メッセージに添付できるファイルの大きさ（写真は縮めてから送る）
export const FILE_KEEP_MONTHS = 6;   // 添付ファイルを残す期間（送った日から。過ぎたら自動で消す）
export const IMAGE_MAX_PX = 1600;    // 写真は長い辺をこの大きさまで縮める

const H9 = 9 * 3600e3;
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const p2 = n => String(n).padStart(2, "0");

// 日本時間の「日付＋時」→ その瞬間（ISO 文字列）
export function jstIso(date, hour, minute = 0) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour - 9, minute)).toISOString();
}
// その瞬間の日本時間の各部分
export function jst(iso) {
  const t = new Date(new Date(iso).getTime() + H9);
  return { date: `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`,
    hour: t.getUTCHours(), minute: t.getUTCMinutes(), dow: t.getUTCDay(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}
export const jstToday = () => jst(new Date().toISOString()).date;
export const ms = iso => new Date(iso).getTime();
export const endIso = iso => new Date(ms(iso) + LESSON_MINUTES * 60e3).toISOString();

// 日付の計算（"2026-10-24" の形のまま、時差の影響を受けない）
export function addDaysJ(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}
export function dowJ(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export const mondayJ = date => addDaysJ(date, dowJ(date) === 0 ? -6 : 1 - dowJ(date));
// n か月後の同じ日（その月にない日は月末。例：12/31 の2か月後 → 2/28）
export function addMonthsJ(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  const t = new Date(Date.UTC(y, m - 1 + n, Math.min(d, last)));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}

// 表示用
export function fmtDay(date) {
  const [, m, d] = date.split("-").map(Number);
  return `${m}/${d}（${WD[dowJ(date)]}）`;
}
export function fmtWhen(iso) {
  const j = jst(iso), e = jst(endIso(iso));
  return `${fmtDay(j.date)} ${j.hour}:${p2(j.minute)}〜${e.hour}:${p2(e.minute)}`;
}
export const fmtHour = h => `${h}:00`;
export function fmtStamp(iso) {
  const j = jst(iso);
  return `${j.month}/${j.day} ${j.hour}:${p2(j.minute)}`;
}

// 添付ファイルが保存期間（6か月）を過ぎて消えたか
export const fileGone = iso => addMonthsJ(jst(iso).date, FILE_KEEP_MONTHS) < jstToday();

// レッスンの状態（画面の表示とボタンを決める）
//   status: booked=予約中 / cancelled=生徒がキャンセル / teacher_cancelled=先生がキャンセル / absent=欠席
export function phase(b, now = Date.now()) {
  if (b.status !== "booked") return b.status;
  const s = ms(b.starts_at);
  if (now >= s + LESSON_MINUTES * 60e3) return "done";        // 終わった
  if (now >= s - ZOOM_OPEN_MINUTES * 60e3) return "live";     // まもなく・授業中（Zoom に入れる）
  if (now >= s - DEADLINE_HOURS * 3600e3) return "locked";    // 24時間前を過ぎた（欠席のみ）
  return "open";                                              // キャンセルできる
}
export const PHASE_LABEL = {
  open: "予約中", locked: "予約中", live: "まもなく開始", done: "受講済み",
  cancelled: "キャンセル済み", teacher_cancelled: "先生の都合でキャンセル", absent: "欠席",
};
// 表示する状態の名前（開始10分前〜開始は「まもなく開始」、始まったら「授業中」）
export function phaseLabel(b, now = Date.now()) {
  const ph = phase(b, now);
  if (ph === "live" && now >= ms(b.starts_at)) return "授業中";
  return PHASE_LABEL[ph];
}
export const PHASE_TAG = {
  open: "tag-ok", locked: "tag-ok", live: "tag-warn", done: "tag-mute",
  cancelled: "tag-mute", teacher_cancelled: "tag-ng", absent: "tag-mute",
};

// ---------- イギリス時間（先生の画面用） ----------
// ブラウザに入っているタイムゾーンの情報（Europe/London）を使うので、夏時間（BST）・冬時間（GMT）の切り替えは自動。
// 夏時間：3月最終日曜〜10月最終日曜（日本との時差 8時間）／冬時間：それ以外（時差 9時間）
const ukFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function uk(iso) {
  const t = new Date(iso);
  const p = Object.fromEntries(ukFmt.formatToParts(t).map(x => [x.type, x.value]));
  const offset = (Number(p.hour) - t.getUTCHours() + 24) % 24;  // UTC との差（夏時間 1・冬時間 0）
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute),
    summer: offset === 1, zone: offset === 1 ? "BST" : "GMT", diff: 9 - offset };
}
// "UK 9:00〜10:00"（イギリスでは前日になるときは「前日」を付ける）
export function fmtUk(iso, withZone = false) {
  const s = uk(iso), e = uk(endIso(iso));
  return `UK ${s.date < jst(iso).date ? "前日 " : ""}${s.hour}:${p2(s.minute)}〜${e.hour}:${p2(e.minute)}${withZone ? ` ${s.zone}` : ""}`;
}
// いまのイギリスが夏時間か冬時間か、次に切り替わる日（イギリスの日付）
export function ukStatus(now = new Date()) {
  const cur = uk(now.toISOString());
  for (let i = 1; i <= 400; i++) {
    const t = new Date(now.getTime() + i * 24 * 3600e3);
    const u = uk(t.toISOString());
    if (u.summer !== cur.summer) {
      // その日のうちのどこで切り替わったか（イギリスでは日曜の未明）→ 前日から1時間ずつ探す
      for (let h = -24; h <= 0; h++) {
        const x = uk(new Date(t.getTime() + h * 3600e3).toISOString());
        if (x.summer !== cur.summer) return { ...cur, next: { ...x, date: x.date } };
      }
    }
  }
  return { ...cur, next: null };
}
