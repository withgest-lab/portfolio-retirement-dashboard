/* shared/swipe-tabs.js — 좌우 스와이프로 "보고 있는 화면 바로 위 배너 줄"을 넘긴다(포트폴리오·현금흐름·매매전략).
   규칙(2026-10-24 사용자 확인): 안쪽 줄(서브탭) 먼저, 끝에서 바깥 줄(위 탭)로 — 앱이 [위 탭, 서브탭] 쌍의 평평한 목록(steps)을
   주면 현재 위치 ±1로 움직인다. 맨 처음·맨 끝에서는 멈춘다. 위 탭이 바뀔 때만 가운데에 새 탭 이름을 잠깐 보여 준다.
   터치로 밀 때만(마우스·휠 제외). 입력칸·슬라이더·캔버스(차트·트리맵), 그 방향으로 더 스크롤되는 가로 스크롤 영역,
   열린 모달·시트·팝오버·알림창 위에서는 넘기지 않는다.
   사용: swipeTabs({ steps:()=>[[top,sub],…], current:()=>[top,sub], go:(step,dir)=>{}, label:step=>'이름', target:()=>요소 }) */
(function () {
  if (window.swipeTabs) return;
  var MIN_DX = 70, RATIO = 1.8, MAX_MS = 700;
  var BLOCK_SEL = 'input,select,textarea,canvas,[contenteditable],.ios-menu,.ios-dlg,.fm';
  var OPEN_SEL = '.modal-bg.open,.ios-dlg-back,.ios-menu,#cmpView.open';
  var POP_SEL = '.chart-pick-pop,.rates-pop';
  var vis = function (e) { if (!e) return false; var s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && e.getClientRects().length > 0; };

  // 시작 지점에서 위로 올라가며 "그 방향으로 더 스크롤되는" 가로 스크롤 영역이 있으면 그 영역의 스크롤에 양보한다
  function scrollsThatWay(el, dir) {
    for (; el && el !== document.body; el = el.parentElement) {
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      var ox = getComputedStyle(el).overflowX;
      if (ox !== 'auto' && ox !== 'scroll') continue;
      if (dir > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;   // 왼쪽으로 밂 = 내용이 오른쪽으로 더 있음
      if (dir < 0 && el.scrollLeft > 0) return true;
    }
    return false;
  }
  function anyOpen() {
    if ([].some.call(document.querySelectorAll(OPEN_SEL), vis)) return true;
    return [].some.call(document.querySelectorAll(POP_SEL), vis);
  }
  var toastEl = null, toastT = null;
  function toast(text) {
    if (!text) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);z-index:2147483000;pointer-events:none;' +
        'padding:10px 18px;border-radius:14px;background:rgba(28,28,30,.86);color:#fff;font:600 15px/1.2 inherit;font-family:inherit;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.2);opacity:0;transition:opacity .15s;';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text; toastEl.style.opacity = '1';
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.style.opacity = '0'; }, 800);
  }
  function slideIn(el, dir) {
    if (!el || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    el.style.transition = 'none'; el.style.transform = 'translateX(' + (dir > 0 ? 24 : -24) + 'px)'; el.style.opacity = '.4';
    void el.offsetWidth;
    el.style.transition = 'transform .18s ease-out, opacity .18s ease-out'; el.style.transform = ''; el.style.opacity = '';
    setTimeout(function () { el.style.transition = ''; }, 220);
  }

  window.swipeTabs = function (cfg) {
    if (document.documentElement.classList.contains('embed')) return;   // 비교 화면 안에 들어간 매매전략(iframe)은 바깥이 처리
    var s = null;
    document.addEventListener('touchstart', function (e) {
      s = null;
      if (e.touches.length !== 1) return;
      var t = e.target;
      if (t.closest && t.closest(BLOCK_SEL)) return;
      if (anyOpen()) return;
      var p = e.touches[0]; s = { x: p.clientX, y: p.clientY, t: Date.now(), el: t };
    }, { passive: true });
    document.addEventListener('touchmove', function (e) { if (s && e.touches.length !== 1) s = null; }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (!s) return;
      var p = e.changedTouches[0], dx = p.clientX - s.x, dy = p.clientY - s.y, dt = Date.now() - s.t, st = s; s = null;
      if (dt > MAX_MS || Math.abs(dx) < MIN_DX || Math.abs(dx) < Math.abs(dy) * RATIO) return;
      var sel = window.getSelection && String(window.getSelection()); if (sel) return;
      var dir = dx < 0 ? 1 : -1;   // 왼쪽으로 밀면 다음
      if (scrollsThatWay(st.el, dir)) return;
      var steps = cfg.steps(), cur = cfg.current();
      var i = steps.findIndex(function (x) { return x[0] === cur[0] && (x[1] || '') === (cur[1] || ''); });
      if (i < 0) i = steps.findIndex(function (x) { return x[0] === cur[0]; });
      var j = i + dir;
      if (i < 0 || j < 0 || j >= steps.length) return;   // 처음·끝에서는 멈춘다
      var next = steps[j];
      cfg.go(next, dir);
      if (next[0] !== cur[0] && cfg.label) toast(cfg.label(next));
      slideIn(cfg.target && cfg.target(), dir);
    }, { passive: true });
  };
})();
