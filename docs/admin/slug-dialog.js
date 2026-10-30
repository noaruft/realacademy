/* 管理画面（Sveltia CMS）：お知らせ・イベント・ブログを新しく作って最初に「保存」を押したとき（⌘S も）に、
   ページのアドレス（ファイル名）を入れる画面を出す。アドレスはこのとき決まり、あとから変えられないため。
   入れた値は右側の「スラッグ」の欄に入れてから、そのまま保存する。
   決まりは admin/config.yml の slug.pattern と同じ（半角の小文字英数字とハイフン）。 */
(function () {
  "use strict";
  var SITE = new URL("../", location.href).href;
  var KINDS = { // コレクション: [アドレスの頭, 薄い字の例]
    news: ["news-", "toefl-2026"],
    events: ["event-", "halloween-2026"],
    blog: ["blog-", "summer-2026"],
  };
  var PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  var confirmed = null; // この画面で決めたアドレス（決めたあと保存に失敗して押し直したときは、もう一度は聞かない）
  var bypass = false;

  function kind() {
    var m = /^#\/collections\/([^/]+)\/new\b/.exec(location.hash);
    return m && KINDS[m[1]] ? m[1] : null;
  }
  function slugInput() {
    return Array.prototype.find.call(document.querySelectorAll("input[aria-labelledby]"), function (i) {
      var label = document.getElementById(i.getAttribute("aria-labelledby"));
      return label && label.textContent.trim() === "スラッグ";
    });
  }
  function showSlugPanel() {
    var tab = document.querySelector('[role="radio"][aria-label="スラッグ"]');
    if (tab && tab.getAttribute("aria-checked") !== "true") tab.click();
  }
  function setValue(input, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  // 全角の英数字は半角に、大文字は小文字に、空白と「_」はハイフンに
  function tidy(s) {
    return s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); })
      .replace(/[ー－―‐]/g, "-").toLowerCase().replace(/[\s_　]+/g, "-");
  }

  var css = document.createElement("style");
  css.textContent =
    ".ra-slug{position:fixed;inset:0;z-index:100000;background:rgba(15,22,40,.45);display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,'Hiragino Sans',sans-serif}" +
    ".ra-slug-box{background:#fff;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.25);padding:28px 32px;width:min(640px,92vw);color:#1b2a4a}" +
    ".ra-slug h2{margin:0 0 6px;font-size:19px}" +
    ".ra-slug p{margin:0 0 18px;font-size:13.5px;line-height:1.7;color:#555}" +
    ".ra-slug-row{display:flex;align-items:center;border:1px solid #b9bfcc;border-radius:6px;padding:0 12px;font-size:15px;background:#fafbfc}" +
    ".ra-slug-row:focus-within{border-color:#1b2a4a;box-shadow:0 0 0 3px rgba(27,42,74,.12)}" +
    ".ra-slug-row .fix{color:#666;white-space:nowrap}" +
    ".ra-slug-row .site{color:#999}" +
    ".ra-slug-row input{flex:1;min-width:6em;border:0;background:transparent;font:inherit;padding:11px 2px;outline:0;color:#1b2a4a}" +
    ".ra-slug-row input::placeholder{color:#c3c7cf}" +
    ".ra-slug-msg{min-height:20px;margin:8px 0 0;font-size:13px;color:#b3261e}" +
    ".ra-slug-msg.ok{color:#2e7d32}" +
    ".ra-slug-btns{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}" +
    ".ra-slug-btns button{font:inherit;font-size:14px;border-radius:6px;padding:9px 18px;cursor:pointer;border:1px solid #b9bfcc;background:#fff;color:#1b2a4a}" +
    ".ra-slug-btns .go{background:#1b2a4a;border-color:#1b2a4a;color:#fff}" +
    ".ra-slug-btns .go:disabled{opacity:.4;cursor:default}";
  document.head.appendChild(css);

  function ask(k, current, done) {
    var prefix = KINDS[k][0], example = KINDS[k][1];
    var wrap = document.createElement("div");
    wrap.className = "ra-slug";
    wrap.innerHTML =
      '<div class="ra-slug-box" role="dialog" aria-modal="true" aria-labelledby="ra-slug-title">' +
      '<h2 id="ra-slug-title">ページのアドレスを決めてください</h2>' +
      "<p>このページのアドレス（URL）になります。保存するとあとから変えられません。<br>半角の小文字英数字とハイフン（-）で書いてください。例：" + prefix + example + "</p>" +
      '<label class="ra-slug-row"><span class="fix"><span class="site">' + SITE.replace(/^https?:\/\//, "") + "</span>" + prefix + "</span>" +
      '<input type="text" autocomplete="off" spellcheck="false" placeholder="' + example + '"><span class="fix">.html</span></label>' +
      '<p class="ra-slug-msg" aria-live="polite"></p>' +
      '<div class="ra-slug-btns"><button type="button" class="cancel">キャンセル</button><button type="button" class="go" disabled>このアドレスで保存</button></div>' +
      "</div>";
    document.body.appendChild(wrap);
    var input = wrap.querySelector("input"), msg = wrap.querySelector(".ra-slug-msg"), go = wrap.querySelector(".go");
    var checked = {}; // 公開中のサイトにすでにあるアドレスか（調べた結果を覚えておく）
    function check() {
      var v = input.value;
      msg.className = "ra-slug-msg";
      if (!v) { msg.textContent = ""; go.disabled = true; return; }
      if (!PATTERN.test(v)) {
        msg.textContent = /^-|-$|--/.test(v) ? "ハイフンは、英数字のあいだに1つずつ入れてください" : "半角の小文字英数字とハイフン（-）だけが使えます";
        go.disabled = true;
        return;
      }
      if (checked[v] === true) { msg.textContent = "このアドレスはすでに使われています。別のアドレスにしてください"; go.disabled = true; return; }
      msg.className = "ra-slug-msg ok";
      msg.textContent = "アドレス：" + SITE + prefix + v + ".html";
      go.disabled = false;
      if (checked[v] === undefined) {
        checked[v] = false;
        fetch(SITE + prefix + v + ".html", { method: "HEAD", cache: "no-store" }).then(function (r) {
          if (r.ok) { checked[v] = true; if (input.value === v) check(); }
        }).catch(function () {});
      }
    }
    input.addEventListener("input", function (e) {
      if (e.isComposing) return; // 日本語入力の変換中は手を出さない（確定したときに直す）
      var pos = input.selectionStart, before = input.value, after = tidy(before);
      if (after !== before) { input.value = after; input.setSelectionRange(pos, pos); }
      check();
    });
    input.addEventListener("compositionend", function () { input.dispatchEvent(new Event("input")); });
    function close() { wrap.remove(); }
    wrap.querySelector(".cancel").addEventListener("click", close);
    go.addEventListener("click", function () { if (!go.disabled) { var v = input.value; close(); done(v); } });
    wrap.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
      if (e.key === "Enter" && !e.isComposing && !go.disabled) go.click();
    });
    input.value = current || "";
    check();
    setTimeout(function () { input.focus(); }, 0);
  }

  function intercept(e, saveButton) {
    var k = kind();
    if (!k || bypass) return;
    showSlugPanel();
    var field = slugInput();
    if (!field) return; // 欄が見つからないとき（管理画面の作りが変わったときなど）は、そのまま保存させる
    if (confirmed && field.value === confirmed) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    ask(k, field.value, function (v) {
      showSlugPanel();
      var f = slugInput() || field;
      setValue(f, v);
      confirmed = v;
      setTimeout(function () {
        var btn = saveButton || document.querySelector('button[data-label="保存"]');
        bypass = true;
        try { if (btn) btn.click(); } finally { bypass = false; }
      }, 50);
    });
  }
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest('button[data-label="保存"]');
    if (btn && btn.getAttribute("aria-disabled") !== "true") intercept(e, btn);
  }, true);
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S") && !document.querySelector(".ra-slug")) intercept(e, null);
  }, true);
  window.addEventListener("hashchange", function () { confirmed = null; });
})();
