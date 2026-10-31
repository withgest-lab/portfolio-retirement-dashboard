/* portfolio/pf-calc.js 회귀 테스트 — 값은 모두 가상 샘플 */
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./pf-calc.js');
const T = require('./div-tax.js');

const DAY = 86400000;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} 기대 ${b}, 실제 ${a} (허용 ±${tol})`);
const ts = s => new Date(s+'T00:00:00').getTime();

/* ── 채권 ── */
const bond = o => Object.assign({bondPrincipal:10000000, bondCouponRate:0.04, bondSpreadRate:0.005, bondIssueDate:'2020-01-01', bondMaturityDate:null}, o);

test('채권: 표면금리+가산금리 연복리, 발행 1년 뒤 = 원금 × (1+금리)', () => {
  const v = P.bondValues(bond(), ts('2020-01-01') + 365*DAY);
  near(v.value, 10450000, 0.01);
});

test('채권: 전일가는 하루 전 평가액 — 1D 등락은 하루치 이자뿐(누적 이자가 아님)', () => {
  const v = P.bondValues(bond(), ts('2020-01-01') + 3*365*DAY);
  assert.ok(v.value > 11000000, '3년 누적 이자가 쌓여 있어야 한다');
  const oneDay = (v.value - v.prev) / v.prev * 100;
  near(oneDay, (Math.pow(1.045, 1/365) - 1) * 100, 0.001, '1D %');
});

test('채권: 만기일 뒤로는 이자가 붙지 않고 1D 등락도 0', () => {
  const b = bond({bondMaturityDate:'2022-01-01'});
  const atMaturity = P.bondValues(b, ts('2022-01-01')).value;
  const later = P.bondValues(b, ts('2022-01-01') + 400*DAY);
  assert.equal(later.value, atMaturity);
  assert.equal(later.prev, atMaturity);
});

test('채권: 발행일 전이면 원금 그대로, 발행 당일 전일가가 원금 아래로 내려가지 않는다', () => {
  assert.equal(P.bondValues(bond(), ts('2019-06-01')).value, 10000000);
  const v = P.bondValues(bond(), ts('2020-01-01'));
  assert.equal(v.value, 10000000);
  assert.equal(v.prev, 10000000);
});

test('채권: 만기일이 비었거나 발행일 이전이면 만기 없음으로 본다', () => {
  const now = ts('2020-01-01') + 365*DAY;
  near(P.bondValues(bond({bondMaturityDate:''}), now).value, 10450000, 0.01);
  near(P.bondValues(bond({bondMaturityDate:'2019-01-01'}), now).value, 10450000, 0.01);
});

/* ── 변화추이 ── */
const hist = (...pts) => pts.map(([byAsset, byQty]) => ({byAsset, byQty}));

test('수익률: 기간 첫 지점부터 있는 종목은 그 단가가 기준, 수량이 바뀌어도 단가로 비교', () => {
  const s = P.chartSeries(hist([{a:100000},{a:1000}], [{a:400000},{a:2000}]), 'a', 2000, 100);
  assert.equal(s.base, 100);
  assert.equal(s.pct[1], 100);
  assert.equal(s.weight, 200000);
  assert.equal(P.seriesPnl(s), 200000);
});

test('수익률: 기간 중 새로 산 외화 종목은 원화 평단이 기준(시세가 원화라 단위를 맞춘다)', () => {
  // 달러 평단 $100 × 1,500원 = 150,000원, 지금 $110 × 1,500원 × 10주
  const s = P.chartSeries(hist([{},{}], [{u:1650000},{u:10}]), 'u', 10, 150000);
  assert.equal(s.fi, 1);
  assert.equal(s.base, 150000);
  near(s.pct[1], 10, 1e-9);
  assert.equal(s.pct[0], null);
  assert.equal(P.seriesPnl(s), 150000);
});

test('수익률: 데이터가 전혀 없는 종목은 null', () => {
  assert.equal(P.chartSeries(hist([{},{}], [{},{}]), 'x', 1, 100), null);
});

test('합계: 기준금액 가중 — 200,000 → 300,000은 +50%(현재 평가액 가중이면 +66.67%)', () => {
  const H = hist([{a:100000,b:100000},{a:1000,b:1000}], [{a:200000,b:100000},{a:1000,b:1000}]);
  const list = ['a','b'].map(id=>P.chartSeries(H, id, 1000, 100));
  assert.equal(P.mergedPct(list, 1), 50);
  assert.equal(P.mergedPct(list, 0), 0);
});

test('합계: 합계 %는 언제나 합계 손익 ÷ 합계 기준금액과 같다(가상 종목 20개, 수량·단가 무작위)', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for(let run = 0; run < 50; run++){
    const start = {}, startQ = {}, now = {}, nowQ = {};
    const ids = [];
    for(let i = 0; i < 20; i++){
      const id = 'a'+i, q = 1 + Math.floor(rnd()*1000), p0 = 100 + rnd()*100000, p1 = p0 * (0.2 + rnd()*3);
      ids.push({id, q, avg:p0});
      if(i % 4){ start[id] = p0*q; startQ[id] = q; }   // 넷 중 하나는 기간 중 새로 산 종목
      now[id] = p1*q; nowQ[id] = q;
    }
    const list = ids.map(x=>P.chartSeries(hist([start,startQ],[now,nowQ]), x.id, x.q, x.avg));
    const pnl = list.reduce((t,s)=>t+P.seriesPnl(s), 0), base = list.reduce((t,s)=>t+s.weight, 0);
    near(P.mergedPct(list, 1), pnl/base*100, 1e-6, '합계 %');
  }
});

test('합계: 그 시점 데이터가 없는 종목은 뺀다', () => {
  const H = hist([{a:1000},{a:10}], [{a:2000,b:500},{a:10,b:5}]);
  const list = [P.chartSeries(H,'a',10,100), P.chartSeries(H,'b',5,100)];
  assert.equal(P.mergedPct(list, 0), 0);          // a만 있는 시점
  assert.equal(P.mergedPct([], 0), null);
});

/* ── 월별 성과 ── */
const snap = (d, v) => ({timestamp:new Date(d+'T09:00:00').getTime(), totalValue:v});
const flow = (d, type, v) => ({at:new Date(d+'T00:00:00').getTime(), type, totalKRW:v});

test('월별: 첫 스냅샷 전 같은 달 입금은 이미 잔액에 있으므로 손익에서 빼지 않는다(가짜 손실 방지)', () => {
  const m = P.monthlyPerformance([snap('2025-08-15',100000000), snap('2025-09-15',100000000)], [flow('2025-08-10','deposit',10000000)]);
  assert.equal(m[0].netFlow, 0);
  assert.equal(m[0].pnl, 0);
  assert.equal(m[1].pnl, 0);
});

test('월별: 스냅샷 사이 입금은 잔액에 처음 나타나는 달로 — 입금액이 수익으로 잡히지 않는다', () => {
  // 7/28 스냅샷 뒤 7/30 입금 → 8월 스냅샷에야 잔액에 나타난다(7월 끝 잔액은 7/28 값)
  const m = P.monthlyPerformance([snap('2025-07-01',100000), snap('2025-07-28',100000), snap('2025-08-20',150000)], [flow('2025-07-30','deposit',50000)]);
  assert.deepEqual(m.map(x=>[x.month+1, x.netFlow, x.pnl]), [[7,0,0],[8,50000,0]]);
});

test('월별: 출금은 빼고, 월별 손익 합 = 끝 − 시작 − 순입출금(스냅샷 드문 구간·건너뛴 달 포함)', () => {
  const snaps = [snap('2025-01-10',1000), snap('2025-03-05',1500), snap('2025-03-25',1400), snap('2025-07-02',2000)];
  const flows = [flow('2025-01-20','deposit',300), flow('2025-03-10','withdrawal',200), flow('2025-05-01','deposit',100)];
  const m = P.monthlyPerformance(snaps, flows);
  assert.equal(m.length, 7);
  const total = 2000 - 1000 - (300 - 200 + 100);
  assert.equal(m.reduce((t,x)=>t+x.pnl, 0), total);
  assert.equal(m.reduce((t,x)=>t+x.netFlow, 0), 200);
  assert.equal(m[1].pnl, 0);   // 스냅샷 없는 2월
});

test('월별: 수익률은 시작 잔액 대비, 스냅샷이 없으면 빈 배열', () => {
  const m = P.monthlyPerformance([snap('2025-01-05',1000), snap('2025-01-25',1100)], []);
  assert.equal(m[0].pnl, 100);
  assert.equal(m[0].rtn, 10);
  assert.equal(m[0].hasFlowData, false);
  assert.deepEqual(P.monthlyPerformance([], []), []);
});

test('월별: 입출금 기록이 시작된 달부터 hasFlowData', () => {
  const m = P.monthlyPerformance([snap('2025-01-05',1000), snap('2025-03-05',1000)], [flow('2025-02-10','deposit',0)]);
  assert.deepEqual(m.map(x=>x.hasFlowData), [false, true, true]);
});

test('월별: 스냅샷이 정확히 1일 0시여도 월별 합 = 끝 − 시작 − 순입출금', () => {
  const at = (y, m, d) => new Date(y, m, d).getTime();
  const S = [{timestamp:at(2025,0,10), totalValue:1000}, {timestamp:at(2025,1,1), totalValue:1600}, {timestamp:at(2025,1,20), totalValue:1700}];
  const m = P.monthlyPerformance(S, [{at:at(2025,0,20), type:'deposit', totalKRW:300}]);
  assert.equal(m.reduce((t,x)=>t+x.pnl, 0), 1700 - 1000 - 300);
  assert.equal(m[0].endVal, 1000);      // 2월 1일 0시 스냅샷은 2월 소속
  assert.equal(m[1].startVal, 1000);    // 시작 = 지난달 끝(빠지는 구간이 없다)
  assert.equal(m[1].netFlow, 300);      // 입금은 잔액에 처음 나타나는 달로
});

/* ── 세금 묶음 ── */
const owns = (r, a) => r.ticker===a.ticker && !(r.company && a.company && r.company!==a.company) && !(r.acctType && a.acctType && T.normAcct(r.acctType)!==T.normAcct(a.acctType));
const isTaxed = x => x.currency==='USD' && T.normAcct(x.acctType)==='general';
const keyOf = x => `${x.ticker}|${T.normAcct(x.acctType)}|${x.company||''}`;
const pseudoOf = r => ({ticker:r.ticker, name:r.name, acctType:r.acctType, company:r.company||null, currency:r.currency||'KRW'});
const taxOf = (log, holdings) => P.taxGroupsOf(log, holdings, {owns, pred:isTaxed, keyOf, pseudoOf, seenOf:()=>Infinity, now:ts('2026-01-01')});
const hold = (o) => Object.assign({ticker:'SMPL', name:'가상주', acctType:'general', company:'nh', currency:'USD', quantity:10, avgPrice:100}, o);
const tradeOf = (type, o) => Object.assign({type, ticker:'SMPL', name:'가상주', acctType:'general', company:'nh', currency:'USD', quantity:10, price:type==='sell' ? 200 : 100, at:ts('2025-03-03'), totalKRW:1000000}, o);
const yearGain = groups => {
  const fxAt = () => ({rate:1000, basis:'hist'});
  return T.cgtSummary(T.realizeGains({groups, method:'fifo', fxAt}).sales, [], 2025).gain;
};

test('세금 묶음: 자산유형만 다른 두 행은 수량·평단을 합친 한 묶음, 매도는 한 번만 — 양도차익이 두 배가 되지 않는다', () => {
  const log = [tradeOf('buy', {quantity:50, at:ts('2025-01-02')}), tradeOf('sell')];   // 50주 사서 10주 팔아 40주 남음(기초 보유 없음)
  const g = taxOf(log, [hold({assetType:'Core', quantity:10, avgPrice:100}), hold({assetType:'주도주', quantity:30, avgPrice:200})]);
  assert.equal(g.length, 1);
  assert.equal(g[0].quantity, 40);
  assert.equal(g[0].avgPrice, 175);
  assert.equal(g[0].trades.length, 2);
  assert.equal(yearGain(g), 1000000);   // (200−100) × 10주 × 1,000원
});

test('세금 묶음: 금융회사가 안 적힌 옛 매도는 두 보유 중 한쪽에만 들어간다', () => {
  const old = o => { const t = tradeOf(o.type, o); delete t.company; return t; };
  const g = taxOf([old({type:'buy', at:ts('2025-01-02')}), old({type:'sell'})], [hold({company:'nh'}), hold({company:'mf'})]);
  assert.equal(g.length, 2);
  assert.equal(g.reduce((t,x)=>t+x.trades.length, 0), 2);
  assert.equal(yearGain(g), 1000000);
});

test('세금 묶음: 금융회사가 적힌 매매는 그 금융회사 보유로 간다', () => {
  const g = taxOf([tradeOf('sell', {company:'mf'})], [hold({company:'nh'}), hold({company:'mf'})]);
  assert.equal(g.find(x=>x.company==='mf').trades.length, 1);
  assert.equal(g.find(x=>x.company==='nh').trades.length, 0);
});

test('세금 묶음: 계좌가 안 적힌 매매의 보유가 ISA뿐이면 과세하지 않는다', () => {
  const noAcct = o => tradeOf(o.type, Object.assign({acctType:null}, o));
  assert.deepEqual(taxOf([noAcct({type:'buy'}), noAcct({type:'sell'})], [hold({acctType:'isa'})]), []);
});

test('세금 묶음: 계좌가 안 적힌 매매는 ISA와 일반계좌 보유가 같이 있으면 과세 쪽(보수적)', () => {
  const g = taxOf([tradeOf('sell', {acctType:null, company:null})], [hold({acctType:'isa', company:null}), hold({company:null})]);
  assert.equal(g.length, 1);
  assert.equal(g[0].trades.length, 1);
});

test('세금 묶음: ISA 매도는 일반계좌 보유에 합쳐지지 않고, 다른 증권사 전량 매도는 따로 한 번 집계', () => {
  const g = taxOf([tradeOf('sell', {acctType:'isa', company:'mf'}), tradeOf('buy', {company:'mf'}), tradeOf('sell', {company:'mf'})], [hold({company:'nh'})]);
  assert.equal(g.length, 2);
  assert.equal(g.find(x=>x.company==='nh').trades.length, 0);
  const sold = g.find(x=>x.company==='mf');
  assert.equal(sold.trades.length, 2);
  assert.equal(sold.quantity, 0);
  assert.equal(sold.asset, null);
});

test('세금 묶음: 주인을 못 찾은 기록의 키가 보유와 같으면 같은 묶음으로(묶음이 둘로 갈라지지 않는다)', () => {
  const g = P.taxGroupsOf([tradeOf('sell', {acctType:'CMA'})], [hold({})], {owns:()=>false, pred:isTaxed, keyOf, pseudoOf, seenOf:()=>Infinity, now:1});
  assert.equal(g.length, 1);
  assert.equal(g[0].trades.length, 1);
  assert.equal(g[0].quantity, 10);
});

test('세금 묶음: 티커가 없는 서로 다른 종목은 합치지 않고, 매도는 그 종목의 원가로 계산한다', () => {
  const noTk = o => hold(Object.assign({ticker:'—'}, o));
  const tkOwns = (r, a) => r.name===a.name;
  const tkKey = x => keyOf(Object.assign({}, x, {ticker:P.tickerOrName(x)}));
  const opt = {owns:tkOwns, pred:isTaxed, keyOf:tkKey, pseudoOf, seenOf:()=>Infinity, now:1};
  const A = noTk({name:'외화채A', quantity:1, avgPrice:10000}), B = noTk({name:'외화채B', quantity:5, avgPrice:1000});
  const sell = tradeOf('sell', {ticker:'—', name:'외화채B', quantity:5, price:1100});
  const buy = tradeOf('buy', {ticker:'—', name:'외화채B', quantity:10, price:1000, at:ts('2025-01-02')});
  const g = P.taxGroupsOf([buy, sell], [A, B], opt);
  assert.equal(g.length, 2);
  assert.equal(g.find(x=>x.name==='외화채A').trades.length, 0);
  assert.equal(g.find(x=>x.name==='외화채B').trades.length, 2);
  assert.equal(yearGain(g), (1100 - 1000) * 5 * 1000);
});

test('세금 묶음: 처음 보인 날은 보유의 스냅샷·매매 중 가장 이른 시각, 없으면 지금', () => {
  const opt = (seenOf) => ({owns, pred:isTaxed, keyOf, pseudoOf, seenOf, now:999});
  assert.equal(P.taxGroupsOf([], [hold({})], opt(()=>Infinity))[0].firstSeen, 999);
  assert.equal(P.taxGroupsOf([], [hold({})], opt(()=>50))[0].firstSeen, 50);
  assert.equal(P.taxGroupsOf([tradeOf('buy', {at:40})], [hold({})], opt(()=>50))[0].firstSeen, 40);
});

/* ── 현금 행 ── */
const cash = (id, cashAcctType, o) => Object.assign({id, acctType:'cash', currency:'KRW', company:'nh', cashAcctType}, o);
const pick = (rows, acct, o={}) => P.pickCashRow(rows, o.cur||'KRW', o.co===undefined ? 'nh' : o.co, acct, T.normAcct);

test('현금 행: 구분이 같은 행을 고른다', () => {
  const r = [cash('c1','general'), cash('c2','pension_personal')];
  assert.equal(pick(r,'pension_personal').id, 'c2');
});

test('현금 행: 구분이 다른 행 하나뿐이면 거기에 넣지 않고 새로 만든다(일반계좌 대금이 개인연금으로 가지 않게)', () => {
  assert.equal(pick([cash('c1','pension_personal')],'general'), null);
});

test('현금 행: 구분 없는 옛 행은 하위호환으로 쓴다', () => {
  assert.equal(pick([cash('c1',null)],'general').id, 'c1');
  assert.equal(pick([cash('c1','cash')],'isa').id, 'c1');
});

test('현금 행: 직접 입력한 구분 이름도 같은 계좌로 읽는다', () => {
  assert.equal(pick([cash('c1','연금저축')],'pension_personal').id, 'c1');
  assert.equal(pick([cash('c1','국내주식')],'general').id, 'c1');
});

test('현금 행: 후보가 여러 개면 amb, 다른 금융회사·통화는 후보가 아니다', () => {
  assert.equal(pick([cash('c1','general'), cash('c2','general',{name:'예금'})],'general'), 'amb');
  assert.equal(pick([cash('c1','general',{company:'mf'})],'general'), null);
  assert.equal(pick([cash('c1','general',{currency:'USD'})],'general'), null);
});

test('현금 행: 구분을 모르는 매매는 구분 없는 행 → 그 금융회사 현금이 하나면 그 행 → 여럿이면 amb', () => {
  assert.equal(pick([cash('c1','general'), cash('c2',null)],null).id, 'c2');
  assert.equal(pick([cash('c1','general')],null).id, 'c1');
  assert.equal(pick([cash('c1','general'), cash('c2','isa')],null), 'amb');
  assert.equal(pick([],null), null);
});

test('현금 행: 현금이 아닌 자산은 후보가 아니다', () => {
  assert.equal(pick([{id:'s', acctType:'general', currency:'KRW', company:'nh', cashAcctType:'general'}],'general'), null);
});
