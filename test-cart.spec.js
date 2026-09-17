/*
  Проверки стора корзины. Один файл на два прогона:
    node test-cart.node.js                     — быстро, в CI, без браузера
    http://…/webflow/store/test-cart.html      — в реальном Chrome, с настоящим
                                                 localStorage и событиями
  Хост даёт окружение: { t, grp, reload, done }. reload(cb) переподнимает
  модуль с нуля — нужен только тесту миграции, который проверяет ПЕРВЫЙ заход
  на страницу после обновления.

  Главное здесь — ПАРИТЕТ С ВОРКЕРОМ: computePrice ниже скопирован из
  framer/code-components/worker.js дословно. Разошлось — значит витрина обещает
  одну сумму, а Paddle выставляет другую.
*/
(function(root){
  /* ── worker.js, дословно ───────────────────────────────────────────────── */
  var SINGLE_BASE=50, FULL_BASE=1380, SINGLE_EXPONENT=0.75;
  var LICENSE_MULT={desktop:1.0,web:1.2,app:1.5,broad:1.8,ent:0};
  var SCALE_MULT={
    desktop:{"1":1.0,"2-5":2.5,"6-10":4.0,"11-25":7.0,"26-50":11.0,"50+":0},
    web:{"10k":1.0,"100k":2.0,"500k":3.5,"1m":5.0,"5m":8.0,"5m+":0},
    app:{"1k":1.0,"10k":2.5,"100k":5.0,"1m":10.0,"1m+":0},
    broad:{regional:1.0,national:2.5,intl:5.0,global:10.0,unlim:0}};
  var CUSTOM_SCALES={desktop:["50+"],web:["5m+"],app:["1m+"],broad:["unlim"]};
  var SUBFAMILY_CUT_COUNT=21;
  function workerPrice(s){
    var hasCustomLicense=s.licenses.some(function(l){return l.id==="ent";});
    var hasCustomScale=s.licenses.some(function(l){return (CUSTOM_SCALES[l.id]||[]).indexOf(l.scaleId)>=0;});
    if(hasCustomLicense||hasCustomScale||s.licenses.length===0) return {custom:true,priceUsd:0};
    var base,cutMult;
    if(s.product==="full"){ base=FULL_BASE; cutMult=1; }
    else if(s.product==="subfamily"){ base=SINGLE_BASE; cutMult=Math.pow(SUBFAMILY_CUT_COUNT*Math.max(1,(s.subfamilies||[]).length),SINGLE_EXPONENT); }
    else { base=SINGLE_BASE; cutMult=Math.pow(Math.max(1,s.cutCount),SINGLE_EXPONENT); }
    var licenseSum=s.licenses.reduce(function(a,l){ return a+(LICENSE_MULT[l.id]||0)*((SCALE_MULT[l.id]||{})[l.scaleId]||0); },0);
    return {custom:false,priceUsd:Math.round(base*cutMult*licenseSum)};
  }

  root.FxCartSpec = function(env){
    var t=env.t, grp=env.grp, C=root.FxCart, LS=env.storage;
    function ok(name,cond){ t(name, !!cond, true); }
    function reset(){ C._reset(); }

    // Fluxetype-подобный слепок: 4 субсемейства × 21 начертание
    var SUBS={};
    ["Caption","Text","Title","Display"].forEach(function(lab){
      SUBS[lab]=[]; for(var i=0;i<21;i++) SUBS[lab].push(lab+" cut "+i);
    });
    var FLUX={ slug:"fluxetype", family:"Fluxetype",
      price:{ currency:"$", singleBase:50, singleExponent:0.75, fullBase:1380, totalInstances:84, subCuts:SUBS } };
    var ARCH={ slug:"archaism", family:"Archaism",
      price:{ currency:"$", singleBase:50, singleExponent:0.75, fullBase:null, totalInstances:9, subCuts:{} } };

    grp("схема и пустое состояние");
    reset();
    ok("стор поднялся", !!C);
    t("пустая корзина", C.isEmpty(), true);
    t("лицензия по умолчанию", C.license(), {licenses:["desktop"],scales:{desktop:"1"},webDomain:""});
    t("итог пустой корзины", C.totals().total, 0);

    grp("позиции: single");
    C.setStyles(FLUX, ["Text cut 0","Text cut 1"]);
    t("одна позиция", C.items().length, 1);
    t("состав", C.items()[0].cuts, ["Text cut 0","Text cut 1"]);
    t("product", C.items()[0].product, "single");
    C.toggleStyle(FLUX, "Text cut 2");
    t("toggle добавил", C.items()[0].cuts.length, 3);
    C.toggleStyle(FLUX, "Text cut 2");
    t("toggle убрал", C.items()[0].cuts.length, 2);
    C.setStyles(FLUX,["A","A","B"]);
    t("дубли схлопываются", C.items()[0].cuts, ["A","B"]);
    C.setStyles(FLUX, []);
    t("пустой список = нет позиции", C.items().length, 0);

    grp("смешивание — то, чего не умел радио S.product");
    reset();
    C.setSubfamilies(FLUX, ["Text"]);
    C.setStyles(FLUX, ["Display cut 0","Display cut 1"]);
    t("две позиции одной семьи", C.items().length, 2);
    t("субсемейство", C.itemsOf("fluxetype").filter(function(i){return i.product==="subfamily";})[0].subs, ["Text"]);
    t("отдельные начертания", C.itemsOf("fluxetype").filter(function(i){return i.product==="single";})[0].cuts, ["Display cut 0","Display cut 1"]);
    t("начертаний в заказе (21+2)", C.totals().styles, 23);

    grp("поглощение");
    reset();
    C.setStyles(FLUX, ["Text cut 0","Display cut 0"]);
    t("субсемейство поглотило своё начертание", C.setSubfamilies(FLUX, ["Text"]).dropped, ["Text cut 0"]);
    t("чужое начертание осталось", C.itemsOf("fluxetype").filter(function(i){return i.product==="single";})[0].cuts, ["Display cut 0"]);
    t("накрытое не добавить заново", C.setStyles(FLUX,["Display cut 0","Text cut 5"]).dropped, ["Text cut 5"]);
    t("full поглотил обе позиции", C.setFull(FLUX, true).dropped.length, 2);
    t("осталась одна позиция", C.itemsOf("fluxetype").length, 1);
    t("и это full", C.items()[0].product, "full");
    t("при full добавление отбивается", C.setStyles(FLUX,["Text cut 0"]).absorbed, "full");
    t("и субсемейство тоже", C.setSubfamilies(FLUX,["Title"]).absorbed, "full");
    C.setFull(FLUX,false);
    t("снятие full очищает семью", C.items().length, 0);

    grp("несколько гарнитур");
    reset();
    C.setStyles(FLUX, ["Text cut 0"]);
    C.setStyles(ARCH, ["Ct0Wd0","Ct1Wd0"]);
    t("две семьи", C.totals().families, 2);
    t("поглощение не течёт между семьями", C.itemsOf("fluxetype").length, 1);
    C.removeFamily("fluxetype");
    t("removeFamily убрал только свою", C.items().map(function(i){return i.slug;}), ["archaism"]);
    C.removeStyle("archaism","Ct0Wd0");
    t("removeStyle оставил второе", C.items()[0].cuts, ["Ct1Wd0"]);
    C.removeStyle("archaism","Ct1Wd0");
    t("последнее удалённое убирает позицию", C.items().length, 0);

    grp("цена = worker.js");
    function parity(label, mut, wsel, slug){
      reset(); mut();
      slug = slug || "fluxetype";
      // лицензия задаётся ГАРНИТУРЕ — так же, как это делает страница шрифта
      C.setLicenses(wsel.licenses.map(function(l){return l.id;}), slug);
      wsel.licenses.forEach(function(l){ C.setScale(l.id, l.scaleId, slug); });
      var w=workerPrice(wsel);
      if(w.custom) t(label+" → custom", C.totals().total, null);
      else t(label+" → $"+w.priceUsd, C.totals().total, w.priceUsd);
    }
    parity("1 style · desktop 1", function(){C.setStyles(FLUX,["A"]);},
      {product:"single",cutCount:1,licenses:[{id:"desktop",scaleId:"1"}]});
    parity("7 styles · desktop 11–25", function(){C.setStyles(FLUX,["a","b","c","d","e","f","g"]);},
      {product:"single",cutCount:7,licenses:[{id:"desktop",scaleId:"11-25"}]});
    parity("23 styles · desktop+web", function(){ var n=[]; for(var i=0;i<23;i++)n.push("s"+i); C.setStyles(FLUX,n);},
      {product:"single",cutCount:23,licenses:[{id:"desktop",scaleId:"2-5"},{id:"web",scaleId:"100k"}]});
    parity("1 sub-family · desktop 1", function(){C.setSubfamilies(FLUX,["Text"]);},
      {product:"subfamily",subfamilies:["Text"],licenses:[{id:"desktop",scaleId:"1"}]});
    parity("2 sub-families · web 500k", function(){C.setSubfamilies(FLUX,["Text","Title"]);},
      {product:"subfamily",subfamilies:["Text","Title"],licenses:[{id:"web",scaleId:"500k"}]});
    parity("full · desktop 26–50", function(){C.setFull(FLUX,true);},
      {product:"full",licenses:[{id:"desktop",scaleId:"26-50"}]});
    parity("full · все четыре usage", function(){C.setFull(FLUX,true);},
      {product:"full",licenses:[{id:"desktop",scaleId:"6-10"},{id:"web",scaleId:"1m"},{id:"app",scaleId:"10k"},{id:"broad",scaleId:"national"}]});
    parity("custom scale → запрос цены", function(){C.setFull(FLUX,true);},
      {product:"full",licenses:[{id:"desktop",scaleId:"50+"}]});
    // заказ из двух семей = сумма двух независимых кривых
    reset();
    C.setStyles(FLUX,["a","b","c"]); C.setStyles(ARCH,["x","y"]);
    ["fluxetype","archaism"].forEach(function(sl){ C.setLicenses(["desktop"],sl); C.setScale("desktop","2-5",sl); });
    var wFlux=workerPrice({product:"single",cutCount:3,licenses:[{id:"desktop",scaleId:"2-5"}]}).priceUsd;
    var wArch=workerPrice({product:"single",cutCount:2,licenses:[{id:"desktop",scaleId:"2-5"}]}).priceUsd;
    t("две семьи = сумма их цен ($"+wFlux+"+$"+wArch+")", C.totals().total, wFlux+wArch);

    grp("строки билета сходятся с итогом");
    (function(){
      var combos=[
        [["desktop","1"]],
        [["desktop","2-5"],["web","100k"]],
        [["desktop","11-25"],["web","5m"],["app","1m"]],
        [["desktop","6-10"],["web","500k"],["app","100k"],["broad","global"]]
      ];
      var bad=0, checked=0;
      combos.forEach(function(cmb){
        [["single",["a","b","c"]],["subfamily",["Text","Title"]],["full",null]].forEach(function(mode){
          reset();
          if(mode[0]==="single") C.setStyles(FLUX, mode[1]);
          else if(mode[0]==="subfamily") C.setSubfamilies(FLUX, mode[1]);
          else C.setFull(FLUX,true);
          C.setLicenses(cmb.map(function(x){return x[0];}));
          cmb.forEach(function(x){ C.setScale(x[0],x[1]); });
          var it=C.items()[0], lines=C.itemLines(it), total=C.itemPrice(it);
          var sum=lines.reduce(function(a,l){return a+l.amount;},0);
          checked++;
          if(sum!==total) bad++;
        });
      });
      t("проверено "+checked+" разбивок, расхождений", bad, 0);
    })();

    grp("лицензия");
    reset(); C.setStyles(FLUX,["a"]);
    C.toggleLicense("desktop");
    t("нельзя снять последнюю", C.license().licenses, ["desktop"]);
    C.toggleLicense("web");
    t("web добавился со своим дефолтом", C.license().scales.web, "10k");
    C.toggleLicense("web");
    t("и снялся вместе со шкалой", C.license().scales.web, undefined);
    t("несуществующая шкала отбивается", C.setScale("desktop","nope").ok, false);
    C.setWebDomain("https://Example.com/x");
    t("домен сохранён как введён (нормализует воркер)", C.license().webDomain, "https://Example.com/x");

    grp("домен веб-лицензии");
    t("схема и путь срезаются", C.normDomain("HTTPS://www.Example.com/x?y=1"), "example.com");
    t("порт и точка в конце срезаются", C.normDomain("example.com.:8080"), "example.com");
    t("обычный домен валиден", C.validDomain("acme.co.uk"), true);
    t("IDN валиден (шрифт.рф — живой покупатель)", C.validDomain("шрифт.рф"), true);
    t("без точки — не домен", C.validDomain("localhost"), false);
    t("дефис на границе метки — не домен", C.validDomain("-acme.com"), false);
    reset(); C.setStyles(FLUX,["a"]);
    t("без Web-лицензии домен не требуется", C.domainMissing(), false);
    C.toggleLicense("web","fluxetype");
    t("с Web и пустым доменом — покупать нельзя", C.domainMissing(), true);
    C.setWebDomain("acme.com");
    t("домен введён — можно", C.domainMissing(), false);

    grp("лицензия заказа (/cart выбирает сразу для всех)");
    reset();
    C.setStyles(FLUX,["a","b"]); C.setStyles(ARCH,["x"]);
    t("пока у всех одна — не mixed", C.orderLicense().mixed, false);
    C.toggleLicense("web","fluxetype");
    t("правка одной гарнитуры → mixed", C.orderLicense().mixed, true);
    t("и чужая гарнитура не тронута", C.licenseOf("archaism").licenses, ["desktop"]);
    C.setLicensesAll(["desktop","web"]);
    t("применили ко всем — mixed снят", C.orderLicense().mixed, false);
    t("обе гарнитуры под web", [C.licenseOf("fluxetype").licenses, C.licenseOf("archaism").licenses],
      [["desktop","web"],["desktop","web"]]);
    t("умолчание тоже выровнено", C.license().licenses, ["desktop","web"]);
    C.setScaleAll("desktop","2-5");
    t("тираж ушёл во все", [C.licenseOf("fluxetype").scales.desktop, C.licenseOf("archaism").scales.desktop],
      ["2-5","2-5"]);
    C.toggleLicenseAll("web");
    t("toggleAll снял web у всех", [C.licenseOf("fluxetype").licenses, C.licenseOf("archaism").licenses],
      [["desktop"],["desktop"]]);
    t("последнюю лицензию снять нельзя", C.toggleLicenseAll("desktop").ok, false);

    grp("билет (deriveTicket)");
    reset();
    t("пустой заказ", C.deriveTicket({emptyText:"Nothing yet",emptyCta:"Pick"}).buyLabel, "Pick");
    C.setStyles(FLUX,["a","b","c"]);
    var d1=C.deriveTicket({ownSlug:"fluxetype"});
    t("одна позиция: строки по usage", d1.tlines.length, 2);
    t("первая строка — что покупаешь", /3 individual styles/.test(d1.tlines[0].name), true);
    t("вторая — usage с ценой", d1.tlines[1].val, "$"+C.totals().total.toLocaleString("en-US"));
    t("своя семья не подписана именем", /Fluxetype/.test(d1.tlines[0].name), false);
    var d1b=C.deriveTicket({ownSlug:"archaism"});
    t("чужая — подписана", /Fluxetype/.test(d1b.tlines[0].name), true);
    C.setStyles(ARCH,["x","y"]);
    var d2=C.deriveTicket({ownSlug:"fluxetype"});
    // блок на гарнитуру: заголовок + состав + имена начертаний + лицензия
    t("две позиции: по блоку на гарнитуру", d2.tlines.length, 8);
    t("итог совпадает с totals", d2.total, C.totals().total);
    t("заголовок блока — имя гарнитуры", d2.tlines[0].name, "<b>Fluxetype</b>");
    t("и он несёт цену позиции", d2.tlines[0].val, "$"+C.itemPrice(C.items()[0]).toLocaleString("en-US"));
    t("под ним — что взято", /3 individual styles/.test(d2.tlines[1].name), true);
    t("и какие именно начертания", d2.tlines[2].name, "a, b, c");
    t("лицензия — внутри блока своей гарнитуры", d2.tlines[3].name, "Desktop · 1 user");
    t("второй блок начинается отбивкой", d2.tlines[4].gap, true);
    t("и это вторая гарнитура", d2.tlines[4].name, "<b>Archaism</b>");
    // одинаковая лицензия больше НЕ выносится общей строкой в конец: заказ
    // должен читаться по гарнитурам, даже если подпись повторяется
    t("лицензия повторена у второй", d2.tlines[7].name, "Desktop · 1 user");
    // две позиции одной гарнитуры — это одна покупка: заголовок один, цена общая
    C.setSubfamilies(FLUX,["Text"]);
    var d3=C.deriveTicket({});
    t("две позиции одной гарнитуры — один заголовок", d3.tlines.filter(function(l){return l.head;}).length, 2);
    t("в заголовке — сумма по гарнитуре", d3.tlines[0].val,
      "$"+C.itemsOf("fluxetype").reduce(function(a,x){return a+C.itemPrice(x);},0).toLocaleString("en-US"));
    t("обе позиции названы под ним", /sub-famil/.test(d3.tlines[3].name), true);
    C.setSubfamilies(FLUX,[]);
    t("имена подрезаны на восьмом", C.pickedText({product:"single",cuts:["1","2","3","4","5","6","7","8","9"]}),
      "1, 2, 3, 4, 5, 6, 7, 8, +1 more");
    t("у full family имён нет", C.pickedText({product:"full",cuts:[]}), "");
    /* only — билет страницы шрифта: она продаёт СВОЙ шрифт, остальное лежит в
       заказе и оплачивается на /cart. Раньше кнопка «Get font» на странице
       Polytype списывала бы деньги и за Fluxetype, набранный на другой странице. */
    var dOnly=C.deriveTicket({only:"archaism", ownSlug:"archaism"});
    t("only: в билете одна гарнитура", dOnly.items.length, 1);
    t("only: Total — только её", dOnly.total, C.itemPrice(C.itemsOf("archaism")[0]));
    t("only: заголовков блоков нет — позиция одна", dOnly.tlines.filter(function(l){return l.head;}).length, 0);
    t("only: чекаут платит за неё одну", C.checkoutSelection(null,"archaism").items.length, 1);
    t("без only чекаут платит за весь заказ", C.checkoutSelection(null).items.length, C.items().length);
    // домен — тоже по своему заказу: web у чужой гарнитуры не должен блокировать
    // кнопку на странице, где web не взят
    C.toggleLicense("web","fluxetype");
    t("web у чужой: заказу домен нужен", C.domainMissing(), true);
    t("а странице archaism — нет", C.domainMissing("archaism"), false);
    C.toggleLicense("web","fluxetype");
    // Enterprise включаем ГАРНИТУРЕ: правка умолчания не должна задним числом
    // менять цену того, что уже лежит в заказе
    C.toggleLicense("ent","fluxetype");
    t("Enterprise → Custom", C.deriveTicket({}).priceText, "Custom");
    t("и кнопка ведёт к разговору", C.deriveTicket({}).buyLabel, "Contact us");
    t("а умолчание при этом не тронуто", C.license().licenses.indexOf("ent")>=0, true);

    grp("позиция из конфига (metaFromConfig)");
    var CFG={ family:"Fluxetype",
      instanceAxes:["CTRS","XHGT","wght"],
      instances:[["Caption Petit Thin",0,0,100],["Caption Petit Bold",0,0,700],
                 ["Text Petit Thin",25,0,100],["Text Petit Bold",25,0,700]],
      subfamilies:[{slug:"fluxetype-caption",label:"Caption",axis:"CTRS",value:0},
                   {slug:"fluxetype-text",label:"Text",axis:"CTRS",value:25}],
      license:{currency:"$",singleBase:50,singleExponent:0.75,fullBase:1380} };
    var m=C.metaFromConfig("Fluxetype", CFG);
    t("slug приводится к нижнему регистру", m.slug, "fluxetype");
    t("имя семьи из конфига", m.family, "Fluxetype");
    t("субсемейства нарезаны по оси", m.price.subCuts.Caption, ["Caption Petit Thin","Caption Petit Bold"]);
    t("и второе тоже", m.price.subCuts.Text, ["Text Petit Thin","Text Petit Bold"]);
    t("всего начертаний", m.price.totalInstances, 4);
    t("цены из license{}", [m.price.singleBase,m.price.fullBase], [50,1380]);
    t("names для сверки имён — вне снимка", m.names.length, 4);
    var bare=C.metaFromConfig("archaism", {family:"Archaism", instanceAxes:["wdth"], instances:[["Ct0Wd0",35]]});
    t("без subfamilies — пустая карта", bare.price.subCuts, {});
    t("дефолты цен, когда license{} нет", [bare.price.singleBase, bare.price.singleExponent, bare.price.fullBase], [50,0.75,null]);
    t("мусор на вход — null", C.metaFromConfig("x", null), null);
    reset();
    C.setStyles(m, ["Caption Petit Thin","Caption Petit Bold"]);
    t("позиция из такого меты считается", C.totals().total, Math.round(50*Math.pow(2,0.75)));
    C.toggleSubfamily(m, "Caption");
    t("и поглощение работает по её subCuts", C.itemsOf("fluxetype").length, 1);

    grp("лицензия — по гарнитуре, а не на весь заказ");
    reset();
    C.setStyles(FLUX,["a","b"]); C.setStyles(ARCH,["x"]);
    C.setLicenses(["desktop"],"fluxetype"); C.setScale("desktop","1","fluxetype");
    var fluxOnly=C.totals().total;
    C.setLicenses(["web"],"archaism"); C.setScale("web","100k","archaism");
    t("у гарнитур разные лицензии", [C.licenseOf("fluxetype").licenses, C.licenseOf("archaism").licenses],
      [["desktop"],["web"]]);
    t("правка одной не трогает другую", C.licenseOf("fluxetype").licenses, ["desktop"]);
    var base2=Math.round(50*Math.pow(2,0.75));
    t("Fluxetype считается по desktop·1", C.itemPrice(C.itemsOf("fluxetype")[0]), base2);
    t("Archaism — по web·100k", C.itemPrice(C.itemsOf("archaism")[0]), Math.round(50*1*1.2*2.0));
    t("итог — сумма по своим лицензиям", C.totals().total,
      base2 + Math.round(50*1*1.2*2.0));
    t("итог изменился после правки только одной", C.totals().total!==fluxOnly, true);
    // новая гарнитура наследует последнюю выбранную лицензию
    C.setStyles({slug:"third",family:"Third",price:FLUX.price},["q"]);
    t("новая гарнитура берёт умолчание (последнее выбранное)", C.licenseOf("third").licenses, ["web"]);
    t("домен нужен, если ХОТЬ ОДНА гарнитура взята под веб", C.domainMissing(), true);
    C.setWebDomain("acme.com");
    t("домен один на заказ — закрывает всех", C.domainMissing(), false);
    C.toggleLicense("ent","archaism");
    t("Enterprise у одной гарнитуры делает весь заказ custom", C.totals().custom, true);

    t("removeFamily помнит лицензию (убрал и вернул)",
      (C.setLicenses(["app"],"archaism"), C.removeFamily("archaism"),
       C.setStyles(ARCH,["x"]), C.licenseOf("archaism").licenses), ["app"]);
    t("а «очистить всё» сбрасывает и лицензии семей",
      (C.clear(), C.setStyles(ARCH,["x"]), C.licenseOf("archaism").licenses),
      C.license().licenses);

    grp("миграция со старой схемы (одна лицензия на заказ)");
    reset();
    LS.setItem(C.KEY, JSON.stringify({v:1,t:Date.now(),rev:1,
      license:{licenses:["desktop","web"],scales:{desktop:"2-5",web:"100k"},webDomain:"acme.com"},
      items:[{slug:"fluxetype",family:"Fluxetype",product:"single",cuts:["a"],price:FLUX.price},
             {slug:"archaism",family:"Archaism",product:"single",cuts:["x"],price:ARCH.price}]}));
    t("лицензия заказа роздана обеим гарнитурам",
      [C.licenseOf("fluxetype").licenses, C.licenseOf("archaism").licenses],
      [["desktop","web"],["desktop","web"]]);
    t("и шкалы тоже", C.licenseOf("archaism").scales, {desktop:"2-5",web:"100k"});
    t("домен пережил миграцию", C.license().webDomain, "acme.com");

    grp("payload для кассы");
    reset(); C.setStyles(FLUX,["a","b"]);
    var sel1=C.checkoutSelection();
    t("одна позиция: поля продублированы наверх (старый воркер)", [sel1.product, sel1.cutCount], ["single",2]);
    t("и лежат в items[]", sel1.items.length, 1);
    t("версия payload", sel1.v, 2);
    C.setStyles(ARCH,["x"]);
    var sel2=C.checkoutSelection();
    t("две позиции: дубля наверху нет", sel2.product, undefined);
    t("обе в items[]", sel2.items.map(function(i){return i.slug;}), ["fluxetype","archaism"]);
    t("лицензия в payload", sel2.licenses, [{id:"desktop",scaleId:"1"}]);
    C.toggleLicense("web"); C.setWebDomain("https://WWW.Acme.com/pricing");
    t("домен нормализован для воркера", C.checkoutSelection().webDomain, "acme.com");
    t("без Web домен не уезжает", (C.toggleLicense("web"), C.checkoutSelection().webDomain), "");

    grp("устойчивость хранилища");
    reset(); C.setStyles(FLUX,["a"]);
    LS.setItem(C.KEY, "{не json");
    t("битый JSON → пустая корзина", C.isEmpty(), true);
    LS.setItem(C.KEY, JSON.stringify({v:1,t:Date.now()-15*24*3600*1000,rev:1,
      license:{licenses:["desktop"],scales:{},webDomain:""},
      items:[{slug:"x",family:"X",product:"single",cuts:["a"]}]}));
    t("протухший снимок выброшен", C.isEmpty(), true);
    LS.setItem(C.KEY, JSON.stringify({v:1,t:Date.now(),rev:1,
      license:{licenses:["nope"],scales:{},webDomain:""},
      items:[{slug:"x",family:"X",product:"single",cuts:["a"]},
             {slug:"y",product:"weird",cuts:["b"]},
             {slug:"z",product:"single",cuts:[]}, null]}));
    t("мусорные позиции отсеяны", C.items().map(function(i){return i.slug;}), ["x"]);
    t("несуществующая лицензия → дефолт", C.license().licenses, ["desktop"]);
    t("позиция без слепка помечена stale", C.items()[0].stale, true);
    t("stale не даёт цены", C.itemPrice(C.items()[0]), null);
    t("но и не роняет итог", C.totals().stale, true);

    grp("refresh — доцепить слепок цен");
    reset();
    LS.setItem(C.KEY, JSON.stringify({v:1,t:Date.now(),rev:1,
      license:{licenses:["desktop"],scales:{desktop:"1"},webDomain:""},
      items:[{slug:"fluxetype",family:"Fluxetype",product:"single",cuts:["a","b","c"]}]}));
    t("до refresh позиция не оценивается", C.itemPrice(C.items()[0]), null);
    C.refresh(FLUX);
    t("после refresh stale снят", C.items()[0].stale, false);
    t("и цена появилась", C.totals().total, Math.round(50*Math.pow(3,0.75)));
    t("повторный refresh ничего не пишет", C.refresh(FLUX).changed, undefined);
    t("чужую семью не трогает", C.refresh(ARCH).changed, undefined);

    grp("правка поверх чужой записи (вторая вкладка / второй эмбед)");
    reset(); C.setStyles(FLUX,["a"]);
    var snap=JSON.parse(LS.getItem(C.KEY));
    snap.items.push({slug:"archaism",family:"Archaism",product:"single",cuts:["Ct0Wd0"],price:ARCH.price});
    snap.rev=99; LS.setItem(C.KEY, JSON.stringify(snap));     // «другая вкладка» дописала
    C.toggleStyle(FLUX,"b");                                  // мутация читает заново
    t("чужая позиция не потеряна", C.totals().families, 2);
    t("своя правка применилась", C.itemsOf("fluxetype")[0].cuts, ["a","b"]);

    grp("события");
    reset();
    var seen=[], fn=function(d){ seen.push(d.reason); };
    C.on(fn); C.setStyles(FLUX,["a"]); C.setWebDomain("x.com"); C.off(fn); C.setStyles(FLUX,["a","b"]);
    t("подписка ловит, отписка работает", seen, ["styles","domain"]);
    var evt=0, h=function(){ evt++; };
    root.addEventListener("fx:cart:changed", h);
    C.setStyles(FLUX,["a"]);
    root.removeEventListener("fx:cart:changed", h);
    t("событие уходит на window", evt, 1);

    grp("миграция со старого билдера");
    reset();
    LS.removeItem(C.KEY);
    LS.setItem("fx:licb:fluxetype:v1", JSON.stringify({
      t:Date.now(), from:"Title", licenses:["desktop","web"], scales:{desktop:"2-5",web:"100k"},
      product:"subfamily", cuts:[], subs:["Title","Caption"], webDomain:"acme.com", tab:"Petit"}));
    LS.setItem("fx:licb:archaism:v1", JSON.stringify({
      t:Date.now(), licenses:["desktop"], scales:{desktop:"1"},
      product:"single", cuts:["Ct0Wd0"], subs:[], webDomain:"", tab:null}));
    env.reload(function(){
      var M=root.FxCart;
      t("обе семьи переехали", M.totals().families, 2);
      t("субсемейства сохранились", M.itemsOf("fluxetype")[0].subs, ["Title","Caption"]);
      t("лицензия подхвачена", M.license().licenses, ["desktop","web"]);
      t("шкалы подхвачены", M.license().scales, {desktop:"2-5",web:"100k"});
      t("домен подхвачен", M.license().webDomain, "acme.com");
      t("позиции помечены stale (слепка цен в старом снимке не было)",
        M.items().every(function(i){return i.stale;}), true);
      t("старые ключи убраны",
        [LS.getItem("fx:licb:fluxetype:v1"), LS.getItem("fx:licb:archaism:v1")], [null,null]);

      // второй заход: мигрировать больше нечего, набранное не трогаем
      M.setStyles(FLUX,["a"]);
      var before=M.items().length;
      env.reload(function(){
        t("повторный заход ничего не ломает", root.FxCart.items().length, before);
        root.FxCart._reset();
        env.done();
      });
    });
  };
})(typeof window!=="undefined" ? window : globalThis);
