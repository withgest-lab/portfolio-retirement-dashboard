// 배당·세금 순수 계산 테스트 — node --test portfolio/*.test.js (가상의 둥근 값만 사용)
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('./div-tax.js');
const DAY = T.DAY;
const d = (y, m, dd, h = 0) => new Date(y, m - 1, dd, h).getTime();
const near = (a, b, eps = 1) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('normAcct: 프리셋과 직접 입력 이름', () => {
  assert.equal(T.normAcct('isa'), 'isa');
  assert.equal(T.normAcct('중개형 ISA'), 'isa');
  assert.equal(T.normAcct('연금저축'), 'pension_personal');
  assert.equal(T.normAcct('퇴직연금 DC'), 'pension_retirement');
  assert.equal(T.normAcct('IRP 개인'), 'irp');
  assert.equal(T.normAcct('위탁'), 'general');
  assert.equal(T.normAcct(null), 'general');
});

test('금융소득 추가 납부: 비교과세(초과분만 누진)', () => {
  assert.equal(T.finExtraTaxMan(1900, 5000), 0);
  // 다른 과표 5,000 + 초과 1,000 → 24% 구간: (240 − 140) × 1.1 = 110
  near(T.finExtraTaxMan(3000, 5000), 110, 0.01);
  // 다른 소득 없음 + 초과 500 → 6% < 14% → 추가 없음
  assert.equal(T.finExtraTaxMan(2500, 0), 0);
});

test('결제일: 미국 T+1, 연말 체결은 다음 해 귀속', () => {
  // 2026-12-31(목) 한국시간 23:40 체결 기록 → 미국 12-31 → 결제 2027-01-04(1/1 휴장, 주말)
  const s = T.settleDate(d(2026, 12, 31, 23), 'USD');
  assert.equal(new Date(s).getFullYear(), 2027);
  // 2026-12-30(수) 한국시간 23시 → 미국 12-30 → 12-31 결제 → 2026 귀속
  assert.equal(new Date(T.settleDate(d(2026, 12, 30, 23), 'USD')).getFullYear(), 2026);
  // 날짜만 적은 기록(자정)은 그 날짜 기준
  assert.equal(T.dateStr(T.settleDate(d(2026, 3, 6), 'USD')), '2026-03-09');
  // 일본 T+2
  assert.equal(T.dateStr(T.settleDate(d(2026, 3, 5), 'JPY')), '2026-03-09');
});

test('배당락일 수량: 스냅샷이 직접 수정(이력 없음) 전 수량을 기억', () => {
  const now = d(2026, 10, 10);
  const h = { id: 'a1', quantity: 1000 };
  // 8월에 보유종목을 직접 고쳐 100 → 1000 (매매 이력 없음). 스냅샷은 그 전 100주
  const snaps = [d(2026, 1, 5), d(2026, 3, 2), d(2026, 5, 4), d(2026, 7, 6)].map(t => ({ timestamp: t, byAsset: { a1: 5e6 }, byQty: { a1: 100 } }))
    .concat([{ timestamp: d(2026, 9, 1), byAsset: { a1: 5e7 }, byQty: { a1: 1000 } }]);
  const q = T.qtyAt(h, d(2026, 3, 27), [], snaps, now);
  assert.deepEqual(q, { qty: 100, basis: 'snap' });
  // 스냅샷이 없으면 현재 수량을 가정
  assert.deepEqual(T.qtyAt(h, d(2026, 3, 27), [], [], now), { qty: 1000, basis: 'assumed' });
});

test('배당락일 수량: 기준점 앞뒤 매매 재생', () => {
  const now = d(2026, 10, 10);
  const h = { id: 'a1', quantity: 30 };
  const trades = [{ at: d(2026, 2, 1), type: 'buy', quantity: 10 }, { at: d(2026, 6, 1), type: 'buy', quantity: 15 }, { at: d(2026, 8, 1), type: 'sell', quantity: 5 }];
  // 1/15 이후 매매 = +10 +15 −5 → 30 − 20 = 10 (그 전 매매 기록·스냅샷이 없어 근거는 가정)
  assert.deepEqual(T.qtyAt(h, d(2026, 1, 15), trades, [], now), { qty: 10, basis: 'assumed' });
  assert.deepEqual(T.qtyAt(h, d(2026, 3, 15), trades, [], now), { qty: 20, basis: 'log' });
  // 앞쪽 스냅샷 기준점(5/30, 20주)에서 앞으로 재생 → 6/25: +15 = 35 (31일 이내라 snap)
  const snaps = [{ timestamp: d(2026, 5, 30), byAsset: { a1: 1 }, byQty: { a1: 20 } }];
  assert.deepEqual(T.qtyAt(h, d(2026, 6, 25), trades, snaps, now), { qty: 35, basis: 'snap' });
  assert.deepEqual(T.qtyAt(h, d(2026, 7, 5), trades, snaps, now), { qty: 35, basis: 'log' });
  // 전량 매도 종목(현재 0주): 매도 전 수량을 되살린다
  const sold = { id: null, quantity: 0, soldOut: true };
  assert.deepEqual(T.qtyAt(sold, d(2026, 3, 1), [{ at: d(2026, 6, 1), type: 'sell', quantity: 40 }], [], now), { qty: 40, basis: 'log' });
});

