/* 전역 다크모드 — 홈·포트폴리오·현금흐름·매수신호가 같은 origin의 localStorage 키 "kis-theme"를 공유한다.
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
    'html[data-theme="dark"]{color-scheme:dark;}' +
    'html[data-theme="dark"]:not([data-native-dark]){background:#fff;filter:invert(1) hue-rotate(180deg);}' +
    'html[data-theme="dark"]:not([data-native-dark]) img,html[data-theme="dark"]:not([data-native-dark]) video{filter:invert(1) hue-rotate(180deg);}' +
    /* 채워진 색 셀 위주의 트리맵 캔버스는 다시 뒤집어 원래 색(흰 글씨 포함)을 유지 */
    'html[data-theme="dark"]:not([data-native-dark]) #qvTreemapCanvas,html[data-theme="dark"]:not([data-native-dark]) #distMarketCanvas,html[data-theme="dark"]:not([data-native-dark]) #distAssetTypeCanvas,html[data-theme="dark"]:not([data-native-dark]) #distDetailCanvas{filter:invert(1) hue-rotate(180deg);}' +
    '.kis-theme-sw,.tabbar button.kis-theme-sw{display:inline-flex;align-items:center;gap:6px;flex-shrink:0;padding:5px 9px;border:1px solid rgba(60,60,67,.29);' +
      'background:#fff;color:#636366;border-radius:999px;font-size:11px;font-weight:600;line-height:1;font-family:inherit;cursor:pointer;white-space:nowrap;}' +
    '.kis-theme-sw .sw{width:26px;height:15px;border-radius:999px;background:#c7c7cc;position:relative;transition:.15s;flex-shrink:0;}' +
    '.kis-theme-sw .sw::after{content:"";position:absolute;top:2px;left:2px;width:11px;height:11px;border-radius:50%;background:#fff;transition:.15s;}' +
    '.kis-theme-sw.on{color:#007aff;border-color:#007aff;}' +
    '.kis-theme-sw.on .sw{background:#007aff;}' +
    '.kis-theme-sw.on .sw::after{left:13px;}' +
    '@media (max-width:480px){.kis-theme-sw .tx{display:none;}.kis-theme-sw{padding:5px 7px;gap:4px;}}';
  (document.head || root).appendChild(css);

  var buttons = [];
  function paint(){
    var dark = current()==='dark';
    buttons.forEach(function(b){ b.classList.toggle('on', dark); b.setAttribute('aria-checked', dark ? 'true' : 'false'); });
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
      b.innerHTML = '<span class="ico">🌙</span><span class="tx">다크 모드</span><span class="sw"></span>';
      b.addEventListener('click', function(){ set(current()==='dark' ? 'light' : 'dark'); });
      if(before) parent.insertBefore(b, before); else parent.appendChild(b);
      buttons.push(b); paint();
      return b;
    }
  };
})();
