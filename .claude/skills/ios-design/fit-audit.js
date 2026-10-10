// 화면 꽉 채움·입력 박스 통일 검사 — ios-design 스킬 8절. 보고 전 "모든 화면 × 펼침·펼침+90도"에서 돌린다.
//
// 사용(CLI, playwright가 NODE_PATH에 있어야 함):
//   node .claude/skills/ios-design/fit-audit.js retirement            # 현금흐름 4탭(1·2단계 설계/결과/세금 상식) + 결과 보기 6종(연 현금흐름·연 자산 흐름·요약·건보료 예상·근거·위기 점검&부족 대책, 자동 설계 확정 경로 포함)
//   node .claude/skills/ios-design/fit-audit.js portfolio --seed      # 포트폴리오 전 화면(가상 데이터 25종목·매매 60건·스냅샷 30개를 심어서)
//   node .claude/skills/ios-design/fit-audit.js home | signals | all
//   옵션: --boxes(입력 박스 통일 검사 추가) --base http://localhost:4173/ --extra(이전 검증 폭 904/1003 등 7개 추가)
// 사용(코드):  const fa = require('<이 파일>');  console.log(await fa.measureFit(page));  console.log(await fa.measureBoxes(page));
//
// 기준(FAIL) — 말하지 않아도 항상 적용되는 규칙:
//   ① 펼침·펼침+90도(750×832·750×700·832×750·832×620 — 실기기 폭)에서 세로 넘침 0(스크롤 잠금 포함)·가로 넘침 0
//   ② 화면 아래 빈 공간 ≤ MAX_BLANK(20px, 바깥 여백 포함) — 남는 높이는 카드·행·차트가 채운다
//   ③ 휠로 끌어도 scrollTop 0(터치 유격 없음)
//   ④ 입력 박스 통일(--boxes): 같은 줄 컨트롤 높이 차 ≤ 1px, 높이 종류 ≤ 2, 폭 종류 ≤ 3, 어긋난 왼쪽 선(2~12px 차) 0
//   ⑤ 겹침·두 줄(--boxes, DESIGN_GUIDELINES 22절): 같은 행의 입력·선택·단위(세·만·%)·라벨 사각형이 1px 넘게 겹침 0, 라벨·단위가 두 줄로 꺾임 0, 입력 값이 칸 밖으로 잘림 0
// 예외(내용이 본질적으로 긴 화면): LONG 목록 — 가로 넘침 0만 검사. 접힘(390×800)은 가로 0만.

const MAX_BLANK = 20;
// 실기기(Fold7 안쪽 화면 1968×2184px ÷ 밀도 2.625) 캡처 비교로 확정(2026-10-10): 펼침 기본 ≈ 750px, 펼침+90도 ≈ 832px. 높이는 주소창 유무로 2종.
const VIEWPORTS = [[750, 832], [750, 700], [832, 750], [832, 620]];
const EXTRA = [[904, 900], [904, 780], [1003, 810], [1003, 700], [904, 850], [1003, 760], [1003, 620]];   // 이전 검증 폭(--extra) — 넓은 화면 회귀 확인용
const FOLDED = [390, 800];
// 긴 화면(세로 스크롤 허용) — 내용이 본질적으로 길거나 사용자 데이터 행 수에 따라 늘어나는 목록. 짧을 때는 마지막 카드가 화면 끝까지 늘어나 빈 공간이 없어야 한다(fillScrollerCard).
const LONG = new Set(['retirement/tax', 'signals', 'folded',
  'portfolio/portfolio', 'portfolio/tradelog', 'portfolio/dashboard/alloc', 'portfolio/returns/monthly_table', 'portfolio/dividend/monthly', 'portfolio/dividend/stock',
  'portfolio/tax/cgt', 'portfolio/returns/principal']);   // 양도세 매도 행·원금기록장 입출금 행은 사용자 데이터 수만큼 늘어남

