/*
 * shared/icons.js
 * 화면의 이모지를 iOS(SF Symbols) 느낌의 라인 아이콘(SVG)으로 바꿔 보여주는 공용 스크립트 — 포트폴리오·현금흐름·홈이 같이 쓴다.
 *
 * 이모지가 문자열로 들어가 있는 곳(정적 HTML, innerHTML 템플릿, textContent 상태 메시지)을 하나하나 고치는 대신,
 * 텍스트 노드를 감시해 매핑표에 있는 이모지를 <svg class="ic"><use href="#ic-이름"/></svg>로 바꾼다.
 * 아이콘은 currentColor를 따르므로 주변 글자색·크기(em)에 자동으로 맞는다. 상태 아이콘(✅❌⚠️💡 등)은 고유 색을 가진다.
 * input/textarea/option/title 안의 글자, 캔버스 글자, 속성(title=""), confirm() 문구는 대상이 아니다.
 * 새 이모지를 쓰고 싶으면 아래 MAP에 이름을 추가하고 SYMBOLS에 아이콘을 정의한다(매핑에 없는 이모지는 그대로 보인다).
 */
(function () {
  'use strict';

  // 이모지 → 아이콘 이름
  var MAP = {
    '✏️': 'pencil', '✏': 'pencil', '📝': 'note',
    '🗑': 'trash', '🗑️': 'trash',
    '📈': 'chart-up', '📉': 'chart-down', '📊': 'chart-bar',
    '🔄': 'refresh', '🏠': 'house', '🧮': 'calculator', '📸': 'camera', '💾': 'archive',
    '💼': 'briefcase', '🔁': 'arrows-lr', '🧾': 'doc-text',
    '💰': 'dollar', '💵': 'dollar', '💸': 'banknote',
    '📅': 'calendar', '🗓': 'calendar', '🗓️': 'calendar',
    '📥': 'tray-down', '📤': 'tray-up', '📂': 'folder', '📋': 'clipboard',
    '👁': 'eye', '👁️': 'eye', '⏳': 'hourglass', '💬': 'bubble', '⚡': 'bolt',
    '🔗': 'link', '🏥': 'cross-case', '📖': 'book', '🎯': 'target',
    '🔶': 'diamond-orange', '🔷': 'diamond-blue', '💎': 'gem', '✨': 'sparkles',
    '🥇': 'medal-1', '🥈': 'medal-2', '🥉': 'medal-3',
    '✅': 'check-circle', '❌': 'xmark-circle', '⚠️': 'warning', '⚠': 'warning',
    '💡': 'bulb', '✔': 'check', '✔️': 'check'
  };

  // 24x24 격자, 선 굵기·끝 모양은 CSS(.ic)가 정한다. 고유 색이 필요한 상태 아이콘만 fill/stroke를 직접 지정.
  var SYMBOLS = {
    'pencil': '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
    'note': '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    'trash': '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/>',
    'chart-up': '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    'chart-down': '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
    'chart-bar': '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    'refresh': '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    'house': '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    'calculator': '<rect x="4" y="2" width="16" height="20" rx="2.5"/><line x1="8" y1="6.5" x2="16" y2="6.5"/><path d="M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 18.5h.01M12 18.5h.01M16 18.5h.01" stroke-width="2.4"/>',
    'camera': '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    'archive': '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/>',
    'briefcase': '<rect x="2" y="7" width="20" height="14" rx="2.5"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    'arrows-lr': '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    'doc-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    'dollar': '<circle cx="12" cy="12" r="10"/><path d="M15.5 9a3.5 2.5 0 0 0-3.5-1.5c-2 0-3.5 1-3.5 2.5s1.5 2 3.5 2.5 3.5 1 3.5 2.5-1.5 2.5-3.5 2.5A3.5 2.5 0 0 1 8.5 15"/><path d="M12 5.8v2m0 8.4v2"/>',
    'banknote': '<rect x="2" y="6" width="20" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01M18 12h.01" stroke-width="2.4"/>',
    'calendar': '<rect x="3" y="4" width="18" height="18" rx="3"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    'tray-down': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    'tray-up': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    'folder': '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    'clipboard': '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1.5"/>',
    'eye': '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    'hourglass': '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
    'bubble': '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    'bolt': '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    'cross-case': '<rect x="3" y="7" width="18" height="14" rx="2.5"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M12 11v6M9 14h6"/>',
    'book': '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    'target': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    'gem': '<path d="M6 3h12l4 6-10 13L2 9z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',
    'sparkles': '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    'diamond-orange': '<path d="M12 2l10 10-10 10L2 12z" fill="#ff9f0a" stroke="#ff9f0a" stroke-linejoin="round"/>',
    'diamond-blue': '<path d="M12 2l10 10-10 10L2 12z" fill="#0a84ff" stroke="#0a84ff" stroke-linejoin="round"/>',
    'medal-1': '<circle cx="12" cy="12" r="10" fill="#f5b301" stroke="none"/><path d="M10 8.6 12.4 7v10" stroke="#fff" stroke-width="2.2" fill="none"/>',
    'medal-2': '<circle cx="12" cy="12" r="10" fill="#a1a7b3" stroke="none"/><path d="M8.8 9.3a3.2 3.2 0 1 1 5.6 2.1L8.8 17h6.6" stroke="#fff" stroke-width="2" fill="none"/>',
    'medal-3': '<circle cx="12" cy="12" r="10" fill="#c98a4b" stroke="none"/><path d="M9 8h6l-3.2 3.6a3.1 3.1 0 1 1-3 4.2" stroke="#fff" stroke-width="2" fill="none"/>',
    'check-circle': '<circle cx="12" cy="12" r="10" fill="#34c759" stroke="none"/><path d="M7.4 12.6l3 3 6.2-6.6" stroke="#fff" stroke-width="2.3" fill="none"/>',
    'xmark-circle': '<circle cx="12" cy="12" r="10" fill="#ff3b30" stroke="none"/><path d="M8.6 8.6l6.8 6.8M15.4 8.6l-6.8 6.8" stroke="#fff" stroke-width="2.3" fill="none"/>',
    'warning': '<path d="M12 3.4 21.6 20H2.4z" fill="#ff9500" stroke="#ff9500" stroke-width="2.2" stroke-linejoin="round"/><path d="M12 9.6v4.8" stroke="#fff" stroke-width="2.3" fill="none"/><circle cx="12" cy="17.4" r="1.3" fill="#fff" stroke="none"/>',
    'bulb': '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" stroke="#ff9f0a"/><path d="M9 18h6" stroke="#ff9f0a"/><path d="M10 22h4" stroke="#ff9f0a"/>',
    'check': '<polyline points="20 6 9 17 4 12"/>'
  };

  var esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
  var keys = Object.keys(MAP).sort(function (a, b) { return b.length - a.length; });
  var RE = new RegExp(keys.map(esc).join('|'), 'g');
  var SKIP = 'script,style,textarea,option,select,input,title,svg';

  // ── 스타일 ──
  var css = '.ic{display:inline-block;width:1.15em;height:1.15em;vertical-align:-.2em;flex-shrink:0;' +
    'fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}';
  // ── 눌림 피드백(모든 페이지 공통) ── 누르면 추가 동작이 일어나는 버튼/카드/요약행은 살짝 줄어들며 어두워진다.
  // 탭·서브탭·기간 탭·모드 토글처럼 선택 상태로 배경이 바뀌는 것은 제외(PRESS_SKIP). 아이콘 버튼(.edit-btn 등)은 자체 규칙이 있다.
  css += '.pressed-flash{transform:scale(.95);filter:brightness(.88);}' +
    ':is(button,a.btn,[role=button],summary,.suggest-item,.div-cal-cell,a.card,.toggle-ctrl):not(.no-press):not(.edit-btn,.del-btn,.btn-chart,.btn-editicon,:disabled){transition:transform .12s,filter .12s;}' +
    ':is(button,a.btn,[role=button],summary,.suggest-item,.div-cal-cell,a.card,.toggle-ctrl):not(.no-press):not(.edit-btn,.del-btn,.btn-chart,.btn-editicon,:disabled):active{transform:scale(.95);filter:brightness(.88);}' +
    'tr[onclick]:active>td,th[onclick]:active{background:rgba(60,60,67,.08);}';
  var st = document.createElement('style');
  st.setAttribute('data-icons', '');
  st.textContent = css;
  document.head.appendChild(st);

  // ── 스프라이트 ──
  var sym = Object.keys(SYMBOLS).map(function (k) {
    return '<symbol id="ic-' + k + '" viewBox="0 0 24 24">' + SYMBOLS[k] + '</symbol>';
  }).join('');
  var sprite = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  sprite.setAttribute('aria-hidden', 'true');
  sprite.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  sprite.innerHTML = sym;
  (document.body || document.documentElement).insertBefore(sprite, (document.body || document.documentElement).firstChild);

  function iconEl(name, emoji) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'ic ic-' + name);
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('data-e', emoji);
    var u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    u.setAttribute('href', '#ic-' + name);
    s.appendChild(u);
    return s;
  }

  function convertTextNode(n) {
    var v = n.nodeValue;
    if (!v) return;
    RE.lastIndex = 0;
    if (!RE.test(v)) return;
    var el = n.parentElement;
    if (!el || el.closest(SKIP)) return;
    var frag = document.createDocumentFragment(), last = 0;
    RE.lastIndex = 0;
    v.replace(RE, function (m, off) {
      if (off > last) frag.appendChild(document.createTextNode(v.slice(last, off)));
      frag.appendChild(iconEl(MAP[m], m));
      last = off + m.length;
      return m;
    });
    if (last < v.length) frag.appendChild(document.createTextNode(v.slice(last)));
    n.parentNode.replaceChild(frag, n);
  }

  function convertSubtree(root) {
    if (!root) return;
    if (root.nodeType === 3) { convertTextNode(root); return; }
    if (root.nodeType !== 1 || root.closest && root.closest(SKIP)) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = [], n;
    while ((n = w.nextNode())) { RE.lastIndex = 0; if (RE.test(n.nodeValue)) list.push(n); }
    list.forEach(convertTextNode);
  }

  convertSubtree(document.body);
  new MutationObserver(function (recs) {
    recs.forEach(function (r) {
      if (r.type === 'characterData') convertTextNode(r.target);
      else r.addedNodes.forEach(convertSubtree);
    });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  // ── 눌림 피드백: 실행 지연 ──
  // 누르면 화면을 바로 다시 그리는 버튼(예: '세부 정보 닫기')은 눌린 모습이 그려지기도 전에 사라진다.
  // 인라인 onclick이 있는 동작 버튼은 첫 클릭을 붙잡아 눌림 클래스를 씌우고 150ms 뒤 같은 요소를 다시 클릭해 원래 동작을 실행한다.
  var PRESS_TARGET = 'button,a.btn,[role=button],summary,.suggest-item,.div-cal-cell,a.card,.toggle-ctrl';
  var PRESS_SKIP = '.no-press,.tabbar,.subtabbar,.period-tabs,.trade-tab,.main-tabs,.tab-btn,.toggle-pill,[role=switch],' +
    '#stockDetailToggleBtn,[id^=cf_mode_],[id^=ep_mode_],.plan-banner-backdrop';
  var PRESS_DELAY = 150;
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest(PRESS_TARGET);
    if (!el) return;
    if (el.__pressReplay) { el.__pressReplay = false; return; }        // 지연 후 재발사된 클릭 — 그대로 통과
    var oc = el.getAttribute('onclick');
    if (!oc || oc.indexOf('flashPress(') >= 0 || el.disabled || el.matches(PRESS_SKIP) || el.closest(PRESS_SKIP)) return;
    e.preventDefault(); e.stopPropagation();
    el.classList.add('pressed-flash');
    setTimeout(function () {
      el.classList.remove('pressed-flash');
      if (!el.isConnected || el.disabled) return;
      el.__pressReplay = true; el.click();
      el.__pressReplay = false;                                           // 클릭이 막혔더라도 플래그가 남지 않게
    }, PRESS_DELAY);
  }, true);

  window.Icons = { map: MAP, convert: convertSubtree };
})();
