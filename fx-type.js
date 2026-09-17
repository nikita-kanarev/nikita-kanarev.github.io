/*
  FX TYPE — разбор конфига гарнитуры: инстансы, субсемейства, группировка.

  ЗАЧЕМ. Одни и те же вопросы — «какие есть начертания», «как они складываются
  в таблицу», «что входит в субсемейство», «какие координаты осей у этого
  начертания» — задают License Builder, страница /cart со своим ящиком
  добавления, Cuts и Playground. Логика группировки (layoutFor) выстрадана:
  variantAxis схлопывается в колонки, у конфигов без него таблица строится по
  ЗНАЧЕНИЯМ осей. В июле обе ветки специально приводили к одному виду —
  вторая копия разошлась бы с первой на ближайшей правке.

  ЧТО ЭТО НЕ ДЕЛАЕТ: не рисует и не ходит в сеть. Здесь нет ни DOM, ни цен, ни
  корзины. Разметку каждая страница строит свою — у страницы шрифта это
  специмен с «Expand all», у ящика в корзине компактный список; общей обязана
  быть группировка, а не пиксели.

    var T = FxType(cfg);
    T.instances / T.byName / T.subfamilies / T.L0
    T.instancesOfSub(slug) · T.dispName(inst, subSlug) · T.vset(inst)
    T.layoutFor(insts, subSlug)
*/
(function(){
  "use strict";
  if (window.FxType) return;

  function FxType(cfg){
    cfg = cfg || {};
    var axes = cfg.axes || [];
    var instanceAxes = cfg.instanceAxes || [];
    var variantAxis = (cfg.cuts||{}).variantAxis;
    var family = cfg.family || "Aa";

    var instances = (cfg.instances||[]).map(function(row){
      var o={name:row[0]}; instanceAxes.forEach(function(t,i){ o[t]=row[i+1]; }); return o;
    });
    var byName = {}; instances.forEach(function(x){ byName[x.name]=x; });

    function vset(inst){
      if(!inst) return "";
      return axes.map(function(a){
        var v=inst[a.tag]!==undefined?inst[a.tag]:a.default; return "'"+a.tag+"' "+v;
      }).join(", ");
    }

    /* ---- субсемейства (опционально, по конфигу) -----------------------------
       cfg.subfamilies = [{slug,label,axis,value}]; субсемейство — это срез одной
       оси (Fluxetype: CTRS 0/25/65/100 → Caption/Text/Title/Display). Нет их —
       каждая ветка ниже становится пустой операцией. */
    var subfamilies = Array.isArray(cfg.subfamilies) && cfg.subfamilies.length ? cfg.subfamilies : null;
    var subBySlug = {}; if(subfamilies) subfamilies.forEach(function(s){ subBySlug[s.slug]=s; });

    function instancesOfSub(slug){
      if(!subfamilies || !slug || slug==="all") return instances;
      var s=subBySlug[slug]; if(!s) return instances;
      return instances.filter(function(x){ return x[s.axis]===s.value; });
    }
    // имя с отрезанной меткой активного субсемейства: в срезанной сетке читается
    // «Petit Thin», а не «Caption Petit Thin». В режиме "all" префикс остаётся —
    // там слово субсемейства и становится колонкой. Идентичность — всегда inst.name.
    function dispName(inst, subSlug){
      if(subfamilies && subSlug && subSlug!=="all" && subBySlug[subSlug]){
        var lab=subBySlug[subSlug].label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
        return inst.name.replace(new RegExp("^"+lab+"\\s+","i"),"");
      }
      return inst.name;
    }

    /* ---- группировка (variantAxis → колонки) — родом из embed-cuts ----------
       Считается для произвольного подмножества инстансов и области видимости,
       поэтому один код обслуживает и всю семью, и обзор «All», и каждое
       субсемейство по отдельности. */
    function layoutFor(insts, subSlug){
      function nm(x){ return dispName(x, subSlug); }
      function buildGroups(){
        var hasV = variantAxis && instanceAxes.indexOf(variantAxis)>=0 && insts.some(function(x){return x[variantAxis]!==undefined;});
        if(!hasV){
          return insts.map(function(inst){ return {name:nm(inst), variants:[{label:nm(inst), inst:inst}]}; });
        }
        var order=[], map={};
        var otherAxes = instanceAxes.filter(function(t){ return t!==variantAxis; });
        insts.forEach(function(inst){
          var key=otherAxes.map(function(t){ return t+":"+inst[t]; }).join("|");
          if(!map[key]){ map[key]=[]; order.push(key); }
          map[key].push(inst);
        });
        return order.map(function(key){
          var list=map[key].slice().sort(function(a,b){ return (a[variantAxis]||0)-(b[variantAxis]||0); });
          var wordLists=list.map(function(x){ return nm(x).split(/\s+/); });
          var common=wordLists[0].filter(function(w){ return wordLists.every(function(ws){ return ws.indexOf(w)>=0; }); });
          var multi=list.length>1;
          var groupName=multi ? wordLists[0].filter(function(w){ return common.indexOf(w)>=0; }).join(" ") : nm(list[0]);
          var variants=list.map(function(x){
            var label=multi ? (nm(x).split(/\s+/).filter(function(w){ return common.indexOf(w)<0; }).join(" ") || nm(x)) : nm(x);
            return {label:label, inst:x};
          });
          return {name:groupName, variants:variants};
        });
      }
      var groups = buildGroups();
      var hasVariants = groups.some(function(g){ return g.variants.length>1; });
      // TABS = метки variantAxis (Fluxetype: XHGT → Petit / Normal / Grande)
      var TABS=[]; groups.forEach(function(g){ g.variants.forEach(function(v){ if(TABS.indexOf(v.label)<0) TABS.push(v.label); }); });
      // внутри вкладки раскладываем группы таблицей, разобрав имя группы:
      // колонки — ведущее слово (оптика/контраст), строки — остаток (вес).
      var splitNames = hasVariants && groups.every(function(g){ return g.name.split(/\s+/).length>1; });
      var COLW=[], ROWK=[], groupByName={};
      groups.forEach(function(g){ groupByName[g.name]=g; });
      if(splitNames){
        groups.forEach(function(g){
          var p=g.name.split(/\s+/), c=p[0], r=p.slice(1).join(" ");
          if(COLW.indexOf(c)<0) COLW.push(c);
          if(ROWK.indexOf(r)<0) ROWK.push(r);
        });
      }
      // нет variantAxis, но варьируются ≥2 оси (Archaism: ширина × контраст) →
      // строим таблицу по ЗНАЧЕНИЯМ осей: колонки — ось с меньшим числом
      // различных значений, строки — вторая.
      var flatTable=null;
      if(!hasVariants && instanceAxes.length>=2){
        var axList=instanceAxes.map(function(t){
          var s={}; insts.forEach(function(x){ s[x[t]]=1; });
          return {tag:t, vals:Object.keys(s).map(Number).sort(function(a,b){return a-b;})};
        }).filter(function(a){ return a.vals.length>1; });
        if(axList.length>=2){
          axList.sort(function(a,b){ return a.vals.length-b.vals.length; });
          var colAx=axList[0], rowAx=axList[1], byKey={};
          insts.forEach(function(x){ byKey[x[rowAx.tag]+"|"+x[colAx.tag]]=x; });
          flatTable={colAx:colAx, rowAx:rowAx, byKey:byKey};
        }
      }
      return {groups:groups, hasVariants:hasVariants, TABS:TABS, splitNames:splitNames,
              COLW:COLW, ROWK:ROWK, groupByName:groupByName, flatTable:flatTable};
    }

    // L0 — раскладка по всей семье: на ней держатся инициализация состояния,
    // панель полной семьи и все конфиги без субсемейств.
    var L0 = layoutFor(instances, "all");
    // имя инстанса → его вкладка (Fluxetype: XHGT → Petit/Normal/Grande)
    var tabByName={}; L0.groups.forEach(function(g){ g.variants.forEach(function(v){ tabByName[v.inst.name]=v.label; }); });

    return {
      cfg:cfg, family:family, axes:axes, instanceAxes:instanceAxes, variantAxis:variantAxis,
      instances:instances, byName:byName,
      subfamilies:subfamilies, subBySlug:subBySlug,
      vset:vset, instancesOfSub:instancesOfSub, dispName:dispName,
      layoutFor:layoutFor, L0:L0, tabByName:tabByName
    };
  }

  window.FxType = FxType;
  try { window.dispatchEvent(new CustomEvent("fx:type:ready")); } catch(e){}
})();
