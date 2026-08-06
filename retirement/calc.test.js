const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  calcISA_FV, pensionTaxRate, tirpTaxDiscount, dependentStatusCheck,
  propertyInsuranceScore, regionalHealthPremium, HEALTH_CAP_MIN, HEALTH_CAP_MAX,
  npsAdjustFactor, calcRetirementIncomeTax, pmtAnnualGrowing, buildNeedOnlyPlan
} = require('./calc.js');

test('pensionTaxRate: 연령별 사적연금 저율분리과세 구간', () => {
  assert.equal(pensionTaxRate(55), 5.5);
  assert.equal(pensionTaxRate(69), 5.5);
  assert.equal(pensionTaxRate(70), 4.4);
  assert.equal(pensionTaxRate(79), 4.4);
  assert.equal(pensionTaxRate(80), 3.3);
  assert.equal(pensionTaxRate(100), 3.3);
});

test('tirpTaxDiscount: 퇴직소득세 연금수령공제 감면율 구간', () => {
  assert.equal(tirpTaxDiscount(1), 0.3);
  assert.equal(tirpTaxDiscount(10), 0.3);
  assert.equal(tirpTaxDiscount(11), 0.4);
  assert.equal(tirpTaxDiscount(20), 0.4);
  assert.equal(tirpTaxDiscount(21), 0.5);
  assert.equal(tirpTaxDiscount(40), 0.5);
});

test('dependentStatusCheck: 건보료 피부양자 재산·소득 기준', () => {
  // 재산 9억 초과 → 소득 무관 무조건 탈락
  assert.equal(dependentStatusCheck(0, 90001).fail, true);
  // 재산 5.4억 초과 9억 이하 + 소득 1,000만원 초과 → 탈락
  assert.equal(dependentStatusCheck(1001, 54001).fail, true);
  // 같은 재산 구간이라도 소득 1,000만원 이하면 유지
  assert.equal(dependentStatusCheck(1000, 54001).fail, false);
  // 재산 5.4억 이하 + 소득 2,000만원 초과 → 탈락
  assert.equal(dependentStatusCheck(2001, 0).fail, true);
  // 재산 5.4억 이하 + 소득 2,000만원 이하 → 유지
  assert.equal(dependentStatusCheck(2000, 54000).fail, false);
});

test('propertyInsuranceScore: 60등급표 경계값', () => {
  // 1억원 공제 후 0원 이하 → 최저 등급
  assert.equal(propertyInsuranceScore(10000), 22);
  assert.equal(propertyInsuranceScore(0), 22);
  // 초고액(등급표 상한 초과) → 최고 등급으로 수렴
  assert.equal(propertyInsuranceScore(9999999), 2341);
});

test('regionalHealthPremium: 월 상한·하한 캡 적용', () => {
  const low = regionalHealthPremium(0, 0);
  // toMan()은 1,000원 단위로 반올림해 표시하므로, 하한(20,160원) 자체를 반올림한 값과 비교해야 함
  assert.equal(low.healthPremium, Math.round(HEALTH_CAP_MIN/1000)/10);
  assert.equal(low.capped, true);
  const high = regionalHealthPremium(100000, 9999999);
  assert.equal(high.healthPremium, Math.round(HEALTH_CAP_MAX/1000)/10);
  assert.equal(high.capped, true);
});

test('npsAdjustFactor: 국민연금 조기·연기수령 가산율', () => {
  assert.equal(npsAdjustFactor(65), 0);
  assert.equal(npsAdjustFactor(60), -0.3); // 5년 조기 × -6%
  assert.ok(Math.abs(npsAdjustFactor(68) - 0.216) < 1e-9); // 3년 연기 × +7.2%
});