test('지급일 추정: 시장·종류별', () => {
  assert.equal(T.dateStr(T.payDate(d(2026, 1, 29), { ccy: 'KRW', kind: 'etf' }).pay), '2026-02-03');   // 목 + 3영업일
  assert.equal(T.dateStr(T.payDate(d(2025, 12, 29), { ccy: 'KRW', kind: 'stock' }).pay), '2026-04-20');   // 4/18(토) → 다음 영업일
  // 새 방식 분기 배당(배당락 11/13 → 약 2주 뒤) — 연도가 바뀌지 않는다
  assert.equal(T.dateStr(T.payDate(d(2025, 11, 13), { ccy: 'KRW', kind: 'stock' }).pay), '2025-11-28');
  assert.equal(T.dateStr(T.payDate(d(2026, 8, 6), { ccy: 'KRW', kind: 'stock' }).pay), '2026-08-21');
  // 새 방식 결산(2월 배당락 → 4월), 옛 방식 분기 말(3/30 → 5/19)
  assert.equal(T.dateStr(T.payDate(d(2026, 2, 26), { ccy: 'KRW', kind: 'stock' }).pay), '2026-04-15');
  assert.equal(T.dateStr(T.payDate(d(2026, 3, 30), { ccy: 'KRW', kind: 'stock' }).pay), '2026-05-19');
  assert.equal(T.dateStr(T.payDate(d(2026, 9, 25), { ccy: 'USD', kind: 'etf' }).pay), '2026-10-01');   // 금 + 4영업일
  assert.equal(T.payDate(d(2026, 3, 27), { ccy: 'JPY' }).basis, 'est');
  // 학습값은 기본 추정에 더하는 보정치
  const base = T.payDate(d(2026, 3, 27), { ccy: 'JPY' }).pay;
  assert.deepEqual(T.payDate(d(2026, 3, 27), { ccy: 'JPY' }, 5 * DAY), { pay: base + 5 * DAY, basis: 'learned' });
  // SPDR 신탁형(SPY)은 다음 달 마지막 영업일 → 12월 배당락은 다음 해 1월 지급
  assert.equal(T.dateStr(T.payDate(d(2025, 12, 19, 23), { ccy: 'USD', kind: 'etf', ticker: 'SPY' }).pay), '2026-01-30');
  // 국내 ETF 12월 말 배당락 → 연초 휴장을 건너 다음 해 지급
  assert.equal(T.dateStr(T.payDate(d(2025, 12, 29, 9), { ccy: 'KRW', kind: 'etf' }).pay), '2026-01-05');
});

test('과거 환율 조회', () => {
  const now = d(2026, 10, 10);
  const fx = T.makeFxAt({ USD: [[d(2026, 1, 2), 1400], [d(2026, 1, 5), 1410], [d(2026, 1, 6), 1420]] }, now, { USD: 1500 });
  assert.deepEqual(fx('USD', d(2026, 1, 5, 12)), { rate: 1410, basis: 'hist' });
  assert.deepEqual(fx('USD', d(2026, 1, 3)), { rate: 1400, basis: 'hist' });
  assert.deepEqual(fx('USD', now + DAY), { rate: 1500, basis: 'now' });
  assert.deepEqual(fx('KRW', d(2026, 1, 5)), { rate: 1, basis: 'na' });
});

function holding(o) {
  return Object.assign({ key: 'X|general|가상증권A', id: 'a1', ticker: 'X', name: '가상 ETF', ccy: 'KRW', acct: 'general', company: '가상증권A', quantity: 100, kind: 'etf', trades: [], ev: [] }, o);
}
const monthlyEv = (from, n, dps) => Array.from({ length: n }, (_, i) => ({ ex: new Date(from.getFullYear(), from.getMonth() + i, 27).getTime(), dps }));

