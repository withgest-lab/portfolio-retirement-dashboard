// 좌우 스와이프·터치 이동 점검 — ios-design 스킬 8절. 스와이프(shared/swipe-tabs.js)·탭 구조·팝업(열린 창)·전체 화면 보기를 바꾸면 돌린다.
// 실제 터치 이벤트(CDP Input.dispatchTouchEvent — 브라우저 제스처·touch-action 경로를 그대로 탄다. 자바스크립트 흉내로는 실기기 문제가 안 잡힘)로:
//   ① 격자(--grid): 화면마다 3×3곳에서 다음(끝 화면은 이전)으로 밀어 정확히 한 칸 넘어가는지 — 목표 100%.
//      + 화면마다 가로로 밀리는 영역(넘치는 표 감싸개 등)이 0인지 — 있으면 그 위의 스와이프가 영역 스크롤에 먼저 쓰여 한 번에 안 넘어간다
//        (2026-10-24 원금기록장: 접힘 384에서 긴 배당 종목명이 표를 103px 넘치게 해 '한 번에 안 넘어감'). 가상 데이터는 fit-audit seedAll(원금기록 행 포함)
//   ② 특수 상황(--cases): 열린 창(모달·알림창·비교 화면·팝오버·풍선 도움말·플랜 선택+뒤 바탕·크게 보기) 위에서는 그대로,
//      처음·끝은 그대로, 두 손가락 확대 중에는 한 손가락 좌우 이동이 확대 화면을 옮기고 넘기지 않음, 세로·대각선(세로 우세)은 스크롤만,
//      버튼·스위치·카드 위에서 시작한 밀기가 클릭으로 새지 않음, 가로 스크롤 영역(끝 근처에서 밀면 그 영역만·끝에서 밀면 넘김),
//      매매전략 도움말 안에서 밀면 도움말 칸만 바뀜
// 사용(playwright가 NODE_PATH에 있어야 함, 정적 서버는 fit-audit과 같게 http://localhost:4173/):
//   node .claude/skills/ios-design/swipe-audit.js <portfolio|retirement|signals|all> [--grid|--cases] [--quick] [--base URL] [--vps 384x800,750x700]
//   --quick: 격자 뷰포트를 384×800·750×700·832×620 3개로. --only tradelog: 그 이름으로 시작하는 화면만 격자(작은 수정 = 부분 검증). 매매전략 데이터(scores.json·detail)는 로컬에 없으면 배포본에서 받아 쓴다.
// 실패가 있으면 종료 코드 1.
const path = require('path');
const { chromium } = require('playwright');
const fa = require(path.join(__dirname, 'fit-audit.js'));

const SITE = 'https://withgest-lab.github.io/portfolio-retirement-dashboard';
const FULL_VPS = [[384, 800], [412, 860], [750, 832], [750, 700], [832, 750], [832, 620]];
const QUICK_VPS = [[384, 800], [750, 700], [832, 620]];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function drag(cdp, x0, y0, dx, dy, ms = 160, n = 8) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= n; i++) { await sleep(ms / n); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx * i / n, y: y0 + dy * i / n }] }); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(160);
}
const cur = page => page.evaluate(() => swipeTabs._cfg.current(null).filter(Boolean).join('/'));
const goStep = (page, st) => page.evaluate(s => swipeTabs._cfg.go(s, 1, null), st);
const center = (page, sel) => page.evaluate(s => { const e = [...document.querySelectorAll(s)].find(x => x.getClientRects().length); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + Math.min(r.height / 2, 120))]; }, sel);
const dbgText = page => page.evaluate(() => { const d = [...document.querySelectorAll('body > div')].find(e => getComputedStyle(e).position === 'fixed' && /넘김|막힘|부족|느림|세로|시작 지점/.test(e.textContent)); return d ? d.textContent.replace(/\n/g, ' | ') : ''; });

