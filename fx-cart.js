/*
  FX CART — общее хранилище заказа для всех эмбедов витрины.

  ЗАЧЕМ. До этого файла корзина жила внутри License Builder (`S` + ключ
  `fx:licb:<family>:v1`), а Playground держал её тень (`CART = {subs,full}`) и
  синхронизировался событиями `fx:license:subs-changed`. Пока заказ был про одну
  семью и покупался на её же странице, этого хватало. Как только появились
  бейдж в футере и страница /cart, владелец состояния обязан быть снаружи:
  бейдж стоит на страницах, где билдера нет вообще, и спрашивать состояние ему
  не у кого.

  ЧТО ЭТО НЕ ДЕЛАЕТ: не рисует, не ходит в сеть, не знает про Paddle. Только
  состояние, правила его изменения и цена.

  ─────────────────────────────────────────────────────────────────────────────
  ПОЗИЦИЯ = СЕМЬЯ × PRODUCT, а не просто семья.

  Старый `S.product` был радио: single XOR subfamily XOR full. Поэтому «Text
  целиком + два начертания из Display» нельзя было ни выбрать, ни оплатить.
  Здесь это две позиции одной семьи, у каждой своя кривая объёма. Цена каждой
  считается той же формулой, что и раньше, — воркеру предстоит научиться
  перебирать массив, а не пересчитывать по-новому.

  ПОГЛОЩЕНИЕ обязательно, иначе покупатель платит дважды за один файл:
    • full поглощает все позиции этой семьи;
    • субсемейство поглощает входящие в него отдельные начертания;
    • при активном full добавление single/subfamily — no-op.
  Мутации возвращают {ok, absorbed, dropped} — UI обязан сказать вслух, что
  позиция исчезла. Молчаливое удаление из корзины читается как баг.
  ⚠️ Те же три правила должны быть на сервере: UI тут не защита, а удобство.

  ЛИЦЕНЗИЯ — УРОВЕНЬ ЗАКАЗА, не позиции. Usage, reach и webDomain описывают
  покупателя, а не гарнитуру: «desktop, 2–5 человек, домен такой-то» не бывает
  разным для Fluxetype и Archaism в одном чеке. Отсюда цена:
      base(позиция) × Σ(licMult × scaleMult)
  позиционная база × общий множитель заказа.

  ОКРУГЛЕНИЕ — ПО ВОРКЕРУ. Источник истины о цене — computePrice в worker.js:
  ОДНО округление в конце, над суммой множителей заказа:
      round( base(позиция) × Σ(licMult × scaleMult) )
  Старый билдер округлял иначе — построчно по каждому usage (Σ round(...)) —
  отсюда известное расхождение в $1–2. Расходился билдер, не воркер, поэтому
  подвинут билдер: деньги берёт сервер, и спорить с ним фронту нечем.

  Из этого следует неочевидное: строки билета НЕЛЬЗЯ считать независимо, иначе
  они не сойдутся с Total. Поэтому itemLines() раздаёт уже посчитанный total по
  usage методом наибольшего остатка — суммы строк сходятся с итогом в точности,
  а не «почти». Отображаемая разбивка — производная от цены, а не наоборот.

  ⚠️ Множители LICENSES/SCALES здесь совпадают с LICENSE_MULT/SCALE_MULT в
  worker.js один в один. Это одна таблица в двух местах — правится парой.
  ⚠️ У субсемейства воркер берёт SUBFAMILY_CUT_COUNT(21) × число субсемейств,
  здесь — фактическую длину price.subCuts. Для Fluxetype это одно и то же
  число; когда воркер станет знать про несколько гарнитур, константу 21 надо
  заменить фактическим счётом, а не наоборот.

  СЛЕПОК ЦЕН В ПОЗИЦИИ (item.price). Числа (singleBase/singleExponent/fullBase/
  currency) живут в <slug>.json и в Custom attributes эмбеда. Бейдж стоит на
  страницах без конфига и без билдера — фетчить их ему неоткуда и незачем.
  Поэтому добавляющая сторона кладёт слепок в позицию: бейдж считает мгновенно
  и без сети. Истина — всё равно свежий конфиг: /cart перефетчивает и
  пересчитывает, слепок обновляет. Позиция без слепка (пришла из миграции)
  помечена stale:true — считать её нельзя, только показать состав.

  ХРАНИЛИЩЕ. Ключ fx:cart:v1, TTL 14 дней. Каждая мутация — read-modify-write
  прямо в localStorage, а не поверх снимка в памяти: на странице может быть
  несколько потребителей, а в браузере несколько вкладок, и они обязаны
  сходиться. Отвалившийся localStorage (приватный режим, забитая квота) не
  повод падать — уходим в память на время сессии.

  СОБЫТИЯ (на window):
    fx:cart:ready    — файл загрузился, window.FxCart готов
    fx:cart:changed  — detail {cart, rev, reason}; шлётся и на правку в другой
                       вкладке (через storage)
  Подписка: FxCart.on(fn) / FxCart.off(fn).

  Потребители грузят файл сами и ждут готовности:
    if (window.FxCart) go(); else addEventListener("fx:cart:ready", go)
  (тот же приём, что data-fx-wait в загрузчике билдера).
*/
(function(){
  "use strict";
  if (window.FxCart) return;            // второй тег на странице — не повод пересобирать стор

  var KEY = "fx:cart:v1";
  var TTL = 14*24*60*60*1000;           // две недели: корзина теперь межстраничная и живёт дольше одной сессии
  var LEGACY = /^fx:licb:(.+):v1$/;     // снимки старого билдера, по одному на семью

  /* ---- тарифы (универсальны для всех гарнитур) ---------------------------
     Переехали сюда из embed-license-builder как есть. Менять только вместе с
     LICENSE_MULT / SCALE_MULT в worker.js — они одна таблица в двух местах. */
  var LICENSES = [
    { id:"desktop", name:"Desktop",     mult:1.0, desc:"Print · artwork · documents<br>Priced by seats" },
    { id:"web",     name:"Web",         mult:1.2, desc:"@font-face embedding<br>Priced by pageviews" },
    { id:"app",     name:"App / eBook", mult:1.5, desc:"Embedded in software<br>Priced by installs" },
    { id:"broad",   name:"Broadcast",   mult:1.8, desc:"Film · TV · streaming<br>Priced by reach" },
    { id:"ent",     name:"Enterprise",  mult:0, custom:true }
  ];
  var SCALES = {
    desktop:{ unit:"Users", items:[
      {id:"1",name:"1 user",cap:"1",mult:1.0},{id:"2-5",name:"2–5 users",cap:"2–5",mult:2.5},{id:"6-10",name:"6–10 users",cap:"6–10",mult:4.0},
      {id:"11-25",name:"11–25 users",cap:"11–25",mult:7.0},{id:"26-50",name:"26–50 users",cap:"26–50",mult:11.0},{id:"50+",name:"50+ users",cap:"50+",mult:0,custom:true}] },
    web:{ unit:"Pageviews / month", items:[
      {id:"10k",name:"≤10K",cap:"≤10K",mult:1.0},{id:"100k",name:"≤100K",cap:"≤100K",mult:2.0},{id:"500k",name:"≤500K",cap:"≤500K",mult:3.5},
      {id:"1m",name:"≤1M",cap:"≤1M",mult:5.0},{id:"5m",name:"≤5M",cap:"≤5M",mult:8.0},{id:"5m+",name:"5M+",cap:"5M+",mult:0,custom:true}] },
    app:{ unit:"Installs or copies", items:[
      {id:"1k",name:"≤1K",cap:"≤1K",mult:1.0},{id:"10k",name:"≤10K",cap:"≤10K",mult:2.5},{id:"100k",name:"≤100K",cap:"≤100K",mult:5.0},
      {id:"1m",name:"≤1M",cap:"≤1M",mult:10.0},{id:"1m+",name:"1M+",cap:"1M+",mult:0,custom:true}] },
    broad:{ unit:"Audience reach", items:[
      {id:"regional",name:"Regional",cap:"Regional",mult:1.0},{id:"national",name:"National",cap:"National",mult:2.5},{id:"intl",name:"International",cap:"Intl",mult:5.0},
      {id:"global",name:"Global",cap:"Global",mult:10.0},{id:"unlim",name:"Unlimited",cap:"Unltd",mult:0,custom:true}] }
  };
  // форматы поставки по типу использования — Desktop без WOFF2 (это веб-формат)
  var USAGE_FORMATS = { desktop:["Variable","OTF","TTF"], web:["Variable","WOFF2"], app:["Variable","OTF","TTF","WOFF2"], broad:["Variable","OTF","TTF"], ent:[] };
  var FORMAT_ORDER = ["Variable","OTF","TTF","WOFF2"];
  var PRODUCTS = ["single","subfamily","full"];

  function licById(id){ for(var i=0;i<LICENSES.length;i++) if(LICENSES[i].id===id) return LICENSES[i]; return null; }
  function scaleById(licId, sid){
    var def=SCALES[licId]; if(!def) return null;
    for(var i=0;i<def.items.length;i++) if(def.items[i].id===sid) return def.items[i];
    return null;
  }
  function defaultScaleId(id){ return SCALES[id] ? SCALES[id].items[0].id : ""; }

  /* ---- доступ к localStorage --------------------------------------------- */
  // Приватный режим, отключённое хранилище, забитая квота: работаем в памяти,
  // корзина живёт до перезагрузки. Это хуже, но это не падение.
  var MEM = null, memOnly = false;
  function rawGet(){
    if (memOnly) return MEM;
    try { return localStorage.getItem(KEY); } catch(e){ memOnly = true; return MEM; }
  }
  function rawSet(s){
    if (!memOnly){ try { localStorage.setItem(KEY, s); return; } catch(e){ memOnly = true; } }
    MEM = s;
  }
  function rawDel(){
    MEM = null;
    if (!memOnly){ try { localStorage.removeItem(KEY); } catch(e){ memOnly = true; } }
  }

  /* ---- схема -------------------------------------------------------------- */
  /* ЛИЦЕНЗИЯ — ПО ГАРНИТУРЕ, а не на весь заказ и не на позицию.
     Дисплейную гарнитуру берут в печать, текстовую — на сайт; общая лицензия
     заставляла бы купить Web для обеих. Позиция мельче, чем надо: «эти два
     начертания для десктопа, а субсемейство для веба» — не то, что кто-то
     покупает. Поэтому ключ — slug семьи.
       byFamily[slug] = {licenses, scales}   — что выбрано для этой гарнитуры
       license = {licenses, scales, webDomain}
         · licenses/scales — ЗНАЧЕНИЕ ПО УМОЛЧАНИЮ для следующей гарнитуры
           (частый случай «везде одно и то же» остаётся одним действием)
         · webDomain — на весь заказ: это сайт покупателя, он один, и просить
           его трижды значит просить одно и то же трижды */
  function empty(){
    return { v:1, t:Date.now(), rev:0,
             license:{ licenses:["desktop"], scales:{ desktop: defaultScaleId("desktop") }, webDomain:"" },
             byFamily:{}, items:[] };
  }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function str(x){ return typeof x==="string" ? x : ""; }
  function arr(x){ return Array.isArray(x) ? x : []; }
  function uniq(list){
    var seen={}, out=[];
    for(var i=0;i<list.length;i++){ var s=str(list[i]); if(s && !seen[s]){ seen[s]=1; out.push(s); } }
    return out;
  }

  // Прочитанное могло быть записано другой версией кода или подправлено руками.
  // Всё, чего мы не понимаем, молча выбрасывается: восстановление не имеет
  // права ни бросить исключение, ни вернуть состояние, которое не отрисовать.
  function sanitize(d){
    if (!d || typeof d!=="object") return null;
    if (d.v!==1 || !d.t || (Date.now()-d.t) > TTL) return null;
    var lic = d.license && typeof d.license==="object" ? d.license : {};
    // разбор одной лицензии: набор usage + шкала на каждый. Всё неизвестное
    // выбрасывается, пустой набор превращается в desktop — заказ без
    // использования не бывает.
    function cleanLic(src){
      var o = src && typeof src==="object" ? src : {};
      var ids = arr(o.licenses).filter(function(id){ return !!licById(id); });
      if (!ids.length) ids = ["desktop"];
      var sc = {};
      ids.forEach(function(id){
        if (!SCALES[id]) return;
        var want = o.scales && o.scales[id];
        sc[id] = scaleById(id, want) ? want : defaultScaleId(id);
      });
      return { licenses:ids, scales:sc };
    }
    var base = cleanLic(lic), ids = base.licenses, scales = base.scales;
    var byFamily = {};
    var bf = d.byFamily && typeof d.byFamily==="object" ? d.byFamily : {};
    Object.keys(bf).forEach(function(slug){
      if (!str(slug)) return;
      byFamily[String(slug).toLowerCase()] = cleanLic(bf[slug]);
    });
    var items = [];
    arr(d.items).forEach(function(it){
      if (!it || typeof it!=="object") return;
      var slug = str(it.slug), product = str(it.product);
      if (!slug || PRODUCTS.indexOf(product) < 0) return;
      var cuts = product==="single" ? uniq(arr(it.cuts)) : [];
      var subs = product==="subfamily" ? uniq(arr(it.subs)) : [];
      if (product==="single" && !cuts.length) return;        // пустая позиция — не позиция
      if (product==="subfamily" && !subs.length) return;
      items.push({ slug:slug, family:str(it.family)||slug, product:product, cuts:cuts, subs:subs,
                   price: it.price && typeof it.price==="object" ? it.price : null,
                   stale: !it.price });
    });
    // ⚠️ Миграция со старой схемы (одна лицензия на заказ): у кого корзина уже
    // набрана, раздаём текущую лицензию всем гарнитурам заказа — иначе после
    // обновления цена молча поехала бы на дефолт.
    items.forEach(function(it){ if (!byFamily[it.slug]) byFamily[it.slug] = {licenses:ids.slice(), scales:JSON.parse(JSON.stringify(scales))}; });
    return { v:1, t:d.t, rev:(+d.rev||0),
             license:{ licenses:ids, scales:scales, webDomain:str(lic.webDomain).slice(0,200) },
             byFamily: byFamily,
             items: items };
  }

  function read(){
    var raw = rawGet();
    if (!raw) return null;
    var d; try { d = JSON.parse(raw); } catch(e){ rawDel(); return null; }
    var ok = sanitize(d);
    if (!ok) { rawDel(); return null; }
    return ok;
  }

  var lastRev = -1;
  function write(cart, reason){
    cart.t = Date.now();
    cart.rev = (cart.rev||0) + 1;
    lastRev = cart.rev;
    rawSet(JSON.stringify(cart));
    emit(cart, reason);
    return cart;
  }

  /* ---- шина --------------------------------------------------------------- */
  var subs = [];
  function emit(cart, reason){
    var detail = { cart: clone(cart), rev: cart.rev, reason: reason||"" };
    for (var i=0;i<subs.length;i++){ try { subs[i](detail); } catch(e){ console.error("[FxCart] listener failed", e); } }
    try { window.dispatchEvent(new CustomEvent("fx:cart:changed", { detail: detail })); } catch(e){}
  }
  // правка в соседней вкладке: тот же покупатель, то же хранилище
  window.addEventListener("storage", function(e){
    if (e.key !== KEY) return;
    var cart = read() || empty();
    if (cart.rev === lastRev) return;      // эхо собственной записи
    lastRev = cart.rev;
    emit(cart, "storage");
  });

  /* ---- миграция со старого билдера ---------------------------------------
     Ключей может быть несколько (у Fluxetype и Archaism свои). Что теряется и
     почему это допустимо:
       • slug — в старом снимке его нет. Берём его из самого ключа: он собирался
         как family.toLowerCase().replace(/[^a-z0-9]+/g,"-"), и для обеих живых
         гарнитур это и есть slug конфига (fluxetype, archaism).
       • слепок цен — в старом снимке его тоже нет, позиция уезжает stale:true.
         Бейдж покажет её без суммы, /cart перефетчит конфиг и оценит.
     Мигрируем только в пустую корзину: если новая уже набрана, старый снимок
     затирать ею нечего, просто убираем. */
  function migrate(){
    var keys = [];
    try { for (var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if (k && LEGACY.test(k)) keys.push(k); } }
    catch(e){ return null; }
    if (!keys.length) return null;

    var cart = read(), fresh = !cart;
    if (fresh) cart = empty();
    var touched = false;

    keys.forEach(function(k){
      var d; try { d = JSON.parse(localStorage.getItem(k)); } catch(e){ d = null; }
      try { localStorage.removeItem(k); } catch(e){}
      if (!fresh || !d || typeof d!=="object" || !d.t || (Date.now()-d.t) > TTL) return;
      var slug = k.match(LEGACY)[1];
      var family = slug.charAt(0).toUpperCase() + slug.slice(1);
      var product = str(d.product), cuts = uniq(arr(d.cuts)), subsL = uniq(arr(d.subs));
      if (product==="full") cart.items.push({ slug:slug, family:family, product:"full", cuts:[], subs:[], price:null, stale:true });
      else if (product==="subfamily" && subsL.length) cart.items.push({ slug:slug, family:family, product:"subfamily", cuts:[], subs:subsL, price:null, stale:true });
      else if (product==="single" && cuts.length) cart.items.push({ slug:slug, family:family, product:"single", cuts:cuts, subs:[], price:null, stale:true });
      else return;
      // лицензия в старом снимке была на семью; в заказе она одна — берём из
      // первого мигрировавшего снимка, остальные не спорят
      if (!touched){
        var ids = arr(d.licenses).filter(function(id){ return !!licById(id); });
        if (ids.length){
          cart.license.licenses = ids;
          cart.license.scales = {};
          ids.forEach(function(id){
            if (!SCALES[id]) return;
            var want = d.scales && d.scales[id];
            cart.license.scales[id] = scaleById(id, want) ? want : defaultScaleId(id);
          });
        }
        if (typeof d.webDomain==="string") cart.license.webDomain = d.webDomain.slice(0,200);
      }
      touched = true;
    });
    if (!touched) return null;
    return write(cart, "migrate");
  }

  /* ---- состав позиции ------------------------------------------------------ */
  // Начертания, входящие в субсемейства: нужны и для поглощения, и для счёта
  // объёма. Живут в слепке (price.subCuts), потому что знает их только конфиг.
  function subCutsOf(item, labels){
    var map = (item && item.price && item.price.subCuts) || {};
    var out = [];
    arr(labels).forEach(function(l){ out = out.concat(arr(map[l])); });
    return out;
  }
  function styleCount(item){
    if (!item) return 0;
    if (item.product==="single") return item.cuts.length;
    if (item.product==="subfamily") return subCutsOf(item, item.subs).length;
    return (item.price && +item.price.totalInstances) || 0;
  }

  /* ---- цена ---------------------------------------------------------------
     base(позиция) × Σ(licMult × scaleMult), округление на уровне позиция×usage.
     Кривая объёма — та же, что была в derive():
       single    → singleBase × cutCount^exp
       subfamily → singleBase × (Σ начертаний выбранных субсемейств)^exp
       full      → fullBase, а если его нет — кривая по всей семье
     Ровно это считает worker.js (SINGLE_BASE 50 / FULL_BASE 1380 /
     SINGLE_EXPONENT 0.75) — здесь мы его повторяем, а не задаём. */
  /* Чья лицензия действует. Передали объект — считаем по нему; передали slug
     (или позицию) — берём лицензию этой гарнитуры; ничего — значение по
     умолчанию. Одна точка входа, чтобы «по какой лицензии считаем» не
     разъехалось между ценой, билетом и кассой. */
  function licenseOf(x, cart){
    var c = cart || read() || empty();
    if (x && typeof x==="object" && x.licenses) return x;          // готовая лицензия
    var slug = x && typeof x==="object" ? x.slug : x;
    if (slug && c.byFamily && c.byFamily[String(slug).toLowerCase()])
      return c.byFamily[String(slug).toLowerCase()];
    return c.license;
  }
  function rows(license){
    var L = licenseOf(license);
    return arr(L.licenses).map(function(id){
      var lic = licById(id); if (!lic) return null;
      var def = SCALES[id];
      var sc = def ? (scaleById(id, L.scales && L.scales[id]) || def.items[0]) : null;
      return { license: lic, scale: sc, unit: def ? def.unit : "" };
    }).filter(Boolean);
  }
  function isCustom(license){
    return rows(license).some(function(r){ return r.license.custom || (r.scale && r.scale.custom); });
  }
  function itemBase(item){
    if (!item || !item.price) return null;               // stale — считать нечем
    var p = item.price;
    var sb = +p.singleBase, exp = +p.singleExponent;
    if (isNaN(sb) || isNaN(exp)) return null;
    if (item.product==="full"){
      if (p.fullBase!=null && !isNaN(+p.fullBase)) return +p.fullBase;
      return sb * Math.pow(Math.max(1, +p.totalInstances||1), exp);
    }
    var n = item.product==="subfamily" ? subCutsOf(item, item.subs).length : item.cuts.length;
    return sb * Math.pow(Math.max(1, n), exp);
  }
  // Σ множителей заказа. Custom-строки (Enterprise, верхний стоп шкалы) в сумму
  // не входят: воркер на них вообще отказывается считать и уводит в запрос цены.
  function licenseSum(license){
    var rs = rows(license), sum = 0;
    for (var i=0;i<rs.length;i++){
      var r = rs[i];
      if (r.license.custom || !r.scale || r.scale.custom) continue;
      sum += r.license.mult * r.scale.mult;
    }
    return sum;
  }
  // license не передан → берём лицензию ГАРНИТУРЫ этой позиции
  function itemPrice(item, license){
    var base = itemBase(item);
    if (base==null) return null;
    return Math.round(base * licenseSum(license || (item && item.slug)));   // одно округление — как в worker.js
  }
  // Разбивка позиции по usage ДЛЯ ПОКАЗА. Считается не независимо, а делением
  // уже известной цены: сначала точные доли, потом наибольшие остатки получают
  // по доллару, пока сумма не сойдётся с total. Иначе билет показывал бы строки,
  // которые не складываются в свой же итог.
  function itemLines(item, license){
    var L = license || (item && item.slug);
    var total = itemPrice(item, L);
    if (total==null) return null;
    var base = itemBase(item), rs = rows(L), out = [], sum = 0;
    rs.forEach(function(r){
      var custom = r.license.custom || !r.scale || r.scale.custom;
      var exact = custom ? 0 : base * r.license.mult * r.scale.mult;
      var floor = custom ? 0 : Math.floor(exact);
      sum += floor;
      out.push({ license:r.license, scale:r.scale, unit:r.unit, custom:custom,
                 exact:exact, amount:floor, rest: custom ? -1 : exact - floor });
    });
    var left = total - sum;
    out.slice().sort(function(a,b){ return b.rest - a.rest; }).forEach(function(l){
      if (left > 0 && !l.custom){ l.amount += 1; left -= 1; }
    });
    return out;
  }
  // Каждая позиция считается по лицензии СВОЕЙ гарнитуры. custom — если хотя бы
  // одна гарнитура ушла в Enterprise или верхний стоп шкалы: считать заказ
  // частично и показать сумму значило бы назвать цену, которой нет.
  // only — считать не весь заказ, а ОДНУ гарнитуру: на странице шрифта покупают
  // её одну, остальное лежит в корзине и оплачивается на /cart.
  function totals(cart, only){
    var c = cart || read() || empty();
    var list = only ? c.items.filter(function(it){ return it.slug===only; }) : c.items;
    var sum = 0, stale = false, custom = false, families = {}, styles = 0;
    list.forEach(function(it){
      families[it.slug] = 1;
      styles += styleCount(it);
      var L = licenseOf(it.slug, c);
      if (isCustom(L)) custom = true;
      var p = itemPrice(it, L);
      if (p==null) stale = true; else sum += p;
    });
    if (!list.length) custom = isCustom(licenseOf(only, c));
    return { total: custom ? null : sum, custom: custom, stale: stale,
             families: Object.keys(families).length, styles: styles,
             currency: (list[0] && list[0].price && list[0].price.currency) || "$" };
  }

  /* ---- домен веб-лицензии --------------------------------------------------
     Живёт здесь, а не на странице: на домен смотрят и билдер, и /cart, и он же
     уезжает в custom_data транзакции, откуда воркер печатает его в LICENSE.md.
     Разъехавшиеся правила «что считать доменом» означали бы, что одна страница
     пускает в оплату то, что другая считает опечаткой. */
  function normDomain(v){
    return String(v||"").trim().toLowerCase()
      .replace(/^[a-z][a-z0-9+.\-]*:\/\//,"")   // scheme
      .replace(/^www\./,"")
      .replace(/[\/?#\s].*$/,"")                // path · query · hash · anything after whitespace
      .replace(/:\d+$/,"")                      // port
      .replace(/\.$/,"")
      .slice(0,120);
  }
  // Намеренно НЕ ascii-only: шрифт.рф и прочие IDN — живые покупатели. Метка
  // может содержать что угодно, кроме разделителей и пунктуации, невозможной в
  // хосте, и не может начинаться или кончаться дефисом. Хотя бы одна точка.
  function validDomain(v){
    v = normDomain(v);
    return /^(?!-)[^\s.\/\\@:,;"'<>()\[\]]+(?:\.(?!-)[^\s.\/\\@:,;"'<>()\[\]]+)+$/.test(v)
      && !/-\./.test(v) && !/-$/.test(v);
  }
  // Домен на весь заказ: он нужен, если ХОТЬ ОДНА гарнитура взята под веб.
  // Без позиций смотрим на значение по умолчанию — так билдер знает, показывать
  // ли поле, ещё до того, как что-то выбрано.
  function webPicked(x){
    var c = read()||empty();
    if (x) return arr(licenseOf(x, c).licenses).indexOf("web")>=0;
    if (!c.items.length) return c.license.licenses.indexOf("web")>=0;
    return c.items.some(function(it){ return arr(licenseOf(it.slug, c).licenses).indexOf("web")>=0; });
  }
  // веб-лицензия выбрана, а домена нет → покупать нечего: сертификат ушёл бы без
  // объекта лицензии, и его пришлось бы перевыпускать руками
  function domainMissing(only){
    return webPicked(only || undefined) && !validDomain((read()||empty()).license.webDomain);
  }

  /* ---- билет: строки и подписи ----------------------------------------------
     Здесь, а не на странице: билет показывают и билдер, и /cart, и расходиться
     в том, ЧТО написано в строке и почему, им нельзя — это те же деньги, только
     словами. Разметку каждая страница рисует свою, а смысл берёт отсюда.

     Раскладка зависит от числа позиций:
       • одна  — строки по usage (привычный вид билдера). Суммы из itemLines():
         при округлении воркера независимо посчитанные строки не сложились бы
         в свой же Total;
       • много — блок на позицию: заголовок с именем гарнитуры и её ценой,
         под ним подписи (состав, имена начертаний, лицензия ЭТОЙ гарнитуры).
         Матрицу «позиции × usage» в 400px не показать, но и в один ряд их
         сваливать нельзя — станет непонятно, что к какой гарнитуре относится.
     opts: {ownSlug, currency, emptyText, emptyCta, buyLabel, staleCta} */
  function esc(x){ return String(x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function itemLabel(it, withFamily){
    var pre = withFamily ? esc(it.family)+" · " : "";
    if(it.product==="full")
      return pre+"<b>Full family</b> · "+((it.price&&it.price.totalInstances)||styleCount(it))+" styles + VF";
    if(it.product==="subfamily")
      return pre+"<b>"+esc(it.subs.join(" + "))+"</b> · "+it.subs.length+
             " sub-famil"+(it.subs.length>1?"ies":"y")+" · "+styleCount(it)+" styles + VF";
    var k=it.cuts.length, base=itemBase(it),
        flat=(it.price?it.price.singleBase:0)*k,
        pct=(base!=null&&flat>0)?Math.round((1-base/flat)*100):0;
    return pre+"<b>"+k+" individual style"+(k>1?"s":"")+"</b>"+(k>1&&pct>0?" · −"+pct+"% volume":"");
  }
  // Имена начертаний в билете: «1 individual style» не говорит КАКОЕ. Пока в
  // заказе одна гарнитура, состав виден слева (сетка или чипы); когда их
  // несколько, билет — единственное место, где позиции стоят рядом, и без имён
  // он не даёт проверить, что куплено именно то. Длинные наборы подрезаем: чек
  // не должен вырасти выше экрана и утащить кнопку вниз.
  function pickedText(it){
    if (!it || it.product!=="single") return "";   // у сабсемей и full состав назван строкой выше
    var n = it.cuts.slice(0,8), rest = it.cuts.length - n.length;
    return n.join(", ") + (rest>0 ? ", +"+rest+" more" : "");
  }
  function deriveTicket(opts){
    opts = opts || {};
    var cart = read() || empty();
    /* only — билет ОДНОЙ гарнитуры. Страница шрифта продаёт свой шрифт: чужие
       позиции там видны быть не должны ни строкой, ни в Total — иначе кнопка
       «Get font» списывала бы деньги за то, что покупатель набирал на другой
       странице и мог ещё передумать. Весь заказ целиком считает /cart. */
    var only = opts.only || null;
    var items = only ? cart.items.filter(function(it){ return it.slug===only; }) : cart.items;
    var own = opts.ownSlug || null;
    // rows — для поля домена и текста инвойса: берём лицензию «своей» гарнитуры
    // на странице шрифта, иначе умолчание
    var rs = rows(licenseOf(own, cart)).filter(function(r){ return !!r.scale; });
    var T = totals(cart, only);
    var custom = T.custom;
    var cur = opts.currency || T.currency || "$";
    var money = function(n){ return cur+Math.round(n).toLocaleString("en-US"); };

    if(!items.length){
      return { items:items, rows:rs, hasCustom:custom, total:0, famCount:0, styleCount:0, stale:false,
               tlines:[{name:opts.emptyText||"Nothing selected yet", val:"", muted:true}],
               priceText:"—", buyLabel:opts.emptyCta||"Choose an option", buyDisabled:true };
    }

    // подпись лицензии одной строкой: «Desktop · 2–5 + Web · ≤100K»
    function useText(L){
      return rows(L).filter(function(r){ return !r.license.custom && r.scale && !r.scale.custom; })
                    .map(function(r){ return r.license.name+" · "+r.scale.name; }).join(" + ");
    }

    var tlines=[], first=true;
    if(items.length===1){
      var it=items[0];
      tlines.push({name:itemLabel(it, it.slug!==own), val:"", muted:true});
      (itemLines(it)||[]).forEach(function(l){
        var nm=l.license.name+(l.scale?" · "+l.scale.name:"");
        if(l.custom){ tlines.push({name:nm, val:"Custom", muted:true}); return; }
        tlines.push({name:nm, val:(first?"":"+ ")+money(l.amount)});
        first=false;
      });
    } else {
      /* Несколько гарнитур — каждая СВОИМ блоком, а не строкой в общем списке.
         Плоским списком билет читался котлом: имя, состав, скидка и лицензия
         стояли одной строкой, а приглушённая подпись лицензии висела между
         позициями и было не видно, чья она. Теперь у гарнитуры заголовок с её
         ценой, а под ним её же подписи: что взято, какие начертания и по какой
         лицензии. Общую подпись «у всех одинаково» не выносим: экономия одной
         строки стоила того, что заказ переставал читаться по гарнитурам. */
      // Блок — на ГАРНИТУРУ, а не на позицию: отдельные начертания и субсемейство
      // одной гарнитуры — это две позиции, но одна покупка и одна лицензия.
      // Заголовком на каждую позицию имя гарнитуры повторялось бы дважды подряд.
      var order=[], groups={};
      items.forEach(function(x){
        if(!groups[x.slug]){
          groups[x.slug]={fam:x.family, use:useText(licenseOf(x.slug, cart)), list:[], sum:0, stale:false};
          order.push(x.slug);
        }
        var g=groups[x.slug], pr=itemPrice(x);
        g.list.push(x);
        if(pr==null) g.stale=true; else g.sum+=pr;
      });
      order.forEach(function(slug, i){
        var g=groups[slug];
        tlines.push({name:"<b>"+esc(g.fam)+"</b>", head:true, gap:i>0,
                     val: g.stale ? "—" : (first?"":"+ ")+money(g.sum)});
        if(!g.stale) first=false;
        g.list.forEach(function(x){
          tlines.push({name:itemLabel(x, false), val:"", sub:true});
          var nm=pickedText(x);
          if(nm) tlines.push({name:esc(nm), val:"", sub:true});
        });
        tlines.push({name:esc(g.use||"Not licensed yet"), val:"", sub:true});
      });
    }
    var anyEnt = items.length
      ? items.some(function(x){ return licenseOf(x.slug, cart).licenses.some(function(id){ var l=licById(id); return l&&l.custom; }); })
      : cart.license.licenses.some(function(id){ var l=licById(id); return l&&l.custom; });
    if(anyEnt) tlines.push({name:"Enterprise", val:"Custom", muted:true});

    var total=T.total||0, priceText, buyLabel, buyDisabled=false;
    if(custom){ priceText="Custom"; buyLabel="Contact us"; }
    // позиция без слепка цен: оценить её можно только там, где есть конфиг
    else if(T.stale){
      var st=items.filter(function(x){ return !!x.stale; })[0];
      priceText="—"; buyDisabled=true;
      buyLabel=(opts.staleCta||"Open {family} to price it").replace("{family}", st?st.family:"the typeface");
    }
    else if(domainMissing(only)){ priceText=total.toLocaleString("en-US"); buyLabel="Add your domain"; buyDisabled=true; }
    else { priceText=total.toLocaleString("en-US"); buyLabel=opts.buyLabel||"Get font"; }

    return { items:items, rows:rs, hasCustom:custom, total:total, famCount:T.families,
             styleCount:T.styles, stale:T.stale, tlines:tlines,
             priceText:priceText, buyLabel:buyLabel, buyDisabled:buyDisabled };
  }

  /* ---- позиция из конфига ---------------------------------------------------
     Одно определение слепка на всех: билдер, /cart, Cuts и Playground кладут
     позиции одной и той же семьи, и собери они price{} по-разному — цена на
     странице шрифта разошлась бы с ценой в корзине.

     `names` НЕ попадает в снимок: он нужен только тому, кто пишет, — сверить,
     что имя начертания существует в мастер-конфиге. Проверка обязана быть у
     каждого писателя: раньше её делал билдер (instByName), и когда на странице
     Archaism остался чужой data-fx-subfamily, клик тихо не срабатывал. Без
     проверки он вместо этого тихо клал бы в корзину несуществующее начертание,
     а всплыло бы это на выдаче файлов после оплаты. */
  function metaFromConfig(slug, cfg){
    if(!cfg || typeof cfg!=="object") return null;
    var tags = cfg.instanceAxes||[], rows = cfg.instances||[];
    var subCuts = {};
    (cfg.subfamilies||[]).forEach(function(sf){
      var k = tags.indexOf(sf.axis);
      subCuts[sf.label] = k<0 ? [] : rows.filter(function(r){ return r[k+1]===sf.value; })
                                        .map(function(r){ return r[0]; });
    });
    var lc = cfg.license||{};
    return {
      slug: String(slug||"").toLowerCase(),
      family: cfg.family || slug,
      names: rows.map(function(r){ return r[0]; }),
      price: {
        currency: lc.currency || "$",
        singleBase: lc.singleBase!=null ? lc.singleBase : 50,
        singleExponent: lc.singleExponent!=null ? lc.singleExponent : 0.75,
        fullBase: lc.fullBase!=null ? lc.fullBase : null,
        totalInstances: rows.length,
        subCuts: subCuts
      }
    };
  }

  /* ---- загрузка конфига -----------------------------------------------------
     Единственное место в сторе, которое ходит в сеть, и это осознанно: имя
     файла на хосте встречается в разном регистре, поэтому кандидатов три
     (slug, Slug, slug.toLowerCase()). Правило одно на всех — четыре копии
     перебора разошлись бы, и один эмбед находил бы конфиг там, где другой нет.
     Промах запоминается как null: 404 не должен превращаться в поток запросов. */
  var CFG_CACHE = {};
  function loadConfig(base, slug){
    slug = String(slug||"");
    if(CFG_CACHE[slug]!==undefined) return Promise.resolve(CFG_CACHE[slug]);
    var cap = slug.charAt(0).toUpperCase()+slug.slice(1);
    var names = [slug, cap, slug.toLowerCase()].filter(function(v,i,a){ return a.indexOf(v)===i; });
    var i = 0;
    function tryNext(){
      if(i>=names.length){ CFG_CACHE[slug]=null; return null; }
      return fetch(String(base||"")+names[i++]+".json", {cache:"no-cache"})
        .then(function(r){ if(!r.ok) throw 0; return r.json(); })
        .then(function(cfg){ CFG_CACHE[slug]=cfg; return cfg; })
        .catch(tryNext);
    }
    return Promise.resolve(tryNext());
  }

  /* ---- что уходит в кассу ---------------------------------------------------
     Собирается здесь, потому что платёж инициируют ДВЕ страницы (билдер и
     /cart), а платят за одно и то же. Разойтись в составе payload значит
     продать разное с одной и той же корзины.

     ⚠️ Совместимость: пока воркер принимает один плоский selection, при ОДНОЙ
     позиции дублируем её поля наверх — существующий create-transaction читает
     именно их. Смешанный заказ он отобьёт, и это правильнее тихого списания за
     половину набора. Когда воркер перейдёт на items[], дубль убрать. */
  // only — платим за одну гарнитуру (страница шрифта). Без него — весь заказ (/cart).
  function checkoutSelection(rs, only){
    var cart = read() || empty();
    var list = only ? cart.items.filter(function(it){ return it.slug===only; }) : cart.items;
    var sel = { v:2,
      items: list.map(function(it){
        return { slug:it.slug, family:String(it.family||it.slug).toLowerCase(), product:it.product,
                 cutNames:it.cuts.slice(), cutCount:it.cuts.length, subfamilies:it.subs.slice(),
                 // ⚠️ лицензия уехала ВНУТРЬ позиции: у каждой гарнитуры своя
                 licenses: rows(licenseOf(it.slug, cart)).filter(function(r){ return !!r.scale; })
                             .map(function(r){ return {id:r.license.id, scaleId:r.scale.id}; }) };
      }),
      licenses: (rs||rows(cart.license)).filter(function(r){ return !!r.scale; })
                  .map(function(r){ return {id:r.license.id, scaleId:r.scale.id}; }),
      webDomain: webPicked(only || cart.license) ? normDomain(cart.license.webDomain) : "" };
    // Совместимость со старым воркером: одна позиция → её поля наверх, включая
    // лицензию именно этой гарнитуры (а не умолчание заказа).
    if(sel.items.length===1){
      var one=sel.items[0];
      sel.licenses=one.licenses;
      sel.family=one.family; sel.product=one.product;
      sel.cutNames=one.cutNames; sel.cutCount=one.cutCount; sel.subfamilies=one.subfamilies;
    }
    return sel;
  }

  /* ---- спецификация для инвойса ---------------------------------------------
     Тот же заказ словами: его выставляют руками из дашборда Paddle, и
     custom_data там заполняется по этому тексту. Живёт рядом с payload, чтобы
     инвойс и чекаут описывали одну и ту же покупку. */
  function invoiceSpec(d, opts){
    opts=opts||{};
    var cur=opts.currency||"$";
    var L=["Request for an invoice — "+(opts.title||"order"),""];
    L.push(d.items.length>1 ? "Order: "+d.famCount+" typefaces · "+d.styleCount+" styles" : "Package:");
    d.items.forEach(function(it){
      var head = it.product==="full"
        ? "Full family (VF + statics) · "+((it.price&&it.price.totalInstances)||styleCount(it))+" styles"
        : it.product==="subfamily"
          ? it.subs.join(" + ")+" · "+it.subs.length+" sub-famil"+(it.subs.length>1?"ies":"y")+" (VF + statics)"
          : it.cuts.length+" individual style"+(it.cuts.length>1?"s":"");
      L.push("  "+it.family+": "+head);
      if(it.product==="single" && it.cuts.length) L.push("    Styles: "+it.cuts.join(", "));
    });
    var dom = normDomain((read()||empty()).license.webDomain);
    L.push("Licensed use:");
    d.rows.forEach(function(r){
      L.push("  - "+r.license.name+" · "+r.scale.name+(r.license.id==="web"?" · "+(dom||"domain to be confirmed"):""));
    });
    L.push("Total: "+cur+d.total.toLocaleString("en-US")+" one-time");
    L.push("","Billing details (please fill in):");
    ["Company name","Billing address","Country","VAT / Tax ID","PO number","E-mail for the license and download"]
      .forEach(function(f){ L.push("  "+f+": "); });
    return L.join("\n");
  }

  /* ---- мутации ------------------------------------------------------------
     Каждая читает хранилище заново: на странице может быть несколько
     потребителей, и правка поверх устаревшего снимка потеряла бы чужую. */
  function find(cart, slug, product){
    for (var i=0;i<cart.items.length;i++)
      if (cart.items[i].slug===slug && cart.items[i].product===product) return cart.items[i];
    return null;
  }
  function drop(cart, slug, product){
    var gone = [];
    cart.items = cart.items.filter(function(it){
      if (it.slug===slug && it.product===product){ gone.push(it); return false; }
      return true;
    });
    return gone;
  }
  // meta = {slug, family, price:{currency, singleBase, singleExponent, fullBase,
  //         totalInstances, subCuts:{label:[names]}}}
  function ensure(cart, meta, product){
    var it = find(cart, meta.slug, product);
    // новая гарнитура в заказе получает лицензию по умолчанию (последнюю
    // выбранную) — иначе её пришлось бы настраивать заново каждый раз
    targetLic(cart, meta.slug);
    if (!it){
      it = { slug:meta.slug, family:meta.family||meta.slug, product:product, cuts:[], subs:[], price:null, stale:true };
      cart.items.push(it);
    }
    if (meta.price){ it.price = meta.price; it.stale = false; }
    if (meta.family) it.family = meta.family;
    return it;
  }
  function hasFull(cart, slug){ return !!find(cart, slug, "full"); }

  function setStyles(meta, names){
    var cart = read() || empty();
    if (hasFull(cart, meta.slug)) return { ok:false, absorbed:"full" };
    names = uniq(arr(names));
    // начертания, уже накрытые выбранными субсемействами, отдельной позицией не
    // продаются: тот же файл, вторая оплата
    var sub = find(cart, meta.slug, "subfamily");
    var covered = {};
    if (sub) subCutsOf(sub, sub.subs).forEach(function(n){ covered[n]=1; });
    var dropped = names.filter(function(n){ return covered[n]; });
    names = names.filter(function(n){ return !covered[n]; });
    if (!names.length){
      var gone = drop(cart, meta.slug, "single");
      if (!gone.length && !dropped.length) return { ok:true, cart:clone(cart) };
      write(cart, "styles");
      return { ok:true, dropped:dropped, cart:clone(cart) };
    }
    var it = ensure(cart, meta, "single");
    it.cuts = names;
    write(cart, "styles");
    return { ok:true, dropped:dropped, cart:clone(cart) };
  }
  function toggleStyle(meta, name){
    var cart = read() || empty();
    var it = find(cart, meta.slug, "single");
    var cur = it ? it.cuts.slice() : [];
    var i = cur.indexOf(name);
    if (i>=0) cur.splice(i,1); else cur.push(name);
    return setStyles(meta, cur);
  }
  function setSubfamilies(meta, labels){
    var cart = read() || empty();
    if (hasFull(cart, meta.slug)) return { ok:false, absorbed:"full" };
    labels = uniq(arr(labels));
    if (!labels.length){
      if (!drop(cart, meta.slug, "subfamily").length) return { ok:true, cart:clone(cart) };
      write(cart, "subfamilies");
      return { ok:true, cart:clone(cart) };
    }
    var it = ensure(cart, meta, "subfamily");
    it.subs = labels;
    // поглощение: отдельные начертания, попавшие внутрь выбранных субсемейств
    var covered = {}, dropped = [];
    subCutsOf(it, labels).forEach(function(n){ covered[n]=1; });
    var single = find(cart, meta.slug, "single");
    if (single){
      dropped = single.cuts.filter(function(n){ return covered[n]; });
      single.cuts = single.cuts.filter(function(n){ return !covered[n]; });
      if (!single.cuts.length) drop(cart, meta.slug, "single");
    }
    write(cart, "subfamilies");
    return { ok:true, dropped:dropped, cart:clone(cart) };
  }
  function toggleSubfamily(meta, label){
    var cart = read() || empty();
    var it = find(cart, meta.slug, "subfamily");
    var cur = it ? it.subs.slice() : [];
    var i = cur.indexOf(label);
    if (i>=0) cur.splice(i,1); else cur.push(label);
    return setSubfamilies(meta, cur);
  }
  function setFull(meta, on){
    var cart = read() || empty();
    if (!on){
      if (!drop(cart, meta.slug, "full").length) return { ok:true, cart:clone(cart) };
      write(cart, "full");
      return { ok:true, cart:clone(cart) };
    }
    // full поглощает всё по этой семье — и это надо сказать вслух
    var dropped = drop(cart, meta.slug, "single").concat(drop(cart, meta.slug, "subfamily"));
    ensure(cart, meta, "full");
    write(cart, "full");
    return { ok:true, dropped:dropped, cart:clone(cart) };
  }
  // Доцепить свежий слепок цен ко всем позициям семьи. Нужен двоим:
  //  • билдеру — позиция могла приехать из миграции без слепка (stale), и до
  //    этого вызова её нечем оценить, хотя конфиг уже в руках;
  //  • странице /cart — она перефетчивает конфиги и обязана считать по ним, а
  //    не по слепку, записанному неделю назад по другим ценам.
  // Пишем только если что-то реально изменилось: лишняя запись разбудила бы
  // подписчиков и соседние вкладки на пустом месте.
  function refresh(meta){
    if (!meta || !meta.slug || !meta.price) return { ok:false };
    var cart = read() || empty(), changed = false;
    cart.items.forEach(function(it){
      if (it.slug !== meta.slug) return;
      if (JSON.stringify(it.price) === JSON.stringify(meta.price) && !it.stale) return;
      it.price = meta.price; it.stale = false;
      if (meta.family) it.family = meta.family;
      changed = true;
    });
    if (!changed) return { ok:true, cart:clone(cart) };
    write(cart, "refresh");
    return { ok:true, changed:true, cart:clone(cart) };
  }
  function removeItem(slug, product){
    var cart = read() || empty();
    if (!drop(cart, slug, product).length) return { ok:true, cart:clone(cart) };
    write(cart, "remove");
    return { ok:true, cart:clone(cart) };
  }
  function removeStyle(slug, name){
    var cart = read() || empty();
    var it = find(cart, slug, "single");
    if (!it || it.cuts.indexOf(name)<0) return { ok:true, cart:clone(cart) };
    it.cuts = it.cuts.filter(function(n){ return n!==name; });
    if (!it.cuts.length) drop(cart, slug, "single");
    write(cart, "remove");
    return { ok:true, cart:clone(cart) };
  }
  function removeFamily(slug){
    var cart = read() || empty();
    var n = cart.items.length;
    cart.items = cart.items.filter(function(it){ return it.slug!==slug; });
    if (cart.items.length===n) return { ok:true, cart:clone(cart) };
    write(cart, "remove-family");
    return { ok:true, cart:clone(cart) };
  }
  // «Remove everything» — это именно начать сначала: лицензии гарнитур уходят
  // вместе с позициями. Иначе набранный заново заказ молча получал бы условия
  // от прошлого, и цена отличалась бы от той, которую человек ожидает.
  // removeFamily, наоборот, лицензию помнит: убрал и вернул — выбор на месте.
  function clearAll(){
    var cart = read() || empty();
    cart.items = [];
    cart.byFamily = {};
    write(cart, "clear");
    return { ok:true, cart:clone(cart) };
  }

  /* Все три правки лицензии принимают slug гарнитуры. Передали — меняем её
     лицензию; не передали — меняем ЗНАЧЕНИЕ ПО УМОЛЧАНИЮ (им наполнится
     следующая добавленная гарнитура). Правка гарнитуры заодно обновляет
     умолчание: «везде одно и то же» должно оставаться одним действием. */
  function targetLic(cart, slug){
    if (!slug) return cart.license;
    slug = String(slug).toLowerCase();
    if (!cart.byFamily[slug])
      cart.byFamily[slug] = { licenses: cart.license.licenses.slice(),
                              scales: JSON.parse(JSON.stringify(cart.license.scales)) };
    return cart.byFamily[slug];
  }
  function setLicenses(ids, slug){
    var cart = read() || empty();
    ids = arr(ids).filter(function(id){ return !!licById(id); });
    if (!ids.length) return { ok:false };
    var L = targetLic(cart, slug);
    L.licenses = ids;
    var keep = {};
    ids.forEach(function(id){
      if (!SCALES[id]) return;
      keep[id] = scaleById(id, L.scales[id]) ? L.scales[id] : defaultScaleId(id);
    });
    L.scales = keep;
    if (slug){ cart.license.licenses = ids.slice(); cart.license.scales = JSON.parse(JSON.stringify(keep)); }
    write(cart, "license");
    return { ok:true, cart:clone(cart) };
  }
  function toggleLicense(id, slug){
    var cart = read() || empty();
    var cur = licenseOf(slug, cart).licenses.slice(), i = cur.indexOf(id);
    if (i>=0){ if (cur.length<2) return { ok:false }; cur.splice(i,1); }
    else cur.push(id);
    return setLicenses(cur, slug);
  }
  function setScale(licId, scaleId, slug){
    var cart = read() || empty();
    if (!scaleById(licId, scaleId)) return { ok:false };
    var L = targetLic(cart, slug);
    L.scales[licId] = scaleId;
    if (slug) cart.license.scales[licId] = scaleId;
    write(cart, "scale");
    return { ok:true, cart:clone(cart) };
  }
  function setWebDomain(s){
    var cart = read() || empty();
    cart.license.webDomain = str(s).slice(0,200);
    write(cart, "domain");
    return { ok:true, cart:clone(cart) };
  }

  /* ---- публичный API ------------------------------------------------------ */
  window.FxCart = {
    KEY: KEY, TTL: TTL,
    LICENSES: LICENSES, SCALES: SCALES, PRODUCTS: PRODUCTS,
    USAGE_FORMATS: USAGE_FORMATS, FORMAT_ORDER: FORMAT_ORDER,
    licById: licById, scaleById: scaleById, defaultScaleId: defaultScaleId,

    get: function(){ return clone(read() || empty()); },
    items: function(){ return (read() || empty()).items; },
    itemsOf: function(slug){ return (read() || empty()).items.filter(function(it){ return it.slug===slug; }); },
    license: function(){ return (read() || empty()).license; },
    isEmpty: function(){ return !(read() || empty()).items.length; },
    styleCount: styleCount,
    subCutsOf: subCutsOf,

    rows: rows, isCustom: isCustom, licenseSum: licenseSum, licenseOf: licenseOf,
    itemBase: itemBase, itemPrice: itemPrice, itemLines: itemLines, totals: totals,
    normDomain: normDomain, validDomain: validDomain, webPicked: webPicked, domainMissing: domainMissing,
    itemLabel: itemLabel, pickedText: pickedText, deriveTicket: deriveTicket, esc: esc,
    checkoutSelection: checkoutSelection, invoiceSpec: invoiceSpec,
    metaFromConfig: metaFromConfig, loadConfig: loadConfig,

    setStyles: setStyles, toggleStyle: toggleStyle, removeStyle: removeStyle,
    setSubfamilies: setSubfamilies, toggleSubfamily: toggleSubfamily,
    setFull: setFull, refresh: refresh,
    removeItem: removeItem, removeFamily: removeFamily, clear: clearAll,
    setLicenses: setLicenses, toggleLicense: toggleLicense, setScale: setScale, setWebDomain: setWebDomain,

    on: function(fn){ if (typeof fn==="function" && subs.indexOf(fn)<0) subs.push(fn); },
    off: function(fn){ subs = subs.filter(function(f){ return f!==fn; }); },

    // только для тестов и для «Start over»: сносит хранилище целиком
    _reset: function(){ rawDel(); lastRev = -1; emit(empty(), "reset"); }
  };

  migrate();
  try { window.dispatchEvent(new CustomEvent("fx:cart:ready")); } catch(e){}
})();
