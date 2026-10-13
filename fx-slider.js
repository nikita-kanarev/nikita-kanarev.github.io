/*
  FX SLIDER — полноэкранная галерея из мульти-имедж поля CMS.

  Разметка (Webflow Designer):
    .fx-marquee > .fx-track > .fx-list (Collection List, источник — мульти-имедж)
                                > .fx-item > img
  CSS лежит в Head страницы шаблона (.fx-marquee … object-fit: contain).

  Поведение: один слайд на ширину .fx-marquee, автопереключение по кругу,
  перетаскивание с доводкой до ближайшего слайда, клик по левой/правой
  половине — назад/вперёд, стрелки клавиатуры. Всё движение идёт через одну
  экспоненциальную доводку pos → target, поэтому любой переход одинаково плавный.

  Кольцо: список клонируется один раз, позиция считается в слайдах и
  заворачивается по модулю N — стыка нет ни вперёд, ни назад.

  Файл хостится на GitHub Pages, потому что длинный скрипт, вставленный руками
  в Custom Code, дважды доезжал до сайта с вырезанными кусками.
*/
(function () {
  var DELAY = 5;   // секунд до автопереключения
  var EASE = 6;    // скорость доводки: больше — быстрее

  function init(box) {
    var track = box.querySelector('.fx-track');
    var list = track && track.querySelector('.fx-list');
    if (!list) return;
    var N = list.querySelectorAll('.fx-item').length;
    if (!N) return;

    var copy = list.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    track.appendChild(copy);
    var items = track.querySelectorAll('.fx-item');

    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var ease = reduce ? 1000 : EASE;

    box.tabIndex = 0;

    // ширина слайда = ширина блока
    var w = box.clientWidth;
    function resize() {
      w = box.clientWidth;
      box.style.setProperty('--fx-w', w + 'px');
    }
    resize();
    new ResizeObserver(resize).observe(box);

    var pos = 0, target = 0, idle = 0, last = null;
    var drag = null, moved = false;

    function wrap(i) { return ((i % N) + N) % N; }

    function go(i) {
      target = i;
      idle = 0;
      // заранее грузим текущий и соседние слайды в обеих копиях
      for (var k = -1; k <= 1; k++) {
        var j = wrap(i + k);
        [items[j], items[j + N]].forEach(function (item) {
          var img = item && item.querySelector('img');
          if (img) img.loading = 'eager';
        });
      }
    }
    go(0);

    function side(e) {
      var r = box.getBoundingClientRect();
      return e.clientX < r.left + r.width / 2 ? -1 : 1;
    }

    box.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      drag = { id: e.pointerId, x0: e.clientX, pos0: pos, lx: e.clientX, lt: e.timeStamp, vel: 0 };
      moved = false;
    });

    box.addEventListener('pointermove', function (e) {
      if (!drag) {
        var s = side(e);
        box.classList.toggle('is-left', s < 0);
        box.classList.toggle('is-right', s > 0);
        return;
      }
      if (e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x0;
      if (!moved) {
        if (Math.abs(dx) < 5) return;   // мелкое дрожание — ещё клик
        moved = true;
        box.setPointerCapture(e.pointerId);
        box.classList.add('is-dragging');
      }
      pos = drag.pos0 - dx / w;
      var dt = (e.timeStamp - drag.lt) / 1000;
      if (dt > 0) drag.vel = -(e.clientX - drag.lx) / w / dt;   // слайдов в секунду
      drag.lx = e.clientX;
      drag.lt = e.timeStamp;
    });

    function endDrag(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (moved) {
        var vel = e.timeStamp - drag.lt < 100 ? drag.vel : 0;
        var from = Math.round(drag.pos0);
        var to = Math.round(pos + vel * 0.2);
        if (to === from && Math.abs(vel) > 0.5) to = from + (vel > 0 ? 1 : -1);
        go(to);
      } else if (e.type === 'pointerup') {
        go(target + side(e));   // клик: левая половина — назад, правая — вперёд
      }
      drag = null;
      box.classList.remove('is-dragging');
    }
    box.addEventListener('pointerup', endDrag);
    box.addEventListener('pointercancel', endDrag);

    // клики внутри слайдера только листают
    box.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
    }, true);
    box.addEventListener('dragstart', function (e) { e.preventDefault(); });

    box.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); go(target - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(target + 1); }
    });

    function tick(t) {
      if (last !== null) {
        var dt = Math.min((t - last) / 1000, 0.1);
        if (!(drag && moved)) {
          pos += (target - pos) * (1 - Math.exp(-dt * ease));
          if (Math.abs(target - pos) < 0.0005) pos = target;
          if (!reduce) {
            idle += dt;
            if (idle >= DELAY) go(target + 1);
          }
        }
        track.style.transform = 'translate3d(' + (-wrap(pos) * w) + 'px, 0, 0)';
      }
      last = t;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function boot() {
    document.querySelectorAll('.fx-marquee').forEach(init);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
