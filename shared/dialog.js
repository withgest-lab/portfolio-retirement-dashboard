/*
 * shared/dialog.js
 * 브라우저 기본 alert/confirm 대신 쓰는 iOS 알림창 — 포트폴리오·현금흐름이 같이 쓴다.
 *   iosConfirm({title, message, okText, cancelText, destructive}) → Promise<boolean>
 *   iosAlert(message, {title, okText})                            → Promise<void>
 *   fieldError(inputEl, message)  입력 누락 안내: 칸 아래 작은 빨간 문구 + 포커스(다음 입력 때 자동으로 사라짐)
 * 가운데 270px 둥근 카드, 버튼은 0.5px 헤어라인으로 구분. 삭제 같은 되돌릴 수 없는 동작은 destructive(빨강 글자).
 * ESC·바깥 탭 = 취소. 색은 고정값이라 다크 모드(페이지 전체 반전)에서도 같이 뒤집혀 자연스럽다.
 */
(function () {
  'use strict';

  var css = document.createElement('style');
  css.textContent =
    '.ios-dlg-back{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;padding:24px;' +
      'opacity:0;transition:opacity .16s;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);}' +
    '.ios-dlg-back.show{opacity:1;}' +
    '.ios-dlg{width:270px;max-width:100%;background:rgba(250,250,252,.96);border-radius:14px;overflow:hidden;text-align:center;' +
      'font-family:"Pretendard Variable",Pretendard,-apple-system,BlinkMacSystemFont,sans-serif;color:#1c1c1e;' +
      'box-shadow:0 12px 32px rgba(0,0,0,.18);transform:scale(1.08);transition:transform .16s;}' +
    '.ios-dlg-back.show .ios-dlg{transform:scale(1);}' +
    '.ios-dlg-body{padding:18px 16px 16px;}' +
    '.ios-dlg-title{font-size:16px;font-weight:700;line-height:1.35;word-break:keep-all;}' +
    '.ios-dlg-msg{font-size:13px;line-height:1.45;color:#3c3c43;margin-top:4px;white-space:pre-line;word-break:keep-all;}' +
    '.ios-dlg-title+.ios-dlg-msg{color:#636366;}' +
    '.ios-dlg-btns{display:flex;border-top:.5px solid rgba(60,60,67,.29);}' +
    '.ios-dlg-btn{flex:1 1 0;min-width:0;border:none;background:transparent;cursor:pointer;font-family:inherit;font-size:16px;font-weight:400;' +
      'color:#007aff;padding:12px 8px;transition:background .1s;}' +
    '.ios-dlg-btn+.ios-dlg-btn{border-left:.5px solid rgba(60,60,67,.29);}' +
    '.ios-dlg-btn:focus{outline:none;}' +
    '.ios-dlg-btn:active{background:rgba(60,60,67,.12);}' +
    '.ios-dlg-btn.primary{font-weight:700;}' +
    '.ios-dlg-btn.destructive{color:#ff3b30;}' +
    '.field-err{font-size:11px;font-weight:600;color:#ff3b30;margin-top:3px;line-height:1.3;}' +
    '.field-err-on{border-color:#ff3b30 !important;}';
  (document.head || document.documentElement).appendChild(css);

  function open(opts) {
    return new Promise(function (resolve) {
      var back = document.createElement('div');
      back.className = 'ios-dlg-back';
      var box = document.createElement('div');
      box.className = 'ios-dlg';
      box.setAttribute('role', 'alertdialog');
      box.setAttribute('aria-modal', 'true');
      var body = document.createElement('div');
      body.className = 'ios-dlg-body';
      if (opts.title) { var t = document.createElement('div'); t.className = 'ios-dlg-title'; t.textContent = opts.title; body.appendChild(t); }
      if (opts.message) { var m = document.createElement('div'); m.className = 'ios-dlg-msg'; m.textContent = opts.message; body.appendChild(m); }
      var btns = document.createElement('div');
      btns.className = 'ios-dlg-btns';
      var prevFocus = document.activeElement;
      function done(v) {
        document.removeEventListener('keydown', onKey, true);
        back.classList.remove('show');
        setTimeout(function () { if (back.parentNode) back.parentNode.removeChild(back); }, 170);
        try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) {}
        resolve(v);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
      }
      if (opts.cancel) {
        var c = document.createElement('button');
        c.type = 'button'; c.className = 'ios-dlg-btn'; c.textContent = opts.cancel;
        c.addEventListener('click', function () { done(false); });
        btns.appendChild(c);
      }
      var ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'ios-dlg-btn primary' + (opts.destructive ? ' destructive' : '');
      ok.textContent = opts.ok;
      ok.addEventListener('click', function () { done(true); });
      btns.appendChild(ok);
      box.appendChild(body); box.appendChild(btns); back.appendChild(box);
      back.addEventListener('mousedown', function (e) { if (e.target === back && opts.cancel) done(false); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(back);
      requestAnimationFrame(function () { back.classList.add('show'); });
      // 되돌릴 수 없는 동작은 취소 쪽에 먼저 포커스(Enter 실수 방지는 아니지만 iOS처럼 안전한 쪽을 기본으로 강조)
      try { (opts.destructive ? btns.firstChild : ok).focus({ preventScroll: true }); } catch (e) {}
    });
  }

  window.iosConfirm = function (o) {
    o = typeof o === 'string' ? { message: o } : (o || {});
    return open({ title: o.title, message: o.message, ok: o.okText || '확인', cancel: o.cancelText || '취소', destructive: !!o.destructive });
  };
  window.iosAlert = function (message, o) {
    o = o || {};
    return open({ title: o.title, message: message, ok: o.okText || '확인' }).then(function () {});
  };

  window.fieldError = function (el, message) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) { window.iosAlert(message); return; }
    var host = el.closest('label') || el.parentNode;
    var old = host.querySelector(':scope > .field-err');
    if (old) old.remove();
    var msg = document.createElement('div');
    msg.className = 'field-err';
    msg.textContent = message;
    msg.setAttribute('role', 'alert');
    if (host.tagName === 'LABEL') host.appendChild(msg); else el.insertAdjacentElement('afterend', msg);
    el.classList.add('field-err-on');
    try { el.focus({ preventScroll: false }); } catch (e) {}
    var clear = function () {
      msg.remove(); el.classList.remove('field-err-on');
      el.removeEventListener('input', clear); el.removeEventListener('change', clear);
    };
    el.addEventListener('input', clear); el.addEventListener('change', clear);
  };
})();