const APPS = {
  portfolio: {
    url: 'portfolio/',
    prep: async (page, o) => {
      await page.evaluate(m => { Object.keys(m).forEach(k => localStorage.setItem(k, JSON.stringify(m[k]))); localStorage.setItem('swipe_debug', '1'); localStorage.setItem('currentPage', 'dashboard'); }, fa.seedAll());
      await page.reload({ waitUntil: 'load' }); await sleep(2500);
    },
    top: () => Math.max(...[...document.querySelectorAll('#tabbar, section.page.active > .subtabbar')].map(e => e.getBoundingClientRect().bottom)),
  },
  retirement: {
    url: 'retirement/',
    prep: async page => {
      await page.evaluate(() => { localStorage.clear(); localStorage.setItem('swipe_debug', '1'); });
      await page.reload({ waitUntil: 'load' }); await sleep(1200);
      await page.evaluate(() => autoSuggest());   // 결과 보기(요약·위기 점검)가 의미 있게 — fit-audit seedPlan과 같은 경로
      await page.waitForFunction(() => typeof _planPickOpts !== 'undefined' && _planPickOpts && _planPickOpts.length, null, { timeout: 30000 });
      await sleep(300); await page.evaluate(() => confirmPlan()); await sleep(600);
      await page.evaluate(() => setMainTab('design')); await sleep(300);
    },
    top: () => document.querySelector('.main-tabs').getBoundingClientRect().bottom,
  },
  signals: {
    url: 'signals/',
    route: true,
    prep: async page => { await page.evaluate(() => localStorage.setItem('swipe_debug', '1')); await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => document.querySelectorAll('#grid .card').length > 0, null, { timeout: 30000 }).catch(() => {}); await sleep(800); },
    top: () => document.querySelector('#mode-seg').getBoundingClientRect().bottom,
  },
};

async function openPage(browser, o, app, w, h, logs) {
  const A = APPS[app];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  page.on('pageerror', e => logs.push(`  ! ${app} ${w}x${h} 페이지 오류: ${e.message}`));
  if (A.route) {   // 로컬엔 매매전략 데이터가 없다 → 배포본의 공개 데이터로 채운다
    await page.route(/\/signals\/(scores\.json|detail\/[^?]+\.json)/, async route => {
      const u = new URL(route.request().url());
      const local = await page.request.fetch(route.request().url()).catch(() => null);
      if (local && local.ok()) return route.fulfill({ response: local });
      const r = await page.request.fetch(SITE + u.pathname.replace(/^.*\/signals\//, '/signals/'));
      return route.fulfill({ response: r });
    });
  }
  await page.goto(o.base + A.url, { waitUntil: 'load' });
  await A.prep(page, o);
  return { ctx, page, cdp };
}

// ① 격자
async function grid(browser, o, app, logs) {
  const A = APPS[app], fails = [];
  let total = 0, okN = 0;
  for (const [w, h] of o.vps) {
    const { ctx, page, cdp } = await openPage(browser, o, app, w, h, logs);
    const steps = await page.evaluate(() => swipeTabs._cfg.steps(null));
    let t0 = 0, k0 = 0;
    for (let si = 0; si < steps.length; si++) {
      const st = steps[si], name = st.filter(Boolean).join('/');
      if (o.only && !name.startsWith(o.only)) continue;   // --only: 바꾼 화면만(부분 검증)
      await goStep(page, st); await sleep(app === 'retirement' && st[1] === 'tb-risk' ? 2500 : 500);
      // 가로로 밀리는 영역(표 감싸개 등)이 있으면 그 위의 스와이프는 영역 스크롤에 먼저 쓰여 한 번에 안 넘어간다 → 모든 폭에서 0이어야 한다
      const hsAreas = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => {
        if (!e.getClientRects().length) return false;
        const cs = getComputedStyle(e); if (!/auto|scroll/.test(cs.overflowX) || cs.visibility === 'hidden') return false;
        return e.scrollWidth - e.clientWidth > 4;
      }).map(e => (e.id ? '#' + e.id : e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).join('.') : '')) + ' +' + (e.scrollWidth - e.clientWidth) + 'px')
        .concat(document.documentElement.scrollWidth - innerWidth > 0 ? ['페이지 +' + (document.documentElement.scrollWidth - innerWidth) + 'px'] : []));
      if (hsAreas.length) fails.push(`${w}x${h} ${name} 가로 스크롤 영역: ${hsAreas.join(', ')}`);
      const top = await page.evaluate(A.top);
      const ys = [0.15, 0.5, 0.82].map(f => Math.round(top + 6 + (h - top - 12) * f));
      const xs = [0.25, 0.5, 0.8].map(f => Math.round(w * f));
      const dir = si === steps.length - 1 ? -1 : 1;
      for (const y of ys) for (const x of xs) {
        const dx = dir > 0 ? -Math.min(130, x - 2) : Math.min(130, w - 2 - x);
        if (Math.abs(dx) < 70) continue;
        const at = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/)[0] : '') : '-'; }, [x, y]);
        await drag(cdp, x, y, dx, 0);
        const now = await cur(page), want = steps[si + dir].filter(Boolean).join('/');
        t0++;
        if (now === want) k0++; else fails.push(`${w}x${h} ${name} @${x},${y} ${at} → ${now} (기대 ${want}) :: ${await dbgText(page)}`);
        if (now !== name) { await goStep(page, st); await sleep(350); }
      }
    }
    logs.push(`  격자 ${app} ${w}x${h}: ${k0}/${t0}`);
    total += t0; okN += k0;
    await ctx.close();
  }
  return { total, okN, fails };
}

