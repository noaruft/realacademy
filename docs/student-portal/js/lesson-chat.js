// 個人レッスンのメッセージ（生徒 ⇔ 先生の1対1）。生徒のページと先生のページで共通。
// 左に相手の一覧、右にやり取り。スマホ幅ではどちらか一方を表示する。
// 写真と PDF を添付できる（写真はブラウザの中で縮めてから送る。送った日から6か月で自動的に消える）。

import { errMsg, esc, toast } from "./common.js?v=19888956";
import { FILE_KEEP_MONTHS, FILE_MAX_MB, IMAGE_MAX_PX, fileGone, fmtStamp } from "./lesson-common.js?v=19888956";

// 写真は長い辺を IMAGE_MAX_PX まで縮めて JPEG に。PDF はそのまま
async function prepareFile(file) {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (file.size > FILE_MAX_MB * 1024 * 1024) throw new Error(`PDFは${FILE_MAX_MB}MBまでです`);
    return { blob: file, name: file.name, type: "application/pdf" };
  }
  if (!file.type.startsWith("image/")) throw new Error("送れるのは写真とPDFだけです");
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error("この形式の写真は読み込めません。JPEG か PNG の写真を選んでください");
  }
  const k = Math.min(1, IMAGE_MAX_PX / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";  // 透明な部分は白に
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.82));
  return { blob, name: file.name.replace(/\.[^.]+$/, "") + ".jpg", type: "image/jpeg" };
}

const kb = n => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const fileLabel = m => (m.file_type?.startsWith("image/") ? "写真" : "PDF");

