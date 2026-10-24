/* shared/swipe-tabs.js — 좌우 스와이프로 "보고 있는 화면 바로 위 배너 줄"을 넘긴다(포트폴리오·현금흐름·매매전략).
   규칙(2026-10-24 사용자 확인): 안쪽 줄(서브탭) 먼저, 끝에서 바깥 줄(위 탭)로 — 앱이 [위 탭, 서브탭] 쌍의 평평한 목록(steps)을
   주면 현재 위치 ±1로 움직인다. 맨 처음·맨 끝에서는 멈춘다. 위 탭이 바뀔 때만 가운데에 새 탭 이름을 잠깐 보여 준다. 터치 전용.

   실기기에서 "되다 안 되다"의 원인과 대책(2026-10-24, 2차):
   - 브라우저는 손가락 아래에서 "가장 가까운 스크롤 영역"까지의 touch-action만 본다. html·body에만 pan-y를 걸면 안쪽 스크롤
     영역(포트폴리오 화면 본문 등) 위에서는 브라우저가 가로 동작(뒤로 가기·당김)을 가져가 터치를 취소(touchcancel)해 버린다.
     → 모든 요소에 touch-action:pan-y pinch-zoom(세로 스크롤·두 손가락 확대는 그대로, 가로 밀기만 앱이 받음).
     실제로 가로로 넘치는 영역(표·탭바·버튼 줄)만 .swipe-hs로 pan-x를 허용한다(넘치지 않는 곳에 허용하면 다시 브라우저가 가져감).
   - 판정은 손가락이 움직이는 중(touchmove)에 — touchend·touchcancel은 놓친 경우 보완.
   - 캔버스(그래프·트리맵·도넛)도 같은 기준 — 이 앱의 차트는 터치 끌기에 반응하지 않고 탭에만 반응한다(끌기는 마우스만).
   - 입력 중 판정은 키보드가 실제로 올라와 있거나(visualViewport 높이 감소) 그 입력칸 위에서 밀 때만 — 안드로이드는 뒤로가기로
     키보드를 내려도 입력칸 포커스가 남아, 예전엔 그 뒤 모든 스와이프가 '입력 중'으로 막혔다.
   - 막는 곳: 슬라이더·textarea, 입력 중, 열린 입력·수정 폼, 그 방향으로 더 스크롤되는 가로 영역,
     열린 모달·풀다운 시트·팝오버·알림창·나란히 보기, 글자 선택 중.
   실기기 점검: 주소에 ?swipedebug 를 붙이면(또는 localStorage swipe_debug=1) 밀 때마다 화면 아래에 거리·시간·결과(막힌 이유)를 보여 준다.
   사용: swipeTabs({ steps:()=>[[top,sub],…], current:()=>[top,sub], go:(step,dir)=>{}, label:step=>'이름', target:()=>요소 })
   점검(스크립트): swipeTabs._check(x, y, dir) → 'ok' | 'ok-canvas' | 막는 이유,  swipeTabs._panRisk(x, y) → 브라우저가 가로 팬을 가져갈 수 있으면 true */
