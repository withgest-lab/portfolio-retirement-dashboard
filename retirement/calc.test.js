const { test } = require('node:test');
const assert = require('node:assert/strict');
const c = require('./calc.js');
const {
  calcISA_FV, calcISA_Detail, pensionTaxRate, tirpTaxDiscount, dependentStatusCheck,
  propertyInsuranceScore, regionalHealthPremium, HEALTH_CAP_MIN, HEALTH_CAP_MAX, HEALTH_RATE_PROPERTY_WON,
  npsAdjustFactor, calcRetirementIncomeTax, pmtAnnualGrowing, propertyTaxBase,
  basicIncomeTax, pensionIncomeDeduction, comprehensivePensionTax, pensionTaxes,
  calcMonthlyDepositFV, growYears, stepBalance, stepBalanceDetail, pvOfMonthlyStream,
  futurePrinAdd, taxFreeBases, simulate, computeAutoPlan, buildAccRows, accumulate, npNominalAtStart,
  pensionLimitAnnual, bridgeExtraMonthly, healthPremiumYear, regionalIncomeMonthly,
  wageIncomeDeduction, wageTaxCredit, comprehensiveTotal, otherIncomeReal, npsMembershipFactor,
  housingPensionMonthly, housingPensionOf, expPct, lumpsAt, genYear, genInit, genSum, genGrow
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
test('simulate: 매년 월 합계 = 구성요소 합(중복·누락 없음), 세후 = 합계 − 세금 − 건보료', () => {
  const r = simulate(withPlan(BASE));
  for(const x of r.rows){
    assert.equal(x.totalInc, x.nhInc + x.mfInc + x.irpInc + x.prinInc + x.npInc + x.tirpInc + x.isaInc + x.othInc + x.hpInc + x.genInc, `${x.age}세 합계`);
    assert.equal(x.netInc, Math.max(0, x.totalInc - x.taxTotal - x.hi - x.npPrem), `${x.age}세 세후`);
  }
});

/* ── 건보료(지역가입자)를 세후에서 차감 ── */
const HI = Object.assign({}, BASE, {realestate:30000, hi_interest:600, hi_dividend:600, hi_other:100});
test('건보료: 은퇴 전 0, 공백기 < 국민연금 수령 후, 수령 후는 오늘 가치로 일정, 행 합계 = lifetimeHi', () => {
  assert.equal(healthPremiumYear(HI, HI.ret - 1, 0, 1).annual, 0);
  const r = simulate(withPlan(HI));
  const gap = r.rows.filter(x => x.age < HI.npage), full = r.rows.filter(x => x.age >= HI.npage);
  assert.ok(gap.every(x => x.hi > 0) && full[0].hi / full[0].infMul > gap[0].hi / gap[0].infMul, '공백기 < 수령 후');
  for(const x of full) near(x.hi / x.infMul, full[0].hi / full[0].infMul, 0.6, `${x.age}세 오늘 가치 일정`);
  near(sum(r.rows, x => x.hi * 12), r.lifetimeHi, r.rows.length * 6, '행 합계');
  near(r.lifetimeNetReal, sum(r.rows, x => x.netInc * 12 / x.infMul), 1e-6, '평생 세후 합계(오늘 가치)');
});

test('건보료: 패널 단독 계산(regionalHealthPremium)과 같은 해 금액(오늘 가치)이 같음', () => {
  const y = healthPremiumYear(HI, 70, HI.np, 1.3);
  const panel = regionalHealthPremium(regionalIncomeMonthly(HI), HI.realestate);
  assert.equal(y.monthlyReal, panel.total);
  near(y.annual, panel.total * 12 * 1.3, 1e-9);
  // 이자+배당 1,000만원 이하면 금융소득 0, 초과면 전액
  const lowFin = healthPremiumYear(Object.assign({}, HI, {hi_dividend:300}), 70, HI.np, 1).monthlyReal;
  assert.ok(lowFin < y.monthlyReal);
});

test('건보료는 인출 계획과 무관(사적연금·ISA 부과 제외) — 인출을 바꿔도 세후 차이 = 세금 차이만', () => {
  const p = withPlan(HI);
  const a = simulate(p), b = simulate(Object.assign({}, p, {isam: p.isam * 1.5, nhpay: p.nhpay * 0.5}));
  for(let i = 0; i < a.rows.length; i++) assert.equal(a.rows[i].hi, b.rows[i].hi, `${a.rows[i].age}세`);
  near(a.lifetimeHi, b.lifetimeHi, 1e-6);
});

test('건보료: 피부양자 가족 있음이면 판정 통과한 해는 0, 소득 기준을 넘으면 지역 금액', () => {
  const dep = Object.assign({}, BASE, {hi_dep:'yes'});
  assert.equal(healthPremiumYear(dep, 66, 100, 1).annual, 0);        // 연 1,200만 ≤ 2,000만
  assert.ok(healthPremiumYear(dep, 66, 200, 1).annual > 0);          // 연 2,400만 > 2,000만
  assert.ok(healthPremiumYear(dep, 66, 150, 1.2).annual > 0);        // 명목 2,160만 > 2,000만(기준선 명목 고정)
  assert.ok(healthPremiumYear(BASE, 66, 100, 1).annual > 0);         // 가족 없음(기본) → 항상 지역가입자
  const r = simulate(withPlan(dep));
  assert.ok(r.rows.filter(x => x.age < dep.npage).every(x => x.hi === 0), '공백기 소득 0 → 피부양자');
});

test('필요분만 인출: 세후(건보료 차감 후)를 생활비에 맞춤', () => {
  const p = withPlan(Object.assign({}, HI, {exp:250}));
  const need = simulate(p, undefined, {needOnly:true});
  const full = simulate(p);
  for(let i = 0; i < need.rows.length; i++){
    const n = need.rows[i], f = full.rows[i];
    if(f.netInc > f.curExp + 2 && n.npInc - n.taxNp - n.hi < n.curExp) near(n.netInc, n.curExp, 3, `${n.age}세`);
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
  // ISA·미래에셋은 자동설계가 고른 소진 나이(isaEnd·mfEnd)에 0원
  const plan = computeAutoPlan(BASE);
  const isaEndRow = r.rows.find(x => x.age === plan.info.isaEnd), mfEndRow = r.rows.find(x => x.age === plan.info.mfEnd);
  assert.ok(isaEndRow.bal.isa < r.isaFV * 0.02 && mfEndRow.bal.mf < r.mfFV * 0.02);
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

test('필요분만 인출: 세후가 생활비를 넘는 해만 사적 인출을 줄여 세후 ≈ 생활비, 남는 자산은 완전소진보다 많음', () => {
  const p = withPlan(Object.assign({}, BASE, {exp:250}));   // 세후가 생활비를 넘는 해가 있는 시나리오
  const full = simulate(p), need = simulate(p, c.SA.base, {needOnly:true});
  // 첫해는 잔액이 같으므로 직접 비교: 세후가 생활비를 넘으면 생활비에 맞춰 줄인다
  const f0 = full.rows[0], n0 = need.rows[0];
  if(f0.netInc > f0.curExp + 2) near(n0.netInc, n0.curExp, 3, `${n0.age}세 세후를 생활비에 맞춰야 함`);
  // 모든 해: 줄인 해의 세후는 생활비 근처, 안 줄인 해는 세후가 생활비 이하
  for(const x of need.rows) assert.ok(x.netInc <= Math.max(x.curExp, Math.round(x.npInc)) + 3, `${x.age}세 세후 ${x.netInc} > 생활비 ${x.curExp}`);
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

/* ── 2차 점검(2026-10-04): 연금수령한도·감면 연차·피부양자 사업소득·평탄화·오늘 기준 요약 ── */
test('pensionLimitAnnual: 평가액 ÷ (11 − 연차) × 120%, 11년차부터 한도 없음, 수령 요건 전은 0', () => {
  near(pensionLimitAnnual(10000, 1), 1200, 1e-9);
  near(pensionLimitAnnual(10000, 3), 1500, 1e-9);
  near(pensionLimitAnnual(10000, 10), 12000, 1e-9);
  assert.equal(pensionLimitAnnual(10000, 11), Infinity);
  assert.equal(pensionLimitAnnual(10000, 0), 0);
});

test('연금수령한도 초과분은 연금외수령: 16.5% 기타소득, 1,500만원 판정에서 제외 / 자동설계는 초과 없음', () => {
  assert.equal(simulate(withPlan(BASE)).overLimitYears, 0, '자동설계 값은 한도 안');
  const p = Object.assign({}, withPlan(BASE), {mfpay:150});
  const r = simulate(p);
  const over = r.rows.filter(x => x.taxedOverAnnual > 0.5);
  assert.ok(over.length > 0 && r.overLimitYears === over.length);
  for(const x of over){
    near(x.taxOther, Math.round(x.otherAnnual * 0.165 / 12), 1, `${x.age}세 연금외수령 세금`);
  }
  for(const x of r.rows){ // 과세 구분 보존: 연금소득 과세분 + 연금외수령분 = (인출 − 비과세) + 퇴직IRP 운용수익분
    const taxable = (x.gross.nh + x.gross.mf + x.gross.irp) - (x.freeAnnual.nh + x.freeAnnual.mf + x.freeAnnual.irp) + (x.gross.tirp - x.tirpDeferredAnnual);
    near(x.privTaxableAnnual + x.otherAnnual, taxable, 1e-6, `${x.age}세 과세 구분 합`);
  }
});

test('퇴직IRP 감면 연차는 실제로 처음 받은 해부터(수령 시작을 은퇴보다 앞으로 넣어도)', () => {
  const p = Object.assign({}, withPlan(BASE), {tage:55});   // 은퇴는 57세 → 실제 1년차는 57세
  const r = simulate(p);
  const x = r.rows.find(y => y.age === 66);                // 실제 10년차 → 30% 감면이어야 함(예전엔 12년차 40%)
  near(x.taxTirp, Math.round(x.tirpDeferredAnnual * r.tirpTaxRate * 0.7 / 12), 1);
  const y = r.rows.find(z => z.age === 67);                // 실제 11년차 → 40%
  near(y.taxTirp, Math.round(y.tirpDeferredAnnual * r.tirpTaxRate * 0.6 / 12), 1);
});

test('피부양자: 사업소득 500만원 초과면 탈락, 그 이하라도 있으면 사업자등록 경고', () => {
  assert.equal(dependentStatusCheck(1000, 0, 600).fail, true);
  const w = dependentStatusCheck(1000, 0, 300);
  assert.equal(w.fail, false); assert.ok(w.warn.length > 0);
  assert.equal(dependentStatusCheck(1000, 0, 0).warn, '');
  assert.equal(dependentStatusCheck(2001, 0, 0).fail, true);   // 기존 기준 유지
});

test('평탄화: 55세 이후 안세공 추가 인출 없음, 최저 세후 실질소득이 기준안 이상, 기대수명까지 유지', () => {
  const plan = computeAutoPlan(BASE);
  assert.ok(plan.info.leveled.minNet >= plan.info.baseline.minNet - 1e-9);
  const r = simulate(Object.assign({}, BASE, plan));
  assert.deepEqual([r.extra.nh, r.extra.mf], [0, 0], '은퇴 57세 → 가교 인출 없음');
  assert.equal(r.runway, BASE.life);
  assert.ok(r.minNetReal > 250, `최저 세후 실질 ${Math.round(r.minNetReal)}`);   // 회귀 방지(샘플 입력 기준)
  // 55세 전 은퇴: 은퇴~54세만 가교 인출
  const e = Object.assign({}, BASE, {ret:52, nhend:51, mfend:51, irpend:51, isaend:51, tdcend:51});
  const b = bridgeExtraMonthly(taxFreeBases(e), e);
  assert.equal(b.years, 3); assert.ok(b.nh > 0);
  const er = simulate(Object.assign({}, e, computeAutoPlan(e)));
  const at55 = er.rows.find(x => x.age === 55), at54 = er.rows.find(x => x.age === 54);
  assert.ok(at54.prinInc > 0, '54세까지는 비과세 원금 가교 인출');
  assert.equal(er.overLimitYears, 0, '55세 전 비과세 원금 인출은 세금 붙는 한도 초과가 아님');
  assert.ok(at55.totalInc > 0);
});

test('오늘 기준 요약이 연도별 행과 일치하고, 생활비 미달은 세후로 셈', () => {
  const r = simulate(withPlan(BASE));
  const gap = r.rows.filter(x => x.age < BASE.npage), full = r.rows.filter(x => x.age >= BASE.npage);
  assert.equal(r.phase.gap.net, Math.round(sum(gap, x => x.netInc / x.infMul) / gap.length));
  assert.equal(r.phase.full.gross, Math.round(sum(full, x => x.totalInc / x.infMul) / full.length));
  assert.equal(r.shortNetYears, r.rows.filter(x => x.netInc < x.curExp).length);
  near(r.minNetReal, Math.min(...r.rows.map(x => x.netInc / x.infMul)), 1e-9);
});

test('비관 시나리오: 같은 계획이면 기대수명 전에 소진되고, 생활비 미달은 소진보다 먼저 드러남', () => {
  const p = withPlan(BASE);
  const s = simulate(p, c.SA.pes);
  assert.ok(s.runway < p.life, `runway ${s.runway}`);
  assert.ok(s.firstShortNetAge !== null && s.firstShortNetAge <= s.runway);
});

test('무작위 입력 200건: 합계·NaN·음수·비과세≤T·이연≤DC 평가액·세후≤세전·자동설계 기대수명 유지', () => {
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const ri = (a, b) => Math.round(a + rnd() * (b - a));
  for(let i = 0; i < 200; i++){
    const age = ri(40, 62), ret = ri(Math.max(age, 50), 70), life = ri(75, 105);
    const p = Object.assign({}, BASE, {age, ret, life, npage: ri(60, 70), exp: ri(100, 600),
      nh: ri(0, 50000), nhm: ri(0, 150), nhstart: ri(40, 65), nhprin: ri(0, 8000), mf: ri(0, 30000), mfm: ri(0, 150), mfstart: ri(40, 65), mfprin: ri(0, 5000),
      irp: ri(0, 20000), irpy: ri(0, 1200), irpstart: ri(40, 65), tirp: ri(0, 100000), tdc: ri(0, 3000), tdcstart: ri(40, 65), tservice: ri(1, 45),
      isa: ri(0, 20000), isay: ri(0, 2000), isastart: ri(40, 65), rnh: ri(0, 15), rmf: ri(0, 15), rirp: ri(0, 15), rtirp: ri(0, 15), risa: ri(0, 20),
      inf: ri(0, 10) / 2, np: ri(0, 500), curYear: ri(2026, 2035),
      realestate: ri(0, 120000), hi_interest: ri(0, 1500), hi_labor: ri(0, 3000), hi_dep: rnd() < 0.3 ? 'yes' : 'no',
      // 2026-10-09 새 기능도 무작위로 섞는다(대부분 꺼진 채, 켜지면 불변식이 그대로 지켜져야 함)
      hi_labor_from: rnd() < 0.5 ? ri(ret, ret + 10) : 0, hi_labor_to: rnd() < 0.5 ? ri(ret + 2, ret + 15) : 0,
      hi_vol: rnd() < 0.3 ? 'yes' : 'no', hi_volprem: ri(0, 30), npyears: ri(5, 35), npcont: rnd() < 0.5 ? 'stop' : 'cont', np_volprem: ri(0, 40),
      exp_s1_age: rnd() < 0.4 ? ri(ret + 5, ret + 20) : 0, exp_s1_pct: ri(60, 110), exp_s2_age: rnd() < 0.3 ? ri(ret + 15, ret + 25) : 0, exp_s2_pct: ri(50, 100),
      hp_age: rnd() < 0.3 ? ri(60, 85) : 0, hp_price: ri(0, 80000), bequest: rnd() < 0.3 ? ri(0, 5000) : 0,
      lump1_age: rnd() < 0.3 ? ri(ret, life) : 0, lump1_amt: ri(0, 3000),
      gen_ov: rnd() < 0.5 ? ri(0, 30000) : 0, gen_ovr: ri(-30, 80), gen_etf: rnd() < 0.4 ? ri(0, 10000) : 0, gen_etfr: ri(-20, 60), gen_kr: rnd() < 0.5 ? ri(0, 10000) : 0,
      gen_harvest: rnd() < 0.5 ? 'yes' : 'no', rgen: ri(0, 10)});
    for(const k of ['nhend','mfend','irpend','isaend','tdcend']) p[k] = ret - 1;
    const q = Object.assign({}, p, computeAutoPlan(p));
    const r = simulate(q), T = taxFreeBases(q);
    for(const x of r.rows){
      const v = [x.totalInc, x.netInc, x.taxTotal, ...Object.values(x.bal)];
      assert.ok(v.every(Number.isFinite), `#${i} ${x.age}세 NaN`);
      assert.ok(Object.values(x.bal).every(b => b >= -1e-6), `#${i} 음수 잔액`);
      assert.equal(x.totalInc, x.nhInc + x.mfInc + x.irpInc + x.prinInc + x.npInc + x.tirpInc + x.isaInc + x.othInc + x.hpInc + x.genInc, `#${i} 합계`);
      assert.equal(x.netInc, Math.max(0, x.totalInc - x.taxTotal - x.hi - x.npPrem), `#${i} 세후 = 합계 − 세금 − 건보료`);
      assert.ok(x.hi >= 0 && x.netInc <= x.totalInc && x.nhInc >= 0 && x.mfInc >= 0 && x.irpInc >= 0, `#${i} 세후/음수`);
    }
    assert.ok(sum(r.rows, x => x.freeAnnual.nh + x.freeAnnual.mf + x.freeAnnual.irp) <= T.nh + T.mf + T.irp + 1e-6, `#${i} 비과세`);
    assert.ok(sum(r.rows, x => x.tirpDeferredAnnual) <= r.tirpFV + 1e-6, `#${i} 이연`);
    if(life > ret && r.totalFV > 1000) assert.equal(r.runway, life, `#${i} 자동설계 기대수명 유지`);
  }
});

/* ── 최종 점검(2026-10-05) 회귀 ── */
test('simulate: 낙관·비관 시나리오는 그 시나리오의 DC 평가액으로 퇴직소득세를 다시 계산한다(직접 입력값은 고정)', () => {
  const tserv = BASE.tservice + BASE.ret - BASE.age;
  const p = Object.assign({}, BASE, { tirptax: calcRetirementIncomeTax(accumulate(BASE).tirpFV, tserv) });   // 화면의 자동값(기본 시나리오 기준)
  const taxIn = s => s.tirpTaxRate * s.tirpFV;                       // 시뮬레이션이 실제로 안분하는 세액(지방세 포함)
  near(taxIn(simulate(p, c.SA.base)), p.tirptax * 1.1, 1e-6, '기본 시나리오는 입력값 그대로');
  for(const [name, adj] of [['낙관', c.SA.opt], ['비관', c.SA.pes]]){
    const s = simulate(p, adj);
    near(taxIn(s), calcRetirementIncomeTax(s.tirpFV, tserv) * 1.1, 1e-6, name + ' 시나리오 퇴직소득세');
    assert.notEqual(Math.round(taxIn(s)), Math.round(p.tirptax * 1.1), name + '은 기본 시나리오 세액과 달라야 함');
    // 직접 입력한 퇴직소득세는 시나리오가 달라도 그대로
    const manual = simulate(Object.assign({}, p, { tirptaxManual: true }), adj);
    near(taxIn(manual), p.tirptax * 1.1, 1e-6, name + ' 직접 입력값 고정');
  }
});

test('입력칸 범위: 자동설계가 만드는 값이 칸 범위 안에 있어야 한다(ISA 인출 시작 나이는 은퇴 최소 나이 이하까지 허용)', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, 'index.html'), 'utf8');
  const attr = (id, a) => Number((new RegExp('id="' + id + '"[^>]*[ ]' + a + '="(-?[0-9]+)"').exec(html) || [])[1]);
  // 은퇴 50~54세면 자동설계는 ISA 인출을 은퇴 나이부터 시작한다 — 칸 최소값이 55면 칸을 한 번 거치기만 해도 값이 바뀌어 52~54세 소득이 사라졌다
  for(const ret of [50, 52, 54]){
    const plan = computeAutoPlan(Object.assign({}, BASE, { ret, nhend: ret - 1, mfend: ret - 1, irpend: ret - 1, isaend: ret - 1, tdcend: ret - 1 }));
    assert.equal(plan.isaage, ret);
    assert.ok(attr('isaage', 'min') <= ret && attr('isaage-r', 'min') <= ret, `isaage 칸 최소값(${attr('isaage', 'min')})이 은퇴 ${ret}세보다 큼`);
  }
  assert.ok(attr('isaage', 'min') <= attr('ret', 'min'), 'isaage 최소값 ≤ 은퇴 나이 최소값');
});


/* ── 2026-10-09: 은퇴 후 소득 수입 반영·국민연금 60세 전 공백·임의계속가입 ── */
test('근로소득공제·근로세액공제: 국세청 구간과 한도', () => {
  assert.equal(wageIncomeDeduction(500), 350);
  assert.equal(wageIncomeDeduction(1500), 750);
  assert.equal(wageIncomeDeduction(4500), 1200);
  assert.equal(wageIncomeDeduction(10000), 1475);
  assert.equal(wageIncomeDeduction(20000), 1675);
  assert.equal(wageIncomeDeduction(100000), 2000);   // 한도 2,000만원
  near(wageTaxCredit(100, 3000), 55, 1e-9, '130만원 이하 55%');
  assert.equal(wageTaxCredit(200, 3000), 74);        // 71.5 + 70×30% = 92.5 → 총급여 3,300만 이하 한도 74만
  near(wageTaxCredit(200, 5000), 66, 1e-9, '총급여 5,000만 한도(74−1700×0.8%=60.4 → 최소 66)');
});

test('금융소득: 2,000만원 이하는 14%(+지방세) 분리, 초과분은 비교과세로 더 큰 쪽', () => {
  near(comprehensiveTotal(0, {fin: 1500}, 65), 1500 * 0.154, 1e-9, '1,500만 → 15.4%');
  const t = comprehensiveTotal(0, {fin: 3000}, 65);
  assert.ok(t > comprehensiveTotal(0, {fin: 2000}, 65));
});

test('pensionTaxes: 다른 소득이 있어도 합계 = 소득세 + 국민연금 + 사적연금(중복 없음), 없으면 기존 식과 같음', () => {
  const ex = {labor: 3600, business: 0, other: 0, fin: 0};
  const a = pensionTaxes(2400, 800, 60, ex);
  near(a.oth + a.np + (a.method === 'comp' ? a.priv : 0), comprehensiveTotal(2400 + (a.method === 'comp' ? 800 : 0), ex, 60), 1e-6, '합계');
  const b = pensionTaxes(2400, 800, 60), d = pensionTaxes(2400, 800, 60, {labor:0, business:0, other:0, fin:0});
  near(b.np, d.np, 1e-9, '빈 ex = 없는 ex'); near(b.priv, d.priv, 1e-9);
  assert.equal(b.oth, 0);
  assert.ok(a.np > b.np, '근로소득이 있으면 국민연금에 붙는 세금이 더 커진다(누진)');
});

test('simulate: 은퇴 후 근로소득은 기간 안 해에만 수입·세금·건보료에 반영(중복 없음)', () => {
  const p = withPlan(Object.assign({}, BASE, {hi_labor: 3000, hi_labor_from: 57, hi_labor_to: 61}));
  const r = simulate(p), r0 = simulate(withPlan(BASE));
  for(const x of r.rows){
    const inWin = x.age >= 57 && x.age <= 61;
    assert.equal(x.othInc > 0, inWin, `${x.age}세 근로소득 기간`);
    assert.equal(x.totalInc, x.nhInc + x.mfInc + x.irpInc + x.prinInc + x.npInc + x.tirpInc + x.isaInc + x.othInc + x.hpInc + x.genInc, `${x.age}세 합계`);
  }
  assert.ok(r.rows[0].othInc > 0 && r.rows[0].taxOth > 0, '근로소득 세금(oth)');
  const gap = r.rows.find(x => x.age === 57), gap0 = r0.rows.find(x => x.age === 57);
  assert.ok(gap.hi > gap0.hi, '근로소득이 있으면 건보료도 오른다');
  assert.ok(gap.netInc > gap0.netInc, '그래도 세후는 늘어난다(소득 > 세금+건보료)');
  assert.equal(r.rows.find(x => x.age === 62).othInc, 0);
});

test('otherIncomeReal: 기간 빈칸 = 은퇴~기대수명, 이자·배당은 은퇴 후 계속', () => {
  const p = Object.assign({}, BASE, {hi_labor: 100, hi_interest: 30, hi_dividend: 20});
  assert.equal(otherIncomeReal(p, 56).labor, 0); assert.equal(otherIncomeReal(p, 56).fin, 0);
  assert.equal(otherIncomeReal(p, 57).labor, 100); assert.equal(otherIncomeReal(p, 90).labor, 100);
  assert.equal(otherIncomeReal(p, 57).fin, 50);
});

test('npsMembershipFactor: 60세 전 은퇴 + 중단 → 가입기간 비례 감소, 계속·60세 이후 은퇴는 보정 없음', () => {
  const p = Object.assign({}, BASE, {npyears: 20});          // 51세·가입 20년, 57세 은퇴
  assert.equal(npsMembershipFactor(p), 1);                   // 기본 = 계속 납부
  near(npsMembershipFactor(Object.assign({}, p, {npcont: 'stop'})), (20 + 6) / (20 + 9), 1e-12, '26/29');
  assert.equal(npsMembershipFactor(Object.assign({}, p, {npcont: 'stop', ret: 60})), 1);
  assert.equal(npsMembershipFactor(Object.assign({}, p, {npcont: 'stop', npyears: 0})), 1);
});

test('국민연금 임의가입 보험료: 60세 전 은퇴 + 계속 납부일 때만, 만 60세 전까지 세후에서 차감', () => {
  const p = withPlan(Object.assign({}, BASE, {np_volprem: 10}));
  const r = simulate(p);
  assert.ok(r.rows.filter(x => x.age < 60).every(x => x.npPrem > 0), '57~59세 보험료');
  assert.ok(r.rows.filter(x => x.age >= 60).every(x => x.npPrem === 0), '60세부터 없음');
  const stop = simulate(Object.assign({}, p, {npcont: 'stop'}));
  assert.ok(stop.rows.every(x => x.npPrem === 0), '중단이면 보험료 없음');
});

test('임의계속가입: 36개월만 min(지역가입자, 임의계속) — 더 싸면 적용, 비싸면 지역가입자 그대로', () => {
  const p = Object.assign({}, BASE, {realestate: 40000, hi_vol: 'yes', hi_volprem: 10});
  const off = healthPremiumYear(Object.assign({}, p, {hi_vol: 'no'}), 57, 0, 1, 0);
  assert.ok(off.annual > 10 * 12, '지역가입자 보험료 > 월 10만');
  const on = healthPremiumYear(p, 57, 0, 1, 0);
  assert.ok(on.volContinued && on.annual < off.annual && Math.abs(on.annual - 120) < 1e-9, '월 10만 × 12');
  assert.equal(healthPremiumYear(p, 59, 0, 1, 0).volContinued, true);   // 57·58·59세 = 36개월
  assert.equal(healthPremiumYear(p, 60, 0, 1, 0).volContinued, false);
  const cheap = healthPremiumYear(Object.assign({}, p, {hi_volprem: 500}), 57, 0, 1, 0);
  assert.equal(cheap.volContinued, false); assert.equal(cheap.annual, off.annual);
});

/* ── 2026-10-09 Opus 검토 반영: 근로세액공제 한도, 비교과세 순서, 임의계속 단위, 판정 기간, 가입기간 10년 ── */
test('근로세액공제 한도: 7,000만 초과 1/2씩 감소(최소 50만), 1.2억 초과 1/2씩(최소 20만)', () => {
  near(wageTaxCredit(1000, 7010), 61, 1e-9, '7,010만');
  near(wageTaxCredit(1000, 8000), 50, 1e-9, '8,000만(최소 50)');
  near(wageTaxCredit(1000, 9000), 50, 1e-9);
  near(wageTaxCredit(1000, 13000), 20, 1e-9, '1.3억(최소 20)');
  near(wageTaxCredit(1000, 15000), 20, 1e-9);
  near(wageTaxCredit(1000, 4000), 74 - 700 * 0.008, 1e-9, '3,300~7,000만 구간');
});

test('금융소득 비교과세: 산출세액끼리 비교한 뒤 세액공제(표준세액공제 7만) — 정확한 값', () => {
  // 3,000만: 분리 14%×2000 + 기본세율(1000−기본공제150 = 850 → 51) = 331 vs 14%×3000 = 420 → 420 − 7 = 413, ×1.1
  near(comprehensiveTotal(0, {fin: 3000}, 65), 413 * 1.1, 1e-6, '3,000만');
  // 2,500만: 280 + 기본세율(500−150=350 → 21) = 301 vs 350 → 350 − 7 = 343, ×1.1
  near(comprehensiveTotal(0, {fin: 2500}, 65), 343 * 1.1, 1e-6, '2,500만');
  near(comprehensiveTotal(0, {fin: 1500}, 65), 1500 * 0.154, 1e-9, '2,000만 이하는 15.4% 분리, 공제 없음');
});

test('판정·상세 헬퍼는 소득 기간(from/to)을 따른다: 62세 이후 근로소득이 끝나면 합산에서 빠진다', () => {
  const p = Object.assign({}, BASE, {hi_labor: 3000, hi_labor_from: 57, hi_labor_to: 61, np: 100, npage: 65});
  const at = (a) => c.dependentTotalIncome(p, 100 * Math.pow(1.025, 14), a);
  assert.ok(at(60) > at(62) + 3000, '근로소득 기간 안/밖');
  assert.equal(c.healthIncomeItems(p).laborAnnual, 0, '기본 판정 시점 = 국민연금 개시 65세 → 기간 밖');
});

test('임의계속가입: 단위가 실질값끼리 비교된다(물가가 있어도 simulate와 같은 선택)', () => {
  const p = withPlan(Object.assign({}, BASE, {realestate: 50000, hi_business: 500, hi_vol: 'yes', hi_volprem: 17}));
  const r = simulate(p);
  const x = r.rows[0], infMul = Math.pow(1.025, 6);
  const direct = healthPremiumYear(p, p.ret, 0, infMul, p.inf);
  assert.equal(Math.round(direct.annual / 12), x.hi, '표시용 호출과 simulate가 같은 값');
  assert.ok(direct.volContinued ? Math.abs(direct.monthlyReal - 17) < 1e-6 : direct.monthlyReal < 17);
});

test('npsMembershipFactor: 가입기간 10년 미만이면 노령연금 0', () => {
  assert.equal(npsMembershipFactor(Object.assign({}, BASE, {npyears: 3, ret: 55, npcont: 'stop'})), 0);
  assert.ok(npsMembershipFactor(Object.assign({}, BASE, {npyears: 8, ret: 57, npcont: 'stop'})) > 0);   // 8+6=14년
});


/* ── 2026-10-09 단계 ③: 주택연금·생활비 단계·일시 지출·남길 금액 ── */
test('주택연금 월지급금: 한국주택금융공사 2026.3 예시표(70세 3억 = 92.3만), 나이 보간·가격 비례·12억 한도', () => {
  near(housingPensionMonthly(70, 30000), 92.3, 0.05, '70세 3억');
  near(housingPensionMonthly(60, 10000), 21.1, 0.06, '60세 1억');
  near(housingPensionMonthly(80, 50000), 241.6, 0.06, '80세 5억');
  near(housingPensionMonthly(62, 10000), 21.06 + (25.28 - 21.06) * 2 / 5, 0.06, '62세 보간');
  assert.equal(housingPensionMonthly(54, 30000), 0, '55세 미만 가입 불가');
  assert.equal(housingPensionMonthly(90, 30000), housingPensionMonthly(80, 30000), '80세 초과는 80세 값');
  assert.equal(housingPensionMonthly(70, 200000), housingPensionMonthly(70, 120000), '12억 한도');
  assert.equal(housingPensionOf({hp_age: 70, gongsiga: 20700}), housingPensionMonthly(70, 30000), '시세 없으면 공시가격÷0.69');
  assert.equal(housingPensionOf({hp_age: 0, gongsiga: 20700}), 0);
});

test('주택연금: 가입 나이부터 명목 고정 월 수입, 세금·건보료는 그대로(비과세·소득 아님)', () => {
  const base = withPlan(BASE);
  const p = Object.assign({}, base, {hp_age: 70, hp_price: 30000});
  const a = simulate(base), b = simulate(p);
  const x = b.rows.find(r => r.age === 75), x0 = a.rows.find(r => r.age === 75);
  assert.equal(b.rows.find(r => r.age === 69).hpInc, 0);
  assert.equal(b.rows.find(r => r.age === 70).hpInc, Math.round(housingPensionMonthly(70, 30000)));
  assert.equal(b.rows.find(r => r.age === 80).hpInc, b.rows.find(r => r.age === 70).hpInc, '명목 고정');
  assert.equal(x.totalInc - x0.totalInc, x.hpInc, '합계 = 기존 + 주택연금');
  assert.equal(x.taxTotal, x0.taxTotal); assert.equal(x.hi, x0.hi);
});

test('생활비 단계: 그 나이부터 비율이 적용되고, 단계를 안 쓰면 minNetEq = minNetReal', () => {
  const p = withPlan(Object.assign({}, BASE, {exp_s1_age: 75, exp_s1_pct: 80, exp_s2_age: 85, exp_s2_pct: 70}));
  const r = simulate(p);
  const e = a => r.rows.find(x => x.age === a).curExp;
  near(e(75) / e(74), 1.025 * 0.8, 0.01, '75세 80%');
  near(e(85) / e(84), 1.025 * 70 / 80, 0.01, '85세 70%(기본 대비)');
  assert.equal(expPct(p, 74), 1); assert.equal(expPct(p, 75), 0.8); assert.equal(expPct(p, 90), 0.7);
  const plain = simulate(withPlan(BASE));
  near(plain.minNetEq, plain.minNetReal, 1e-9); near(plain.maxNetEq, plain.maxNetReal, 1e-9);
  assert.ok(r.minNetEq >= r.minNetReal, '단계로 생활비가 줄면 보정 값이 더 크다');
  assert.equal(r.runway, p.life);
});

test('일시 지출: 그 해 생활비에 월 환산으로 더해지고 농협에서 추가 인출, 자동설계는 미리 떼어 기대수명까지 유지', () => {
  const p = withPlan(Object.assign({}, BASE, {lump1_age: 70, lump1_amt: 3000}));
  const r = simulate(p), plain = simulate(withPlan(BASE));
  const x70 = r.rows.find(x => x.age === 70), x69 = r.rows.find(x => x.age === 69);
  const nominal = 3000 * Math.pow(1.025, 70 - 51);
  assert.equal(x70.lumpM, Math.round(nominal / 12));
  assert.ok(x70.curExp > x69.curExp * 1.4, '일시 지출 해 생활비');
  const extraNh = r.rows.find(x => x.age === 70).gross.nh - plain.rows.find(x => x.age === 70).gross.nh;
  assert.ok(extraNh >= nominal - 1 && extraNh <= nominal * 1.4, '그 해 농협 인출은 일시 지출 + 세금 보충분');
  assert.equal(r.runway, p.life);
  assert.equal(lumpsAt(p, 70, 2), 6000); assert.equal(lumpsAt(p, 69, 2), 0);
});

test('남길 금액: 자동설계가 기대수명 시점에 그만큼(명목 환산)을 남긴다', () => {
  const p = withPlan(Object.assign({}, BASE, {bequest: 5000}));
  const r = simulate(p);
  const target = 5000 * Math.pow(1.025, 90 - 51);
  near(r.leftover, target, target * 0.1, '남는 돈');
  assert.equal(r.runway, p.life);
  assert.ok(simulate(withPlan(BASE)).leftover < r.leftover / 10, '입력 전엔 거의 남기지 않음');
});


/* ── 2026-10-09 Opus 검토 반영(단계 ③): 일시 지출 세금 보충·미달 판정·spill·단계 순서·주택연금 요건 ── */
test('일시 지출: 그 해 세후가 (일시 지출 + 기본 생활비 수준)을 채운다(세금 보충) — 90세 마지막 해 포함', () => {
  for(const age of [62, 75, 90]){
    const p = withPlan(Object.assign({}, BASE, {exp: 250, lump1_age: age, lump1_amt: 3000}));
    const r = simulate(p), x = r.rows.find(v => v.age === age), y = r.rows.find(v => v.age === age - 1) || x;
    assert.ok(x.netInc >= x.curExp - 2, `${age}세 세후 ${x.netInc} < 생활비 ${x.curExp}`);
  }
});

test('minNetEq: 일시 지출 해의 생활비 미달이 최저 세후에 잡힌다(일시 지출이 최저치를 가리지 않음)', () => {
  const p = withPlan(Object.assign({}, BASE, {exp: 250, lump1_age: 57, lump1_amt: 3000}));
  const r = simulate(p);
  const x = r.rows.find(v => v.age === 57);
  near(x.realEq, Math.max(0, x.netInc - x.lumpM) / x.infMul, 0.6 / x.infMul, 'lumpM은 표시용 반올림');
  assert.ok(r.minNetEq <= x.realEq + 1e-9);
  // 일시 지출만 있고 인출 계획은 같은 입력으로 비교: 일시 지출을 빼면 realEq = realNet
  const plain = simulate(withPlan(BASE));
  assert.equal(plain.minNetEq, plain.minNetReal);
});

test('일시 지출·남길 금액이 농협 잔액보다 크면 미래에셋·ISA에서 채우고, 그래도 모자란 몫은 reserveUnmet에 기록한다', () => {
  const big = withPlan(Object.assign({}, BASE, {exp: 250, lump1_age: 70, lump1_amt: 30000}));
  const r = simulate(big);
  const x70 = r.rows.find(v => v.age === 70);
  assert.ok(x70.gross.mf > 0 || x70.gross.isa > 0 || x70.gross.nh > 0);
  const un = computeAutoPlan(Object.assign({}, BASE, {bequest: 600000})).info.reserveUnmet;
  assert.ok(un > 0, '60억원 남기기는 못 채움');
  assert.equal(computeAutoPlan(Object.assign({}, BASE, {bequest: 5000})).info.reserveUnmet, 0);
});

test('생활비 단계 순서: 입력 순서와 무관하게 그 나이 이하 중 가장 늦은 단계', () => {
  const q = {exp_s1_age: 85, exp_s1_pct: 70, exp_s2_age: 75, exp_s2_pct: 80};
  assert.equal(expPct(q, 74), 1); assert.equal(expPct(q, 75), 0.8); assert.equal(expPct(q, 84), 0.8); assert.equal(expPct(q, 90), 0.7);
});

test('주택연금: 공시가격 12억 초과는 가입 불가', () => {
  assert.equal(housingPensionOf({hp_age: 70, gongsiga: 150000}), 0);
  assert.ok(housingPensionOf({hp_age: 70, gongsiga: 120000}) > 0);
});


/* ── 2026-10-09 단계 ④: 일반계좌(해외주식·국내상장 해외ETF·국내/현금) ── */
test('genInit: 평가액과 현재 수익률로 원가를 만든다(국내·현금은 원가 = 평가액)', () => {
  const g = genInit({gen_ov: 1400, gen_ovr: 40, gen_etf: 1200, gen_etfr: 20, gen_kr: 500});
  near(g.ov.cost, 1000, 1e-9); near(g.etf.cost, 1000, 1e-9);
  assert.deepEqual(g.kr, {bal: 500, cost: 500});
  assert.equal(genSum(g), 3100);
  assert.equal(genSum(genInit({})), 0);
});

test('genYear: 해외주식은 그해 이익 250만 공제 후 22%, 인출은 공제 이내 → 국내·현금 → 해외ETF → 해외주식(과세) 순, 합계 보존', () => {
  const g0 = {ov: {bal: 10000, cost: 6000}, etf: {bal: 0, cost: 0}, kr: {bal: 0, cost: 0}};   // 이익률 40%
  const y = genYear(g0, 1000, 9000, 0, false);                                                  // 수익률 0, 1,000만 인출
  near(y.ovGain, 400, 1e-9); near(y.ovTax, (400 - 250) * 0.22, 1e-9, '(400−250)×22%');
  near(genSum(y.next), 9000, 1e-9, '합계 보존');
  near(y.next.ov.cost, 6000 * 0.9, 1e-9, '원가도 같은 비율로 줄어듦');
  // 국내·현금이 있으면 공제 이내 해외주식 다음에 먼저 쓴다 → 세금 줄어듦
  const g1 = {ov: {bal: 10000, cost: 6000}, etf: {bal: 0, cost: 0}, kr: {bal: 2000, cost: 2000}};
  const y1 = genYear(g1, 1000, 11000, 0, false);
  near(y1.ovGain, 250, 1e-9, '해외주식은 공제 이내(250만)만 실현'); assert.equal(y1.ovTax, 0);
  near(y1.take.kr, 1000 - 625, 1e-9, '나머지 375는 국내·현금');
  // ETF: 이익이 금융소득으로 넘어간다
  const g2 = {ov: {bal: 0, cost: 0}, etf: {bal: 5000, cost: 4000}, kr: {bal: 0, cost: 0}};
  const y2 = genYear(g2, 1000, 4000, 0, false);
  near(y2.etfGain, 200, 1e-9); assert.equal(y2.ovTax, 0);
});

test('genYear: 250만 공제 활용(harvest)은 남은 공제만큼 해마다 이익을 실현해 원가를 올린다(세금 0)', () => {
  const g0 = {ov: {bal: 10000, cost: 6000}, etf: {bal: 0, cost: 0}, kr: {bal: 0, cost: 0}};
  const y = genYear(g0, 0, 10000, 0, true);
  near(y.next.ov.cost, 6250, 1e-9); assert.equal(y.ovTax, 0);
  const grown = genGrow(g0, 0, 4, true);
  near(grown.ov.cost, 7000, 1e-9, '4년 × 250만'); near(grown.ov.bal, 10000, 1e-9);
  assert.equal(genGrow(g0, 0, 4, false).ov.cost, 6000);
});

test('일반계좌 simulate: 자동설계가 인출 구간을 정하고, 합계·세금·보존이 맞고, 입력이 없으면 기존 결과와 같다', () => {
  const p = Object.assign({}, BASE, {gen_ov: 4000, gen_ovr: 35, gen_etf: 1000, gen_etfr: 20, gen_kr: 500});
  const pl = computeAutoPlan(p);
  assert.ok(pl.genage === p.ret && pl.genpay > 0 && pl.info.genEnd >= p.ret);
  const q = Object.assign({}, p, pl), r = simulate(q);
  assert.ok(r.rows.some(x => x.genInc > 0));
  for(const x of r.rows) assert.equal(x.totalInc, x.nhInc + x.mfInc + x.irpInc + x.prinInc + x.npInc + x.tirpInc + x.isaInc + x.othInc + x.hpInc + x.genInc, `${x.age}세 합계`);
  assert.ok(r.lifetimeGenTax > 0 && r.runway === p.life);
  const none = simulate(withPlan(BASE));
  assert.equal(none.rows.every(x => x.genInc === 0) && none.lifetimeGenTax === 0, true);
  assert.equal(computeAutoPlan(BASE).genpay, 0);
});

test('해외ETF 매매차익은 금융소득에 합산된다: 이익이 있는 해 세금이 늘고 건보료 금융소득 판정에 들어간다', () => {
  const base = Object.assign({}, BASE, {gen_etf: 20000, gen_etfr: 100});   // 평가 2억, 원가 1억
  const q = Object.assign({}, withPlan(base), {genage: 57, genpay: 100});
  const r = simulate(q), x = r.rows[0];
  assert.ok(x.genInc > 0 && x.taxOth > 0, '금융소득 세금이 oth로 잡힘');
  const noEtf = simulate(Object.assign({}, q, {gen_etf: 0, gen_kr: 20000}));    // 같은 인출이지만 비과세 칸
  assert.ok(x.taxTotal > noEtf.rows[0].taxTotal, 'ETF 이익은 과세, 국내·현금은 비과세');
});

test('retShock·path 옵션은 일반계좌에도 적용되고, path가 0이면 변화 없다', () => {
  const p = Object.assign({}, withPlan(BASE), {gen_ov: 4000, gen_ovr: 35, genage: 57, genpay: 20});
  const a = simulate(p), b = simulate(p, undefined, {path: new Array(40).fill(0)});
  assert.deepEqual(a.rows.map(x => x.netInc), b.rows.map(x => x.netInc));
  const down = simulate(p, undefined, {path: new Array(40).fill(-8)});
  assert.ok(down.rows.reduce((s, x) => s + x.netInc, 0) < a.rows.reduce((s, x) => s + x.netInc, 0) || down.runway < a.runway);
  assert.ok(simulate(p, undefined, {retShock: 0.5}).leftover < a.leftover);
});


/* ── 2026-10-09 Opus 검토 반영(단계 ④) ── */
test('genYear: 한 칸을 다 꺼내는 해·수익률 양수/음수에서도 합계는 balNext와 정확히 같다(돈이 생기거나 사라지지 않음)', () => {
  for(const [rate, paid] of [[6, 4000], [10, 5000], [5, 1800], [-20, 3000], [-35, 2000], [0, 1000]]){
    const g0 = {ov: {bal: 10000, cost: 6000}, etf: {bal: 3000, cost: 2500}, kr: {bal: 2000, cost: 2000}};
    const B = genSum(g0), f = Math.pow(1 + rate/1200, 12);
    const balNext = Math.max(0, B * f - paid * (1 + (f - 1) / 2));            // 임의의 합계 진행(월중 인출 근사)
    const y = genYear(g0, paid, balNext, rate, false);
    near(genSum(y.next), balNext, 1e-6, `r=${rate}% 합계`);
    for(const k of ['ov','etf','kr']){ assert.ok(y.next[k].bal >= 0 && Number.isFinite(y.next[k].cost) && y.next[k].cost >= 0, `${k} 음수·NaN`); }
  }
  // 칸을 모두 비우는 해
  const all = genYear({ov: {bal: 1000, cost: 500}, etf: {bal: 0, cost: 0}, kr: {bal: 0, cost: 0}}, 2000, 0, 5, false);
  assert.equal(genSum(all.next), 0);
});

test('genInit: 수익률을 안 넣거나 NaN이면 원가 = 평가액(이익 0), 손실 종목은 원가 > 평가액이라도 세금 음수 없음', () => {
  assert.equal(genInit({gen_ov: 1000}).ov.cost, 1000);
  assert.equal(genInit({gen_ov: 1000, gen_ovr: NaN}).ov.cost, 1000);
  near(genInit({gen_ov: 800, gen_ovr: -20}).ov.cost, 1000, 1e-9);
  const y = genYear(genInit({gen_ov: 800, gen_ovr: -20}), 500, 300, 0, false);
  assert.equal(y.ovTax, 0); assert.equal(y.ovGain, 0);
});

test('일반계좌 잔여자산: 인출 계획이 없어도 기대수명 시점 일반계좌 잔액이 leftover에 들어간다', () => {
  const p = withPlan(Object.assign({}, BASE, {gen_kr: 10000}));
  const q = Object.assign({}, p, {genage: 0, genpay: 0});
  const r = simulate(q), last = r.rows[r.rows.length - 1];
  assert.ok(last.bal.gen > 40000);
  assert.equal(r.leftover, last.bal.nh + last.bal.mf + last.bal.irp + last.bal.tirp + last.bal.isa + last.bal.gen);
  assert.ok(simulate(q, undefined, {retShock: 0.5}).leftover < r.leftover, '폭락하면 잔여가 줄어든다(일반계좌 포함)');
});

test('남길 금액·일시 지출을 일반계좌에서 떼어 두면 끝 나이 뒤에 인출돼 사라지지 않는다(남길 금액이 실제로 남음, 일시 지출 해 미달 없음)', () => {
  const b = withPlan(Object.assign({}, BASE, {gen_kr: 5000, bequest: 5000}));
  const r = simulate(b), target = 5000 * Math.pow(1.025, 90 - 51);
  assert.ok(r.leftover >= target * 0.85, `남은 돈 ${Math.round(r.leftover)} < 목표 ${Math.round(target)}의 85%`);
  const big = withPlan(Object.assign({}, BASE, {exp: 250, gen_ov: 20000, gen_ovr: 50, gen_etf: 5000, gen_etfr: 30, gen_kr: 5000, rgen: 6, bequest: 20000}));
  const rb = simulate(big), t2 = 20000 * Math.pow(1.025, 90 - 51);
  assert.ok(rb.leftover >= t2 * 0.8, `2억 남기기: ${Math.round(rb.leftover)} vs ${Math.round(t2)}`);
  const lump = withPlan(Object.assign({}, BASE, {exp: 250, gen_ov: 20000, gen_ovr: 50, gen_etf: 5000, gen_etfr: 30, gen_kr: 5000, rgen: 6, lump1_age: 80, lump1_amt: 5000}));
  const x = simulate(lump).rows.find(v => v.age === 80);
  assert.ok(x.netInc >= x.curExp - 2, `80세 일시 지출 해 세후 ${x.netInc} < ${x.curExp}`);
  // 미래에셋도 같은 구조: 농협이 작아 남길 금액이 미래에셋까지 넘어가는 경우
  const mf = withPlan(Object.assign({}, BASE, {nh: 1000, nhm: 0, bequest: 10000}));
  assert.ok(simulate(mf).leftover >= 10000 * Math.pow(1.025, 39) * 0.7 || computeAutoPlan(Object.assign({}, BASE, {nh: 1000, nhm: 0, bequest: 10000})).info.reserveUnmet > 0);
});