// side：自分の立場（"student" | "teacher"）。onUnread(n)：未読の合計が変わったとき
export function createChat(api, root, { side, onUnread = () => {}, title = n => n, lockedNote = "" }) {
  root.innerHTML = `
    <div class="chat">
      <ul class="chat-list" data-list></ul>
      <section class="chat-main" data-main hidden>
        <div class="chat-head"><button class="chat-back" type="button" data-back aria-label="一覧に戻る">‹ 一覧</button><span data-with></span></div>
        <div class="chat-log" data-log aria-live="polite"></div>
        <p class="chat-locked muted" data-locked hidden></p>
        <form class="chat-form" data-form>
          <div class="chat-pending" data-pending hidden></div>
          <div class="chat-row">
            <label class="chat-attach" title="写真・PDFを添付（写真は自動で縮めます。PDFは${FILE_MAX_MB}MBまで）">
              <input type="file" name="file" accept="image/*,application/pdf" data-file hidden>
              <span aria-hidden="true">＋</span><span class="lbl">写真・PDF</span>
            </label>
            <textarea class="input" name="body" rows="2" maxlength="2000" placeholder="メッセージを入力" aria-label="メッセージ"></textarea>
            <button class="btn" type="submit">送信</button>
          </div>
        </form>
      </section>
      <p class="chat-empty muted" data-empty>左の一覧から相手を選んでください。</p>
    </div>`;
  const q = s => root.querySelector(`[data-${s}]`);
  let threads = [];
  let cur = null;
  let pending = null;  // 送る前の添付（縮めたあと）

  function renderList() {
    q("list").innerHTML = threads.length ? threads.map(t => {
      const last = t.last ? (t.last.from === side ? "あなた：" : "") + (t.last.body || `（${fileLabel(t.last)}）`) : "まだメッセージはありません";
      return `
      <li><button type="button" data-id="${esc(t.other_id)}" class="${t.other_id === cur ? "is-cur" : ""}">
        <span class="nm">${esc(title(t.other_name))}${t.unread ? `<span class="badge">${t.unread}</span>` : ""}</span>
        <span class="last">${esc(last)}</span>
      </button></li>`;
    }).join("")
      : `<li class="muted" style="padding:14px">${side === "teacher" ? "予約のある生徒がまだいません。" : "先生がまだ登録されていません。"}</li>`;
  }

  function attHtml(m) {
    if (!m.file_path) return "";
    if (fileGone(m.created_at)) return `<div class="att gone">（${fileLabel(m)}：保存期間の${FILE_KEEP_MONTHS}か月を過ぎたため削除されました）</div>`;
    return m.file_type?.startsWith("image/")
      ? `<a class="att att-img" data-att="${m.id}" target="_blank" rel="noopener" aria-label="写真を大きく見る"><span class="muted">写真を読み込み中…</span></a>`
      : `<a class="att att-pdf mat-btn" data-att="${m.id}" target="_blank" rel="noopener">${esc(m.file_name || "PDF")}<small>${m.file_size ? kb(m.file_size) : ""}</small></a>`;
  }

  async function show(id) {
    cur = id;
    const t = threads.find(x => x.other_id === id);
    if (!t) { cur = null; q("main").hidden = true; q("empty").hidden = false; root.querySelector(".chat").classList.remove("is-open"); return; }
    q("main").hidden = false;
    q("empty").hidden = true;
    root.querySelector(".chat").classList.add("is-open");
    q("with").textContent = title(t.other_name);
    const list = await api.messages(id);
    const log = q("log");
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40 || log.dataset.for !== String(id);
    log.innerHTML = list.length ? list.map(m => `
      <div class="msg ${m.from === side ? "mine" : "theirs"}">
        ${m.body ? `<div class="bubble">${esc(m.body).replace(/\n/g, "<br>")}</div>` : ""}
        ${attHtml(m)}
        <div class="stamp">${fmtStamp(m.created_at)}${m.from === side && m.read_at ? "　既読" : ""}</div>
      </div>`).join("") : `<p class="muted" style="text-align:center;margin:24px 0">まだメッセージはありません。</p>`;
    if (atBottom) log.scrollTop = log.scrollHeight;
    log.dataset.for = String(id);
    // 添付ファイルのアドレスを取ってきて差し込む
    for (const el of log.querySelectorAll("[data-att]")) {
      const m = list.find(x => String(x.id) === el.dataset.att);
      api.fileUrl(m).then(url => {
        if (!url) { el.outerHTML = `<div class="att gone">（${fileLabel(m)}を開けませんでした）</div>`; return; }
        el.href = url;
        if (el.classList.contains("att-img")) {
          const img = new Image();
          img.alt = m.file_name || "写真";
          img.onload = () => { if (atBottom) log.scrollTop = log.scrollHeight; };
          img.src = url;
          el.replaceChildren(img);
        }
      }).catch(() => {});
    }
    q("form").hidden = !t.can_send;
    q("locked").hidden = t.can_send;
    q("locked").textContent = lockedNote;
    renderList();
    if (t.unread) await api.markRead(id);
  }

  async function refresh() {
    threads = await api.threads();
    onUnread(threads.reduce((n, t) => n + t.unread, 0));
    renderList();
    if (cur != null) await show(cur);
  }

  function renderPending() {
    q("pending").hidden = !pending;
    q("pending").innerHTML = pending ? `<span class="chip">${pending.type.startsWith("image/") ? "写真" : "PDF"}：${esc(pending.name)}（${kb(pending.blob.size)}）
      <button type="button" data-unpick aria-label="添付をやめる">×</button></span>` : "";
  }

  q("list").addEventListener("click", e => {
    const b = e.target.closest("button[data-id]");
    if (b) show(b.dataset.id).then(() => q("form").body.focus({ preventScroll: true }));
  });
  q("back").addEventListener("click", () => { cur = null; show(null); renderList(); });
  q("file").addEventListener("change", async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      pending = await prepareFile(f);
    } catch (err) {
      pending = null;
      toast(errMsg(err), true);
    }
    renderPending();
  });
  q("pending").addEventListener("click", e => {
    if (e.target.closest("[data-unpick]")) { pending = null; renderPending(); }
  });
  q("form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector("button[type=submit]");
    if (!f.body.value.trim() && !pending) return;
    btn.disabled = true;
    try {
      await api.send(cur, f.body.value, pending);
      f.reset();
      pending = null;
      renderPending();
      q("log").dataset.for = "";  // 送ったら一番下へ
      await refresh();
    } catch (err) {
      toast(errMsg(err), true);
    } finally {
      btn.disabled = false;
    }
  });
  // Ctrl（Mac は ⌘）＋Enter でも送信
  q("form").body.addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); q("form").requestSubmit(); }
  });

  return {
    refresh,
    // 相手を指定して開く（「メッセージ」ボタンから）
    async open(id) { await refresh(); await show(id); },
  };
}
