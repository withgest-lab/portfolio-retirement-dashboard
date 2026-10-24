/* shared/swipe-tabs.js — 좌우 스와이프로 "보고 있는 화면 바로 위 배너 줄"을 넘긴다(포트폴리오·현금흐름·매매전략).
   규칙(2026-10-24 사용자 확인): 안쪽 줄(서브탭) 먼저, 끝에서 바깥 줄(위 탭)로 — 앱이 [위 탭, 서브탭] 쌍의 평평한 목록(steps)을
   주면 현재 위치 ±1로 움직인다. 맨 처음·맨 끝에서는 멈춘다. 위 탭이 바뀔 때만 가운데에 새 탭 이름을 잠깐 보여 준다. 터치 전용.

   실기기에서 "어떤 화면은 되고 어떤 화면은 안 됨"을 고친 판정 규칙(2026-10-24):
   - 손을 뗄 때(touchend)가 아니라 손가락이 움직이는 중(touchmove) 기준을 넘는 순간 넘긴다 — 브라우저가 가로 제스처를 가져가면
     touchend 대신 touchcancel이 와서 예전엔 판정조차 안 됐다(touchend·touchcancel은 놓친 경우 보완용).
   - html·body에 touch-action:pan-y(가로 팬을 브라우저가 가져가지 않게), 가로 스크롤 영역은 pan-x pan-y로 자기 스크롤 유지.
   - 캔버스(그래프·트리맵·도넛)는 막지 않고 "빠르게 쓸어 넘김"만 인정(짚고 끌어 값 보기와 구분).
   - 막는 곳: 슬라이더·textarea, 키보드가 올라온 입력 중, 열린 입력·수정 폼, 그 방향으로 더 스크롤되는 가로 스크롤 영역,
     열린 모달·풀다운 시트·팝오버·알림창·나란히 보기, 글자 선택 중.
   사용: swipeTabs({ steps:()=>[[top,sub],…], current:()=>[top,sub], go:(step,dir)=>{}, label:step=>'이름', target:()=>요소 })
   점검: swipeTabs._check(x, y, dir) → 'ok' | 'ok-canvas'(빠른 밀기만) | 막는 이유 */
