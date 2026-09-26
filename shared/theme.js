/* 전역 다크모드 — 홈·포트폴리오·현금흐름·매수·매도 전략이 같은 origin의 localStorage 키 "kis-theme"를 공유한다.
   한 화면에서 켜면 다른 화면(이동/다른 탭)도 같은 모드로 열린다. 값이 없으면 기기(시스템) 설정을 따른다.
   - <head>에서 동기 로드해 첫 페인트 전에 data-theme를 정한다(깜빡임 방지).
   - 색이 CSS 변수로 정리된 페이지(html[data-native-dark])는 자기 다크 팔레트를 쓰고, 그 밖의 페이지는
     html 전체를 invert+hue-rotate(180°)로 뒤집어 다크로 만든다(색상 계열은 유지, 밝기만 반전. 캔버스 차트 포함).
   - kisTheme.mount(el): el 안에 ON/OFF 스위치("🌙 다크 모드")를 넣는다. */
(function(){
  var K = 'kis-theme', root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : {matches:false};
  var stored = null;
  try { var t = localStorage.getItem(K); if(t==='dark'||t==='light') stored = t; } catch(e){}
  function current(){ return root.dataset.theme || (mq.matches ? 'dark' : 'light'); }
  root.dataset.theme = stored || (mq.matches ? 'dark' : 'light');

  var css = document.createElement('style');
  css.textContent =
    'html[data-theme="dark"][data-native-dark]{color-scheme:dark;}' +
    'html[data-theme="dark"]:not([data-native-dark]){background:#fff;filter:invert(1) hue-rotate(180deg);}' +
    'html[data-theme="dark"]:not([data-native-dark]) img,html[data-theme="dark"]:not([data-native-dark]) video{filter:invert(1) hue-rotate(180deg);}' +
    /* 채워진 색 셀 위주의 트리맵 캔버스는 다시 뒤집어 원래 색(흰 글씨 포함)을 유지 */
    'html[data-theme="dark"]:not([data-native-dark]) #qvTreemapCanvas,html[data-theme="dark"]:not([data-native-dark]) #distMarketCanvas,html[data-theme="dark"]:not([data-native-dark]) #distAssetTypeCanvas,html[data-theme="dark"]:not([data-native-dark]) #distDetailCanvas{filter:invert(1) hue-rotate(180deg);}' +
    /* 초승달 아이콘 전용 버튼: OFF = 회색 윤곽, ON(다크) = 안이 흰색으로 채워진 초승달 */
    '.kis-theme-sw,.tabbar button.kis-theme-sw{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:26px;height:26px;padding:0;border:0;margin-left:6px;' +
      'background:transparent;border-radius:999px;cursor:pointer;color:#8e8e93;}' +
    '.top-bar .kis-theme-sw{margin-left:auto;}' +
    '.kis-theme-sw svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:.15s;}' +
    '.kis-theme-sw.on{color:#fff;}' +
    '.kis-theme-sw.on svg{fill:none;}' +
    'html[data-theme="dark"]:not([data-native-dark]) .kis-theme-sw{filter:invert(1) hue-rotate(180deg);}';
  (document.head || root).appendChild(css);

  var buttons = [];
  function paint(){
    var dark = current()==='dark';
    buttons.forEach(function(b){
      b.classList.toggle('on', dark); b.setAttribute('aria-checked', dark ? 'true' : 'false');
      // 라이트 = 초승달(누르면 다크), 다크 = 햇살(누르면 라이트)
      b.querySelector('svg').innerHTML = dark ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>' : '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
      b.title = dark ? '라이트 모드로 전환' : '다크 모드로 전환';
      b.setAttribute('aria-label', b.title);
    });
  }
  function set(v, persist){
    root.dataset.theme = v;
    if(persist !== false){ try { localStorage.setItem(K, v); } catch(e){} }
    paint();
    try { if(typeof window.onThemeChange === 'function') window.onThemeChange(v); } catch(e){}
  }
  // 다른 탭/화면에서 바꾼 값 즉시 반영
  window.addEventListener('storage', function(e){
    if(e.key===K && (e.newValue==='dark'||e.newValue==='light')) set(e.newValue, false);
  });
  // 저장된 선택이 없을 때만 시스템 설정 변화를 따른다
  var onMq = function(){ var s=null; try{ s = localStorage.getItem(K); }catch(e){} if(s!=='dark'&&s!=='light') set(mq.matches?'dark':'light', false); };
  if(mq.addEventListener) mq.addEventListener('change', onMq);

  window.kisTheme = {
    current: current,
    set: set,
    mount: function(parent, before){
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'kis-theme-sw'; b.setAttribute('role','switch');
      b.title = '다크 모드 켜기/끄기 (모든 화면에 적용)';
      b.setAttribute('aria-label','다크 모드 켜기/끄기');
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
      b.addEventListener('click', function(){ set(current()==='dark' ? 'light' : 'dark'); });
      if(before) parent.insertBefore(b, before); else parent.appendChild(b);
      buttons.push(b); paint();
      return b;
    }
  };
})();