test('장부: 자동·예상·기록 중복 제거·제외', () => {
  const now = d(2026, 10, 10);
  const h = holding({ ev: monthlyEv(new Date(2025, 0, 1), 21, 50) });   // 2025-01 ~ 2026-09 매월 27일 50원
  const items = T.buildLedger({ year: 2026, now, holdings: [h], records: [], snaps: [] });
  const auto = items.filter(i => i.src === 'auto'), proj = items.filter(i => i.src === 'proj');
  // 2025-12-27 배당락 → 2026-01 지급 포함, 2026-09-27 배당락 → 10월 초 지급(지남/예정 경계)
  // 2025-12-27 ~ 2026-09-27 배당락 10회(지급 1/2 ~ 9/30, 모두 지남) + 10~12월 배당락 3회 예상(작년 회차 반복)
  assert.equal(auto.length, 10);
  assert.equal(proj.length, 3);
  assert.ok(proj.every(p => p.known === false && p.guess === true && p.qtyBasis === 'now'));
  assert.ok(items.every(i => i.gross === 50 * 100));
  // 원천징수 15.4%(일반계좌)
  near(auto[0].wht, 770, 0.01);
  // 수동 기록이 같은 회차면 자동 항목을 숨긴다
  const rec = { id: 'r1', type: 'dividend', at: d(2026, 3, 3), name: '가상 ETF', ticker: 'X', acct: 'general', currency: 'KRW', totalKRW: 4230, src: 'manual', owners: [h.key] };
  const items2 = T.buildLedger({ year: 2026, now, holdings: [h], records: [rec], snaps: [] });
  assert.equal(items2.filter(i => i.src === 'confirmed').length, 1);
  assert.equal(items2.length, items.length);
  // 제외(새 키·옛 키 모두)
  const k = auto[0].key;
  assert.equal(T.buildLedger({ year: 2026, now, holdings: [h], records: [], snaps: [], dismiss: new Set([k]) }).length, items.length - 1);
  const oldKey = `X|general|${T.dateStr(auto[0].ex)}`;
  assert.equal(T.buildLedger({ year: 2026, now, holdings: [h], records: [], snaps: [], dismiss: new Set([oldKey]) }).length, items.length - 1);
  // 확정 기록은 자기가 대신한 회차 키(ckey)를 알려 준다 — 기록을 지울 때 이 키를 제외하면 같은 회차 자동 항목이 되살아나지 않는다
  const c = items2.find(i => i.src === 'confirmed');
  assert.ok(c.ckey && items.some(i => i.key === c.ckey));
  const items3 = T.buildLedger({ year: 2026, now, holdings: [h], records: [], snaps: [], dismiss: new Set([c.ckey]) });
  assert.equal(items3.length, items.length - 1);
  // 짝지어진 회차가 없는 기록(보유 종목과 무관)은 ckey가 없다
  const lone = T.buildLedger({ year: 2026, now, holdings: [h], records: [{ id: 'r9', type: 'dividend', at: d(2026, 5, 5), name: '가상 배당처', acct: 'general', currency: 'KRW', totalKRW: 1000, owners: [] }], snaps: [] });
  assert.equal(lone.find(i => i.src === 'confirmed').ckey, undefined);
});

test('장부: 비과세 계좌는 원천징수 0, 미국 배당은 지급일 환율', () => {
  const now = d(2026, 10, 10);
  const h = holding({ acct: 'isa', key: 'X|isa|' });
  h.ev = [{ ex: d(2026, 3, 27), dps: 50 }];
  assert.equal(T.buildLedger({ year: 2026, now, holdings: [h], records: [], snaps: [] })[0].wht, 0);
  const us = holding({ ccy: 'USD', kind: 'stock', key: 'U|general|', ticker: 'U', ev: [{ ex: d(2026, 3, 2), dps: 1 }], quantity: 10 });
  const fxAt = T.makeFxAt({ USD: [[d(2026, 3, 1), 1300], [d(2026, 3, 16), 1350]] }, now, { USD: 1500 });
  const it = T.buildLedger({ year: 2026, now, holdings: [us], records: [], snaps: [], fxAt })[0];
  assert.equal(it.fxBasis, 'hist');
  assert.equal(it.gross, 10 * 1350);   // 3/2 + 10영업일 = 3/16 환율
});

test('장부: 전량 매도한 종목의 그 해 배당도 포함, 예상은 만들지 않음', () => {
  const now = d(2026, 10, 10);
  const h = holding({ id: null, quantity: 0, soldOut: true, ev: [{ ex: d(2026, 2, 26), dps: 100 }, { ex: d(2026, 5, 27), dps: 100 }, { ex: d(2026, 8, 27), dps: 100 }],
    trades: [{ at: d(2026, 6, 15), type: 'sell', quantity: 30 }] });
  const items = T.buildLedger({ year: 2026, now, holdings: [h], records: [], snaps: [] });
  assert.equal(items.length, 2);            // 2·5월 배당락(보유 30주), 8월은 이미 0주
  assert.ok(items.every(i => i.qty === 30 && i.src === 'auto'));
});