// 화면 안에서 실제로 보이는 내용의 가장 아래(뷰포트 기준)와 넘침을 잰다
const IN_PAGE_FIT = () => {
  const de = document.documentElement, body = document.body;
  const cands = [];
  try { if (typeof getScroller === 'function') cands.push(getScroller()); } catch (e) {}
  cands.push(body, document.scrollingElement || de);
  const sc = cands.filter(Boolean).reduce((a, b) => ((b.scrollHeight - b.clientHeight) > (a.scrollHeight - a.clientHeight) ? b : a), cands.find(Boolean));
  const locked = [sc, body, de].some(e => e && e.classList && e.classList.contains('fit-noscroll'));
  let low = 0;
  const root = sc === document.scrollingElement ? body : sc;
  root.querySelectorAll('*').forEach(el => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.height < 2 || r.width < 2 || cs.visibility === 'hidden' || cs.display === 'none' || cs.position === 'fixed' || cs.opacity === '0') return;
    if (r.top >= innerHeight) return;
    if (el.closest('.top-bar, .tabbar, .subtabbar, .main-tabs, [aria-hidden="true"]')) return;
    low = Math.max(low, Math.min(r.bottom, innerHeight));
  });
  return { over: Math.max(0, sc.scrollHeight - sc.clientHeight), locked, hS: Math.max(0, Math.max(de.scrollWidth, body.scrollWidth) - innerWidth), blank: Math.max(0, Math.round(innerHeight - low)), vh: innerHeight };
};

// 입력 박스(숫자·나이·선택·읽기전용) 크기·정렬 검사
const IN_PAGE_BOXES = () => {
  const vis = e => e.offsetParent !== null && !['hidden', 'range', 'checkbox', 'radio', 'file'].includes(e.type) && e.getBoundingClientRect().height > 8 && e.getBoundingClientRect().width > 8;
  const els = [...document.querySelectorAll('input, select')].filter(vis);
  const box = e => { const r = e.getBoundingClientRect(); return { id: e.id || e.name || e.className.toString().slice(0, 14) || e.tagName, top: r.top, left: r.left, h: Math.round(r.height), w: Math.round(r.width) }; };
  const items = els.map(box);
  const kinds = (arr, key, tol) => { const out = []; arr.map(i => i[key]).sort((a, b) => a - b).forEach(v => { if (!out.length || v - out[out.length - 1] > tol) out.push(v); }); return out; };
  // ① 같은 줄(top 차 ≤ 4px) 컨트롤의 높이 차
  const sameLine = [];
  const byTop = items.slice().sort((a, b) => a.top - b.top);
  for (let i = 0; i < byTop.length; i++) {
    const row = [byTop[i]];
    while (i + 1 < byTop.length && byTop[i + 1].top - byTop[i].top <= 4) row.push(byTop[++i]);
    if (row.length > 1) { const hs = row.map(r => r.h); if (Math.max(...hs) - Math.min(...hs) > 1) sameLine.push(row.map(r => r.id + ':' + r.h).join(' / ')); }
  }
  // ④ 어긋난 왼쪽 선: 같은 카드·패널 안에서 왼쪽 위치가 2~12px 차이로 비슷하게 늘어선 입력(같은 열인데 안 맞는 것)
  const nearMiss = [];
  const groups = new Map();
  els.forEach((e, i) => { const c = e.closest('.acct-card, .sec-card, .inline-panel, .basic-row, .modal, .fm, .card') || document.body; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(items[i]); });
  groups.forEach(list => { const ls = list.slice().sort((x, y) => x.left - y.left); for (let i = 1; i < ls.length; i++) { const d = ls[i].left - ls[i - 1].left; if (d >= 2 && d <= 12) nearMiss.push(ls[i - 1].id + '↔' + ls[i].id + '(' + Math.round(d) + 'px)'); } });
  // ⑤ 겹침·두 줄·잘림 — 같은 행(.health-input-row/.irow/.fm-f 등) 안의 컨트롤·단위·라벨 사각형 교차, 글자 두 줄 꺾임, 입력 값 잘림
  const rowSel = '.health-input-row, .irow, .fm-f, .ymon-amt, .irow-ctrl, .hir-range';
  const parts = [...document.querySelectorAll('input, select, .unit-tag, .hir-label, .ilabel, .req-st')].filter(e => {
    if (e.offsetParent === null || ['hidden', 'range', 'checkbox', 'radio', 'file'].includes(e.type)) return false;
    if (e.closest('[aria-hidden="true"]') || getComputedStyle(e).visibility === 'hidden') return false;
    const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2;
  });
  const nm = e => (e.id || e.name || (e.className && e.className.toString().split(' ')[0]) || e.tagName) + (e.matches('.unit-tag, .hir-label, .ilabel, .req-st') ? '「' + e.textContent.trim().slice(0, 8) + '」' : '');
  const overlaps = [], wraps = [], clipped = [];
  const byRow = new Map();
  parts.forEach(e => { for (let r = e.closest(rowSel); r; r = r.parentElement && r.parentElement.closest(rowSel)) { if (!byRow.has(r)) byRow.set(r, []); byRow.get(r).push(e); } });
  byRow.forEach(list => {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ox > 1 && oy > 1) overlaps.push(nm(a) + '×' + nm(b) + '(' + Math.round(ox) + 'px)');
    }
  });
  parts.forEach(e => {
    if (e.matches('input, select')) { if (e.tagName === 'INPUT' && e.value && e.scrollWidth > e.clientWidth + 1 && e.type !== 'date') clipped.push(nm(e) + '=' + e.value.slice(0, 8)); return; }
    const tw = document.createTreeWalker(e, NodeFilter.SHOW_TEXT), tops = [];   // 글자 노드만(ⓘ 버튼 같은 인라인 요소는 제외 — 줄 높이 차로 오탐)
    for (let n = tw.nextNode(); n; n = tw.nextNode()) { if (!n.textContent.trim() || n.parentElement.closest('button')) continue; const rg = document.createRange(); rg.selectNodeContents(n); [...rg.getClientRects()].filter(r => r.width > 1).forEach(r => tops.push(Math.round(r.top))); }
    if (tops.length && Math.max(...tops) - Math.min(...tops) > 4) wraps.push(nm(e));
    else if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible') clipped.push(nm(e));
  });
  // 폭 종류: 내용에 맞춘 select(.hir-input)와 의도된 전용 폭(.hir-wide)은 3단계(sm/md/lg) 판정에서 뺀다(높이·정렬·겹침은 그대로 검사)
  const wItems = items.filter((_, i) => !(els[i].matches('.hir-wide') || (els[i].tagName === 'SELECT' && els[i].classList.contains('hir-input'))));
  return { count: items.length, hKinds: kinds(items, 'h', 1), wKinds: kinds(wItems, 'w', 2), sameLine, nearMiss, overlaps, wraps, clipped };
};

