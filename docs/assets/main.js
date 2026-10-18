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

  // ---------- コピーライト年 ----------
  document.querySelectorAll(".year").forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