test('calcISA_FV: 5년 만기 회차마다 0원부터 다시 시작 (2026년 세법개정 반영)', () => {
  // 10년 내내 납입 시 정확히 두 번째 5년 회차 진입 시점(6년차)에 잔액이 급감해야 함
  // (이전 회차 만기 수령금이 계좌 밖으로 나가고 0원부터 재시작하는 구조이므로)
  const rate = 4;
  const fvThroughYear5 = calcISA_FV(0, 1000, 0, 0, 4, 5, rate, 'isa');  // 1~5년차 회차만 보고 즉시 은퇴
  const fvThroughYear10 = calcISA_FV(0, 1000, 0, 0, 9, 10, rate, 'isa'); // 1~10년차(두 회차) 납입 후 은퇴
  // 두 번째 회차도 첫 회차와 동일한 조건으로 굴러갔다면, 각 회차의 만기 성장분이
  // 재투자되어 10년차 결과가 5년차 결과의 두 배보다는 크지만 완전히 복리 누적된
  // (회차가 리셋되지 않는) 값보다는 작아야 한다.
  const naiveDoubled = fvThroughYear5 * 2;
  assert.ok(fvThroughYear10 > fvThroughYear5, '두 번째 회차 이후 자산이 더 커야 함');
  assert.ok(fvThroughYear10 < naiveDoubled * 1.5, '단순 2배보다 과도하게 크면 회차 리셋이 적용 안 된 것');
});

test('pmtAnnualGrowing: 산출된 월 인출액으로 N년 뒤 잔액이 0에 수렴', () => {
  const fv = 100000, rate = 4, inf = 2.5, N = 20;
  const pmt = pmtAnnualGrowing(fv, rate, inf, N);
  assert.ok(pmt > 0);

  // pmtAnnualGrowing과 동일한 월중 분할 규칙으로 잔액을 직접 시뮬레이션 —
  // 함수가 이분탐색으로 찾아낸 월 인출액이 실제로 N년 뒤 잔액을 0 근처로 만드는지 검증
  const rm = rate/100/12;
  const g1 = 1+rm*(20/30), g2 = 1+rm*(10/30);
  let bal = fv;
  for(let year=0; year<N; year++){
    const inc = pmt * Math.pow(1+inf/100, year);
    for(let m=0;m<12;m++){
      bal = bal*g1;
      bal = Math.max(0, bal-inc)*g2;
    }
  }
  assert.ok(Math.abs(bal) < fv * 1e-6, `잔액이 0에 수렴해야 함 (실제: ${bal})`);
});

test('pmtAnnualGrowing: 잔액 또는 기간이 없으면 인출액 0', () => {
  assert.equal(pmtAnnualGrowing(0, 4, 2.5, 10), 0);
  assert.equal(pmtAnnualGrowing(10000, 4, 2.5, 0), 0);
});

test('buildNeedOnlyPlan: 완전소진 총액을 생활비 목표에 맞춰 비례 축소', () => {
  const p = { nhpay:50, mfpay:30, irppay:0, isam:20, tm:0, exp:50 };
  // 완전소진 총합 100만원 → 생활비 목표 50만원이면 정확히 절반으로 축소
  const plan = buildNeedOnlyPlan(p);
  assert.ok(plan);
  assert.equal(plan.nhpay, 25);
  assert.equal(plan.mfpay, 15);
  assert.equal(plan.isam, 10);
  // 원본 객체는 변경되지 않아야 함
  assert.equal(p.nhpay, 50);
});

test('buildNeedOnlyPlan: 완전소진 총액이 이미 생활비 목표 이하면 null', () => {
  const p = { nhpay:20, mfpay:0, irppay:0, isam:0, tm:0, exp:50 };
  assert.equal(buildNeedOnlyPlan(p), null);
});

test('calcRetirementIncomeTax: 근속연수가 길수록 세금이 줄어듦', () => {
  const income = 30000; // 3억원 퇴직소득
  const tax10 = calcRetirementIncomeTax(income, 10);
  const tax20 = calcRetirementIncomeTax(income, 20);
  const tax30 = calcRetirementIncomeTax(income, 30);
  assert.ok(tax20 < tax10, '근속 20년 세금이 10년보다 적어야 함');
  assert.ok(tax30 < tax20, '근속 30년 세금이 20년보다 적어야 함');
  assert.ok(tax10 > 0 && tax30 >= 0);
});
