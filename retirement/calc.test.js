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
  pensionLimitAnnual, bridgeExtraMonthly, healthPremiumYear, regionalIncomeMonthly
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
    assert.equal(x.totalInc, x.nhInc + x.mfInc + x.irpInc + x.prinInc + x.npInc + x.tirpInc + x.isaInc, `${x.age}세 합계`);
    assert.equal(x.netInc, Math.max(0, x.totalInc - x.taxTotal - x.hi), `${x.age}세 세후`);
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
      realestate: ri(0, 120000), hi_interest: ri(0, 1500), hi_labor: ri(0, 3000), hi_dep: rnd() < 0.3 ? 'yes' : 'no'});
    for(const k of ['nhend','mfend','irpend','isaend','tdcend']) p[k] = ret - 1;
    const q = Object.assign({}, p, computeAutoPlan(p));
    const r = simulate(q), T = taxFreeBases(q);
    for(const x of r.rows){
      const v = [x.totalInc, x.netInc, x.taxTotal, ...Object.values(x.bal)];
      assert.ok(v.every(Number.isFinite), `#${i} ${x.age}세 NaN`);
      assert.ok(Object.values(x.bal).every(b => b >= -1e-6), `#${i} 음수 잔액`);
      assert.equal(x.totalInc, x.nhInc + x.mfInc + x.irpInc + x.prinInc + x.npInc + x.tirpInc + x.isaInc, `#${i} 합계`);
      assert.equal(x.netInc, Math.max(0, x.totalInc - x.taxTotal - x.hi), `#${i} 세후 = 합계 − 세금 − 건보료`);
      assert.ok(x.hi >= 0 && x.netInc <= x.totalInc && x.nhInc >= 0 && x.mfInc >= 0 && x.irpInc >= 0, `#${i} 세후/음수`);
    }
    assert.ok(sum(r.rows, x => x.freeAnnual.nh + x.freeAnnual.mf + x.freeAnnual.irp) <= T.nh + T.mf + T.irp + 1e-6, `#${i} 비과세`);
    assert.ok(sum(r.rows, x => x.tirpDeferredAnnual) <= r.tirpFV + 1e-6, `#${i} 이연`);
    if(life > ret && r.totalFV > 1000) assert.equal(r.runway, life, `#${i} 자동설계 기대수명 유지`);
  }
});
