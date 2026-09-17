/*
  FX ORDER UI — контролы лицензии, общие для License Builder и страницы /cart.

  ЗАЧЕМ. Заказ настраивают в двух местах: на странице шрифта (билдер) и в
  корзине. Карточки usage и капсулы тиража — те же самые, и держать их в двух
  файлах нельзя: капсула это ~90 строк геометрии с отдельно выстраданными
  случаями (тач-прокрутка через ползунок, залипающий :hover, откат по
  pointercancel). Вторая копия разошлась бы с первой на первой же правке.

  ЧТО ВНУТРИ: только контролы лицензии и их CSS. Цена, состав заказа и смысл
  строк билета — в fx-cart.js; разметка страницы — у страницы. Модуль ничего не
  решает про заказ, он читает состояние из FxCart и зовёт колбэки хозяина.

  CSS отдаётся под тот селектор, который передал хозяин (.fx-licb, .fx-cartpage),
  поэтому правила живут в одном месте, а областей видимости может быть сколько
  угодно. Цвета берутся из переменных хозяина (--fx-ink/--fx-paper/--fx-rust).

  Использование:
    FxOrderUI.inject(".fx-cartpage");
    var usage = FxOrderUI.usage(usageEl, extraEl, {onToggle:fn});
    var reach = FxOrderUI.reach(reachEl, {onScale:fn(id,scaleId), afterChange:fn});
    usage.render(); reach.render();
*/
(function(){
  "use strict";
  if (window.FxOrderUI) return;

  function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  /* ---- CSS ----------------------------------------------------------------
     {S} подставляется областью видимости хозяина. Всё, что ниже, переехало из
     embed-license-builder как есть — включая комментарии о том, почему так. */
  var CSS = [
    /* usage cards */
    "{S} .usage{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}",
    /* карточка = кнопка: обводка + паддинг → рыжая заливка (hover) → чёрная (on) */
    "{S} .ucard{font-family:inherit;font-size:inherit;text-align:left;cursor:pointer;border:1px solid var(--fx-ink);border-radius:6px;padding:18px;display:flex;flex-direction:column;gap:8px;min-height:120px;position:relative;transition:color .18s;box-sizing:border-box;}",
    "{S} .ucard::before{content:'';position:absolute;inset:3px;border-radius:3px;background:var(--fx-rust);opacity:0;transition:opacity .18s ease,background .18s ease;pointer-events:none;z-index:0;}",
    "{S} .ucard>*{position:relative;z-index:1;}",
    "{S} .ucard .uname{font-family:var(--fx-sans);font-variation-settings:'wght' 560;font-size:22px;line-height:1;}",
    "{S} .ucard .udesc{line-height:1.5;color:var(--fx-ink-faint);margin-top:auto;}",
    "@media (hover:hover){",
    "  {S} .ucard:hover .uname,{S} .ucard:hover .udesc{color:var(--fx-paper);}",
    "  {S} .ucard:hover::before{opacity:1;}",
    "}",
    "{S} .ucard[aria-pressed='true'] .uname,{S} .ucard[aria-pressed='true'] .udesc{color:var(--fx-paper);}",
    "{S} .ucard[aria-pressed='true']::before{background:var(--fx-ink);opacity:1;}",
    "{S} .usage-extra{display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap;}",
    "{S} .usage-extra .lbl{color:var(--fx-ink-faint);}",

    /* reach = капсула-ползунок с дискретными стопами */
    "{S} .reach{display:flex;flex-direction:column;gap:12px;}",
    "{S} .reach .empty{line-height:1.6;color:var(--fx-ink-faint);padding:18px 0;}",
    "{S} .rcap{position:relative;box-sizing:border-box;width:100%;height:46px;border:1px solid var(--fx-ink);border-radius:6px;overflow:hidden;cursor:ew-resize;}",
    "{S} .rcap .fill{position:absolute;left:3px;top:3px;bottom:3px;width:0;background:var(--fx-rust);border-radius:3px;opacity:0;transition:opacity .2s ease;pointer-events:none;z-index:0;}",
    "{S} .rcap.dragging .fill{opacity:1;}",
    "{S} .rcap .stops{position:absolute;inset:0;pointer-events:none;z-index:1;}",
    "{S} .rcap .stopcap{position:absolute;top:50%;transform:translate(-50%,-50%);color:var(--fx-ink-faint);white-space:nowrap;opacity:0;transition:opacity .15s ease;}",
    /* подписи делений — ТОЛЬКО там, где есть настоящий ховер. На тач-экране
       :hover «залипает» после тапа, и все деления проявлялись разом, наезжая
       друг на друга в кашу (в узкую капсулу они физически не расходятся). */
    "@media (hover:hover){ {S} .rcap:hover .stopcap{opacity:1;} }",
    "{S} .rcap .stopcap.on{opacity:0!important;}",
    "{S} .rcell{display:flex;flex-direction:column;gap:6px;}",
    "{S} .rcap-lab{display:none;color:var(--fx-ink);}",
    "{S} .rcap .rlabel{position:absolute;left:16px;top:50%;transform:translateY(-50%);pointer-events:none;z-index:2;color:var(--fx-ink);transition:color .18s ease;}",
    "{S} .rcap .rval{position:absolute;left:0;top:50%;transform:translateY(-50%);pointer-events:none;z-index:2;white-space:nowrap;color:var(--fx-ink);transition:color .18s ease;}",
    "{S} .rcap.dragging .rlabel,{S} .rcap.dragging .rval{color:var(--fx-paper);}",
    "{S} .rcap .caret{position:absolute;left:0;top:50%;width:1px;height:26px;border-radius:1px;background:var(--fx-ink);transform:translate(-50%,-50%);pointer-events:none;z-index:2;transition:background .18s ease,width .18s ease,height .18s ease,border-radius .18s ease;}",
    "{S} .rcap .caret::after{content:'';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:0;height:0;background:var(--fx-paper);border-radius:1px;transition:width .18s ease,height .18s ease;}",
    "{S} .rcap.dragging .caret{background:var(--fx-rust);width:7px;height:38px;border-radius:4px;}",
    "{S} .rcap.dragging .caret::after{width:1px;height:30px;}",
    /* «активный» вид каретки по ховеру — только там, где есть курсор: на тач-
       экране :hover залипал после того, как палец проехал по капсуле при
       прокрутке, и ползунок навсегда оставался в ржавом «перетаскиваю» виде */
    "@media (hover:hover){",
    "  {S} .rcap:hover .caret{background:var(--fx-rust);width:7px;height:38px;border-radius:4px;}",
    "  {S} .rcap:hover .caret::after{width:1px;height:30px;}",
    "}",
    /* touch-action:pan-y — вертикальный свайп, начавшийся на капсуле, отдаётся
       странице (скролл) и НЕ доезжает до нативного range. Без этого прокрутка
       пальцем через ползунок молча меняла тираж лицензии (и цену). */
    "{S} .rcap input[type=range]{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:ew-resize;z-index:3;-webkit-appearance:none;appearance:none;background:transparent;touch-action:pan-y;}",
    "{S} .rcap input[type=range]:focus{outline:none;}",
    "{S} .rcap input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:7px;height:46px;background:transparent;border:none;cursor:ew-resize;}",
    "@media (max-width:1100px){ {S} .usage{grid-template-columns:repeat(2,1fr);} }",
    "@media (max-width:560px){",
    "  {S} .usage{grid-template-columns:1fr;}",
    /* на узком экране подпись уезжает из капсулы наверх: внутри для неё и
       значения одновременно места уже нет */
    "  {S} .rcap-lab{display:block;}",
    "  {S} .rcap .rlabel{display:none;}",
    "}"
  ].join("\n");

  function inject(scope, id){
    id = id || ("fx-order-ui-"+String(scope).replace(/[^a-z0-9]+/gi,"-"));
    if(document.getElementById(id)) return;
    var st=document.createElement("style"); st.id=id;
    st.textContent=CSS.replace(/\{S\}/g, scope);
    document.head.appendChild(st);
  }

  /* ---- usage cards --------------------------------------------------------
     Порядок и подписи берём из FxCart.LICENSES — та же таблица, что считает
     цену и что лежит в воркере. */
  /* opts.slug — ЧЬЯ лицензия показывается. Лицензия принадлежит гарнитуре:
     дисплейную берут в печать, текстовую на сайт, и общий набор заставлял бы
     купить лишнее. Без slug контролы показывают значение по умолчанию (им
     наполнится следующая добавленная гарнитура). */
  function usage(host, extraHost, opts){
    opts=opts||{};
    function slug(){ return typeof opts.slug==="function" ? opts.slug() : opts.slug; }
    function render(){
      var sel=FxCart.licenseOf(slug()).licenses;
      host.innerHTML = FxCart.LICENSES.filter(function(l){return FxCart.SCALES[l.id];}).map(function(l){
        return '<button class="ucard" type="button" data-u="'+l.id+'" aria-pressed="'+(sel.indexOf(l.id)>=0)+'">'+
          '<div class="uname">'+esc(l.name)+'</div>'+
          '<div class="udesc">'+(l.desc||"")+'</div></button>';
      }).join("");
      host.querySelectorAll(".ucard").forEach(function(c){
        c.addEventListener("click",function(){ if(opts.onToggle) opts.onToggle(c.dataset.u); });
      });
      if(!extraHost) return;
      var ent=FxCart.LICENSES.filter(function(l){return l.custom;})[0];
      extraHost.innerHTML = '<span class="lbl">'+esc(opts.extraLabel||"Bigger footprint?")+'</span>'+
        (ent?'<button class="linkbtn" type="button" data-u="'+ent.id+'" aria-pressed="'+(sel.indexOf(ent.id)>=0)+'"><span>'+esc(ent.name)+' →</span></button>':'');
      var eb=extraHost.querySelector("[data-u]");
      if(eb) eb.addEventListener("click",function(){ if(opts.onToggle) opts.onToggle(eb.dataset.u); });
    }
    return {render:render};
  }

  /* ---- reach: капсулы с дискретными стопами ------------------------------- */
  function reach(host, opts){
    opts=opts||{};
    var sliders=[], key=null;
    function slug(){ return typeof opts.slug==="function" ? opts.slug() : opts.slug; }

    function makeOne(license){
      var def=FxCart.SCALES[license.id], items=def.items;
      var sid=FxCart.licenseOf(slug()).scales[license.id]||items[0].id;
      var idx=Math.max(0,items.findIndex(function(s){return s.id===sid;}));
      var box=document.createElement("div"); box.className="rcap";
      box.innerHTML='<input type="range" min="0" max="'+(items.length-1)+'" step="1"><div class="fill"></div>'+
        '<div class="stops">'+items.map(function(s){return '<span class="stopcap">'+esc(s.cap||s.name)+'</span>';}).join("")+'</div>'+
        '<span class="rlabel"></span><span class="rval"></span><span class="caret"></span>';
      var input=box.querySelector("input"),fill=box.querySelector(".fill"),
          lblEl=box.querySelector(".rlabel"),valEl=box.querySelector(".rval"),caret=box.querySelector(".caret");
      var stops=box.querySelectorAll(".stopcap");
      lblEl.textContent=license.name+" · "+def.unit; input.value=idx;
      function reflow(){
        var v=+input.value,n=items.length; valEl.textContent=items[v].name;
        var w=box.clientWidth;if(!w)return;
        var edge=3,half=3.5,thumbW=7,labelEnd=16+lblEl.offsetWidth,insetL=labelEnd+12+64;
        // нативный range прижимаем к видимой дорожке, чтобы значение совпадало с курсором
        var inputW=Math.max(40,w-edge-insetL);
        input.style.left=insetL+"px"; input.style.right="auto"; input.style.width=inputW+"px";
        function xOf(i){ return insetL+thumbW/2+(n>1?i/(n-1):0)*(inputW-thumbW); }
        var caretX=xOf(v);
        caret.style.left=caretX+"px";fill.style.width=Math.max(0,caretX+half-edge)+"px";
        valEl.style.left=Math.max(labelEnd+12,caretX-12-valEl.offsetWidth)+"px";
        for(var i=0;i<stops.length;i++){
          var cw=(stops[i].offsetWidth||24)/2;                       // подписи не должны вылезать из капсулы
          stops[i].style.left=Math.min(w-cw-6,Math.max(cw+6,xOf(i)))+"px";
          stops[i].classList.toggle("on",i===v);
        }
      }
      function set(i){ if(opts.onScale) opts.onScale(license.id, items[i].id); reflow(); if(opts.afterChange) opts.afterChange(); }
      input.addEventListener("input",function(){ set(+input.value); });
      var atDown=idx;
      box.addEventListener("pointerdown",function(){ atDown=+input.value; box.classList.add("dragging"); });
      // жест отменён браузером (палец поехал вертикально → прокрутка): откатываем
      // значение. Нативный range успевает «прыгнуть» на точку касания ДО того,
      // как браузер решит, что это скролл — из-за этого прокрутка страницы через
      // капсулу молча меняла тираж и цену.
      box.addEventListener("pointercancel",function(){
        if(+input.value===atDown) return;
        input.value=atDown; set(atDown);
      });
      sliders.push(reflow);
      /* Капсула едет в обёртке вместе с дублем подписи. На десктопе дубль
         скрыт (подпись внутри капсулы), на ≤560px наоборот. */
      var cell=document.createElement("div"); cell.className="rcell";
      var lab=document.createElement("div"); lab.className="rcap-lab";
      lab.textContent=lblEl.textContent;
      cell.appendChild(lab); cell.appendChild(box);
      return cell;
    }

    function render(){
      var sel=FxCart.licenseOf(slug()).licenses;
      var rows=FxCart.LICENSES.filter(function(l){ return sel.indexOf(l.id)>=0 && FxCart.SCALES[l.id]; });
      // Капсулы пересобираются ТОЛЬКО когда меняется набор выбранных лицензий.
      // Раньше любой посторонний клик стирал .reach и строил ползунки заново:
      // позиция каретки восстанавливалась асинхронно, в rAF, и на тач-экране это
      // читалось как «ползунок дёргается сам по себе». Значение живёт в сторе,
      // от пропуска перерисовки не теряется.
      var k=String(slug()||"")+"|"+rows.map(function(l){return l.id;}).join(",");
      if(k===key) return;
      key=k;
      host.innerHTML=""; sliders=[];
      if(!rows.length){ host.innerHTML='<div class="empty">// select a usage above to set its reach</div>'; return; }
      rows.forEach(function(l){ host.appendChild(makeOne(l)); });
      // Раскладка каретки и делений считается по ИЗМЕРЕННОЙ ширине подписи,
      // поэтому одного прохода мало:
      //  • синхронно — чтобы капсула не оставалась пустой, если rAF заморожен
      //    (фоновая вкладка) или не выстрелит вовсе;
      //  • в rAF — после первой раскладки страницы;
      //  • с задержкой — веб-шрифт мог доехать позже и сдвинуть подпись, а с
      //    ней и всю геометрию трека.
      var run=function(){ for(var i=0;i<sliders.length;i++) sliders[i](); };
      run();
      if(window.requestAnimationFrame) requestAnimationFrame(run);
      setTimeout(run, 80);
    }
    function reflow(){ for(var i=0;i<sliders.length;i++) sliders[i](); }

    // pointercancel обязателен: на тач-экране жест, начавшийся на капсуле и
    // перешедший в прокрутку страницы, заканчивается НЕ pointerup. Без этого
    // класс .dragging оставался навсегда — ползунок залипал в «ржавом» виде.
    function endDrag(){
      var d=host.querySelectorAll(".rcap.dragging");
      for(var i=0;i<d.length;i++) d[i].classList.remove("dragging");
    }
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);
    window.addEventListener("resize", reflow);

    return {render:render, reflow:reflow};
  }

  window.FxOrderUI = { inject:inject, usage:usage, reach:reach, css:function(scope){ return CSS.replace(/\{S\}/g, scope); } };
  try { window.dispatchEvent(new CustomEvent("fx:order-ui:ready")); } catch(e){}
})();