test('양도차익: 선입선출·이동평균·환차익·기초 보유분', () => {
  const fxAt = T.makeFxAt({ USD: [[d(2025, 1, 2), 1300], [d(2026, 1, 2), 1400], [d(2026, 6, 1), 1500]] }, d(2026, 10, 10), { USD: 1500 });
  const g = { key: 'U|general|', name: '가상주식', ccy: 'USD', quantity: 10, avgPrice: 150,
    trades: [{ id: 'b1', at: d(2025, 3, 3), type: 'buy', quantity: 10, price: 100 }, { id: 'b2', at: d(2026, 2, 2), type: 'buy', quantity: 10, price: 200 },
             { id: 's1', at: d(2026, 6, 2), type: 'sell', quantity: 10, price: 300 }] };
  // 선입선출: 첫 로트(100달러, 1300원)를 판다 → 양도 300×10×1500 = 450만, 취득 100×10×1300 = 130만
  const f = T.realizeGains({ groups: [g], method: 'fifo', fxAt });
  assert.equal(f.sales.length, 1);
  near(f.sales[0].gain, 4500000 - 1300000);
  near(f.sales[0].fxGain, 10 * 100 * (1500 - 1300));
  assert.equal(f.sales[0].costBasis, 'log');
  // 이동평균: 평균 원가(원) = (130만 + 280만)/20 × 10 = 205만
  const a = T.realizeGains({ groups: [g], method: 'avg', fxAt });
  near(a.sales[0].gain, 4500000 - 2050000);
  // 남은 로트(선입선출): 두 번째 로트 10주 × 200 × 1400
  near(f.remaining[g.key].cost, 2800000);
  // 연도 요약: 공제 250만 후 22%
  const s = T.cgtSummary(f.sales, [], 2026);
  near(s.tax, Math.round((3200000 - 2500000) * 0.22));
});

test('양도차익: 이력 전 보유분 평단 역산·매입 환율 입력', () => {
  const fxAt = T.makeFxAt({ USD: [[d(2025, 1, 2), 1300], [d(2026, 6, 1), 1500]] }, d(2026, 10, 10), { USD: 1500 });
  // 이력 전에 10주(평단 x) 보유 + 2026-02 10주 200달러 매수 → 앱 평단 150 → x = 100
  const g = { key: 'U|general|', name: '가상주식', ccy: 'USD', quantity: 15, avgPrice: 150, firstSeen: d(2025, 1, 6),
    trades: [{ id: 'b2', at: d(2026, 2, 2), type: 'buy', quantity: 10, price: 200 }, { id: 's1', at: d(2026, 6, 2), type: 'sell', quantity: 5, price: 300 }] };
  const op = T.openingAvg(g);
  near(op.q0, 10, 1e-9); near(op.avg, 100, 1e-9);
  const est = T.realizeGains({ groups: [g], method: 'fifo', fxAt });
  assert.equal(est.sales[0].costBasis, 'est');
  assert.deepEqual(est.needFx, [g.key]);
  const inp = T.realizeGains({ groups: [g], method: 'fifo', fxAt, buyFx: { [g.key]: 1200 } });
  assert.equal(inp.sales[0].costBasis, 'input');
  near(inp.sales[0].gain, 5 * 300 * 1500 - 5 * 100 * 1200);
});

test('양도차익: 전량 매도 종목은 기록 손익으로 평단 역산', () => {
  const fxAt = T.makeFxAt({ USD: [[d(2026, 1, 2), 1400]] }, d(2026, 10, 10), { USD: 1500 });
  // 기록: 300달러에 10주 매도, 그때 환율 1500으로 손익 300만 → 평단 = 300 − 300만/(10×1500) = 100
  const g = { key: 'U|general|', name: '가상주식', ccy: 'USD', quantity: 0, avgPrice: 0,
    trades: [{ id: 's1', at: d(2026, 3, 2), type: 'sell', quantity: 10, price: 300, totalKRW: 4500000, pnl: 3000000 }] };
  near(T.openingAvg(g).avg, 100, 1e-9);
});

test('국내 상장 해외 ETF 매매차익: 이익만 합산(손실 통산 없음)', () => {
  const fxAt = T.makeFxAt(null, d(2026, 10, 10), {});
  const g = { key: 'E|general|', name: '가상 해외ETF', ccy: 'KRW', quantity: 0, avgPrice: 0,
    trades: [{ id: 'b', at: d(2026, 1, 5), type: 'buy', quantity: 20, price: 10000 }, { id: 's1', at: d(2026, 3, 5), type: 'sell', quantity: 10, price: 12000 },
             { id: 's2', at: d(2026, 5, 6), type: 'sell', quantity: 10, price: 9000 }] };
  const r = T.realizeGains({ groups: [g], method: 'fifo', fxAt });
  assert.equal(r.sales.length, 2);
  assert.equal(T.etfDivIncome(r.sales, 2026), 20000);
});

// ── 리뷰 재현 케이스 ──
test('기록 짝짓기: 1분기 확정 기록이 12월 회차에 먹히지 않는다(금액 보존)', () => {
  const now = d(2026, 10, 10);
  const h = holding({ kind: 'stock', key: 'K|general|', ticker: 'K', ev: [{ ex: d(2025, 12, 26, 9), dps: 1000 }, { ex: d(2026, 3, 27, 9), dps: 400 }, { ex: d(2026, 6, 26, 9), dps: 400 }] });
  const pay1 = T.payDate(d(2026, 3, 27, 9), { ccy: 'KRW', kind: 'stock' }).pay;
  const rec = { id: 'r1', type: 'dividend', at: pay1, exAt: d(2026, 3, 27, 9), ticker: 'K', acct: 'general', currency: 'KRW', gross: 40000, wht: 6160, src: 'auto', owners: [h.key] };
  const items = T.buildLedger({ year: 2026, now, holdings: [h], records: [rec], snaps: [] });
  // 받은 배당(예상 제외) = 12월분 100,000 + 1분기 확정 40,000 + 2분기 40,000
  assert.equal(items.filter(i => i.src !== 'proj').reduce((s, i) => s + i.gross, 0), 180000);
  assert.equal(items.filter(i => i.src === 'confirmed').length, 1);
  assert.equal(items.filter(i => i.src === 'auto' && T.dateStr(i.ex) === '2026-03-27').length, 0);
});