async function measureFit(page) {
  const m = await page.evaluate(IN_PAGE_FIT);
  const w = await page.viewportSize();
  await page.mouse.move(Math.round(w.width / 2), Math.round(w.height / 2));
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(120);
  const top = await page.evaluate(() => { const c = [document.body, document.scrollingElement]; try { if (typeof getScroller === 'function') c.push(getScroller()); } catch (e) {} return Math.max(...c.filter(Boolean).map(e => e.scrollTop || 0)); });
  await page.evaluate(() => { [document.body, document.scrollingElement].forEach(e => e && (e.scrollTop = 0)); try { const s = getScroller(); if (s) s.scrollTop = 0; } catch (e) {} });
  return Object.assign(m, { wheelTop: Math.round(top) });
}
async function measureBoxes(page) { return page.evaluate(IN_PAGE_BOXES); }

const judgeFit = (m, isLong) => {
  const f = [];
  if (m.hS > 0) f.push('가로 넘침 ' + m.hS);
  if (isLong) return f;
  if (m.over > 0 && !m.locked) f.push('세로 넘침 ' + m.over);
  if (m.blank > MAX_BLANK) f.push('아래 빈 공간 ' + m.blank);
  if (m.wheelTop > 0) f.push('휠 후 scrollTop ' + m.wheelTop);
  return f;
};
const judgeBoxes = b => {
  const f = [];
  if (b.sameLine.length) f.push('같은 줄 높이 차: ' + b.sameLine.slice(0, 3).join(' | '));
  if (b.hKinds.length > 2) f.push('높이 종류 ' + b.hKinds.length + '(' + b.hKinds.join('/') + ')');
  if (b.wKinds.length > 3) f.push('폭 종류 ' + b.wKinds.length + '(' + b.wKinds.join('/') + ')');
  if (b.nearMiss.length) f.push('어긋난 왼쪽 선 ' + b.nearMiss.slice(0, 4).join(','));
  if (b.overlaps && b.overlaps.length) f.push('겹침 ' + b.overlaps.slice(0, 4).join(','));
  if (b.wraps && b.wraps.length) f.push('두 줄 꺾임 ' + b.wraps.slice(0, 4).join(','));
  if (b.clipped && b.clipped.length) f.push('잘림 ' + b.clipped.slice(0, 4).join(','));
  return f;
};

