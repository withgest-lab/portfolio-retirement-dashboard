/* shared/bridge.js 회귀 테스트 — 포트폴리오 자산(pf_assets_v1) → 은퇴 계좌 잔액(만원) 집계.
   브리지는 브라우저 전용 IIFE(window·localStorage 사용)라 Node에서는 전역을 모킹한 뒤 require한다. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

let store = {};
global.window = global;
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
require(path.join('..', 'shared', 'bridge.js'));

const stock = (acctType, extra) => Object.assign(
  { id: 's', ticker: 'X', name: '종목', acctType, quantity: 10, currentPrice: 1000000, currency: 'KRW' }, extra);
const cash = (cashAcctType, amount, extra) => Object.assign(
  { id: 'c', ticker: '—', name: '현금', acctType: 'cash', cashAcctType, quantity: 1, currentPrice: amount, currency: 'KRW' }, extra);

function snap(assets, fx) {
  store = { pf_assets_v1: JSON.stringify(assets) };
  if (fx) store.pf_fx_v1 = JSON.stringify(fx);
  return window.PortfolioBridge.getPortfolioSnapshot();
}

test('퇴직연금: 종목과 현금이 tirp에 함께 합산된다', () => {
  const s = snap([stock('pension_retirement'), cash('pension_retirement', 5000000)]);
  assert.strictEqual(s.tirp, 1500); // 1000만(종목) + 500만(현금)
});

test('IRP·ISA 계좌 안 현금도 각 계좌 잔액에 합산된다', () => {
  const s = snap([
    stock('irp'), cash('irp', 2000000),
    stock('isa'), cash('isa', 3000000),
  ]);
  assert.strictEqual(s.irp, 1200);
  assert.strictEqual(s.isa, 1300);
});

test('개인연금 현금은 금융회사(nh/mf/미지정)별로 분류된다', () => {
  const s = snap([
    cash('pension_personal', 1000000, { company: 'nh' }),
    cash('pension_personal', 2000000, { company: 'mf' }),
    cash('pension_personal', 4000000),
  ]);
  assert.strictEqual(s.nh, 100);
  assert.strictEqual(s.mf, 200);
  assert.strictEqual(s.unclassifiedPersonalPension, 400);
});

test('외화 현금은 환율로 환산해 합산한다', () => {
  const s = snap([cash('pension_retirement', 1000, { currency: 'USD' })], { USD: 1400, JPY: 9 });
  assert.strictEqual(s.tirp, 140); // $1,000 × 1,400원 = 140만원
});

test('일반계좌·계좌유형이 없는 현금은 연금 계좌 잔액에서 제외된다(일반계좌는 gen으로 따로 집계)', () => {
  const s = snap([cash('general', 9000000), cash(null, 9000000), cash('cash', 9000000)]);
  assert.deepStrictEqual([s.nh, s.mf, s.irp, s.tirp, s.isa], [0, 0, 0, 0, 0]);
  assert.strictEqual(s.gen.kr.ev, 900);   // 일반계좌 현금만 국내·현금 칸에
});

test('일반계좌: 세금 기준 3분류(해외주식·국내상장 해외ETF·국내/현금)와 원가', () => {
  const s = snap([
    // 해외주식(USD): 평가 $150 × 10주, 평단 $100 → 환율 1400
    { id: '1', ticker: 'GOOGL', name: '알파벳', acctType: 'general', market: 'us', quantity: 10, avgPrice: 100, currentPrice: 150, currency: 'USD' },
    // 국내상장 해외ETF(KRW, 투자시장 미국)
    { id: '2', ticker: '360750.KS', name: 'S&P500 ETF', acctType: 'general', market: 'us', quantity: 100, avgPrice: 20000, currentPrice: 25000, currency: 'KRW' },
    // 국내주식
    { id: '3', ticker: '005930.KS', name: '삼성전자', acctType: 'general', market: 'kr', quantity: 10, avgPrice: 70000, currentPrice: 80000, currency: 'KRW' },
    cash('general', 1000000),
    stock('pension_retirement'),               // 연금 계좌 종목은 일반계좌에 안 섞임
  ], { USD: 1400, JPY: 9 });
  assert.deepStrictEqual(s.gen.ov, { ev: Math.round(150 * 10 * 1400 / 10000), cost: Math.round(100 * 10 * 1400 / 10000) });   // 21 / 14
  assert.deepStrictEqual(s.gen.etf, { ev: 250, cost: 200 });
  assert.deepStrictEqual(s.gen.kr, { ev: 80 + 100, cost: 70 + 100 });                // 국내주식 80만 + 현금 100만
  assert.strictEqual(s.tirp, 1000);
});

test('일반계좌 JPY 종목은 해외주식, 투자시장이 없는 KRW 종목은 국내로 본다', () => {
  const s = snap([
    { id: '1', ticker: '7203.T', name: '도요타', acctType: 'general', market: 'jp', quantity: 100, avgPrice: 2000, currentPrice: 3000, currency: 'JPY' },
    { id: '2', ticker: 'X', name: '시장미지정', acctType: 'general', quantity: 1, avgPrice: 1000000, currentPrice: 2000000, currency: 'KRW' },
  ], { USD: 1400, JPY: 10 });
  assert.deepStrictEqual(s.gen.ov, { ev: 300, cost: 200 });   // 3,000엔×100주×10원 = 300만
  assert.deepStrictEqual(s.gen.kr, { ev: 200, cost: 100 });
});

test('레거시 필드(category/subCategory/subAccount)도 인식한다', () => {
  const s = snap([
    { ticker: 'X', name: '구종목', category: 'pension_retirement', quantity: 1, currentPrice: 1000000, currency: 'KRW' },
    { ticker: '—', name: '구현금', acctType: 'cash', subCategory: 'pension_retirement', quantity: 1, currentPrice: 2000000, currency: 'KRW' },
    { ticker: '—', name: '구연금현금', acctType: 'cash', cashAcctType: 'pension_personal', subAccount: 'nh', quantity: 1, currentPrice: 3000000, currency: 'KRW' },
  ]);
  assert.strictEqual(s.tirp, 300);
  assert.strictEqual(s.nh, 300);
});

test('직접 입력한 계좌 이름도 빠지지 않고 합산된다(종목·현금 모두)', () => {
  const s = snap([stock('중개형ISA'), stock('퇴직연금 DC'), stock('개인IRP'), stock('연금저축', { company: 'nh' }), stock('CMA'),
    cash('ISA 계좌', 2000000)]);
  assert.strictEqual(s.isa, 1200);
  assert.strictEqual(s.tirp, 1000);
  assert.strictEqual(s.irp, 1000);
  assert.strictEqual(s.nh, 1000);
  assert.deepStrictEqual(s.gen.kr, { ev: 1000, cost: 1000 });
});

test('계좌 이름 판정이 배당·세금 쪽(div-tax normAcct)과 어긋나지 않는다', () => {
  const T = require(path.join('..', 'portfolio', 'div-tax.js'));
  const bucketOf = s => s.isa ? 'isa' : s.irp ? 'irp' : s.tirp ? 'pension_retirement' : s.unclassifiedPersonalPension ? 'pension_personal' : s.gen.kr.ev ? 'general' : null;
  ['general', 'isa', 'irp', 'pension_personal', 'pension_retirement', '중개형ISA', '중개형 isa', 'IRP 개인', '퇴직연금', '퇴직 IRP', '연금저축', '개인연금', '국내주식', 'CMA', '해외주식계좌']
    .forEach(name => assert.strictEqual(bucketOf(snap([stock(name)])), T.normAcct(name), name));
});

test('일반계좌 음수 현금은 순자산이 맞도록 다른 칸에서 뺀다(평가손익률은 그대로)', () => {
  const ov = extra => stock('general', Object.assign({ currency: 'USD', quantity: 1, currentPrice: 20000, avgPrice: 10000 }, extra));
  const fx = { USD: 1000, JPY: 10 };
  // 해외주식 2,000만(원가 1,000만) + 현금 −500만 → 해외주식 1,500만(원가 750만)
  let s = snap([ov(), cash('general', -5000000)], fx);
  assert.deepStrictEqual(s.gen.ov, { ev: 1500, cost: 750 });
  assert.deepStrictEqual(s.gen.kr, { ev: 0, cost: 0 });
  // 국내 종목이 있으면 그 칸 안에서 먼저 상계된다
  s = snap([stock('general', { avgPrice: 1000000 }), ov(), cash('general', -5000000)], fx);
  assert.strictEqual(s.gen.kr.ev, 500);
  assert.strictEqual(s.gen.ov.ev, 2000);
  // 해외ETF 칸 → 해외주식 칸 순서, 전부 합쳐 순자산과 같다
  s = snap([stock('general', { market: 'us', quantity: 1, currentPrice: 3000000, avgPrice: 3000000 }), ov(), cash('general', -5000000)], fx);
  assert.strictEqual(s.gen.etf.ev, 0);
  assert.strictEqual(s.gen.ov.ev, 1800);
  // 계좌 전체가 음수면 0 아래로 내려가지 않는다
  s = snap([cash('general', -5000000)], fx);
  assert.deepStrictEqual(s.gen, { ov: { ev: 0, cost: 0 }, etf: { ev: 0, cost: 0 }, kr: { ev: 0, cost: 0 } });
});

test('저장된 자산이 없으면 모두 0', () => {
  store = {};
  const s = window.PortfolioBridge.getPortfolioSnapshot();
  assert.deepStrictEqual(s, { nh: 0, mf: 0, unclassifiedPersonalPension: 0, irp: 0, tirp: 0, isa: 0,
    gen: { ov: { ev: 0, cost: 0 }, etf: { ev: 0, cost: 0 }, kr: { ev: 0, cost: 0 } } });
});