test('지급일 학습: 12월분을 4월에 받은 기록이 3월 회차에 붙지 않고 계절 규칙을 유지', () => {
  const now = d(2026, 10, 10);
  const ex = [d(2025, 3, 28, 9), d(2025, 6, 27, 9), d(2025, 9, 26, 9), d(2025, 12, 26, 9), d(2026, 3, 27, 9), d(2026, 6, 26, 9), d(2026, 9, 25, 9)];
  const h = holding({ kind: 'stock', key: 'K|general|', ticker: 'K', ev: ex.map(e => ({ ex: e, dps: 400 })) });
  const recs = [{ id: 'm1', type: 'dividend', at: d(2026, 4, 17), ticker: 'K', acct: 'general', currency: 'KRW', gross: 40000, wht: 6160, src: 'manual', owners: [h.key] },
                { id: 'm2', type: 'dividend', at: d(2026, 5, 20), ticker: 'K', acct: 'general', currency: 'KRW', gross: 40000, wht: 6160, src: 'manual', owners: [h.key] }];
  const corr = T.learnLag(recs, h.ev, { ccy: 'KRW', kind: 'stock' });
  assert.ok(Math.abs(corr) <= 3 * DAY, '보정치 ' + corr / DAY + '일');
  const items = T.buildLedger({ year: 2026, now, holdings: [h], records: recs, snaps: [] });
  // 2026 지급: 12월분(4월 기록) + 1분기(5월 기록) + 2분기(8월 자동) + 3분기(11월 예정) = 4회분
  assert.equal(items.reduce((s, i) => s + i.gross, 0), 160000);
  assert.equal(items.filter(i => i.src === 'confirmed').length, 2);
});

test('배당락일 당일 매수는 배당 권리 없음(날짜 기준 비교)', () => {
  const now = d(2026, 10, 10);
  // 미국 배당락 3/12 22시(한국 시간), 날짜만 적은 3/12 매수 10주
  assert.equal(T.qtyAt({ id: 'a', quantity: 10, ccy: 'USD' }, d(2026, 3, 12, 22), [{ at: d(2026, 3, 12), type: 'buy', quantity: 10 }], [], now).qty, 0);
  // 국내 배당락 3/12 09시: 3/12 매수 → 권리 없음, 3/11 매수 → 권리 있음
  assert.equal(T.qtyAt({ id: 'a', quantity: 10, ccy: 'KRW' }, d(2026, 3, 12, 9), [{ at: d(2026, 3, 12), type: 'buy', quantity: 10 }], [], now).qty, 0);
  assert.equal(T.qtyAt({ id: 'a', quantity: 10, ccy: 'KRW' }, d(2026, 3, 12, 9), [{ at: d(2026, 3, 11, 15), type: 'buy', quantity: 10 }], [], now).qty, 10);
});

test('양도차익: 전량 매도 종목의 기초 평단은 첫 매도 전 매수를 걷어내고 푼다', () => {
  const fx = 1500;
  // 이력 전 10주(평단 100) + 매수 10@200 → 그때 평단 150 → 20주 300에 매도(손익 = 150×20×1500)
  const g = { key: 'U', ccy: 'USD', quantity: 0, avgPrice: 0, trades: [{ at: d(2026, 1, 5), type: 'buy', quantity: 10, price: 200 },
    { at: d(2026, 3, 5), type: 'sell', quantity: 20, price: 300, pnl: (300 - 150) * 20 * fx, totalKRW: 300 * 20 * fx }] };
  near(T.openingAvg(g).avg, 100, 1e-9);
  // 이후 다시 5@250 매수해 보유 중(0주가 됐던 경로)
  const g2 = Object.assign({}, g, { quantity: 5, avgPrice: 250, trades: g.trades.concat([{ at: d(2026, 5, 5), type: 'buy', quantity: 5, price: 250 }]) });
  near(T.openingAvg(g2).avg, 100, 1e-9);
});