// 가상 포트폴리오(공개 저장소 규칙: 가상의 둥근 값만) — 목록형 화면을 현실적인 행 수로 점검하기 위해 감사 스크립트 안에서만 심는다
const seedAssets = () => {
  const rows = [], mk = (i, t, n, acct, mkt, q, avg, cur, ccy) => rows.push({ id: 's' + i, ticker: t, name: n, acctType: acct, market: mkt, quantity: q, avgPrice: avg, currentPrice: cur, prevPrice: cur, currency: ccy });
  for (let i = 1; i <= 12; i++) mk(i, 'KR' + i, '국내종목 ' + i, i % 3 ? 'general' : 'isa', 'kr', 10 * i, 10000 * i, 11000 * i, 'KRW');
  for (let i = 13; i <= 22; i++) mk(i, 'US' + i, '미국종목 ' + i, 'general', 'us', 5 * (i - 12), 100 + 10 * (i - 12), 120 + 10 * (i - 12), 'USD');
  for (let i = 23; i <= 25; i++) mk(i, 'ETF' + i, '글로벌ETF ' + i, i % 2 ? 'pension_personal' : 'irp', 'global', 100 * (i - 22), 15000, 16000, 'KRW');
  const TYPES = ['Core', '주도주', '유망주', '원자재', '안전자산'], COS = ['가상증권A', '가상증권B', '가상은행C'];
  rows.forEach((r, i) => { r.assetType = TYPES[i % TYPES.length]; r.company = COS[i % COS.length]; });
  return rows;
};
// 매매 이력 60건(매수·매도·배당·입금) — 둥근 가상 값
const seedTradeLog = () => {
  const assets = seedAssets(), out = [], day = 86400000, now = Date.now();
  for (let i = 0; i < 60; i++) {
    const a = assets[i % assets.length], kind = ['buy', 'sell', 'dividend', 'buy', 'sell'][i % 5], fx = a.currency === 'USD' ? 1400 : 1;
    const at = now - (i + 1) * 11 * day, qty = 1 + (i % 7), price = a.currentPrice;
    if (kind === 'dividend') out.push({ id: 't' + i, name: a.name, ticker: '—', type: 'dividend', at, acctType: 'cash', assetType: null, company: a.company, price: null, quantity: null, currency: a.currency, totalKRW: 30000 + 1000 * (i % 9), pnl: 30000 + 1000 * (i % 9), pnlPct: null, reason: '', cashAdjusted: null });
    else out.push({ id: 't' + i, name: a.name, ticker: a.ticker, type: kind, at, acctType: a.acctType, assetType: a.assetType, company: a.company, market: a.market, price, quantity: qty, currency: a.currency, totalKRW: Math.round(price * qty * fx), pnl: kind === 'sell' ? Math.round(price * qty * fx * 0.08) : null, pnlPct: kind === 'sell' ? 8 : null, reason: kind === 'sell' ? '목표 수익 달성' : '', cashAdjusted: null });
  }
  return out;
};
// 월말 스냅샷 30개 — 자산이 완만히 늘어난 가상 이력
const seedSnaps = () => {
  const assets = seedAssets(), out = [], day = 86400000, now = Date.now();
  for (let i = 0; i < 30; i++) {
    const f = 0.7 + 0.3 * i / 29 + (i % 4 === 0 ? -0.02 : 0.01), byAsset = {}, byQty = {};
    let total = 0;
    assets.forEach(a => { const ev = Math.round(a.currentPrice * a.quantity * (a.currency === 'USD' ? 1400 : 1) * f); byAsset[a.id] = ev; byQty[a.id] = a.quantity; total += ev; });
    out.push({ id: 'n' + i, timestamp: now - (29 - i) * 30 * day, totalValue: total, byAsset, byQty, manual: false });
  }
  return out;
};
const seedAll = () => ({ pf_assets_v1: seedAssets(), pf_tradelog_v1: seedTradeLog(), pf_snaps_v5: seedSnaps() });

