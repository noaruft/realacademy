(function () {
  var root = document.documentElement;

  // ---------- 日英切替 ----------
  function setLang(lang) {
    root.setAttribute("data-lang", lang);
    root.setAttribute("lang", lang);
    document.querySelectorAll(".lang-toggle button").forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.lang === lang ? "true" : "false");
    });
    document.querySelectorAll("[data-ph-ja]").forEach(function (el) {
      el.placeholder = el.getAttribute(lang === "en" ? "data-ph-en" : "data-ph-ja");
    });
    var t = document.querySelector("meta[name='title-" + lang + "']");
    if (t) document.title = t.content;
    try { localStorage.setItem("sea-lang", lang); } catch (e) {}
  }
  var saved = null;
  try { saved = localStorage.getItem("sea-lang"); } catch (e) {}
  setLang(saved === "en" ? "en" : "ja");
  document.querySelectorAll(".lang-toggle button").forEach(function (b) {
    b.addEventListener("click", function () { setLang(b.dataset.lang); });
  });

  // ---------- ヘッダー ----------
  var header = document.querySelector(".site-header");
  function onScroll() { header && header.classList.toggle("scrolled", window.scrollY > 8); }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  var menuBtn = document.querySelector(".menu-btn");
  if (menuBtn) {
    menuBtn.addEventListener("click", function () {
      var open = document.body.classList.toggle("menu-open");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.querySelectorAll(".nav a").forEach(function (a) {
      a.addEventListener("click", function () { document.body.classList.remove("menu-open"); });
    });
  }

  // ---------- 表示アニメーション ----------
  var items = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add("in"); });
  }

  // ---------- イベント一覧：最初は6件（スマホの1列は3件）までを見せ、次の段は下半分から薄くして畳む。ボタンで全部を開く ----------
  document.querySelectorAll(".events").forEach(function (list) {
    var cards = list.querySelectorAll(".event"), more = list.nextElementSibling;
    if (!more || !more.classList.contains("events-more")) return;
    var btn = more.querySelector("button"), open = false;
    more.querySelectorAll(".n").forEach(function (n) { n.textContent = cards.length; });
    function fold() {
      list.classList.remove("folded"); list.style.maxHeight = ""; list.style.removeProperty("--fade-from");
      if (open) return;
      var cols = getComputedStyle(list).gridTemplateColumns.split(" ").length;
      var show = cols > 1 ? Math.ceil(6 / cols) * cols : 3;  // 全部見せる件数（段の終わりまで）
      if (cards.length <= show) { more.hidden = true; return; }
      var next = cards[show], top = next.offsetTop, h = next.offsetHeight;
      list.classList.add("folded");
      list.style.maxHeight = (top + h * 0.8) + "px";      // 次の段は8割まで見せ、
      list.style.setProperty("--fade-from", (top + h * 0.3) + "px");  // 3割あたりから下を薄くする（半分より下はほとんど見えない）
      more.hidden = false;
    }
    btn.addEventListener("click", function () {
      open = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      more.classList.toggle("open", open);
      fold();
      if (!open) list.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    fold();
    var t;
    window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(fold, 150); });
    new MutationObserver(fold).observe(document.documentElement, { attributes: true, attributeFilter: ["data-lang"] });  // 日英の切り替えで高さが変わるため
  });

  // ---------- お問い合わせフォーム ----------
  var form = document.querySelector("form.form");

  // 「留学相談」「両方」なら留学用の項目、「イベント参加申込」ならイベント用の項目を表示する。
  // イベントを選ぶと、そのイベント専用の選択欄（_src/events の FORM 行から生成）が出る。
  // 隠れている欄は disabled にして、入力チェックと送信の対象から外す。
  // イベントページからは contact.html?type=event&event=<slug> で開き、選択済みにする。
  if (form) {
    var params = new URLSearchParams(location.search);
    var radio = params.get("type") && form.querySelector('input[name="type"][value="' + params.get("type") + '"]');
    if (radio) radio.checked = true;
    var eventSelect = form.querySelector('select[name="event"]');
    if (eventSelect && params.get("event")) eventSelect.value = params.get("event");

    var show = function (block, visible) {
      if (!block) return;
      block.hidden = !visible;
      block.querySelectorAll("input, select, textarea").forEach(function (el) {
        if (!el.hasAttribute("data-full")) el.disabled = !visible;
      });
    };
    // 満席の選択肢は常に選べないままにする
    form.querySelectorAll("label.full input").forEach(function (el) { el.setAttribute("data-full", ""); });

    var sync = function () {
      var checked = form.querySelector('input[name="type"]:checked');
      var isEvent = !!(checked && checked.value === "event");
      show(form.querySelector(".study-only"), !!(checked && checked.hasAttribute("data-study")));
      show(form.querySelector(".event-only"), isEvent);
      if (eventSelect) eventSelect.required = isEvent;
      form.querySelectorAll(".event-fields").forEach(function (block) {
        show(block, isEvent && eventSelect && eventSelect.value === block.getAttribute("data-event"));
      });
    };
    form.querySelectorAll('input[name="type"]').forEach(function (r) { r.addEventListener("change", sync); });
    if (eventSelect) eventSelect.addEventListener("change", sync);
    sync();
  }

  // ---------- 郵便番号から住所を入れる ----------
  // 全角数字やハイフンなしで入れても、半角・ハイフンあり（106-0044）に直す。7桁そろったら郵便番号検索（zipcloud：日本郵便のデータ）で調べ、都道府県と「市区町村・町名」を入れる。
  // 市区町村の欄に自分で書いた内容があるときは上書きしない。見つからない・通信できないときは手で入力してもらう。
  var zip = form && form.querySelector("#zip");
  if (zip) {
    var pref = form.querySelector("#pref"), city = form.querySelector("#city");
    var hint = form.querySelector("[data-zip-hint]");
    var hintDefault = hint ? hint.innerHTML : "";
    var say = function (ja, en) {
      if (!hint) return;
      hint.innerHTML = ja ? '<span lang="ja">' + ja + '</span><span lang="en">' + en + "</span>" : hintDefault;
    };
    var lastZip = "";
    zip.addEventListener("input", function () {
      var d = zip.value.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/[^0-9]/g, "");
      if (d.length !== 7) { lastZip = ""; return; }
      if (d === lastZip) return;
      lastZip = d;
      zip.value = d.slice(0, 3) + "-" + d.slice(3);  // 半角・ハイフンありにそろえる
      say("住所を調べています…", "Looking up the address…");
      fetch("https://zipcloud.ibsnet.co.jp/api/search?zipcode=" + d)
        .then(function (r) { return r.json(); })
        .then(function (res) {
          var r = res && res.results && res.results[0];
          if (!r) { say("この郵便番号の住所が見つかりませんでした。都道府県と住所を入力してください", "Address not found. Please fill it in."); return; }
          pref.value = r.address1;
          var auto = r.address2 + r.address3;
          if (!city.value.trim() || city.value === city.getAttribute("data-auto")) {
            city.value = auto;
            city.setAttribute("data-auto", auto);
          }
          say("住所の一部を入れました。続けて番地を入力してください", "Filled in. Please add the street number.");
          city.focus();
          city.setSelectionRange(city.value.length, city.value.length);
        })
        .catch(function () { say("自動入力できませんでした。都道府県と住所を入力してください", "Could not look it up. Please fill in the address."); });
    });
  }

  // ---------- 送信 ----------
  // form の data-endpoint（Google Apps Script のウェブアプリ）へ、項目名と入力内容を送る。
  // 受付側（_src/tools/contact-form.gs）がメールを送り、スプレッドシートに記録する。
  // data-endpoint が空の間は送信せず、完了表示だけを出す（確認用）。
  var jaText = function (el) {
    if (!el) return "";
    var ja = el.querySelector('[lang="ja"]');
    return (ja ? ja.textContent : el.textContent).replace(/REQUIRED/g, "").trim();
  };
  var collectFields = function () {
    var out = [];
    form.querySelectorAll(".field").forEach(function (field) {
      if (field.closest("[hidden]") || field.querySelector('input[name="agree"]')) return;
      var label = jaText(field.querySelector(".label") || field.querySelector("label[for]"));
      var value = "";
      var boxes = field.querySelectorAll('input[type="radio"], input[type="checkbox"]');
      if (boxes.length) {
        value = Array.prototype.filter.call(boxes, function (x) { return x.checked && !x.disabled; })
          .map(function (x) { return jaText(x.closest("label")); }).join("、");
      } else {
        var el = field.querySelector("select, textarea, input");
        if (el && !el.disabled) value = el.tagName === "SELECT" ? (el.value ? el.options[el.selectedIndex].text : "") : el.value.trim();
      }
      if (label && value) out.push([label, value]);
    });
    return out;
  };
  if (form) {
    var endpoint = (form.getAttribute("data-endpoint") || "").trim();
    var errorBox = form.querySelector(".form-error");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var done = function () {
        form.classList.add("sent");
        form.scrollIntoView({ behavior: "smooth", block: "start" });
      };
      if (!endpoint) { done(); return; }
      var en = root.getAttribute("data-lang") === "en";
      var btn = form.querySelector('button[type="submit"]');
      var original = btn.innerHTML;
      btn.disabled = true;
      btn.textContent = en ? "Sending…" : "送信中…";
      if (errorBox) errorBox.hidden = true;
      var hp = form.querySelector('input[name="website"]');
      fetch(endpoint, {
        method: "POST",
        body: JSON.stringify({ fields: collectFields(), website: hp ? hp.value : "", page: location.href }),
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res || !res.ok) throw new Error((res && res.error) || "error");
          done();
        })
        .catch(function () {
          if (errorBox) {
            errorBox.textContent = en
              ? "Sorry, your message could not be sent. Please try again, or call us at 03-6435-5320."
              : "送信できませんでした。時間をおいてもう一度お試しいただくか、お電話（03-6435-5320）でお問い合わせください。";
            errorBox.hidden = false;
          }
          btn.disabled = false;
          btn.innerHTML = original;
        });
    });
  }

  // ---------- ブログのカテゴリ絞り込み（blog.html#english のようにURLでも指定できる） ----------
  var filter = document.querySelector(".blog-filter");
  if (filter) {
    var apply = function (cat) {
      var shown = 0;
      filter.querySelectorAll("[data-filter]").forEach(function (b) {
        b.setAttribute("aria-pressed", b.dataset.filter === cat ? "true" : "false");
      });
      document.querySelectorAll(".post-card[data-cat]").forEach(function (c) {
        var on = cat === "all" || c.dataset.cat === cat;
        c.hidden = !on;
        if (on) { shown++; c.classList.add("in"); }
      });
      var empty = document.querySelector(".blog-empty");
      if (empty) empty.hidden = shown > 0;
    };
    filter.addEventListener("click", function (e) {
      var b = e.target.closest("[data-filter]");
      if (!b) return;
      history.replaceState(null, "", b.dataset.filter === "all" ? location.pathname : "#" + b.dataset.filter);
      apply(b.dataset.filter);
    });
    var initial = location.hash.slice(1);
    apply(filter.querySelector('[data-filter="' + initial + '"]') ? initial : "all");
  }

  // ---------- 保護者・生徒の声のスライド（端のある一列。ループはしない） ----------
  var ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12h17M14.5 6l6 6-6 6"/></svg>';
  document.querySelectorAll(".voice-slider").forEach(function (slider) {
    var track = slider.querySelector(".voices");
    var cards = track ? Array.prototype.slice.call(track.children) : [];
    if (cards.length < 2) return;
    function button(cls, ja, en) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "vs-btn " + cls;
      b.setAttribute("aria-label", root.getAttribute("data-lang") === "en" ? en : ja);
      b.innerHTML = ARROW;
      slider.appendChild(b);
      return b;
    }
    var prev = button("vs-prev", "前の声へ", "Previous");
    var next = button("vs-next", "次の声へ", "Next");
    prev.querySelector("svg").style.transform = "scaleX(-1)";
    var count = document.createElement("div");
    count.className = "vs-count";
    count.setAttribute("aria-live", "polite");
    slider.appendChild(count);
    var two = function (n) { return (n < 10 ? "0" : "") + n; };
    var current = -1;

    function leftOf(i) { return cards[i].offsetLeft - (track.clientWidth - cards[i].offsetWidth) / 2; }
    function go(i, instant) {
      i = Math.max(0, Math.min(cards.length - 1, i));
      if (instant) track.style.scrollBehavior = "auto";
      track.scrollLeft = leftOf(i);
      if (instant) track.style.scrollBehavior = "";
      mark(i);
    }
    function nearest() {
      var mid = track.scrollLeft + track.clientWidth / 2, best = 0, dist = Infinity;
      cards.forEach(function (c, i) {
        var d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
        if (d < dist) { dist = d; best = i; }
      });
      return best;
    }
    function mark(i) {
      if (i === current) return;
      current = i;
      cards.forEach(function (c, k) { c.classList.toggle("is-current", k === i); });
      prev.disabled = i === 0;
      next.disabled = i === cards.length - 1;
      count.textContent = two(i + 1) + " / " + two(cards.length);
    }
    prev.addEventListener("click", function () { go(current - 1); });
    next.addEventListener("click", function () { go(current + 1); });
    cards.forEach(function (c, i) {
      c.addEventListener("click", function () { if (i !== current) go(i); });
    });
    var ticking = false;
    track.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; mark(nearest()); });
    }, { passive: true });
    window.addEventListener("resize", function () { go(current, true); });
    // 3件以上あれば2件目を中央にして、左右に前後のカードが見える状態で始める
    var start = cards.length >= 3 ? 1 : 0;
    go(start, true);
    window.addEventListener("load", function () { go(current, true); });
  });

  // ---------- お知らせ一覧の切り替え（ひとつの選択欄で ALL／NEWS／EVENTS） ----------
  var newsSelect = document.querySelector("[data-news-select]");
  if (newsSelect) {
    newsSelect.addEventListener("change", function () {
      var kind = newsSelect.value;
      document.querySelectorAll(".news-list li[data-kind]").forEach(function (li) {
        li.hidden = kind !== "all" && li.dataset.kind !== kind;
      });
    });
  }

  // ---------- 写真枠のスライド（data-slides のある枠は、写真を時間とともにフェードで切り替える） ----------
  document.querySelectorAll(".ph[data-slides]").forEach(function (ph) {
    var urls = ph.getAttribute("data-slides").split("|");
    var first = (ph.style.backgroundImage.match(/url\(["']?([^"')]+)/) || [])[1];
    if (first) urls.unshift(first);
    // スマホ幅（820px以下）では、スマホ用の写真（data-slides-sp。1枚目から順に）を使う。画面の向きが変わったときも差し替える
    var pc = urls, sp = ph.hasAttribute("data-slides-sp") ? ph.getAttribute("data-slides-sp").split("|") : null;
    var narrow = window.matchMedia("(max-width: 820px)");
    if (sp && narrow.matches) urls = sp;
    // 2枚目以降は、表示する直前に読み込む（最初の表示を軽くする）
    var layers = urls.map(function (u, i) {
      var d = document.createElement("div");
      d.className = "ph-slide" + (i === 0 ? " on" : "");
      if (i === 0) d.style.backgroundImage = "url('" + u + "')";
      ph.appendChild(d);
      return d;
    });
    var ready = urls.map(function (_, i) { return i === 0; });
    function load(n, done) {
      if (ready[n]) { done && done(); return; }
      var img = new Image();
      img.onload = img.onerror = function () { layers[n].style.backgroundImage = "url('" + urls[n] + "')"; ready[n] = true; done && done(); };
      img.src = urls[n];
    }
    if (sp) narrow.addEventListener("change", function () {
      urls = narrow.matches ? sp : pc;
      layers.forEach(function (d, n) { if (ready[n]) d.style.backgroundImage = "url('" + urls[n] + "')"; });
    });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var i = 0;
    load(1);
    setInterval(function () {
      var next = (i + 1) % layers.length;
      load(next, function () {
        layers[i].classList.remove("on");
        layers[next].classList.add("on");
        i = next;
        ph.dispatchEvent(new CustomEvent("phslide", { bubbles: true, detail: { index: next } }));  // 同じ欄の「色の入れ替え」・写真の提供元もそろえて切り替える
        load((next + 1) % layers.length);  // 次の写真を先に読み込んでおく
      });
    }, 7000);  // 1枚あたりの表示時間（ミリ秒）
  });

  // ---------- 写真がまだない枠の仮の色（data-color-cycle）：同じ欄の写真の切り替えに合わせて色を入れ替える ----------
  document.querySelectorAll(".ph[data-color-cycle]:not(.has-photo)").forEach(function (ph) {
    var layers = ["", "warm", "deep"].map(function (c, i) {
      var d = document.createElement("div");
      d.className = "ph-color " + c + (i === 0 ? " on" : "");
      ph.appendChild(d);
      return d;
    });
    var i = 0, area = ph.closest("section") || document;
    area.addEventListener("phslide", function () {
      layers[i].classList.remove("on");
      i = (i + 1) % layers.length;
      layers[i].classList.add("on");
    });
  });

  // ---------- 写真の提供元（.photo-credit）：同じ欄の写真の切り替えに合わせて、何枚目の写真かに対応する表記に変える ----------
  document.querySelectorAll(".photo-credit").forEach(function (credit) {
    var items = credit.children, area = credit.closest("section") || document;
    area.addEventListener("phslide", function (e) {
      var n = e.detail ? e.detail.index : 0;
      Array.prototype.forEach.call(items, function (el, k) { el.classList.toggle("on", k === n); });
    });
  });

  // ---------- コピーライト年 ----------
  document.querySelectorAll(".year").forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