(function () {
  if (window.swipeTabs) return;
  var MIN_DX = 60, RATIO = 1.6, MAX_MS = 800, CV_MIN_DX = 80, CV_MAX_MS = 500, HS_SLACK = 4;
  var HARD_SEL = 'input[type=range],textarea,[contenteditable=""],[contenteditable=true],.ios-menu,.ios-dlg';
  var FORM_SEL = 'tr.fm-row,#addAssetWrap,#addTradeLogWrap,#principalAddWrap,[id^="dnew_wrap_"],[id^="addDivWrap"]';
  var OPEN_SEL = '.modal-bg.open,.ios-dlg-back,.ios-menu,#cmpView.open,.chart-pick-pop,.rates-pop';
  var vis = function (e) { if (!e) return false; var s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && e.getClientRects().length > 0; };

  var st = document.createElement('style');
  st.textContent = 'html,body{touch-action:pan-y;overscroll-behavior-x:none;}' +
    '.tbl-wrap,.tabbar-scroll{touch-action:pan-x pan-y;}';
  (document.head || document.documentElement).appendChild(st);

  function anyOpen() { return [].some.call(document.querySelectorAll(OPEN_SEL), vis); }
  function typing() {
    var a = document.activeElement;
    return !!(a && a !== document.body && a.matches && a.matches('input:not([type=range]):not([type=button]):not([type=checkbox]):not([type=radio]),textarea,[contenteditable]'));
  }
  // 시작 지점 위로 "그 방향으로 4px 넘게 더 스크롤되는" 가로 스크롤 영역이 있으면 그 스크롤에 양보
  function scrollsThatWay(el, dir) {
    for (; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (el.scrollWidth - el.clientWidth <= HS_SLACK) continue;
      var ox = getComputedStyle(el).overflowX;
      if (ox !== 'auto' && ox !== 'scroll') continue;
      if (dir > 0 && el.scrollWidth - el.clientWidth - el.scrollLeft > HS_SLACK) return true;
      if (dir < 0 && el.scrollLeft > HS_SLACK) return true;
    }
    return false;
  }
  // dir: 1=다음(왼쪽으로 밂), -1=이전. 반환: '' = 넘겨도 됨, 그 밖 = 막는 이유
  function blockReason(el, dir) {
    if (!el || !el.closest) return 'no-target';
    if (anyOpen()) return 'open';
    if (el.closest(HARD_SEL)) return 'slider/text';
    if (typing()) return 'typing';
    if (el.closest(FORM_SEL)) return 'form';
    if (dir && scrollsThatWay(el, dir)) return 'hscroll';
    return '';
  }

  var toastEl = null, toastT = null;
  function toast(text) {
    if (!text) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);z-index:2147483000;pointer-events:none;' +
        'padding:10px 18px;border-radius:14px;background:rgba(28,28,30,.86);color:#fff;font-weight:600;font-size:15px;line-height:1.2;font-family:inherit;' +
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
    if (document.documentElement.classList.contains('embed')) return;   // 비교 화면 안 매매전략(iframe)은 바깥이 처리
    var g = null;   // 진행 중인 제스처
    function navigate(dir) {
      var steps = cfg.steps(), cur = cfg.current();
      var i = steps.findIndex(function (x) { return x[0] === cur[0] && (x[1] || '') === (cur[1] || ''); });
      if (i < 0) i = steps.findIndex(function (x) { return x[0] === cur[0]; });
      var j = i + dir;
      if (i < 0 || j < 0 || j >= steps.length) return false;   // 처음·끝에서는 멈춘다
      var next = steps[j];
      cfg.go(next, dir);
      if (next[0] !== cur[0] && cfg.label) toast(cfg.label(next));
      slideIn(cfg.target && cfg.target(), dir);
      return true;
    }
    function judge(x, y) {
      if (!g || g.done) return;
      var dx = x - g.x, dy = y - g.y, dt = Date.now() - g.t;
      var minDx = g.canvas ? CV_MIN_DX : MIN_DX, maxMs = g.canvas ? CV_MAX_MS : MAX_MS;
      if (dt > maxMs) { g.done = true; return; }   // 느린 끌기(값 보기 등)는 이 제스처에서 더 보지 않는다
      if (Math.abs(dx) < minDx || Math.abs(dx) < Math.abs(dy) * RATIO) return;
      g.done = true;
      var dir = dx < 0 ? 1 : -1;
      if (String(window.getSelection ? window.getSelection() : '')) return;
      if (blockReason(g.el, dir)) return;
      navigate(dir);
    }
    document.addEventListener('touchstart', function (e) {
      g = null;
      if (e.touches.length !== 1) return;
      var t = e.target;
      if (blockReason(t, 0)) return;
      var p = e.touches[0];
      g = { x: p.clientX, y: p.clientY, t: Date.now(), el: t, canvas: !!(t.closest && t.closest('canvas')), done: false };
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (!g) return;
      if (e.touches.length !== 1) { g = null; return; }
      var p = e.touches[0]; g.lx = p.clientX; g.ly = p.clientY;
      judge(p.clientX, p.clientY);
    }, { passive: true });
    function finish(e) {
      if (!g) return;
      var p = e.changedTouches && e.changedTouches[0];
      judge(p ? p.clientX : g.lx, p ? p.clientY : g.ly);
      g = null;
    }
    document.addEventListener('touchend', finish, { passive: true });
    document.addEventListener('touchcancel', finish, { passive: true });
  };
  window.swipeTabs._check = function (x, y, dir) {
    var el = document.elementFromPoint(x, y);
    var r = blockReason(el, dir || 1);
    if (r) return r;
    return el && el.closest && el.closest('canvas') ? 'ok-canvas' : 'ok';
  };
})();