// 현금흐름 결과 탭 보기 6종 — 요약·근거·위기 점검·부족 대책은 자동 설계 결과가 있어야 의미가 있어 순회 전에 한 번 확정한다(confirmPlan 경로 검증 겸).
const RESULT_VIEWS = ['flow', 'asset', 'plan', 'hi', 'basis', 'risk'];
const seedPlan = async page => {
  await page.evaluate(() => autoSuggest());
  await page.waitForFunction(() => typeof _planPickOpts !== 'undefined' && _planPickOpts && _planPickOpts.length, null, { timeout: 30000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => confirmPlan());   // 확정하면 결과 탭의 "연 현금흐름"으로 이동
  await page.waitForTimeout(600);
};
const goRetirement = (page, t, v) => page.evaluate(([t, v]) => {
  setMainTab(t);
  if (t !== 'result') return;
  chartTab = 'flow'; _altView = null;
  if (v === 'flow' || v === 'asset') setTab(v); else setAltView(v);
}, [t, v]);

const SCREENS = {
  retirement: { base: 'retirement/', tabs: ['design', 'step2', 'result', 'tax'], go: goRetirement, long: t => t === 'tax' },
  portfolio: { base: 'portfolio/', seed: true },
  home: { base: '' },
  signals: { base: 'signals/', long: () => true },
};

async function sweep(browser, preset, o) {
  const cfg = SCREENS[preset], rows = [];
  const vps = VIEWPORTS.concat(o.extra ? EXTRA : []);
  for (const [w, h] of vps.concat(o.folded ? [FOLDED] : [])) {
    const folded = w === FOLDED[0];
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(o.base + cfg.base, { waitUntil: 'load' });
    if (o.seed && cfg.seed) await page.evaluate(m => { try { Object.keys(m).forEach(k => localStorage.setItem(k, JSON.stringify(m[k]))); } catch (e) {} }, seedAll());
    else if (preset === 'retirement') await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(preset === 'portfolio' ? 2500 : 1200);
    let targets = [['', '']], seeded = false;
    if (preset === 'retirement') targets = cfg.tabs.flatMap(t => t === 'result' ? RESULT_VIEWS.map(v => [t, v]) : [[t, '']]);
    if (preset === 'portfolio') {
      const pages = await page.evaluate(() => [...document.querySelectorAll('#tabbar [data-page]')].map(b => b.dataset.page));
      targets = [];
      for (const p of pages) { const subs = await page.evaluate(pg => { const c = document.getElementById('page_' + pg); return c ? [...c.querySelectorAll(':scope > .subtabbar [data-sub], :scope > nav [data-sub]')].map(b => b.dataset.sub) : []; }, p); (subs.length ? subs : ['']).forEach(s => targets.push([p, s])); }
    }
    for (const [a, b] of targets) {
      if (preset === 'retirement') { if (a === 'result' && !seeded) { await seedPlan(page); seeded = true; } await cfg.go(page, a, b); }
      if (preset === 'portfolio') { await page.evaluate(([p, s]) => { switchPage(p); if (s) switchSubPage(p, s); }, [a, b]); }
      await page.waitForTimeout(preset === 'portfolio' ? 1000 : b === 'risk' ? 3600 : 600);   // 위기 점검&부족 대책은 행마다 자동 설계를 다시 계산해 늦게 채워진다
      const name = preset + (a ? '/' + a : '') + (b ? '/' + b : '');
      const isLong = folded || LONG.has(name) || (cfg.long && cfg.long(a));
      const fit = await measureFit(page), fails = judgeFit(fit, isLong);
      let boxes = null;
      if (o.boxes && !folded) { boxes = await measureBoxes(page); fails.push(...judgeBoxes(boxes)); }
      rows.push({ vp: w + '×' + h, name, fit, boxes, fails, isLong });
    }
    await page.close();
  }
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const preset = args.find(a => !a.startsWith('--')) || 'retirement';
  const val = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const o = { boxes: args.includes('--boxes'), extra: args.includes('--extra'), seed: args.includes('--seed'), folded: args.includes('--folded'), base: (val('--base') || 'http://localhost:4173/').replace(/\/?$/, '/') };
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const presets = preset === 'all' ? Object.keys(SCREENS) : [preset];
  let all = [];
  for (const p of presets) all = all.concat(await sweep(browser, p, Object.assign({}, o, { seed: o.seed || p === 'portfolio' && args.includes('--seed') })));
  await browser.close();
  let bad = 0;
  for (const r of all) {
    const f = r.fit;
    const line = [r.vp.padEnd(9), r.name.padEnd(28), ('넘침' + f.over + (f.locked ? '·잠금' : '')).padEnd(10), ('가로' + f.hS).padEnd(6), ('빈공간' + f.blank).padEnd(8), r.isLong ? '(긴 화면)' : '', r.fails.length ? 'FAIL ' + r.fails.join(' ; ') : 'ok'].join(' ');
    if (r.fails.length) bad++;
    console.log(line);
    if (o.boxes && r.boxes) console.log('          박스 ' + r.boxes.count + '개 · 높이 ' + r.boxes.hKinds.join('/') + ' · 폭 ' + r.boxes.wKinds.join('/'));
  }
  console.log(bad ? '\nFAIL ' + bad + '건' : '\n모두 통과');
  process.exit(bad ? 1 : 0);
}

module.exports = { measureFit, measureBoxes, judgeFit, judgeBoxes, seedAssets, seedTradeLog, seedSnaps, seedAll, MAX_BLANK, VIEWPORTS, IN_PAGE_FIT, IN_PAGE_BOXES };
if (require.main === module) main().catch(e => { console.error(e); process.exit(2); });