test('양도차익: 원가를 모르면 NaN·취득가 0이 아니라 양도차익 0 + unknown', () => {
  const fxAt = T.makeFxAt({ USD: [[d(2026, 1, 2), 1400]] }, d(2026, 10, 10), { USD: 1500 });
  const g = { key: 'U', name: '가상', ccy: 'USD', quantity: 0, avgPrice: 0, trades: [{ id: 's', at: d(2026, 3, 5), type: 'sell', quantity: 10, price: 300 }] };
  for (const method of ['fifo', 'avg']) {
    const r = T.realizeGains({ groups: [g], method, fxAt });
    assert.ok(Number.isFinite(r.sales[0].gain));
    near(r.sales[0].gain, 0);
    assert.equal(r.sales[0].costBasis, 'unknown');
    const s = T.cgtSummary(r.sales, [], 2026);
    assert.equal(s.tax, 0); assert.equal(s.nUnknown, 1);
  }
  // 기록보다 많이 판 몫도 unknown
  const g2 = { key: 'V', name: '가상2', ccy: 'USD', quantity: 0, avgPrice: 0, trades: [{ id: 'b', at: d(2026, 1, 5), type: 'buy', quantity: 5, price: 100 }, { id: 's', at: d(2026, 3, 5), type: 'sell', quantity: 8, price: 300 }] };
  assert.equal(T.realizeGains({ groups: [g2], method: 'fifo', fxAt }).sales[0].costBasis, 'unknown');
});

test('양도차익: 이동평균 + 기초 보유분 매입 환율 입력', () => {
  const fxAt = T.makeFxAt({ USD: [[d(2026, 1, 2), 1400], [d(2026, 6, 1), 1500]] }, d(2026, 10, 10), { USD: 1500 });
  const g = { key: 'U', name: '가상', ccy: 'USD', quantity: 15, avgPrice: 150, firstSeen: d(2026, 1, 6),
    trades: [{ id: 'b2', at: d(2026, 2, 2), type: 'buy', quantity: 10, price: 200 }, { id: 's1', at: d(2026, 6, 2), type: 'sell', quantity: 5, price: 300 }] };
  // 기초 10주×100×1200 + 매수 10주×200×1400 = 400만 / 20주 → 5주 원가 100만
  const r = T.realizeGains({ groups: [g], method: 'avg', fxAt, buyFx: { U: 1200 } });
  near(r.sales[0].cost, 1000000);
  assert.equal(r.sales[0].costBasis, 'input');
});

test('결제일: 2024-05-28 이전 미국은 T+2, 주간거래(한국 낮) 체결은 한국 날짜, 대체 휴장', () => {
  assert.equal(T.dateStr(T.settleDate(d(2024, 3, 6), 'USD')), '2024-03-08');
  // 2026-12-31 11시(한국) 주간거래 → 미국 12/31 체결 → 2027-01-04 결제
  assert.equal(T.dateStr(T.settleDate(d(2026, 12, 31, 11), 'USD')), '2027-01-04');
  // 2026-07-02 체결 → 7/3(금) 대체 휴장 → 7/6 결제
  assert.equal(T.dateStr(T.settleDate(d(2026, 7, 2), 'USD')), '2026-07-06');
});

test('양도세 요약: 손실·수동 입력·남은 공제, 통화 방어', () => {
  const sales = [{ year: 2026, ccy: 'USD', gain: 3000000, costBasis: 'log' }, { year: 2026, ccy: 'USD', gain: -1000000, costBasis: 'log' }, { year: 2026, ccy: 'KRW', gain: 9e9, costBasis: 'log' }];
  const s = T.cgtSummary(sales, [{ at: d(2026, 4, 1), pnl: '500000' }], 2026);
  assert.equal(s.gain, 2500000); assert.equal(s.profit, 3500000); assert.equal(s.loss, -1000000);
  assert.equal(s.tax, 0); assert.equal(s.left, 0);
  assert.equal(T.cgtSummary([], [{ at: d(2026, 4, 1), pnl: 1000000 }], 2026).left, 1500000);
  assert.equal(T.etfDivIncome(sales, 2026), 9e9);
});

test('recordAmounts: 세전 기록·세후 역산·비과세', () => {
  assert.deepEqual(T.recordAmounts({ gross: 10000, wht: 1540 }, 'general'), { gross: 10000, wht: 1540, net: 8460, est: false });
  const r = T.recordAmounts({ totalKRW: 8460, currency: 'KRW' }, 'general');
  near(r.gross, 10000); assert.equal(r.est, true);
  assert.deepEqual(T.recordAmounts({ totalKRW: 8460, currency: 'KRW' }, 'isa'), { gross: 8460, wht: 0, net: 8460, est: true });
});

test('장부: 배당이 끊긴 종목은 예상하지 않고, 올해 시작한 종목은 주기로 예상', () => {
  const now = d(2026, 10, 10);
  const stopped = holding({ key: 'S', ev: [{ ex: d(2025, 3, 27), dps: 100 }, { ex: d(2025, 6, 27), dps: 100 }, { ex: d(2025, 9, 26), dps: 100 }, { ex: d(2025, 12, 26), dps: 100 }, { ex: d(2026, 3, 27), dps: 100 }] });
  assert.equal(T.buildLedger({ year: 2026, now, holdings: [stopped], records: [], snaps: [] }).filter(i => i.src === 'proj').length, 0);
  const young = holding({ key: 'Y', ev: [{ ex: d(2026, 7, 30), dps: 50 }, { ex: d(2026, 8, 28), dps: 50 }, { ex: d(2026, 9, 29), dps: 50 }] });
  const pj = T.buildLedger({ year: 2026, now, holdings: [young], records: [], snaps: [] }).filter(i => i.src === 'proj');
  assert.ok(pj.length >= 2, '예상 ' + pj.length + '건');
});