// ② 특수 상황
async function cases(browser, o, app, logs) {
  const res = [];
  const check = (name, ok, extra) => res.push({ name, ok, extra: extra || '' });
  // 확대(두 손가락) 중: 한 손가락 좌우 이동이 확대 화면을 옮기고 넘기지 않음 → 확대를 풀면 다시 넘김
  async function zoomCase(page, cdp, tag) {
    const before = await cur(page);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 }); await sleep(400);
    const z0 = await page.evaluate(() => Math.round(visualViewport.offsetLeft));
    const vw = page.viewportSize().width;
    await drag(cdp, Math.round(vw * 0.7), 420, -200, 0, 200, 10);
    const z1 = await page.evaluate(() => [Math.round(visualViewport.offsetLeft), document.documentElement.classList.contains('swipe-zoomed')]);
    const after = await cur(page);
    check(`${tag} 확대 ×2 중 좌우 이동 → 확대 화면이 옮겨지고 그대로`, z1[0] - z0 > 20 && after === before, `offsetLeft ${z0}→${z1[0]}, swipe-zoomed=${z1[1]}, ${before}→${after}`);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }); await sleep(400);
    const z2 = await page.evaluate(() => document.documentElement.classList.contains('swipe-zoomed'));
    check(`${tag} 확대를 풀면 swipe-zoomed 해제`, !z2);
  }
  // 버튼·스위치·카드 위에서 시작한 밀기가 클릭으로 새지 않는지 — 손가락에서 나온(isTrusted) click을 세어 0이어야 하고 화면은 넘어가야 한다
  //   (앱 설정 go()가 화면을 넘길 때 부르는 .click()은 untrusted라 세지 않는다)
  async function noClickCase(page, cdp, tag, sel) {
    const c = await center(page, sel);
    if (!c) { check(`${tag} ${sel} 없음`, false); return; }
    await page.evaluate(() => { window.__swClicks = 0; if (!window.__swClickHook) { window.__swClickHook = true; document.addEventListener('click', e => { if (e.isTrusted) window.__swClicks++; }, true); } });
    const before = await cur(page);
    await drag(cdp, c[0], c[1], c[0] > 140 ? -130 : 130, 0);
    await sleep(250);
    const n = await page.evaluate(() => window.__swClicks), after = await cur(page);
    check(`${tag} ${sel} 위에서 시작한 밀기 → 클릭 0·화면 넘김`, n === 0 && after !== before, `click ${n}회, ${before}→${after}`);
  }
  // ⓘ 풍선: 풍선 위에서 밀면 그대로, 바깥에서 밀면 넘기고 풍선은 닫힌다(새 화면 위에 남으면 안 됨)
  async function ipopCase(page, cdp, tag) {
    const openPop = () => page.evaluate(() => { const b = [...document.querySelectorAll('.ibtn,.ibtn-t')].find(x => x.getClientRects().length && x.getBoundingClientRect().top > 0 && x.getBoundingClientRect().bottom < innerHeight); if (!b) return false; b.click(); return !!document.getElementById('ipop'); });
    if (!(await openPop())) { check(`${tag} 보이는 ⓘ 버튼 없음`, false); return; }
    const before = await cur(page);
    const pc = await center(page, '#ipop');
    await drag(cdp, pc[0], pc[1], pc[0] > 140 ? -130 : 130, 0);
    check(`${tag} ⓘ 풍선 위에서 밀기 → 그대로`, (await cur(page)) === before, await dbgText(page));
    if (!(await page.evaluate(() => !!document.getElementById('ipop')))) await openPop();
    const vw = page.viewportSize().width, vh = page.viewportSize().height;
    const pt = await page.evaluate(([vw, vh]) => { const r = document.getElementById('ipop').getBoundingClientRect(); const y = r.bottom < vh - 160 ? Math.round(r.bottom + 90) : Math.round(Math.max(150, r.top - 90)); return [Math.round(vw * 0.75), y]; }, [vw, vh]);
    await drag(cdp, pt[0], pt[1], -150, 0);
    const after = await cur(page), left = await page.evaluate(() => !!document.getElementById('ipop'));
    check(`${tag} ⓘ 풍선 바깥에서 밀기 → 넘기고 풍선 닫힘`, after !== before && !left, `${before}→${after}, 풍선 남음=${left}`);
    if (after !== before) { await goStep(page, before.split('/')); await sleep(400); }
  }
  // 가로 스크롤 영역: 시험용 넘치는 표 감싸개를 화면 맨 위에 넣어 확인(실데이터 표가 넘칠 때와 같은 경로)
  async function hsCase(page, cdp, tag, hostSel) {
    await page.evaluate(sel => {
      const host = document.querySelector(sel); const d = document.createElement('div');
      d.className = 'tbl-wrap'; d.id = '__hsTest'; d.style.cssText = 'overflow-x:auto;height:90px;flex:0 0 auto;background:rgba(0,122,255,.06)';
      d.innerHTML = '<div style="width:2400px;height:90px"></div>'; host.prepend(d);
    }, hostSel);
    await sleep(600);   // MutationObserver → .swipe-hs 표시(250ms 묶음)
    const t = await page.evaluate(() => { const d = document.getElementById('__hsTest'); const r = d.getBoundingClientRect(); return { hs: d.classList.contains('swipe-hs'), max: d.scrollWidth - d.clientWidth, x: Math.round(r.left + r.width * 0.75), y: Math.round(r.top + r.height / 2) }; });
    check(`${tag} 넘치는 가로 영역에 swipe-hs 자동 표시`, t.hs);
    const base = await cur(page);
    const sl = () => page.evaluate(() => Math.round(document.getElementById('__hsTest').scrollLeft));
    await drag(cdp, t.x, t.y, -120, 0);
    check(`${tag} 가로 영역 끌기 → 그 영역만 밀림`, (await sl()) > 30 && (await cur(page)) === base, `scrollLeft=${await sl()}`);
    await page.evaluate(m => { document.getElementById('__hsTest').scrollLeft = m - 20; }, t.max); await sleep(80);
    await drag(cdp, t.x, t.y, -150, 0);
    const nearEnd = await cur(page);
    check(`${tag} 끝 20px 전에서 왼쪽 밀기 → 영역만 끝까지(화면 그대로)`, nearEnd === base, `${base}→${nearEnd}, scrollLeft=${await sl()}/${t.max}`);
    if (nearEnd !== base) { await goStep(page, base.split('/')); await sleep(400); }
    await page.evaluate(m => { document.getElementById('__hsTest').scrollLeft = m; }, t.max); await sleep(80);
    await drag(cdp, t.x, t.y, -150, 0);
    const atEnd = await cur(page);
    check(`${tag} 끝에서 왼쪽 밀기 → 다음 화면`, atEnd !== base, `${base}→${atEnd}`);
    await page.evaluate(() => document.getElementById('__hsTest')?.remove());
    await goStep(page, base.split('/')); await sleep(400);
  }
  async function overlayCase(page, cdp, tag, openFn, sel, closeFn, dx = -150, at) {
    const before = await cur(page);
    await page.evaluate(openFn); await sleep(800);
    const c = at || await center(page, sel);
    if (!c) { check(`${tag}: 창(${sel})이 안 열림`, false); await page.evaluate(closeFn).catch(() => {}); return; }
    await drag(cdp, c[0], c[1], dx, 0);
    const after = await cur(page);
    check(`${tag} 위에서 밀기 → 뒤 화면 그대로`, after === before, `${before}→${after} :: ${await dbgText(page)}`);
    await page.evaluate(closeFn).catch(() => {}); await sleep(300);
    if (after !== before) { await goStep(page, before.split('/')); await sleep(400); }
  }

  if (app === 'portfolio') {
    let { ctx, page, cdp } = await openPage(browser, o, app, 750, 700, []);
    await page.evaluate(() => switchPage('portfolio')); await sleep(400);
    await overlayCase(page, cdp, 'pf750 백업/복원 창', () => openBackupModal(), '.modal-bg.open > div', () => closeSheetsModal());
    await overlayCase(page, cdp, 'pf750 알림창', () => { iosConfirm({ title: '점검', message: '스와이프 점검' }); }, '.ios-dlg', () => { const b = document.querySelector('.ios-dlg-back'); if (b) b.remove(); });
    await overlayCase(page, cdp, 'pf750 비교 화면', () => cmpOpen(assets[0].id), '#cmpView', () => cmpClose());
    await page.evaluate(() => { switchPage('dashboard'); switchSubPage('dashboard', 'chart'); }); await sleep(600);
    await overlayCase(page, cdp, 'pf750 종목 선택 팝오버', () => document.getElementById('stockDetailToggleBtn').click(), '#assetTogglesDetail', () => closeChartPickPop());
    await drag(cdp, 200, 420, 150, 0);
    check('pf750 맨 처음에서 이전으로 밀기 → 그대로(튕김)', (await cur(page)) === 'dashboard/chart', await dbgText(page));
    await noClickCase(page, cdp, 'pf750', '#statToggleBtn');
    await page.evaluate(() => { switchPage('tax'); switchSubPage('tax', 'fit'); }); await sleep(500);
    await drag(cdp, 500, 420, -150, 0);
    check('pf750 맨 끝에서 다음으로 밀기 → 그대로(튕김)', (await cur(page)) === 'tax/fit', await dbgText(page));
    await page.evaluate(() => { switchPage('dividend'); switchSubPage('dividend', 'monthly'); }); await sleep(700);
    await ipopCase(page, cdp, 'pf750 배당금관리');
    await page.evaluate(() => switchPage('portfolio')); await sleep(400);
    await hsCase(page, cdp, 'pf750', 'section.page.active');
    await page.evaluate(() => switchPage('portfolio')); await sleep(400);
    await zoomCase(page, cdp, 'pf750');
    await ctx.close();
    ({ ctx, page, cdp } = await openPage(browser, o, app, 384, 800, []));
    await page.evaluate(() => switchPage('portfolio')); await sleep(500);
    await drag(cdp, 200, 600, 0, -300, 250);
    let v = await page.evaluate(() => Math.round(document.querySelector('section.page.active').scrollTop));
    check('pf384 세로 끌기 → 세로 스크롤만', v > 50 && (await cur(page)) === 'portfolio', 'scrollTop=' + v);
    await drag(cdp, 250, 600, -70, -150, 250);
    check('pf384 대각선(가로 70·세로 150) → 그대로', (await cur(page)) === 'portfolio', await cur(page));
    await ctx.close();
  }
  if (app === 'retirement') {
    const { ctx, page, cdp } = await openPage(browser, o, app, 750, 700, []);
    await page.evaluate(() => setMainTab('step2')); await sleep(400);
    const openPick = async () => { autoSuggest(); for (let i = 0; i < 120 && !document.getElementById('planPick').classList.contains('show'); i++) await new Promise(r => setTimeout(r, 250)); };
    await overlayCase(page, cdp, 'ret750 자동 설계 플랜 선택 팝업', openPick, '#planPick', () => closePlanPick());
    await overlayCase(page, cdp, 'ret750 플랜 선택 뒤 어두운 바탕', openPick, '#planPickBackdrop', () => closePlanPick(), 150, [40, 660]);
    await page.evaluate(() => setMainTab('design')); await sleep(400);
    await page.evaluate(() => setMainTab('step2')); await sleep(400);
    await ipopCase(page, cdp, 'ret750 2단계');
    await page.evaluate(() => setMainTab('design')); await sleep(300);
    await overlayCase(page, cdp, 'ret750 수익률·물가 설정 창', () => document.getElementById('ratesToggleBtn').click(), '#ratesWrap', () => closeRatesPop());
    await drag(cdp, 200, 420, 150, 0);
    check('ret750 맨 처음에서 이전으로 밀기 → 그대로(튕김)', (await cur(page)) === 'design', await dbgText(page));
    await noClickCase(page, cdp, 'ret750', '#ratesToggleBtn');
    await page.evaluate(() => setMainTab('tax')); await sleep(400);
    await drag(cdp, 500, 420, -150, 0);
    check('ret750 맨 끝에서 다음으로 밀기 → 그대로(튕김)', (await cur(page)) === 'tax', await dbgText(page));
    await page.evaluate(() => setMainTab('design')); await sleep(400);
    await zoomCase(page, cdp, 'ret750');
    await ctx.close();
  }
  if (app === 'signals') {
    const { ctx, page, cdp } = await openPage(browser, o, app, 750, 700, []);
    const cards = await page.evaluate(() => document.querySelectorAll('#grid .card').length);
    if (!cards) check('sig750 카드가 없음(데이터를 못 받음)', false);
    else {
      await overlayCase(page, cdp, 'sig750 종목 크게 보기', async () => { document.querySelector('#grid .card [data-action="fullscreen"]').click(); for (let i = 0; i < 40 && !document.getElementById('fullscreen-backdrop').classList.contains('open'); i++) await new Promise(r => setTimeout(r, 250)); }, '#fullscreen-backdrop', () => closeFullscreen(), -150, [375, 420]);
      await noClickCase(page, cdp, 'sig750', '#grid .card');
      await page.evaluate(() => swipeTabs._cfg.go(['buy', ''])); await sleep(400);
    }
    await page.evaluate(() => setHelpOpen(true)); await sleep(500);
    const hp = await page.evaluate(() => { const r = document.querySelector('#help-overlay .help-panel').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(Math.max(r.top + 60, Math.min(r.bottom - 40, 420)))]; });
    const st = () => page.evaluate(() => document.querySelector('#mode-seg .chip.active').dataset.mode + '/' + document.querySelector('#help-seg .chip.active').dataset.pane);
    const s0 = await st();
    await drag(cdp, hp[0], hp[1], -150, 0);
    const s1 = await st();
    check('sig750 도움말 안에서 밀기 → 도움말 칸만 다음(화면 모드 그대로)', s0 === 'buy/buy' && s1 === 'buy/sell', `${s0}→${s1}`);
    await drag(cdp, hp[0], hp[1], 150, 0);
    check('sig750 도움말 안에서 반대로 밀기 → 도움말 칸 이전', (await st()) === 'buy/buy', await st());
    await page.evaluate(() => setHelpOpen(false)); await sleep(300);
    await zoomCase(page, cdp, 'sig750');
    await ctx.close();
  }
  res.forEach(r => logs.push(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.extra ? ' — ' + r.extra : ''}`));
  return res;
}

async function main() {
  const args = process.argv.slice(2);
  const val = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const flagVals = new Set(['--base', '--vps', '--only'].map(k => args.indexOf(k)).filter(n => n >= 0).map(n => n + 1));   // 플래그 값 자리(예: --only portfolio)는 앱 이름이 아니다
  const which = args.find((a, n) => !a.startsWith('--') && !flagVals.has(n)) || 'all';
  const o = { only: val('--only'), base: (val('--base') || 'http://localhost:4173/').replace(/\/?$/, '/'), vps: val('--vps') ? val('--vps').split(',').map(s => s.split('x').map(Number)) : args.includes('--quick') ? QUICK_VPS : FULL_VPS };
  const doGrid = !args.includes('--cases'), doCases = !args.includes('--grid');
  const apps = which === 'all' ? Object.keys(APPS) : [which];
  const browser = await chromium.launch();
  let bad = 0;
  for (const app of apps) {
    const logs = [];
    if (doGrid) {
      const g = await grid(browser, o, app, logs);
      logs.push(`  → 격자 ${app}: ${g.okN}/${g.total} (${g.total ? Math.round(g.okN / g.total * 100) : 0}%)`);
      g.fails.slice(0, 30).forEach(f => logs.push('    ✗ ' + f));
      bad += g.fails.length;
    }
    if (doCases) bad += (await cases(browser, o, app, logs)).filter(r => !r.ok).length;
    console.log(`== ${app}\n` + logs.join('\n'));
  }
  await browser.close();
  console.log(bad ? `FAIL ${bad}` : 'PASS');
  process.exit(bad ? 1 : 0);
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { drag };