(function () {
  if (window.swipeTabs) return;
  var MIN_DX = 50, RATIO = 1.4, MAX_MS = 1000, HS_SLACK = 4;
  var HARD_SEL = 'input[type=range],textarea,[contenteditable=""],[contenteditable=true],.ios-menu,.ios-dlg';
  var FORM_SEL = 'tr.fm-row,#addAssetWrap,#addTradeLogWrap,#principalAddWrap,[id^="dnew_wrap_"]';
  var OPEN_SEL = '.modal-bg.open,.ios-dlg-back,.ios-menu,#cmpView.open,.chart-pick-pop,.rates-pop';
  var HS_SEL = '.tbl-wrap,.tabbar-scroll,.topbar-actions,.vbar-scroll';
  var vis = function (e) { if (!e) return false; var s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && e.getClientRects().length > 0; };
  var DEBUG = /[?&#]swipedebug/.test(location.search + location.hash);
  try { if (localStorage.getItem('swipe_debug') === '1') DEBUG = true; } catch (e) {}

  var st = document.createElement('style');
  st.textContent = 'html,body,body *{touch-action:pan-y pinch-zoom;}' +
    'html,body{overscroll-behavior-x:none;}' +
    '.swipe-hs,.swipe-hs *{touch-action:pan-x pan-y pinch-zoom !important;}';
  (document.head || document.documentElement).appendChild(st);

  // 실제로 가로로 넘치는 스크롤 영역에만 .swipe-hs(가로 스크롤 허용) — 처음·크기 변화·DOM 변화(묶어서) 때 갱신
  function markHS() {
    [].forEach.call(document.querySelectorAll(HS_SEL), function (el) {
      el.classList.toggle('swipe-hs', el.scrollWidth - el.clientWidth > HS_SLACK);
    });
  }
  var hsT = null;
  function markHSSoon() { clearTimeout(hsT); hsT = setTimeout(markHS, 250); }
  function startHS() {
    markHS();
    window.addEventListener('resize', markHSSoon);
    if (window.MutationObserver) new MutationObserver(markHSSoon).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startHS); else startHS();

  function anyOpen() { return [].some.call(document.querySelectorAll(OPEN_SEL), vis); }
  function typing(target) {
    var a = document.activeElement;
    if (!(a && a !== document.body && a.matches && a.matches('input:not([type=range]):not([type=button]):not([type=checkbox]):not([type=radio]),textarea,[contenteditable]'))) return false;
    if (target && (a === target || a.contains(target))) return true;
    var vv = window.visualViewport;
    return !!(vv && vv.height < window.innerHeight * 0.75);   // 키보드가 올라와 화면이 줄었을 때만
  }
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
  function blockReason(el, dir) {
    if (!el || !el.closest) return 'no-target';
    if (anyOpen()) return 'open';
    if (el.closest(HARD_SEL)) return 'slider/text';
    if (typing(el)) return 'typing';
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
  var dbgEl = null;
  function dbg(text) {
    if (!DEBUG) return;
    if (!dbgEl) {
      dbgEl = document.createElement('div');
      dbgEl.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483001;pointer-events:none;padding:6px 10px;border-radius:10px;' +
        'background:rgba(0,0,0,.78);color:#fff;font:12px/1.4 -apple-system,sans-serif;white-space:pre-wrap;';
      document.body.appendChild(dbgEl);
    }
    dbgEl.textContent = text;
  }
  function slideIn(el, dir) {
    if (!el || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    el.style.transition = 'none'; el.style.transform = 'translateX(' + (dir > 0 ? 24 : -24) + 'px)'; el.style.opacity = '.4';
    void el.offsetWidth;
    el.style.transition = 'transform .18s ease-out, opacity .18s ease-out'; el.style.transform = ''; el.style.opacity = '';
    setTimeout(function () { el.style.transition = ''; }, 220);
  }
  function tagOf(el) { return el ? (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : '')) : '-'; }

  window.swipeTabs = function (cfg) {
    if (document.documentElement.classList.contains('embed')) return;   // 비교 화면 안 매매전략(iframe)은 바깥이 처리
    var g = null;
    function navigate(dir) {
      var steps = cfg.steps(), cur = cfg.current();
      var i = steps.findIndex(function (x) { return x[0] === cur[0] && (x[1] || '') === (cur[1] || ''); });
      if (i < 0) i = steps.findIndex(function (x) { return x[0] === cur[0]; });
      var j = i + dir;
      if (i < 0) return 'no-current';
      if (j < 0 || j >= steps.length) return 'edge';   // 처음·끝에서는 멈춘다
      var next = steps[j];
      cfg.go(next, dir);
      if (next[0] !== cur[0] && cfg.label) toast(cfg.label(next));
      slideIn(cfg.target && cfg.target(), dir);
      return '';
    }
    function info(dx, dy, dt) { return 'dx ' + Math.round(dx) + ' dy ' + Math.round(dy) + ' ' + (dt / 1000).toFixed(2) + 's · ' + tagOf(g && g.el) + (g && g.canvas ? ' (캔버스)' : ''); }
    function judge(x, y, final, how) {
      if (!g || g.done) return;
      var dx = x - g.x, dy = y - g.y, dt = Date.now() - g.t;
      var minDx = MIN_DX, maxMs = MAX_MS;
      if (dt > maxMs) { g.done = true; dbg(info(dx, dy, dt) + '\n✗ 너무 느림(' + (maxMs / 1000) + 's 초과)'); return; }
      if (Math.abs(dx) < minDx || Math.abs(dx) < Math.abs(dy) * RATIO) {
        if (final) dbg(info(dx, dy, dt) + '\n✗ ' + (Math.abs(dx) < minDx ? '가로 거리 부족(' + minDx + 'px 미만)' : '세로 움직임이 큼') + ' · ' + how);
        return;
      }
      g.done = true;
      var dir = dx < 0 ? 1 : -1;
      var r = String(window.getSelection ? window.getSelection() : '') ? 'selection' : blockReason(g.el, dir);
      if (!r) r = navigate(dir);
      dbg(info(dx, dy, dt) + '\n' + (r ? '✗ 막힘: ' + r : '✓ 넘김 ' + (dir > 0 ? '→ 다음' : '← 이전')) + ' · ' + how);
    }
    document.addEventListener('touchstart', function (e) {
      g = null;
      if (e.touches.length !== 1) return;
      var t = e.target, r = blockReason(t, 0);
      if (r) { dbg('시작 지점에서 막힘: ' + r + ' · ' + tagOf(t)); return; }
      var p = e.touches[0];
      g = { x: p.clientX, y: p.clientY, t: Date.now(), el: t, canvas: !!(t.closest && t.closest('canvas')), done: false };
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (!g) return;
      if (e.touches.length !== 1) { g = null; return; }
      var p = e.touches[0]; g.lx = p.clientX; g.ly = p.clientY;
      judge(p.clientX, p.clientY, false, 'move');
    }, { passive: true });
    function finish(e) {
      if (!g) return;
      var p = e.changedTouches && e.changedTouches[0];
      judge(p ? p.clientX : g.lx, p ? p.clientY : g.ly, true, e.type === 'touchcancel' ? 'cancel(브라우저가 가져감)' : 'end');
      g = null;
    }
    document.addEventListener('touchend', finish, { passive: true });
    document.addEventListener('touchcancel', finish, { passive: true });
    if (DEBUG) dbg('스와이프 점검 모드 — 화면을 좌우로 밀어 보세요');
  };
  window.swipeTabs._check = function (x, y, dir) {
    var el = document.elementFromPoint(x, y);
    var r = blockReason(el, dir || 1);
    if (r) return r;
    return el && el.closest && el.closest('canvas') ? 'ok-canvas' : 'ok';
  };
  // 그 지점에서 시작한 가로 팬을 브라우저가 가져갈 수 있는지: 대상 → 가장 가까운 스크롤 영역까지 touch-action에 가로 팬 금지가 하나라도 없으면 위험
  window.swipeTabs._panRisk = function (x, y) {
    for (var el = document.elementFromPoint(x, y); el; el = el.parentElement) {
      var ta = getComputedStyle(el).touchAction;
      if (ta === 'none' || (/pan-y/.test(ta) && !/pan-x|auto|manipulation/.test(ta))) return false;
      var cs = getComputedStyle(el);
      if (/auto|scroll/.test(cs.overflowX + cs.overflowY) && el !== document.documentElement) {
        if (el.classList.contains('swipe-hs')) return false;   // 진짜 가로 스크롤 영역 — 그 영역이 가로 스크롤을 쓴다(의도)
      }
      if (el === document.documentElement) break;
    }
    return true;
  };
})();