test('환율: 기록 시작 전 날짜는 가장 이른 값(추정)', () => {
  const fx = T.makeFxAt({ USD: [[d(2022, 1, 3), 1190]] }, d(2026, 10, 10), { USD: 1500 });
  assert.deepEqual(fx('USD', d(2019, 5, 1)), { rate: 1190, basis: 'est' });
});

test('금융소득 추가 납부: 세율 구간을 걸치는 경우', () => {
  // 다른 과표 4,500 + 초과 1,000 → 4,500~5,000은 15%, 5,000~5,500은 24%: (75 + 120 − 140) × 1.1 = 60.5
  near(T.finExtraTaxMan(3000, 4500), 60.5, 0.01);
});

test('옛 스냅샷 id 연결: 수량 곡선이 명확히 맞는 것만', () => {
  const snap = (t, byQty) => ({ timestamp: t, byAsset: Object.fromEntries(Object.keys(byQty).map(k => [k, byQty[k] * 10000])), byQty });
  // 가상 종목: 3월 매수 10, 5월 매수 20(누적 30), 8월 전량 매도
  const g = { key: 'X|general|가상증권A', trades: [{ at: d(2026, 3, 2), type: 'buy', quantity: 10 }, { at: d(2026, 5, 4), type: 'buy', quantity: 20 }, { at: d(2026, 8, 3), type: 'sell', quantity: 30 }] };
  const snaps = [snap(d(2026, 4, 1), { old1: 10, live: 5 }), snap(d(2026, 6, 1), { old1: 30, live: 5 }), snap(d(2026, 7, 1), { old1: 30, live: 5 }), snap(d(2026, 9, 1), { live: 5 })];
  const l = T.linkSnapIds([g], snaps, ['live']);
  assert.deepEqual(l.get(g.key), { ids: ['old1'], endAt: d(2026, 7, 1) });
  // 현재 자산 id는 후보가 아니다 / 수량이 안 맞으면 연결하지 않는다
  assert.equal(T.linkSnapIds([g], [snap(d(2026, 4, 1), { z: 7 }), snap(d(2026, 6, 1), { z: 9 })], []).size, 0);
  // 한 시점만 일치: 단가가 체결 단가와 ±25% 안이면 연결, 아니면 버림
  const g1 = { key: 'Y', trades: [{ at: d(2026, 3, 2), type: 'buy', quantity: 10, totalKRW: 100000 }] };
  assert.equal(T.linkSnapIds([g1], [{ timestamp: d(2026, 4, 1), byAsset: { o: 105000 }, byQty: { o: 10 } }], []).size, 1);
  assert.equal(T.linkSnapIds([g1], [{ timestamp: d(2026, 4, 1), byAsset: { o: 300000 }, byQty: { o: 10 } }], []).size, 0);
  // 같은 id가 두 종목에 맞으면 둘 다 버린다
  const g2 = { key: 'Z', trades: [{ at: d(2026, 3, 2), type: 'buy', quantity: 10, totalKRW: 100000 }] };
  assert.equal(T.linkSnapIds([g1, g2], [{ timestamp: d(2026, 4, 1), byAsset: { o: 105000 }, byQty: { o: 10 } }], []).size, 0);
});

test('배당락일 수량: 연결된 옛 스냅샷·매도 기록 없이 사라진 종목', () => {
  const now = d(2026, 10, 10);
  const snaps = [[d(2026, 4, 1), 10], [d(2026, 6, 1), 30], [d(2026, 7, 1), 30]].map(([t, q]) => ({ timestamp: t, byAsset: { old1: q * 1e4 }, byQty: { old1: q } }));
  const buys = [{ at: d(2026, 3, 2), type: 'buy', quantity: 10 }, { at: d(2026, 5, 4), type: 'buy', quantity: 20 }];
  const h = { id: null, quantity: 0, soldOut: true, inferred: true, snapIds: ['old1'], endAt: d(2026, 7, 1) };
  assert.deepEqual(T.qtyAt(h, d(2026, 6, 20), buys, snaps, now), { qty: 30, basis: 'snapinf' });
  assert.deepEqual(T.qtyAt(h, d(2026, 4, 10), buys, snaps, now), { qty: 10, basis: 'snapinf' });   // 4/1 스냅샷(10주)에서 가까움
  // 마지막으로 보인 시점 뒤의 배당락은 보유 여부가 불명확해 0
  assert.equal(T.qtyAt(h, d(2026, 7, 20), buys, snaps, now).qty, 0);
  // 연결된 스냅샷으로 전량 매도 종목도 수량을 정한다(매도 기록은 있음)
  const sold = { id: null, quantity: 0, soldOut: true, snapIds: ['old1'] };
  assert.deepEqual(T.qtyAt(sold, d(2026, 6, 20), buys.concat([{ at: d(2026, 8, 3), type: 'sell', quantity: 30 }]), snaps, now), { qty: 30, basis: 'snap' });
});

