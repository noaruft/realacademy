/* 管理画面（Sveltia CMS）の編集画面の右側に出すプレビュー。
   ホームページと同じ assets/style.css と同じ HTML の形で、入力しているそばから表示する。
   HTML の形は _src/build.py（news_page・event_page・post_page・voices_html・results_html）、
   本文の Markdown の変換は _src/mdlite.py をそのまま JavaScript に移したもの。
   どちらかを変えたら、ここも合わせて直す（README の「管理画面」→「プレビュー」）。
   ヘッダー・フッター・ブログの前後の記事への案内は出さない。 */
(function () {
  "use strict";
  var SITE = new URL("../", location.href).href; // サイトの一番上（ローカルなら http://localhost:8123/）

  // ------------------------------------------------------------------ 文字の下ごしらえ（build.py の text・J など）
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escAttr(s) {
    return esc(s).replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  }
  function unesc(s) {
    var t = document.createElement("textarea");
    t.innerHTML = s;
    return t.value;
  }
  function text(v) {
    return esc(String(v == null ? "" : v).trim()).replace(/\n/g, "<br>");
  }
  function filled(v) {
    return String(v == null ? "" : v).trim() !== "";
  }
  function J(ja, en) {
    if (en == null || en === "") return ja;
    return '<span lang="ja">' + ja + '</span><span lang="en">' + en + "</span>";
  }
  function dotted(iso) {
    return iso ? String(iso).replace(/-/g, ".") : "";
  }

  // ------------------------------------------------------------------ 本文の Markdown（_src/mdlite.py と同じ）
  var HTML_BLOCK = /^\s*<\/?(?:div|p|ul|ol|li|h[1-6]|table|thead|tbody|tr|th|td|dl|dt|dd|blockquote|figure|section|hr|img|iframe)\b/i;
  var HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
  var LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  var RULE = /^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$|^\s*(?:_\s*){3,}$/;
  var QUOTE = /^\s*>\s?(.*)$/;
  var TABLE_ROW = /^\s*\|.*\|\s*$/;
  var TABLE_RULE = /^\s*\|(\s*:?-+:?\s*\|)+\s*$/;
  var W = "[\\p{L}\\p{N}_]"; // Python の \w（日本語の文字も含む）

  function inline(s) {
    var keep = [];
    function stash(x) {
      keep.push(x);
      return "\u0000" + (keep.length - 1) + "\u0000";
    }
    s = s.replace(/`([^`]+)`/g, function (_, c) { return stash("<code>" + c + "</code>"); });
    s = s.replace(/\\([\\`*_{}\[\]()#+\-.!~|<>])/g, function (_, c) { return stash(c); });
    s = s.replace(/<(https?:\/\/[^>\s]+)>/g, function (_, u) { return stash('<a href="' + u + '">' + u + "</a>"); });
    s = s.replace(/(<[^>]+>)/g, function (_, t) { return stash(t); });
    s = s.replace(/&(?!#?\w+;)/g, "&amp;");
    s = s.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, function (_, alt, src) {
      return stash('<img src="' + src.replace(/^\/+/, "") + '" alt="' + alt + '" loading="lazy">');
    });
    s = s.replace(/\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, '<a href="$2">$1</a>');
    s = s.replace(/\*\*(.+?)\*\*|__(.+?)__/g, function (_, a, b) { return "<strong>" + (a || b) + "</strong>"; });
    s = s.replace(new RegExp("(?<![*" + W.slice(1, -1) + "])\\*(?![\\s*])(.+?)(?<![\\s*])\\*(?![*" + W.slice(1, -1) + "])", "gu"), "<em>$1</em>");
    s = s.replace(new RegExp("(?<![_" + W.slice(1, -1) + "])_(?![\\s_])(.+?)(?<![\\s_])_(?![_" + W.slice(1, -1) + "])", "gu"), "<em>$1</em>");
    s = s.replace(/~~(.+?)~~/g, "<del>$1</del>");
    while (s.indexOf("\u0000") >= 0) {
      s = s.replace(/\u0000(\d+)\u0000/g, function (_, n) { return keep[+n]; });
    }
    return s;
  }
  function linesInline(lines) {
    return lines.map(function (l) { return inline(l.trim().replace(/(\\| {2,})$/, "")); }).join("<br>");
  }
  function startsBlock(line) {
    return HTML_BLOCK.test(line) || HEADING.test(line) || LIST_ITEM.test(line) || QUOTE.test(line) || RULE.test(line);
  }
  function tableCells(line) {
    var t = line.trim();
    return t.slice(1, -1).split(/(?<!\\)\|/).map(function (c) { return inline(c.trim()); });
  }
  function renderTable(lines) {
    var rows = [tableCells(lines[0])].concat(lines.slice(2).map(tableCells));
    return "<table>" + rows.map(function (r, n) {
      var heading = n === 0 && !r[0];
      return "<tr>" + r.map(function (c, k) {
        var t = heading || k === 0 ? "th" : "td";
        return "<" + t + ">" + c + "</" + t + ">";
      }).join("") + "</tr>";
    }).join("") + "</table>";
  }
  function indentOf(l) {
    return l.length - l.replace(/^\s+/, "").length;
  }
  function renderList(lines) {
    var first = LIST_ITEM.exec(lines[0]);
    var base = first[1].length;
    var ordered = /\d/.test(first[2][0]);
    var items = [];
    lines.forEach(function (line) {
      var m = LIST_ITEM.exec(line);
      if (m && m[1].length <= base) items.push([m[3]]);
      else if (items.length) items[items.length - 1].push(line);
    });
    var out = items.map(function (it) {
      var txt = [it[0]], sub = [];
      it.slice(1).forEach(function (l) { (sub.length || LIST_ITEM.test(l) ? sub : txt).push(l); });
      var html = linesInline(txt);
      if (sub.length) {
        var indent = Math.min.apply(null, sub.filter(function (l) { return l.trim(); }).map(indentOf));
        html += mdToHtml(sub.map(function (l) { return l.slice(indent); }).join("\n"));
      }
      return "<li>" + html + "</li>";
    });
    var tag = ordered ? "ol" : "ul";
    return "<" + tag + ">\n" + out.join("\n") + "\n</" + tag + ">";
  }
  function mdToHtml(src) {
    var lines = String(src || "").replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "").split("\n");
    var out = [], i = 0, j, m;
    var isDigit = function (mm) { return /\d/.test(mm[2][0]); };
    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (HTML_BLOCK.test(line)) {
        j = i;
        while (j < lines.length && lines[j].trim()) j++;
        out.push(lines.slice(i, j).join("\n"));
        i = j;
        continue;
      }
      if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
        j = i + 2;
        while (j < lines.length && TABLE_ROW.test(lines[j])) j++;
        out.push(renderTable(lines.slice(i, j)));
        i = j;
        continue;
      }
      if ((m = HEADING.exec(line))) {
        var n = m[1].length;
        out.push("<h" + n + ">" + inline(m[2]) + "</h" + n + ">");
        i++;
        continue;
      }
      if (RULE.test(line)) { out.push("<hr>"); i++; continue; }
      if (LIST_ITEM.test(line)) {
        var first = LIST_ITEM.exec(line);
        j = i + 1;
        while (j < lines.length) {
          var l = lines[j], lm = LIST_ITEM.exec(l);
          if (lm && lm[1].length <= first[1].length && isDigit(lm) !== isDigit(first)) break; // 箇条書きと番号付きが入れ替わったら別のリスト
          if (l.trim() && (lm || /^[ \t]/.test(l))) j++;
          else if (!l.trim() && j + 1 < lines.length && (LIST_ITEM.test(lines[j + 1]) || /^[ \t]/.test(lines[j + 1]))) j++; // 項目のあいだの空行
          else break;
        }
        out.push(renderList(lines.slice(i, j).filter(function (x) { return x.trim(); })));
        i = j;
        continue;
      }
      if (QUOTE.test(line)) {
        j = i;
        while (j < lines.length && QUOTE.test(lines[j])) j++;
        var inner = lines.slice(i, j).map(function (x) { return QUOTE.exec(x)[1]; }).join("\n");
        out.push("<blockquote>" + mdToHtml(inner) + "</blockquote>");
        i = j;
        continue;
      }
      j = i + 1;
      while (j < lines.length && lines[j].trim() && !startsBlock(lines[j])) j++;
      out.push("<p>" + linesInline(lines.slice(i, j)) + "</p>");
      i = j;
    }
    return out.join("\n");
  }
  window.RA_mdToHtml = mdToHtml; // 確認用（_src/mdlite.py と同じ結果になるか）

  function bodyHtml(ja, en) {
    var out = filled(ja) ? '<div lang="ja">\n' + mdToHtml(ja) + "\n</div>\n" : "";
    if (filled(en)) out += '<div lang="en">\n' + mdToHtml(en) + "\n</div>\n";
    return out;
  }

  // ------------------------------------------------------------------ 仕上げ（build.py の brand_font・phrase_breaks）
  var parser = null; // BudouX（日本語の文節改行。サイトと同じ 0.7.0）
  import("https://cdn.jsdelivr.net/npm/budoux@0.7.0/+esm").then(function (b) {
    parser = b.loadDefaultJapaneseParser();
  }).catch(function () {});
  var JA_CHAR = /[぀-ヿ㐀-鿿！-｠]/;
  var NO_WBR = { title: 1, script: 1, style: 1, option: 1, textarea: 1 };
  function brandFont(html) {
    return html.replace(/(<(title|script|style)\b[\s\S]*?<\/\2>)|>([^<]*)(?=<)/g, function (all, block, _, t) {
      if (block) return block;
      t = t.split("REAL ACADEMY").join('<span class="ra-name">REAL ACADEMY</span>');
      return ">" + t.replace(/(?<![A-Za-z.])STEAM(?![A-Za-z.])/g, '<span class="steam-word">STEAM</span>');
    });
  }
  function phraseBreaks(html) {
    if (!parser) return html;
    var skip = 0;
    return html.split(/(<!--[\s\S]*?-->|<[^>]+>)/).map(function (part) {
      if (part.charAt(0) === "<") {
        var m = /^<\/?\s*([a-zA-Z0-9]+)/.exec(part);
        if (m && NO_WBR[m[1].toLowerCase()]) skip += part.charAt(1) === "/" ? -1 : 1;
        return part;
      }
      if (skip || !JA_CHAR.test(part)) return part;
      return parser.parse(unesc(part)).map(esc).join("<wbr>");
    }).join("");
  }
  function finish(html) {
    return phraseBreaks(brandFont(html));
  }

  // ------------------------------------------------------------------ 写真
  // 管理画面で入れた写真（まだ公開していないものも見えるよう getAsset で探す）
  function assetUrl(props, path) {
    if (!filled(path)) return null;
    try {
      var a = props.getAsset(path);
      if (a && a.url) return a.url;
      if (a && typeof a.toString === "function" && /^(blob:|https?:)/.test(String(a))) return String(a);
    } catch (e) {}
    return SITE + String(path).replace(/^\/+/, "");
  }
  // 写真の大きさ（イベントの枠を写真の縦横の比率に合わせるため）と、写真枠の番号のファイル（assets/photos/<番号>.jpg・.webp など）。
  // 一度調べたら覚えておき、入力のたびに読み直してちらつかないようにする
  var SIZE = {}, NUMBERED = {}, CUR_DOC = null;
  function probe(urls, done) {
    (function next(k) {
      if (k >= urls.length) return done(null);
      var img = new Image();
      img.onload = function () { done(urls[k], img.naturalWidth, img.naturalHeight); };
      img.onerror = function () { next(k + 1); };
      img.src = urls[k];
    })(0);
  }
  function numberedSrc(no, doc) {
    if (NUMBERED[no] !== undefined) return NUMBERED[no];
    NUMBERED[no] = null;
    probe(["jpg", "jpeg", "png", "webp"].map(function (x) { return SITE + "assets/photos/" + no + "." + x; }), function (url, w, hh) {
      NUMBERED[no] = url;
      if (!url) return;
      SIZE[url] = [w, hh];
      doc = CUR_DOC || doc; // 表示している枠の中のページ（下の「管理画面に登録」）
      if (doc) doc.querySelectorAll('[data-photo-no="' + no + '"]').forEach(function (el) { fillBox(el, url); });
    });
    return null;
  }
  function boxStyle(src, fit) {
    var s = "background:url('" + src + "') center / cover no-repeat;";
    if (fit && SIZE[src]) s += "aspect-ratio:" + SIZE[src][0] + " / " + SIZE[src][1] + ";";
    return s;
  }
  function fillBox(el, src) {
    if (!el.classList.contains("has-photo")) el.className = el.className.replace(/^ph\b/, "ph has-photo");
    el.setAttribute("style", boxStyle(src, el.hasAttribute("data-fit")));
  }
  // 写真の枠（管理画面で入れた写真が優先、なければ写真枠の番号の写真。どちらもなければ null）
  function photoBox(props, cls, label, path, no, fit) {
    var src = assetUrl(props, path) || (filled(no) ? numberedSrc(no, props.document) : null);
    var attrs = ' data-label="' + escAttr(label) + '"' + (fit ? ' data-fit="1"' : "") + (filled(no) && !filled(path) ? ' data-photo-no="' + escAttr(no) + '"' : "");
    if (src) return '<div class="ph has-photo ' + cls + '"' + attrs + ' data-src="' + escAttr(src) + '" style="' + boxStyle(src, fit) + '"></div>';
    if (filled(no)) return '<div class="ph ' + cls + '"' + attrs + "></div>";
    return null;
  }
  // 入れたばかりの写真は大きさがまだ分からないので、読み込んでから枠の比率を合わせる（build.py の fit=True）
  function fitPhotos(doc) {
    doc.querySelectorAll(".event-ph[data-fit][data-src]").forEach(function (el) {
      var src = el.getAttribute("data-src");
      if (SIZE[src]) return;
      probe([src], function (url, w, hh) {
        if (url) { SIZE[url] = [w, hh]; fillBox(el, url); }
      });
    });
  }
  // 本文の写真（assets/uploads/…）のアドレス
  function fixImages(props, html) {
    return html.replace(/<img src="([^"]+)"/g, function (all, src) {
      if (/^(https?:|blob:|data:)/.test(src)) return all;
      return '<img src="' + (assetUrl(props, "/" + src) || src) + '"';
    });
  }

  // ------------------------------------------------------------------ 各ページの形（build.py と同じ）
  var EN_ONLY_JA_NOTE = '<p class="lang-note" lang="en">Full details for this event are available in Japanese. Switch to JA, or contact us for help in English.</p>';
  var EN_ONLY_JA_NOTE_NEWS = '<p class="lang-note" lang="en">Full details are available in Japanese. Switch to JA, or contact us for help in English.</p>';
  var STATE_LABELS = { open: ["受付中", "Open"], full: ["満席", "Full"], closed: ["受付終了", "Closed"], ended: ["開催終了", "Finished"] };
  var CAT = { english: ["英語関連", "English"], overseas: ["留学関連", "Study abroad"], education: ["教育関連", "Education"], world: ["世界情勢", "World affairs"], other: ["その他", "Other"] };

  function news(d) {
    var titleJa = text(d.title_ja), titleEn = text(d.title_en);
    var headingJa = text(d.heading_ja) || titleJa, headingEn = text(d.heading_en) || titleEn;
    var lead = filled(d.lead_ja) ? '\n    <p class="lead">' + J(text(d.lead_ja), text(d.lead_en) || null) + "</p>" : "";
    var body = bodyHtml(d.body_ja, d.body_en);
    if (!filled(d.body_en)) body += EN_ONLY_JA_NOTE_NEWS + "\n";
    var labelJa = text(d.button_label_ja), labelEn = text(d.button_label_en), link = String(d.button_link || "").trim();
    var button = labelJa && link ? '<a class="btn" href="' + escAttr(link) + '">' + J(labelJa, labelEn || null) + "</a>\n      " : "";
    var posted = d.posted || "";
    return '\n<section class="page-hero">\n  <div class="container reveal">\n' +
      '    <p class="breadcrumb"><a href="index.html">Home</a> / <a href="news.html">News</a> / Article</p>\n' +
      '    <div class="article-meta"><span class="news-tag">GENERAL</span><time class="news-date" datetime="' + escAttr(posted) + '">' + dotted(posted) + "</time></div>\n" +
      "    <h1>" + J(headingJa, headingEn || null) + "</h1>" + lead + "\n  </div>\n</section>\n\n" +
      '<section>\n  <div class="container article">\n' + body +
      '\n    <div class="article-actions">\n      ' + button + '<a class="text-link" href="news.html#news">' + J("お知らせ一覧へ戻る", "Back to news") + "</a>\n    </div>\n  </div>\n</section>\n";
  }

  function eventState(d) {
    var today = new Date();
    var iso = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
    var end = d.end || d.start || "";
    var status = String(d.status || "auto").toLowerCase();
    if (status === "open") return "open";
    if (end && end < iso) return "ended";
    if (status === "full" || status === "closed") return status;
    return "open";
  }
  function event(d, props) {
    var state = eventState(d);
    var both = function (k) { return [text(d[k + "_ja"]), text(d[k + "_en"]) || text(d[k + "_ja"])]; };
    var rows = [["日程", "Date"].concat(both("date"))];
    if (filled(d.time_ja)) rows.push(["時間", "Time"].concat(both("time")));
    rows.push(["場所", "Place"].concat(both("place")));
    (d.spec || []).forEach(function (s) { rows.push([text(s.label_ja), text(s.label_en), text(s.value_ja), text(s.value_en)]); });
    var spec = rows.map(function (r) { return "      <dt>" + J(r[0], r[1]) + "</dt><dd>" + J(r[2], r[3] || r[2]) + "</dd>"; }).join("\n");
    var body = bodyHtml(d.body_ja, d.body_en);
    if (body.indexOf('lang="en"') < 0) body += EN_ONLY_JA_NOTE + "\n";
    var apply = "";
    if (state === "open") apply = '<a class="btn" href="contact.html?type=event">' + J("参加を申し込む", "Apply") + "</a>\n      ";
    else if (state === "full") apply = '<p class="event-note">' + J("満席のため、受付を締め切りました。キャンセル待ちをご希望の方は、お問い合わせください。", "This event is fully booked. Please contact us to join the waiting list.") + "</p>\n      " +
      '<a class="btn ghost" href="contact.html">' + J("キャンセル待ちを問い合わせる", "Ask about the waiting list") + "</a>\n      ";
    var title = text(d.title), titleEn = text(d.title_en);
    var sub = filled(d.sub) ? '\n    <p class="lead">' + text(d.sub) + "</p>" : "";
    var posted = d.posted ? '<span class="news-date">' + dotted(d.posted) + "</span>" : "";
    var photo = photoBox(props, "event-ph", "Photo — Event（A4縦）", d.photo, d.photo_no, true);
    var label = STATE_LABELS[state];
    return '\n<section class="page-hero">\n  <div class="container reveal">\n' +
      '    <p class="breadcrumb"><a href="index.html">Home</a> / <a href="news.html">News</a> / Event</p>\n' +
      '    <div class="article-meta"><span class="event-status ' + state + '">' + J(label[0], label[1]) + "</span>" + posted + "</div>\n" +
      "    <h1>" + (titleEn ? J(title, titleEn) : title) + "</h1>" + sub + "\n  </div>\n</section>\n\n" +
      '<section>\n  <div class="container event-layout' + (photo ? "" : " no-photo") + '">\n    ' + (photo ? photo + "\n    " : "") +
      '<div class="article">\n    <dl class="spec">\n' + spec + "\n    </dl>\n" + body +
      '\n    <div class="article-actions">\n      ' + apply + '<a class="text-link" href="news.html#events">' + J("イベント一覧へ戻る", "Back to events") + "</a>\n    </div>\n    </div>\n  </div>\n</section>\n";
  }

  function blog(d) {
    var cat = CAT[d.category] || CAT.other;
    var title = text(d.title), titleEn = text(d.title_en);
    var date = d.date || "";
    var draft = d.draft ? '<p class="lang-note">「公開しない」にチェックが入っています。この記事はサイトに出ません。</p>\n' : "";
    return '\n<section class="page-hero">\n  <div class="container reveal">\n' +
      '    <p class="breadcrumb"><a href="index.html">Home</a> / <a href="blog.html">Blog</a> / Article</p>\n' +
      '    <div class="article-meta"><span class="news-tag">' + J(cat[0], cat[1]) + '</span><time class="news-date" datetime="' + escAttr(date) + '">' + dotted(date) + "</time></div>\n" +
      "    <h1>" + (titleEn ? J(title, titleEn) : title) + "</h1>\n  </div>\n</section>\n\n" +
      '<section>\n  <div class="container article">\n' + draft + bodyHtml(d.body_ja, d.body_en) +
      '\n    <div class="article-actions">\n      <a class="text-link" href="blog.html">' + J("ブログ一覧へ戻る", "Back to the blog") + "</a>\n    </div>\n  </div>\n</section>\n";
  }

  var VOICE_SLIDER = { top: false, school: true, uk: true }; // 英語教室・イギリス留学のページは横に送るスライド
  function voices(d, props, key) {
    var cards = (d.voices || []).map(function (v) {
      var nameJa = text(v.name_ja);
      var label = "生徒の声 — " + unesc(nameJa);
      var ph = photoBox(props, "voice-ph warm", label, v.photo, v.photo_no, false) || '<div class="ph voice-ph warm" data-label="' + escAttr(label) + '"></div>';      var hl = filled(v.highlight_ja) ? '\n            <span class="voice-highlight">' + J(text(v.highlight_ja), text(v.highlight_en)) + "</span>" : "";
      var en = filled(v.text_en) ? '\n            <span lang="en">' + text(v.text_en) + "</span>" : "";
      return '        <figure class="voice">\n          ' + ph + "\n          <blockquote>" + hl +
        '\n            <span lang="ja">' + text(v.text_ja) + "</span>" + en +
        "\n          </blockquote>\n          <figcaption><cite>" + J(nameJa, text(v.name_en)) + "</cite></figcaption>\n        </figure>";
    }).join("\n");
    var list = '<div class="voices">\n' + cards + "\n      </div>";
    if (VOICE_SLIDER[key]) list = '<div class="voice-slider">\n      ' + list + "\n    </div>";
    return '\n<section class="bg-gray">\n  <div class="container">\n    <div class="center">\n      <p class="eyebrow">Voices</p>\n' +
      '      <h2><span lang="ja">保護者・生徒の声</span><span lang="en">From our families</span></h2>\n    </div>\n    ' + list + "\n  </div>\n</section>\n";
  }

  function results(d) {
    var asOf = filled(d.as_of_ja) ? '<p style="color:rgba(246,241,231,.78)">' + J(text(d.as_of_ja), text(d.as_of_en)) + "</p>" : "";
    var rows = (d.items || []).map(function (r) {
      var note = filled(r.note_ja) ? "<small>" + J(text(r.note_ja), text(r.note_en)) + "</small>" : "";
      return '      <li><span class="grade">' + J(text(r.grade_ja), text(r.grade_en)) + "</span><span>" + J(text(r.text_ja), text(r.text_en)) + note + "</span></li>";
    }).join("\n");
    var footer = filled(d.footer_ja) ? '\n    <p class="results-sub">' + J(text(d.footer_ja), text(d.footer_en)) + "</p>" : "";
    return '\n<section id="results" class="bg-navy">\n  <div class="container narrow">\n    <div>\n      <p class="eyebrow">Achievements</p>\n' +
      '      <h2><span lang="ja">実績・データ</span><span lang="en">Results</span></h2>\n      ' + asOf + "\n    </div>\n" +
      '    <ul class="results">\n' + rows + "\n    </ul>" + footer + "\n  </div>\n</section>\n";
  }

  // ------------------------------------------------------------------ 管理画面に登録
  // プレビューの中にもう1つ枠（iframe）を作り、その中でページを実際の幅で組む（パソコン 1280px／スマホ 390px）。
  // サイトの並びは画面の幅で変わるため、右側の狭い欄のままだとパソコンでもスマホの並びになってしまう。
  // パソコンは欄に収まるよう縮めて見せる。上の「パソコン／スマホ」「日本語／English」で切り替える（選んだものは次の記事でも続く）
  var FONTS = "https://fonts.googleapis.com/css2?family=Cinzel:wght@500&family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=EB+Garamond:wght@400;500&family=Jost:wght@400;500&family=Libre+Baskerville&family=Noto+Serif+JP:wght@400;500&family=Playfair+Display:ital,wght@1,400&family=Shippori+Mincho:wght@500&family=Zen+Kaku+Gothic+New:wght@400;500&display=swap";
  var WIDTH = { pc: 1280, sp: 390 };
  var view = { mode: "pc", lang: "ja" };
  var INNER_CSS =
    "html,body{margin:0}" +
    ".reveal{opacity:1!important;transform:none!important}" + // ふわっと出す動きは使わない
    ".voice-slider .voice{opacity:1}";

  function setup(box) {
    var doc = box.ownerDocument, win = doc.defaultView;
    var bar = doc.createElement("div");
    bar.className = "ra-bar";
    bar.innerHTML =
      '<div class="ra-seg" data-k="mode"><button type="button" data-v="pc">パソコン</button><button type="button" data-v="sp">スマホ</button></div>' +
      '<div class="ra-seg" data-k="lang"><button type="button" data-v="ja">日本語</button><button type="button" data-v="en">English</button></div>';
    var stage = doc.createElement("div");
    stage.className = "ra-stage";
    var frame = doc.createElement("iframe");
    frame.setAttribute("title", "プレビュー");
    stage.appendChild(frame);
    box.appendChild(bar);
    box.appendChild(stage);
    var inner = frame.contentDocument;
    inner.open();
    inner.write('<!doctype html><html lang="ja" data-lang="ja"><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="' + FONTS + '"><link rel="stylesheet" href="' + SITE + 'assets/style.css">' +
      "<style>" + INNER_CSS + "</style></head><body><main></main></body></html>");
    inner.close();
    box._ra = { bar: bar, stage: stage, frame: frame, doc: inner, main: inner.querySelector("main") };
    bar.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      view[b.parentNode.getAttribute("data-k")] = b.getAttribute("data-v");
      apply(box);
    });
    // 中身の高さが変わったとき（写真や文字の読み込み・入力）と、欄の幅が変わったときに、枠の大きさを合わせ直す
    new frame.contentWindow.ResizeObserver(function () { layout(box); }).observe(inner.body);
    win.addEventListener("resize", function () { layout(box); });
  }
  function layout(box) {
    var ra = box._ra, w = WIDTH[view.mode];
    var scale = Math.min(1, (box.clientWidth - (view.mode === "sp" ? 32 : 0)) / w);
    var hgt = ra.main.offsetTop + ra.main.offsetHeight;
    ra.frame.style.width = w + "px";
    ra.frame.style.height = hgt + "px";
    ra.frame.style.transform = "scale(" + scale + ")";
    ra.stage.style.width = w * scale + "px";
    ra.stage.style.height = hgt * scale + "px";
  }
  function apply(box) {
    var ra = box._ra, root = ra.doc.documentElement;
    root.setAttribute("data-lang", view.lang);
    root.setAttribute("lang", view.lang);
    ra.stage.classList.toggle("sp", view.mode === "sp");
    ra.bar.querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("on", view[b.parentNode.getAttribute("data-k")] === b.getAttribute("data-v"));
    });
    layout(box);
  }

  function register() {
    var CMS = window.CMS, h = window.h || (CMS && CMS.h);
    if (!CMS || !h) return setTimeout(register, 50);
    CMS.registerPreviewStyle(
      "html,body{margin:0;background:#e9e6df}" +
      ".ra-bar{position:sticky;top:0;z-index:10;display:flex;justify-content:flex-end;gap:8px;padding:8px 10px;background:rgba(233,230,223,.94)}" +
      ".ra-seg{display:flex;border:1px solid #c9a463;border-radius:999px;overflow:hidden;background:#fff;font:13px/1 system-ui,'Hiragino Sans',sans-serif}" +
      ".ra-seg button{border:0;background:transparent;padding:7px 14px;cursor:pointer;color:#1b2a4a;font:inherit}" +
      ".ra-seg button.on{background:#1b2a4a;color:#fff}" +
      ".ra-stage{overflow:hidden;margin:0 auto;background:#fff}" +
      ".ra-stage iframe{display:block;border:0;transform-origin:0 0}" +
      ".ra-stage.sp{margin:8px auto 24px;border-radius:22px;box-shadow:0 0 0 8px #1b2a4a,0 10px 30px rgba(0,0,0,.25)}",
      { raw: true });

    function template(build) {
      return function (props) {
        var data = props.entry.getIn(["data"]);
        data = data && data.toJS ? data.toJS() : data || {};
        var html = finish(fixImages(props, build(data, props)));
        // 枠（iframe）とボタンは自分で作って持ち続け、入力のたびに中身だけを入れ替える（読み直しでちらつかないように）
        return h("div", {
          className: "ra-preview",
          ref: function (box) {
            if (!box) return;
            if (!box._ra) setup(box);
            CUR_DOC = box._ra.doc;
            box._ra.main.innerHTML = html;
            fitPhotos(box._ra.doc);
            apply(box);
          },
        });
      };
    }
    CMS.registerPreviewTemplate("news", template(news));
    CMS.registerPreviewTemplate("events", template(event));
    CMS.registerPreviewTemplate("blog", template(blog));
    ["top", "school", "uk"].forEach(function (key) {
      CMS.registerPreviewTemplate(key, template(function (d, props) { return voices(d, props, key); }));
    });
    CMS.registerPreviewTemplate("results", template(results));
  }
  register();
})();
