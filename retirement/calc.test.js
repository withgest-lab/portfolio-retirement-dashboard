const { test } = require('node:test');
const assert = require('node:assert/strict');
const c = require('./calc.js');
const {
  calcISA_FV, calcISA_Detail, pensionTaxRate, tirpTaxDiscount, dependentStatusCheck,
  propertyInsuranceScore, regionalHealthPremium, HEALTH_CAP_MIN, HEALTH_CAP_MAX, HEALTH_RATE_PROPERTY_WON,
  npsAdjustFactor, calcRetirementIncomeTax, pmtAnnualGrowing, propertyTaxBase,
  basicIncomeTax, pensionIncomeDeduction, comprehensivePensionTax, pensionTaxes,
  calcMonthlyDepositFV, growYears, stepBalance, stepBalanceDetail, pvOfMonthlyStream,
  futurePrinAdd, taxFreeBases, simulate, computeAutoPlan, buildAccRows, accumulate, npNominalAtStart
} = c;

// 화면 기본값과 같은 입력(납입 종료는 getP()처럼 은퇴나이-1로 정규화된 상태)
const BASE = {
  age:51, ret:57, life:90, exp:400, plimit:1450, realestate:0,
  nh:12000, nhm:99, nhstart:51, nhend:56, nhage:57, nhpay:70, nhprin:3000,
  mf:6000, mfm:0, mfstart:51, mfend:56, mfage:57, mfpay:46, mfprin:200,
  irp:400, irpy:300, irpymon:3, irpstart:51, irpend:56, irpage:70, irppay:0,
  tirp:22000, tdc:1000, tdcymon:1, tdcstart:51, tdcend:56, tservice:10, tage:65, tm:100, tirptax:2000,
  np:170, npbase:170, npage:65,
  isa:100, isay:2000, isaymon:1, isastart:51, isaend:56, isaage:57, isam:90,
  rnh:4, rmf:4, rirp:4, rtirp:4, risa:4, inf:2.5, curYear:2026
};
const withPlan = p => Object.assign({}, p, computeAutoPlan(p));
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} 기대 ${b}, 실제 ${a} (허용 ±${tol})`);

/* ── 세율·제도 기준 ── */
test('pensionTaxRate: 연령별 사적연금 저율분리과세 구간', () => {
  assert.equal(pensionTaxRate(55), 5.5);
  assert.equal(pensionTaxRate(69), 5.5);
  assert.equal(pensionTaxRate(70), 4.4);
  assert.equal(pensionTaxRate(79), 4.4);
  assert.equal(pensionTaxRate(80), 3.3);
});

test('tirpTaxDiscount: 퇴직소득세 연금수령 감면율 구간(21년차~ 50%)', () => {
  assert.equal(tirpTaxDiscount(1), 0.3);
  assert.equal(tirpTaxDiscount(10), 0.3);
  assert.equal(tirpTaxDiscount(11), 0.4);
  assert.equal(tirpTaxDiscount(20), 0.4);
  assert.equal(tirpTaxDiscount(21), 0.5);
});

test('dependentStatusCheck: 건보료 피부양자 재산·소득 기준', () => {
  assert.equal(dependentStatusCheck(0, 90001).fail, true);
  assert.equal(dependentStatusCheck(1001, 54001).fail, true);
  assert.equal(dependentStatusCheck(1000, 54001).fail, false);
  assert.equal(dependentStatusCheck(2001, 0).fail, true);
  assert.equal(dependentStatusCheck(2000, 54000).fail, false);
});

test('propertyTaxBase: 공시가격 → 재산세 과세표준', () => {
  assert.equal(propertyTaxBase(30000, 'single'), 12900);
  assert.equal(propertyTaxBase(50000, 'single'), 22000);
  assert.equal(propertyTaxBase(60000, 'single'), 26400);
  assert.equal(propertyTaxBase(100000, 'single'), 45000);
  assert.equal(propertyTaxBase(50000, 'multi'), 30000);
  assert.equal(propertyTaxBase(0, 'single'), 0);
});

test('propertyInsuranceScore: 1억 공제 후 남는 재산이 없으면 0점(재산보험료 0원)', () => {
  assert.equal(propertyInsuranceScore(0), 0);
  assert.equal(propertyInsuranceScore(10000), 0);
  assert.equal(propertyInsuranceScore(10001), 22);   // 공제 후 1만원 → 1등급
  assert.equal(propertyInsuranceScore(10451), 44);   // 공제 후 451만원 → 2등급
  assert.equal(propertyInsuranceScore(9999999), 2341);
});

test('regionalHealthPremium: 최저보험료는 소득분에만, 재산분은 별도로 더함', () => {
  const low = regionalHealthPremium(0, 0);
  assert.equal(low.healthPremium, Math.round(HEALTH_CAP_MIN/1000)/10);
  assert.equal(low.capped, true);
  // 소득 0 + 재산 과표 3억(공제 후 2억 → 586점): 하한 20,160원 + 586×211.5원
  const withProp = regionalHealthPremium(0, 30000);
  assert.equal(withProp.score, 586);
  assert.equal(withProp.healthPremium, Math.round((HEALTH_CAP_MIN + 586*HEALTH_RATE_PROPERTY_WON)/1000)/10);
  const high = regionalHealthPremium(100000, 9999999);
  assert.equal(high.healthPremium, Math.round(HEALTH_CAP_MAX/1000)/10);
  assert.equal(high.capped, true);
});

test('npsAdjustFactor: 국민연금 조기 -6%/년·연기 +7.2%/년', () => {
  assert.equal(npsAdjustFactor(65), 0);
  assert.equal(npsAdjustFactor(60), -0.3);
  assert.ok(Math.abs(npsAdjustFactor(68) - 0.216) < 1e-9);
});

test('calcRetirementIncomeTax: 공개 예시(퇴직금 1억·근속 10년 → 퇴직소득세 387.5만원)와 일치', () => {
  // 근속연수공제 1,500 → 환산급여 10,200 → 환산급여공제 6,260 → 과표 3,940 → 환산산출세액 465 → ×10/12 = 387.5
  assert.equal(calcRetirementIncomeTax(10000, 10), 388);
  const t10 = calcRetirementIncomeTax(30000, 10), t20 = calcRetirementIncomeTax(30000, 20), t30 = calcRetirementIncomeTax(30000, 30);
  assert.ok(t20 < t10 && t30 < t20, '근속이 길수록 세금이 줄어야 함');
});

test('basicIncomeTax: 기본세율 구간 경계에서 연속', () => {
  assert.equal(basicIncomeTax(1400), 84);
  near(basicIncomeTax(5000), 624, 1e-9);
  near(basicIncomeTax(8800), 8800*0.24 - 576, 1e-9);
  for(const b of [1400, 5000, 8800, 15000, 30000, 50000, 100000]){
    near(basicIncomeTax(b + 1e-6), basicIncomeTax(b), 1e-3, `구간 경계 ${b}`);
  }
});

test('pensionIncomeDeduction: 연금소득공제 구간·한도 900만원', () => {
  assert.equal(pensionIncomeDeduction(300), 300);
  assert.equal(pensionIncomeDeduction(350), 350);
  near(pensionIncomeDeduction(700), 490, 1e-9);
  near(pensionIncomeDeduction(1400), 630, 1e-9);
  near(pensionIncomeDeduction(4100), 900, 1e-9);
  assert.equal(pensionIncomeDeduction(9000), 900);
});

test('pensionTaxes: 1,500만원 이하는 저율/종합 중 적은 쪽, 초과는 16.5%/종합 중 적은 쪽', () => {
  // 다른 소득 없는 57세 사적연금 1,332만원: 종합과세(약 30만원)가 5.5% 분리과세(73만원)보다 적음
  const a = pensionTaxes(0, 1332, 57);
  assert.equal(a.method, 'comp');
  near(a.priv, comprehensivePensionTax(1332, 57), 1e-9);
  assert.ok(a.priv < 1332*0.055);
  // 국민연금 3,876 + 사적연금 4,548(77세): 16.5% 분리과세가 종합과세 증가분보다 적음
  const b = pensionTaxes(3876, 4548, 77);
  assert.equal(b.method, 'sep165');
  near(b.priv, 4548*0.165, 1e-9);
  near(b.np, comprehensivePensionTax(3876, 77), 1e-9);
  // 사적연금이 없으면 국민연금 종합과세만
  assert.equal(pensionTaxes(2040, 0, 66).priv, 0);
});

/* ── 독립 공식과 교차검증 ── */
test('calcMonthlyDepositFV: 등비급수 닫힌식과 일치', () => {
  const B = 10000, m = 50, r = 4, years = 6, rm = r/1200, n = years*12;
  const closed = B*Math.pow(1+rm, n) + m*(1+rm*10/30)*(Math.pow(1+rm, n)-1)/rm;
  near(calcMonthlyDepositFV(B, m, 51, 56, 51, 57, r), Math.round(closed), 1);
});

test('growYears: 인출 없는 해의 stepBalance(월복리 12회)와 같은 배수', () => {
  near(stepBalance(10000, 4, 0) / 10000, growYears(4, 1), 1e-12);
  near(10000 * growYears(4, 3), stepBalance(stepBalance(stepBalance(10000, 4, 0), 4, 0), 4, 0), 1e-6);
});

test('pvOfMonthlyStream: 그 금액에서 같은 금액을 계속 빼면 기간 끝에 0', () => {
  const pv = pvOfMonthlyStream(70, 8, 4);
  let b = pv;
  for(let y=0; y<8; y++) b = stepBalanceDetail(b, 4, 70).bal;
  near(b, 0, 1e-6);
});

test('pmtAnnualGrowing: 산출된 월 인출액으로 N년 뒤 잔액이 0에 수렴', () => {
  const fv = 100000, rate = 4, inf = 2.5, N = 20;
  const pmt = pmtAnnualGrowing(fv, rate, inf, N);
  let bal = fv;
  for(let year=0; year<N; year++) bal = stepBalance(bal, rate, pmt * Math.pow(1+inf/100, year));
  assert.ok(Math.abs(bal) < fv * 1e-6, `잔액이 0에 수렴해야 함 (실제: ${bal})`);
  assert.equal(pmtAnnualGrowing(0, 4, 2.5, 10), 0);
  assert.equal(pmtAnnualGrowing(10000, 4, 2.5, 0), 0);
});

/* ── ISA ── */
test('calcISA_FV: 해지 없이 연속 복리, 비과세 한도 이내면 IRP와 같은 값', () => {
  const fv5 = calcISA_FV(0, 1000, 0, 0, 4, 5, 4, 'isa');
  const fv10 = calcISA_FV(0, 1000, 0, 0, 9, 10, 4, 'isa');
  assert.ok(fv10 > fv5 * 2.1, '회차 리셋 없이 연속 복리로 누적되어야 함');
  assert.equal(calcISA_FV(0, 10, 0, 0, 4, 5, 4, 'isa'), calcISA_FV(0, 10, 0, 0, 4, 5, 4));
});

test('calcISA_Detail: 계속 보유 시 총 납입한도 1억원 — 초과 납입분은 제외', () => {
  const d = calcISA_Detail(7, 2000, 51, 51, 56, 57, 4, 'isa', 1);
  assert.equal(d.principal, 10000);       // 7 + 9,993(5년차에 한도 도달)
  assert.equal(d.capHitAge, 55);
  // IRP(한도 없음)는 6년 전부 납입
  assert.equal(calcISA_Detail(7, 2000, 51, 51, 56, 57, 4, undefined, 1).principal, 12007);
});

/* ── 미래 안세공(세액공제 초과 납입분) 자동 합산 ── */
test('futurePrinAdd: 2026년분은 제외(입력값이 2026년 말 확정), 2027년분부터 합산', () => {
  // 농협 월 99만 = 연 1,188만 → 연금저축 공제 600 → 초과 588/년, IRP 300은 합산 900 안이라 초과 없음
  const a = futurePrinAdd(BASE, 2026);   // 2027~2031년 = 52~56세, 5년
  assert.equal(a.years, 5);
  assert.equal(a.nh, 588*5);
  assert.equal(a.irp, 0);
});

test('futurePrinAdd: 시간이 흘러도 이미 지난 해(2027~작년)가 빠지지 않음', () => {
  // 2029년에 54세로 나이만 갱신 — 같은 사람이므로 합산액이 같아야 함(52·53세분은 이미 지난 해)
  const later = futurePrinAdd(Object.assign({}, BASE, {age:54}), 2029);
  assert.equal(later.nh, 588*5);
});

test('futurePrinAdd: 연금저축 600·IRP 합산 900 배분, 연 1,800 초과 경고', () => {
  const p = Object.assign({}, BASE, {nhm:30, mfm:30, irpy:500});
  const a = futurePrinAdd(p, 2026);
  // 연금저축 720 → 공제 600, 초과 120을 농협·미래 60/60, IRP 500 중 공제 300 → 초과 200
  assert.equal(a.nh, 60*5); assert.equal(a.mf, 60*5); assert.equal(a.irp, 200*5);
  assert.deepEqual(futurePrinAdd(Object.assign({}, BASE, {nhm:150, irpy:300}), 2026).overPayAges.length, 5);
});

/* ── 시뮬레이션: 중복·누락 방지(보존 법칙) ── */
test('simulate: 매년 월 합계 = 구성요소 합(중복·누락 없음), 세후 = 합계 − 세금', () => {
  const r = simulate(withPlan(BASE));
  for(const x of r.rows){
    assert.equal(x.totalInc, x.nhInc + x.mfInc + x.irpInc + x.prinInc + x.npInc + x.tirpInc + x.isaInc, `${x.age}세 합계`);
    assert.equal(x.netInc, Math.max(0, x.totalInc - x.taxTotal), `${x.age}세 세후`);
  }
});

test('simulate: 국민연금은 현재가치 입력 → 매년 물가만큼 증액', () => {
  const r = simulate(withPlan(BASE));
  for(const x of r.rows){
    const expect = x.age >= BASE.npage ? Math.round(BASE.np * Math.pow(1.025, x.age - BASE.age)) : 0;
    assert.equal(x.npInc, expect, `${x.age}세`);
  }
  assert.equal(npNominalAtStart(BASE), Math.round(170 * Math.pow(1.025, 14)));
});

test('simulate: 비과세 분류 총액 = 과세제외금액 T, 이연퇴직소득 분류 총액 = 은퇴 시점 DC 평가액', () => {
  const p = withPlan(BASE);
  const r = simulate(p);
  const T = taxFreeBases(p);
  near(sum(r.rows, x => x.freeAnnual.nh), Math.min(T.nh, sum(r.rows, x => x.gross.nh)), 1e-6, '농협 비과세');
  near(sum(r.rows, x => x.freeAnnual.mf), Math.min(T.mf, sum(r.rows, x => x.gross.mf)), 1e-6, '미래 비과세');
  near(sum(r.rows, x => x.tirpDeferredAnnual), Math.min(r.tirpFV, sum(r.rows, x => x.gross.tirp)), 1e-6, '이연퇴직소득');
});

test('simulate: 계좌 하나 = 잔액 하나(안세공 포함) — 은퇴 시점 잔액이 적립기 마지막 해 잔액과 이어짐', () => {
  const p = withPlan(BASE);
  const acc = buildAccRows(p);
  const a = accumulate(p);
  const last = acc[acc.length-1];
  assert.equal(last.nhB_억, Math.round(a.nhFV/10000*10)/10);
  // 안세공 원금이 잔액에서 빠지지 않음(예전엔 차트·런웨이에서 누락)
  assert.ok(a.nhFV > calcMonthlyDepositFV(p.nh - p.nhprin, p.nhm, 51, 56, 51, 57, 4));
});

test('자동설계 → 시뮬레이션: 계좌마다 기대수명(또는 지정 구간 끝)에 소진, 남는 돈 총자산의 1% 미만', () => {
  const p = withPlan(BASE);
  const r = simulate(p);
  assert.equal(r.runway, p.life);
  assert.ok(r.leftover < r.totalFV * 0.01, `잔여 ${Math.round(r.leftover)} / 총자산 ${r.totalFV}`);
  const last = r.rows[r.rows.length-1];
  for(const k of ['nh','mf','irp','tirp','isa']){
    const fv = r[k+'FV'];
    if(fv > 0) assert.ok(last.bal[k] < fv * 0.02, `${k} 잔여 ${Math.round(last.bal[k])} / ${fv}`);
  }
  // ISA·미래에셋은 공백기 끝(국민연금 개시 전)까지 소진
  const gapLast = r.rows.find(x => x.age === p.npage - 1);
  assert.ok(gapLast.bal.isa < r.isaFV * 0.02 && gapLast.bal.mf < r.mfFV * 0.02);
});

test('사적연금 1,500만원은 세율 경계일 뿐 — 넘는 해에도 인출액을 깎지 않음', () => {
  const p = withPlan(BASE);
  const r = simulate(p);
  const over = r.rows.filter(x => x.privTaxableAnnual > p.plimit);
  assert.ok(over.length > 0, '기본값에서 한도를 넘는 해가 있어야 함');
  for(const x of over){
    if(x.age <= p.life - 2 && x.age >= p.nhage && x.age >= p.npage){ // 잔액이 모자란 마지막 해 제외
      assert.equal(x.gross.nh, Math.round(p.nhpay * x.infMul) * 12, `${x.age}세 농협 인출이 계획대로여야 함`);
    }
  }
  assert.ok(over.some(x => x.taxMethod === 'sep165' || x.taxMethod === 'comp'));
});

test('엣지: 은퇴 ≥ 국민연금 개시(공백기 없음)여도 안세공·ISA·미래에셋이 전부 인출됨', () => {
  const p = withPlan(Object.assign({}, BASE, {ret:66, npage:65, nhend:65, mfend:65, irpend:65, isaend:65, tdcend:65}));
  const r = simulate(p);
  const T = taxFreeBases(p);
  near(sum(r.rows, x => x.freeAnnual.nh + x.freeAnnual.mf + x.freeAnnual.irp), T.nh + T.mf + T.irp, 1e-6, '비과세 원금 전액 분류');
  const last = r.rows[r.rows.length-1];
  assert.ok(last.bal.isa < r.isaFV * 0.02, 'ISA 소진');
  assert.ok(last.bal.mf < r.mfFV * 0.02, '미래에셋 소진');
  assert.equal(r.runway, p.life);
});

test('엣지: 55세 전 은퇴 — 연금저축은 55세부터, 그 전엔 ISA·비과세 원금만', () => {
  const p = withPlan(Object.assign({}, BASE, {ret:52, nhend:51, mfend:51, irpend:51, isaend:51, tdcend:51}));
  assert.equal(p.nhage, 55); assert.equal(p.mfage, 55);
  const r = simulate(p);
  for(const x of r.rows.filter(x => x.age < 55)){
    assert.equal(x.nhInc + x.mfInc + x.irpInc + x.tirpInc, 0, `${x.age}세에는 과세 연금 인출이 없어야 함`);
  }
  assert.equal(r.runway, p.life);
  assert.ok(r.leftover < r.totalFV * 0.01);
});

test('필요분만 인출: 해마다 생활비 이상은 빼지 않고, 남는 자산은 완전소진보다 많음', () => {
  const p = withPlan(BASE);
  const full = simulate(p), need = simulate(p, c.SA.base, {needOnly:true});
  for(const x of need.rows){
    assert.ok(x.totalInc <= Math.max(x.curExp, x.npInc) + 5, `${x.age}세 ${x.totalInc} > 생활비 ${x.curExp}`);
  }
  assert.ok(need.leftover > full.leftover);
});

test('ISA 해지 과세는 계좌에서 한 번만 차감(세후 계산에 이중 반영 안 됨)', () => {
  const p = withPlan(BASE);
  const r = simulate(p);
  const taxed = r.rows.filter(x => x.isaTax > 0);
  assert.equal(taxed.length, 1);
  const x = taxed[0];
  // 그해 월 세금은 연금소득세·퇴직소득세뿐(각각 반올림이라 ±2만원 이내) — ISA 해지세(수백만원)는 들어가지 않음
  near(x.taxTotal, x.taxPriv + x.taxNp + x.taxTirp, 2, 'ISA 해지세가 세후에 다시 빠지면 안 됨');
  assert.ok(x.isaTax > 10);
  assert.equal(Math.round(r.isaTaxPaid), x.isaTax);
});