test('장부: 매도 기록 없이 사라진 종목의 배당은 스냅샷 근거로 추가', () => {
  const now = d(2026, 10, 10);
  const snaps = [d(2026, 4, 1), d(2026, 6, 1), d(2026, 7, 1)].map(t => ({ timestamp: t, byAsset: { old1: 3e5 }, byQty: { old1: 30 } }));
  const h = holding({ key: 'X|general|', id: null, quantity: 0, soldOut: true, inferred: true, snapIds: ['old1'], endAt: d(2026, 7, 1), company: null,
    trades: [{ at: d(2026, 3, 2), type: 'buy', quantity: 30 }], ev: [{ ex: d(2026, 6, 27), dps: 100 }, { ex: d(2026, 9, 27), dps: 100 }] });
  const items = T.buildLedger({ year: 2026, now, holdings: [h], records: [], snaps });
  assert.equal(items.length, 1);   // 6/27 배당락만 — 9/27은 마지막으로 보인 7/1 이후라 제외
  assert.equal(items[0].qty, 30); assert.equal(items[0].qtyBasis, 'snapinf'); assert.equal(items[0].src, 'auto');
});

test('배당일 자동 입금: 대상·한 번만·통화 금액', () => {
  const now = d(2026, 10, 10), from = d(2026, 10, 5);
  const h = holding({ id: 'h1', ev: monthlyEv(new Date(2025, 0, 1), 21, 50), trades: [{ at: d(2024, 6, 3), type: 'buy', quantity: 100 }] });   // 매수 근거가 있어야 수량이 '추정'이 아니다
  const items = T.buildLedger({ year: 2026, now, holdings: [h], records: [], snaps: [] });
  assert.ok(items.every(i => i.hid === 'h1'));
  const hNo = holding({ id: 'h2', ev: monthlyEv(new Date(2025, 0, 1), 21, 50) });   // 근거 없음 → 수량 추정 → 자동 입금 안 함
  assert.equal(T.autoCashDue(T.buildLedger({ year: 2026, now, holdings: [hNo], records: [], snaps: [] }), { from: d(2026, 1, 1), now }).length, 0);
  const due = T.autoCashDue(items, { from: d(2026, 1, 1), now });
  assert.ok(due.length > 0 && due.every(i => i.src === 'auto' && i.pay >= d(2026, 1, 1) && i.pay <= now));
  // 시작일 이전 지급은 대상이 아니고, 이미 넣은 회차는 다시 넣지 않는다
  assert.equal(T.autoCashDue(items, { from: now + 1, now }).length, 0);
  const done = new Set(due.map(T.autoCashKey));
  assert.equal(T.autoCashDue(items, { from: d(2026, 1, 1), now, done }).length, 0);
  // 확정 기록: 시작일 이후 만든 것만, 원금 연결·이미 입금은 제외
  const rec = (o) => Object.assign({ id: 'r' + Math.random(), type: 'dividend', at: d(2026, 10, 7), name: '가상 ETF', ticker: 'X', acct: 'general', currency: 'KRW', totalKRW: 4230, gross: 5000, wht: 770, src: 'manual', owners: [h.key] }, o);
  const conf = recs => T.buildLedger({ year: 2026, now, holdings: [h], records: recs, snaps: [] }).filter(i => i.src === 'confirmed');
  assert.equal(T.autoCashDue(conf([rec({ createdAt: d(2026, 10, 6) })]), { from, now }).length, 1);
  assert.equal(T.autoCashDue(conf([rec({})]), { from, now }).length, 0);                                    // 옛 기록(createdAt 없음)
  assert.equal(T.autoCashDue(conf([rec({ createdAt: d(2026, 10, 6), principalId: 'p1' })]), { from, now }).length, 0);
  assert.equal(T.autoCashDue(conf([rec({ createdAt: d(2026, 10, 6), cash: { state: 'in' } })]), { from, now }).length, 0);
  // 금액: 원화는 세후 원화, 외화는 기록 당시 환율로 되돌린 통화 금액(원천 15% 뒤)
  assert.equal(T.netInCcy({ ccy: 'KRW', net: 4230.4 }), 4230);
  assert.equal(T.netInCcy({ ccy: 'USD', dps: 0.5, qty: 10, gross: 0.5 * 10 * 1400, net: 0.5 * 10 * 1400 * 0.85 }), 4.25);
  assert.equal(T.netInCcy({ ccy: 'USD', net: 1400 * 3 }, 1400), 3);
  assert.equal(T.netInCcy({ ccy: 'JPY', dps: 20, qty: 100, gross: 20 * 100 * 9, net: 20 * 100 * 9 * (1 - 0.15315) }), 1694);
});

