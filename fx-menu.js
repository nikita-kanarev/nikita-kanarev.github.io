/*
  FX MENU — меню «Typefaces» в шапке: каждая гарнитура своим шрифтом.

  ЧТО ДЕЛАЕТ. Берёт существующий Webflow-дропдаун «Typefaces» (CMS-список ссылок
  /typefaces/<slug>) и вместо его списка показывает полноэкранную панель:
  светлые плашки, каждая набрана своим шрифтом; при наведении плашка
  раскрывается в карточку цвета гарнитуры со всеми начертаниями. Фон страницы
  затемнён и размыт; ВСЯ прочая анимация страницы на паузе, пока меню открыто.

  ИСТОЧНИКИ ДАННЫХ. Порядок и названия — из CMS-списка дропдауна (новый шрифт
  попадает в меню сам после Publish; порядок = порядок в CMS). Шрифт, оси,
  начертания — <slug>.json на хосте (data-fx-base). Цвет — Custom attribute
  data-color на ссылке элемента списка, привязанный к полю Color (запросов ноль).
  Без атрибута — фон страницы /typefaces/<slug> (~60 KB на шрифт), тот же кеш
  sessionStorage "fx-tile2:<href>", что у плиток главной (fx-index.js).
  Семейства группируются по первому слову названия: «Polytype Display» и
  «Polytype Text» — одна колонка-группа.

  ПАУЗА. Владелец один: все Web Animations / CSS-анимации страницы ставит на
  паузу этот файл и при закрытии возобновляет их, ПОТОМ шлёт fx:resume — модули
  с собственным состоянием (fx-index: плитка, ушедшая за экран) приводят себя в
  порядок уже после. Чего getAnimations не достаёт — часы ротации, rAF-циклы,
  запуск новых анимаций — модули гасят сами по html[data-fx-paused]
  (fx-index, fx-slider).

  РЕГУЛИРОВКА ИЗ WEBFLOW. Переменные (Variables) — CSS custom properties на :root:
    --fx-menu-blur   размытие фона            (Size, по умолчанию 14px; 0 — без размытия)
    --fx-menu-dim    затемнение фона          (Color с прозрачностью, по умолчанию rgba(0,0,0,.25))
    --fx-menu-tile   цвет плашки в покое      (Color, по умолчанию #f2f1ec)
    --fx-menu-ink    цвет текста плашки       (Color, по умолчанию #1a1a1a)

  ПОДКЛЮЧЕНИЕ. Один тег в Site settings → Custom code → Footer (или Embed в
  символе шапки):
    <script src="https://nikita-kanarev.github.io/fx-menu.js" defer></script>
  Атрибуты на теге (необязательны):
    data-fx-base       хост с <slug>.json (по умолчанию каталог самого скрипта)
    data-fx-dropdown   CSS-селектор дропдауна (по умолчанию — .w-dropdown, в списке
                       которого есть ссылки на /typefaces/)
*/
(function () {
  if (window.FxMenu) return;
  var script = document.currentScript;
  function sattr(n) { return script && script.getAttribute(n) || ""; }
  var BASE = sattr("data-fx-base") || (script && script.src ? script.src.replace(/[^\/]*(\?.*)?$/, "") : "https://nikita-kanarev.github.io/");
  var HTML = document.documentElement;

  var CSS = [
    ".fxm-src .w-dropdown-list{display:none!important}",
    /* the veil covers the WHOLE window (whatever shows beside a narrower header blurs too);
       the header is lifted above it while the menu is open, so it stays sharp */
    ".fxm-veil{position:fixed;inset:0;z-index:990;background:var(--fx-menu-dim,rgba(0,0,0,.25));",
    "  -webkit-backdrop-filter:blur(var(--fx-menu-blur,14px));backdrop-filter:blur(var(--fx-menu-blur,14px));opacity:0;visibility:hidden;transition:opacity .25s,visibility 0s .25s}",
    "html.fxm-open .fxm-veil{opacity:1;visibility:visible;transition:opacity .25s}",
    "html.fxm-open .fxm-hdr{z-index:995!important}",
    "html.fxm-open .fxm-hdr.fxm-pos{position:relative}",
    ".fxm{position:fixed;left:0;right:0;top:var(--fxm-top,0px);z-index:991;max-height:calc(100vh - var(--fxm-top,0px));overflow:auto;overscroll-behavior:contain;",
    "  padding:20px;box-sizing:border-box;opacity:0;visibility:hidden;transform:translateY(-8px);",
    "  transition:opacity .2s,transform .3s cubic-bezier(.2,.7,.2,1),visibility 0s .3s}",
    "html.fxm-open .fxm{opacity:1;visibility:visible;transform:none;transition:opacity .2s,transform .3s cubic-bezier(.2,.7,.2,1)}",
    ".fxm *{box-sizing:border-box;margin:0}",
    ".fxm-cols{display:grid;grid-template-columns:repeat(var(--n,3),minmax(0,1fr));gap:20px;align-items:start}",
    ".fxm-stack{display:flex;flex-direction:column;gap:20px;min-width:0}",
    ".fxm-fam{display:flex;flex-direction:column;gap:6px}",
    ".fxm-card{display:flex;flex-direction:column;position:relative;height:var(--h,52px);overflow:hidden;border-radius:4px;",
    "  background:var(--fx-menu-tile,#f2f1ec);color:var(--fx-menu-ink,#1a1a1a);text-decoration:none;",
    "  transition:height .45s cubic-bezier(.2,.75,.15,1),background-color .25s,color .25s}",
    ".fxm-card:hover,.fxm-card:focus{color:var(--fx-menu-ink,#1a1a1a);text-decoration:none}",
    ".fxm-t{display:block;flex:none;line-height:1;padding:.32em .4em .38em;white-space:nowrap;overflow:hidden;font-size:clamp(28px,3vw,46px);font-weight:400;transition:font-variation-settings .45s}",
    ".fxm-bd{flex:none;display:flex;flex-direction:column;padding:0 .9em .9em calc(.4 * clamp(28px,3vw,46px));opacity:0;transition:opacity .2s}",
    ".fxm-st{display:grid;grid-auto-flow:column;column-gap:30px;align-content:start;justify-content:start;overflow:hidden}",
    ".fxm-st span{line-height:1.02;white-space:nowrap}",
    ".fxm-ft{font-size:12px;line-height:1.3;opacity:.75;margin-top:10px}",
    /* open = expanded; .on = the one under the cursor, in its colour. The other open card (the
       one the cursor came from) stays expanded in the resting tile colours */
    ".fxm-tile.open .fxm-card,.fxm-tile.open .fxm-card:hover{height:var(--H,auto)}",
    ".fxm-tile.open.on .fxm-card,.fxm-tile.open.on .fxm-card:hover{background:var(--c,#333);color:#fff}",
    ".fxm-tile.open .fxm-bd{opacity:1;transition:opacity .3s .15s}",
    "@media (prefers-reduced-motion:reduce){.fxm,.fxm-veil,.fxm-card,.fxm-bd,.fxm-t{transition:none!important}}"
  ].join("\n");

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* ---------- data ---------- */
  function noop() {}
  function loadJson(slug) {
    return fetch(BASE + slug + ".json").then(function (r) { if (!r.ok) throw 0; return r.json(); }).catch(function () { return null; });
  }
  /* the font is registered under its own family name — the same face fx-index / FX.injectFontFace
     register — so on a page that already has the typeface it is not decoded a second time */
  function loadFont(cfg) {
    if (!cfg.fontUrl || !cfg.family) return Promise.resolve();
    if (window.FX && FX.injectFontFace) FX.injectFontFace(cfg);
    else if (window.FontFace && ![].some.call(document.fonts, function (f) { return f.family.replace(/["']/g, "") === cfg.family; }))
      document.fonts.add(new FontFace(cfg.family, "url(" + cfg.fontUrl + ")"));
    return document.fonts.load("16px '" + cfg.family + "'").catch(noop);
  }
  /* page colour (fallback when the link has no data-color): the same cache and the same parse as the home tiles (fx-index.js pageInfo) —
     keep the "fx-tile2:" key and the {color, imgs, desc} shape in step with it */
  function pageInfo(href) {
    var key = "fx-tile2:" + href, hit = null;
    try { hit = JSON.parse(sessionStorage.getItem(key)); } catch (e) {}
    if (hit) return Promise.resolve(hit);
    if (!window.fetch || !window.DOMParser) return Promise.resolve({});
    return fetch(href, { credentials: "same-origin" }).then(function (r) { if (!r.ok) throw 0; return r.text(); }).then(function (t) {
      var doc = new DOMParser().parseFromString(t, "text/html");
      var info = {
        color: doc.body && doc.body.style.backgroundColor || "",
        imgs: [].map.call(doc.querySelectorAll("img.fx-img"), function (im) { return im.getAttribute("src"); }).filter(Boolean),
        desc: ((doc.querySelector('meta[name="description"]') || {}).content || "").trim()
      };
      try { sessionStorage.setItem(key, JSON.stringify(info)); } catch (e) {}
      return info;
    }).catch(function () { return {}; });
  }

  /* as FxType.vset: Safari drops a value EQUAL to the font's default (and then sets opsz from
     the font size), so a default is nudged by 0.01 */
  function axesVS(axes, over) {
    return (axes || []).map(function (a) {
      var v = over && over[a.tag] != null ? over[a.tag] : a.default;
      if (v === a.default) v = (a.max !== undefined && v >= a.max) ? v - 0.01 : v + 0.01;
      return "'" + a.tag + "' " + v;
    }).join(", ");
  }
  function titleOver(axes) {   // the name in the open card: a bold weight if there is a weight axis
    var o = {}; (axes || []).forEach(function (a) { if (a.tag === "wght") o.wght = Math.min(a.max, 700); }); return o;
  }
  /* named instances → columns of rows. 1 instance axis: one column. 2+: the columns are
     cuts.variantAxis when the JSON declares it (as in the Cuts / Order embeds; Fluxetype: x-height
     Petit/Normal/Grande × 7 weights), otherwise the axis with the fewest distinct values
     (Archaism: contrast × width). Same idea as FxType.layoutFor, which isn't loaded on every page. */
  function styleCols(cfg) {
    var ins = cfg.instances || [], tags = cfg.instanceAxes || [];
    if (!ins.length) return [];
    function vs(v) { var o = {}; tags.forEach(function (t, i) { o[t] = v[i + 1]; }); return axesVS(cfg.axes, o); }
    var cols;
    if (tags.length < 2) cols = [ins];
    else {
      var best = tags.indexOf(cfg.cuts && cfg.cuts.variantAxis), bestN = 1e9;
      if (best < 0) tags.forEach(function (t, i) { var n = {}; ins.forEach(function (v) { n[v[i + 1]] = 1; }); var k = Object.keys(n).length; if (k > 1 && k < bestN) { bestN = k; best = i; } });
      var keys = [], by = {};
      ins.forEach(function (v) { var k = v[best + 1]; if (!by[k]) { by[k] = []; keys.push(k); } by[k].push(v); });
      keys.sort(function (a, b) { return a - b; });
      cols = keys.map(function (k) { return by[k]; });
    }
    return cols.map(function (col) {
      var first = col.map(function (v) { return String(v[0]).split(" "); });
      var shared = first.every(function (w) { return w.length > 1 && w[0] === first[0][0]; });
      return col.map(function (v, i) {
        var name = String(v[0]), label = shared ? first[i].slice(1).join(" ") : name;
        if (!shared && /\d/.test(name) && name.indexOf(" ") < 0) label = cfg.family;   // codes like Ct0Wd50 → the typeface's name
        return { label: label, vs: vs(v) };
      });
    });
  }

  /* ---------- menu ---------- */
  var menu, veil, colsBox, items = [], fams = null, colN = 0, dropdown, closeT = 0, paused = [];

  function collect(dd) {
    var seen = {};
    return [].slice.call(dd.querySelectorAll(".w-dropdown-list a[href]")).map(function (a) {
      var href = a.getAttribute("href"), m = href.match(/\/typefaces\/([^\/?#]+)/);
      if (!m || seen[m[1]]) return null; seen[m[1]] = 1;
      var name = (a.textContent || "").replace(/\s+/g, " ").trim() || m[1];
      // colour straight from the CMS: custom attribute data-color on the link (or its item), bound to the Color field
      var cEl = a.closest("[data-color]"), color = cEl ? cEl.getAttribute("data-color").trim() : "";
      return { slug: m[1], href: href, name: name, fam: name.split(" ")[0], color: color };
    }).filter(Boolean);
  }

  function build() {
    if (fams) return;
    fams = [];
    items.forEach(function (it) { var f = fams[fams.length - 1]; if (!f || f.name !== it.fam) fams.push(f = { name: it.fam, items: [] }); f.items.push(it); });
    fams.forEach(function (f) {
      var box = el("div", "fxm-fam"); box.dataset.n = f.items.length; f.el = box;
      f.items.forEach(function (it) {
        var tile = el("div", "fxm-tile"), card = el("a", "fxm-card"); card.href = it.href;
        var t = el("span", "fxm-t", esc(it.name));
        var bd = el("div", "fxm-bd");
        card.appendChild(t); card.appendChild(bd); tile.appendChild(card); box.appendChild(tile);
        it.tile = tile; it.t = t; it.bd = bd; tile.__it = it;
        tile.addEventListener("mouseenter", function () { hoverTile(tile); });
        card.addEventListener("click", function (e) {   // touch: the first tap opens the card, the second follows the link
          if (matchMedia("(hover: none)").matches && !tile.classList.contains("open")) { e.preventDefault(); hoverTile(tile); }
        });
      });
    });
    layout(true);
    load();
  }

  function load() {
    items.forEach(function (it) {
      // data-color from the CMS needs no request; without it — the typeface page's background (~60 KB each)
      if (it.color) it.tile.style.setProperty("--c", it.color);
      else pageInfo(it.href).then(function (info) { if (info && info.color) it.tile.style.setProperty("--c", info.color); });
      loadJson(it.slug).then(function (cfg) {
        if (!cfg) return;
        it.cfg = cfg;
        // a list ending in "sans-serif", not "inherit": that keyword is invalid inside a list and kills the declaration
        var ff = "'" + cfg.family.replace(/'/g, "") + "', sans-serif";
        it.t.style.fontFamily = ff; setTitle(it, false);
        var cols = styleCols(cfg), n = (cfg.instances || []).length;
        if (cols.length) {
          var h = '<div class="fxm-st" style="grid-template-rows:repeat(' + cols[0].length + ',auto)">';
          cols.forEach(function (col) { col.forEach(function (s) { h += '<span style="font-family:' + esc(ff) + ';font-variation-settings:' + s.vs + '">' + esc(s.label) + "</span>"; }); });
          h += '</div><div class="fxm-ft">' + n + " styles · Variable Font</div>";
          it.bd.innerHTML = h;
        }
        loadFont(cfg).then(function () { it.w = 0; it.tile.style.setProperty("--h", it.t.offsetHeight + "px"); });
      });
    });
  }

  /* masonry: each family into the currently shortest column; every column is its own stack,
     so an open card only pushes tiles in its own column */
  function layout(force) {
    if (!fams) return;
    var w = window.innerWidth, n = Math.min(w < 760 ? 1 : w < 1500 ? 3 : 4, fams.length);
    if (!force && colN === n) return;
    colN = n; colsBox.style.setProperty("--n", n); colsBox.innerHTML = "";
    var cols = [], h = [];
    for (var i = 0; i < n; i++) { var st = colsBox.appendChild(el("div", "fxm-stack")); bindStack(st); cols.push(st); h.push(0); }
    fams.forEach(function (f) { var k = h.indexOf(Math.min.apply(null, h)); cols[k].appendChild(f.el); h[k] += 0.4 + f.items.length; });
    items.forEach(function (it) { it.w = 0; });
  }
  function sizeTiles() {   // all reads, then all writes: one layout, not one per tile
    var hs = items.map(function (it) { return it.t ? it.t.offsetHeight : 0; });
    items.forEach(function (it, i) { if (it.tile) it.tile.style.setProperty("--h", hs[i] + "px"); });
  }

  function fitCard(it) {
    var box = it.bd.querySelector(".fxm-st"); if (!box) return;
    var sp = box.querySelectorAll("span"), size = Math.min(36, it.tile.offsetWidth / 11);
    function set() { for (var i = 0; i < sp.length; i++) sp[i].style.fontSize = size + "px"; }
    // text width scales with the size (the 30px gaps don't): scale by the overflow, then a step or two to finish
    set(); for (var i = 0; i < 4 && box.scrollWidth > box.clientWidth + 1; i++) { size *= i ? 0.95 : 0.98 * box.clientWidth / box.scrollWidth; set(); }
  }
  function openTile(tile) {
    var it = tile.__it, card = tile.firstChild;
    if (!it.bd.firstChild) return;   // no JSON (yet): the tile stays a plain link
    if (it.w !== tile.offsetWidth) { it.w = tile.offsetWidth; fitCard(it); }
    setTitle(it, true);
    var keep = card.style.transition; card.style.transition = "none"; card.style.height = "auto";   // measure the content
    var H = card.scrollHeight; card.style.height = ""; void card.offsetHeight; card.style.transition = keep;
    tile.style.setProperty("--H", H + "px");
    tile.classList.add("open");
  }
  function closeTile(tile) { tile.classList.remove("open", "on"); setTitle(tile.__it, false); }
  function setTitle(it, bold) { if (it.cfg) it.t.style.fontVariationSettings = axesVS(it.cfg.axes, bold ? titleOver(it.cfg.axes) : null); }
  /* open in a column: the tile under the cursor + the one the cursor came from (same column),
     in either direction — down: it and the one above; up: it and the one below. Everything
     else in the column and in other columns closes. */
  function hoverTile(tile) {
    var stack = tile.closest(".fxm-stack"), prev = stack.__last;
    clearTimeout(stack.__t);
    [].forEach.call(stack.querySelectorAll(".fxm-tile.open"), function (t) { if (t !== tile && t !== prev) closeTile(t); });
    [].forEach.call(colsBox.querySelectorAll(".fxm-stack"), function (st) { if (st !== stack) { st.__last = null; [].forEach.call(st.querySelectorAll(".fxm-tile.open"), closeTile); } });
    if (!tile.classList.contains("open")) openTile(tile);
    [].forEach.call(colsBox.querySelectorAll(".fxm-tile.on"), function (t) { t.classList.remove("on"); });
    tile.classList.add("on");
    stack.__last = tile;
  }
  function bindStack(st) {
    st.addEventListener("mouseenter", function () { clearTimeout(st.__t); });
    st.addEventListener("mouseleave", function () { st.__t = setTimeout(function () { st.__last = null; [].forEach.call(st.querySelectorAll(".fxm-tile.open"), closeTile); }, 250); });
  }

  /* ---------- pause everything else on the page ---------- */
  function pauseAll() {
    HTML.setAttribute("data-fx-paused", "");
    paused = [];
    if (document.getAnimations) document.getAnimations().forEach(function (a) {
      if (a.playState !== "running") return;
      if (window.CSSTransition && a instanceof CSSTransition) return;
      var t = a.effect && a.effect.target;
      if (t && (menu.contains(t) || veil.contains(t))) return;
      try { a.pause(); paused.push(a); } catch (e) {}
    });
    document.dispatchEvent(new CustomEvent("fx:pause"));
  }
  function resumeAll() {
    HTML.removeAttribute("data-fx-paused");
    paused.forEach(function (a) { try { if (a.playState === "paused") a.play(); } catch (e) {} });
    paused = [];
    document.dispatchEvent(new CustomEvent("fx:resume"));
  }

  /* ---------- open / close ---------- */
  function isOpen() { return HTML.classList.contains("fxm-open"); }
  var hdr;
  function topEdge() { return Math.max(0, Math.round(hdr.getBoundingClientRect().bottom)); }
  function place() { HTML.style.setProperty("--fxm-top", topEdge() + "px"); layout(); sizeTiles(); }   // .fxm inherits --fxm-top
  function open() {
    clearTimeout(closeT);
    if (isOpen()) return;
    build();
    HTML.classList.add("fxm-open"); place();
    pauseAll();
  }
  function close() {
    clearTimeout(closeT);
    if (!isOpen()) return;
    HTML.classList.remove("fxm-open");
    items.forEach(function (it) { if (it.tile) closeTile(it.tile); });
    resumeAll();
  }
  function later() { clearTimeout(closeT); closeT = setTimeout(close, 300); }

  function init() {
    var sel = sattr("data-fx-dropdown");
    dropdown = sel ? document.querySelector(sel) : [].filter.call(document.querySelectorAll(".w-dropdown"), function (d) { return d.querySelector('.w-dropdown-list a[href*="/typefaces/"]'); })[0];
    if (!dropdown) return;
    items = collect(dropdown);
    if (!items.length) return;
    var st = el("style"); st.id = "fx-menu-css"; st.textContent = CSS; document.head.appendChild(st);
    dropdown.classList.add("fxm-src");
    hdr = dropdown.closest("[data-wf--header--variant], header, nav, .w-nav") || dropdown;
    hdr.classList.add("fxm-hdr");
    if (getComputedStyle(hdr).position === "static") hdr.classList.add("fxm-pos");   // z-index needs a positioned box
    veil = el("div", "fxm-veil"); menu = el("nav", "fxm"); menu.setAttribute("aria-label", "Typefaces");
    colsBox = menu.appendChild(el("div", "fxm-cols"));
    document.body.appendChild(veil); document.body.appendChild(menu);

    var hoverDev = !(window.matchMedia && matchMedia("(hover: none)").matches);
    var toggle = dropdown.querySelector(".w-dropdown-toggle") || dropdown;
    if (hoverDev) {
      dropdown.addEventListener("mouseenter", open);
      dropdown.addEventListener("mouseleave", later);
      menu.addEventListener("mouseenter", function () { clearTimeout(closeT); });
      menu.addEventListener("mouseleave", later);
    }
    toggle.addEventListener("click", function (e) {   // touch, or a click before the hover fired: open instead of navigating
      if (!isOpen() || !hoverDev) { e.preventDefault(); e.stopPropagation(); isOpen() ? close() : open(); }
    }, true);
    veil.addEventListener("click", close);
    menu.addEventListener("click", function (e) { if (e.target === menu || e.target === colsBox || e.target.classList.contains("fxm-stack")) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    var rz = 0;
    window.addEventListener("resize", function () { if (isOpen() && !rz) rz = requestAnimationFrame(function () { rz = 0; if (isOpen()) place(); }); });
    window.addEventListener("pageshow", function (e) { if (e.persisted) close(); });   // back/forward cache: don't come back with the page paused
  }

  window.FxMenu = { open: open, close: close };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
