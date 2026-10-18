// 読み込みの見張り役（type="module" ではない普通のスクリプト）。
// ページ本体のスクリプトが動かず「読み込み中…」のまま止まったとき、理由を画面に出す。
(function () {
  var errors = [];
  function note(msg) {
    if (msg && errors.indexOf(msg) < 0) errors.push(String(msg));
  }
  window.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t !== window && (t.src || t.href)) note("読み込めないファイル: " + (t.src || t.href));
    else note(e.message || (e.error && e.error.message));
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    note((r && (r.message || r.error_description)) || r);
  });

  function fail(lead) {
    var box = document.getElementById("loading");
    if (!box || box.hidden) return;
    box.hidden = false;
    box.className = "card boot-error";
    box.style.textAlign = "left";
    box.innerHTML = "";
    var p = document.createElement("p");
    p.textContent = lead;
    box.appendChild(p);
    if (errors.length) {
      var pre = document.createElement("pre");
      pre.textContent = errors.join("\n");
      box.appendChild(pre);
    }
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-sm";
    btn.textContent = "もう一度読み込む";
    btn.onclick = function () { location.reload(); };
    box.appendChild(btn);
  }

  if (location.protocol === "file:") {
    document.addEventListener("DOMContentLoaded", function () {
      fail("このページはファイルを直接（ダブルクリックで）開くと動きません。" +
        "「新開発」フォルダの「確認用サーバーを起動.command」をダブルクリックすると、正しい形で開き直せます。" +
        "（サーバーが動いていれば http://localhost:8123/student-portal/ からも開けます）");
    });
    return;
  }
  window.addEventListener("load", function () {
    setTimeout(function () {
      fail(errors.length
        ? "ページの読み込み中にエラーが起きました。下の内容を教室の担当者にお知らせください。"
        : "ページの読み込みに時間がかかっています。通信状況を確認して、もう一度読み込んでください。");
    }, errors.length ? 0 : 12000);
  });
})();
