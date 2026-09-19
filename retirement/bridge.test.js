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

test('일반계좌·계좌유형이 없는 현금은 연동에서 제외된다', () => {
  const s = snap([cash('general', 9000000), cash(null, 9000000), cash('cash', 9000000)]);
  assert.deepStrictEqual([s.nh, s.mf, s.irp, s.tirp, s.isa], [0, 0, 0, 0, 0]);
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

test('저장된 자산이 없으면 모두 0', () => {
  store = {};
  const s = window.PortfolioBridge.getPortfolioSnapshot();
  assert.deepStrictEqual(s, { nh: 0, mf: 0, unclassifiedPersonalPension: 0, irp: 0, tirp: 0, isa: 0 });
});
