/* ── 순수 계산 함수 모음 (DOM/전역 상태 비의존) ──
   calc.test.js에서 Node 내장 테스트러너(node:test)로 직접 테스트됨.
   브라우저에서는 index.html이 <script src="calc.js">로 그대로 불러와 사용.
*/

/* ── 연초 일시납 FV 계산 ──
   IRP: 연속 운용 (이월 O) - 납입기간 내 매년 지정한 달 21일 납입, 이후 운용
   ISA: 은퇴할 때까지 해지·재개설 없이 계속 유지(만기 연장 가정) - 연속 복리로
        굴리다가, 은퇴 시점에 전체 보유기간 누적 수익 기준으로 비과세 한도를
        1회 적용해 세후 금액을 산출한다.
        (예전에는 "5년 만기마다 계좌를 해지하고 0원부터 재개설"하는 2026년
         세법개정 초안 가정을 반영했었지만, 이후 ISA 만기 연장이 가능하도록
         재개정될 것으로 보여 계속 유지하는 쪽으로 설계를 되돌림)
   isaType: 'isa' | 'irp'(기본)
   payMonth: 연납입을 실제로 하는 달(1~12, 기본 1월) — 매년 그 달 21일에 한 번에
     납입한다고 가정하고, 그 시점부터 그 해가 끝날 때까지 남은 기간(개월+10/30)만큼만
     복리 성장분을 붙인다. 1월이면 (12-1)+10/30 = 기존과 동일한 11+10/30.
*/
function calcISA_FV(curBal, isay, curAge, startAge, endAge, retAge, annualR, isaType, payMonth){
  const pm       = payMonth>=1 && payMonth<=12 ? payMonth : 1;
  const rm       = annualR/100/12;
  const growFull = Math.pow(1+rm, 12);
  const growDep  = Math.pow(1+rm, (12-pm)+10/30); // 매년 지정한 달 21일 납입 기준

  // ── IRP: 연속 복리 (기존 방식) ──
  if(isaType !== 'isa'){
    let bal = curBal;
    for(let age=curAge; age<retAge; age++){
      const paying = age>=startAge && age<=endAge;
      bal = paying ? bal*growFull + isay*growDep : bal*growFull;
    }
    return Math.max(0, Math.round(bal));
  }

  // ── ISA: 연속 복리(해지·재개설 없음), 은퇴 시점에 비과세 한도 1회 적용 ──
  const ISA_EXEMPT = 200; // 비과세 한도(만원) — 계약기간 중 1회 적용

  let bal = curBal;
  let principal = curBal;
  for(let age=curAge; age<retAge; age++){
    const paying = age>=startAge && age<=endAge;
    bal = paying ? bal*growFull + isay*growDep : bal*growFull;
    if(paying) principal += isay;
  }

  const gain     = Math.max(0, bal - principal);
  const taxable  = Math.max(0, gain - ISA_EXEMPT);
  const afterTax = bal - taxable * 0.099;

  return Math.max(0, Math.round(afterTax));
}

/* ── 사적연금 저율분리과세 세율 (연령별 차등, 소득세법 연금소득 원천징수세율) ── */
function pensionTaxRate(age){
  if(age >= 80) return 3.3;
  if(age >= 70) return 4.4;
  return 5.5;
}

/* ── 퇴직소득세 연금수령공제 감면율 (실제 수령연차 기준) ── */
function tirpTaxDiscount(withdrawalYear){
  if(withdrawalYear >= 21) return 0.5;
  if(withdrawalYear >= 11) return 0.4;
  return 0.3;
}

/* ── 건강보험 피부양자 자격 판정(소득+재산 기준) ──
   - 재산 과세표준 9억원 초과: 소득 무관 무조건 탈락
   - 재산 과세표준 5.4억 초과 9억 이하: 연소득 1,000만원 초과 시 탈락
   - 그 외(5.4억 이하): 연소득 2,000만원 초과 시 탈락
   ※ 피부양자 판정용 "연소득"은 반영률 감면 없이 전액 합산(국민건강보험법상 판정 기준) —
     아래 지역가입자 보험료 산정(regionalIncomeMonthly)과는 반영률 방식이 다르므로 혼동 주의 */
function dependentStatusCheck(totalAnnualIncome, realEstateBase){
  const re = realEstateBase || 0;
  if(re > 90000) return {fail:true, reason:'재산 과세표준 9억원 초과 → 소득과 무관하게 자동 탈락'};
  if(re > 54000 && totalAnnualIncome > 1000) return {fail:true, reason:'재산 과세표준 5.4억원 초과 + 소득 연 1,000만원 초과'};
  if(re <= 54000 && totalAnnualIncome > 2000) return {fail:true, reason:'소득 연 2,000만원 초과'};
  return {fail:false, reason:''};
}

/* ── 건보료 산정용 소득 항목 취합 ── (건보료 설계 패널 전용 입력 hi_* 필드 사용)
   피부양자 판정(전액 100% 합산)과 지역가입자 보험료 산정(항목별 반영률)이 소득 계산 방식이
   서로 다르므로, 공통 원재료(healthIncomeItems)만 공유하고 합산 로직은 각 함수에서 따로 처리 */
function healthIncomeItems(p){
  const pensionAnnual = p.np * 12; // 국민연금 등 공적연금(만원, 세전 총지급액)
  const laborAnnual = p.hi_labor || 0;
  const businessAnnual = p.hi_business || 0;
  const otherAnnual = p.hi_other || 0;
  const financeAnnual = (p.hi_interest||0) + (p.hi_dividend||0);
  const financeIncluded = financeAnnual > 1000 ? financeAnnual : 0; // 이자+배당 합산 1,000만원 초과 시 전액, 이하면 0(문턱 효과)
  return {pensionAnnual, laborAnnual, businessAnnual, otherAnnual, financeIncluded};
}

// 피부양자 판정용 총소득(연, 만원) — 전 항목 반영률 없이 100% 합산
function dependentTotalIncome(p){
  const it = healthIncomeItems(p);
  return it.pensionAnnual + it.laborAnnual + it.businessAnnual + it.otherAnnual + it.financeIncluded;
}

// 재산세 과세표준 + 전월세 재산 인정액 합산(지역가입자 재산보험료부과점수 산정용, 만원)
function totalPropertyBase(p){
  return (p.realestate||0) + (p.hi_rentprop||0);
}

/* ── 재산세 과세표준액 자동 계산(지방세법 시행령 제109조, 2026년 적용 공정시장가액비율) ──
   과세표준액 = 공시가격(시가표준액) × 공정시장가액비율
   - 1세대 1주택 특례: 공시가격 3억원 이하 43% / 3억~6억원 44% / 6억원 초과 45%
   - 다주택자(2주택 이상)·법인: 특례 대상 아님 → 원칙 60%
   gongsigaMan: 공시가격(만원), houseType: 'single'(1세대1주택, 기본값) | 'multi'(다주택·법인) */
function propertyTaxBase(gongsigaMan, houseType){
  const g = gongsigaMan || 0;
  let ratio;
  if(houseType === 'multi'){
    ratio = 0.60;
  } else if(g <= 30000){
    ratio = 0.43;
  } else if(g <= 60000){
    ratio = 0.44;
  } else {
    ratio = 0.45;
  }
  return Math.round(g * ratio);
}

/* ── 재산보험료부과점수 60등급표 (국민건강보험법 시행령 별표4, 2024.5.7 개정) ──
   재산금액(만원) 상한 기준 "이하" 구간, 60등급 마지막 행은 초과분(Infinity) */
const PROPERTY_SCORE_TABLE = [
  {max:450,score:22},{max:900,score:44},{max:1350,score:66},{max:1800,score:97},
  {max:2250,score:122},{max:2700,score:146},{max:3150,score:171},{max:3600,score:195},
  {max:4050,score:219},{max:4500,score:244},{max:5020,score:268},{max:5590,score:294},
  {max:6220,score:320},{max:6930,score:344},{max:7710,score:365},{max:8590,score:386},
  {max:9570,score:412},{max:10700,score:439},{max:11900,score:465},{max:13300,score:490},
  {max:14800,score:516},{max:16400,score:535},{max:18300,score:559},{max:20400,score:586},
  {max:22700,score:611},{max:25300,score:637},{max:28100,score:659},{max:31300,score:681},
  {max:34900,score:706},{max:38800,score:731},{max:43200,score:757},{max:48100,score:785},
  {max:53600,score:812},{max:59700,score:841},{max:66500,score:881},{max:74000,score:921},
  {max:82400,score:961},{max:91800,score:1001},{max:103000,score:1041},{max:114000,score:1091},
  {max:127000,score:1141},{max:142000,score:1191},{max:158000,score:1241},{max:176000,score:1291},
  {max:196000,score:1341},{max:218000,score:1391},{max:242000,score:1451},{max:270000,score:1511},
  {max:300000,score:1571},{max:330000,score:1641},{max:363000,score:1711},{max:399300,score:1781},
  {max:439230,score:1851},{max:483153,score:1921},{max:531468,score:1991},{max:584615,score:2061},
  {max:643077,score:2131},{max:707385,score:2201},{max:778124,score:2271},{max:Infinity,score:2341}
];

// 재산세 과세표준+전월세 재산 인정액 합계(만원)에서 1억원 공제 후 60등급표 조회
function propertyInsuranceScore(totalPropertyMan){
  const base = Math.max(0, (totalPropertyMan||0) - 10000);
  for(const row of PROPERTY_SCORE_TABLE){ if(base <= row.max) return row.score; }
  return PROPERTY_SCORE_TABLE[PROPERTY_SCORE_TABLE.length-1].score;
}

// 지역가입자 보험료 산정용 소득월액(만원/월) — 항목별 반영률 적용(2차 출처 교차검증 수준)
// 공적연금·근로소득 50%, 사업·기타소득 100%, 금융소득(1,000만원 초과 시 전액 반영, 문턱효과) 100%
// ※ financeIncluded는 healthIncomeItems()에서 이미 "1,000만원 초과 시 전액 / 이하 0"으로 판정된
//   값이라 여기서는 "초과분만"이 아니라 전액이 그대로 들어온다 — 아래 100% 가중치와 헷갈리지 말 것
function regionalIncomeMonthly(p){
  const it = healthIncomeItems(p);
  const weightedAnnual = it.pensionAnnual*0.5 + it.laborAnnual*0.5 + it.businessAnnual + it.otherAnnual + it.financeIncluded;
  return weightedAnnual / 12;
}

// 지역가입자 예상 건보료(2026년 기준, 1차 출처: 법제처 생활법령정보·보건복지부 고시)
// 건강보험료 = 소득월액×7.19% + 재산보험료부과점수×211.5원, 상한 4,591,740원/하한 20,160원
// 장기요양보험료 = 건강보험료×13.14%
// 지역가입자 건보료 산정 요율(2026년 기준) — 계산 함수와 결과 화면 표시가 같은 값을 쓰도록 모듈 상수로 분리
const HEALTH_RATE_INCOME = 0.0719;      // 소득보험료율 7.19%
const HEALTH_RATE_PROPERTY_WON = 211.5; // 재산보험료부과점수당 금액(원)
const HEALTH_RATE_LTC = 0.1314;         // 장기요양보험료율(건강보험료 대비) 13.14%
const HEALTH_CAP_MAX = 4591740;         // 월 상한(원)
const HEALTH_CAP_MIN = 20160;           // 월 하한(원)

function regionalHealthPremium(incomeMonthly, propertyMan){
  const score = propertyInsuranceScore(propertyMan);
  const incomePremiumWon = (incomeMonthly||0) * 10000 * HEALTH_RATE_INCOME;
  const propertyPremiumWon = score * HEALTH_RATE_PROPERTY_WON;
  const rawHealthWon = incomePremiumWon + propertyPremiumWon;
  const healthPremiumWon = Math.min(HEALTH_CAP_MAX, Math.max(HEALTH_CAP_MIN, rawHealthWon));
  const ltcPremiumWon = healthPremiumWon * HEALTH_RATE_LTC;
  const toMan = won => Math.round(won/1000)/10; // 만원, 소수 1자리
  return {
    score,
    incomeMonthly: Math.round((incomeMonthly||0)*10)/10,
    incomePremium: toMan(incomePremiumWon),
    propertyPremium: toMan(propertyPremiumWon),
    healthPremium: toMan(healthPremiumWon),
    ltcPremium: toMan(ltcPremiumWon),
    total: toMan(healthPremiumWon + ltcPremiumWon),
    capped: rawHealthWon !== healthPremiumWon
  };
}

/* ── 국민연금 조기·연기수령 가산율 ── 정상수급나이(65세) 대비 1년당 조기 -6%, 연기 +7.2%
   (실제 정상수급나이는 출생연도별로 다르지만 이 대시보드는 65세를 기준으로 단순화) */
function npsAdjustFactor(npage){
  const NORMAL_AGE = 65;
  if(npage < NORMAL_AGE) return -(NORMAL_AGE - npage) * 0.06;
  if(npage > NORMAL_AGE) return (npage - NORMAL_AGE) * 0.072;
  return 0;
}

/* ── 퇴직소득세 실제 계산(국세청 공식): 근속연수공제 → 환산급여 → 환산급여공제
   → 과세표준 → 종합소득세 누진세율(2026) → 근속연수만큼 환산산출세액을 되돌림
   retirementIncome: 퇴직소득금액(원금, 만원), serviceYears: 근속연수(년) */
function calcRetirementIncomeTax(retirementIncome, serviceYears){
  const yrs = Math.max(1, Math.round(serviceYears));
  const income = Math.max(0, retirementIncome);

  let serviceDeduction;
  if(yrs <= 5)       serviceDeduction = yrs * 100;
  else if(yrs <= 10)  serviceDeduction = 500 + (yrs - 5) * 200;
  else if(yrs <= 20)  serviceDeduction = 1500 + (yrs - 10) * 250;
  else                serviceDeduction = 4000 + (yrs - 20) * 300;

  const convertedIncome = Math.max(0, income - serviceDeduction) * 12 / yrs;

  let convertedDeduction;
  if(convertedIncome <= 800)         convertedDeduction = convertedIncome;
  else if(convertedIncome <= 7000)   convertedDeduction = 800 + (convertedIncome - 800) * 0.6;
  else if(convertedIncome <= 10000)  convertedDeduction = 4520 + (convertedIncome - 7000) * 0.55;
  else if(convertedIncome <= 30000)  convertedDeduction = 6170 + (convertedIncome - 10000) * 0.45;
  else                                convertedDeduction = 15170 + (convertedIncome - 30000) * 0.35;

  const taxBase = Math.max(0, convertedIncome - convertedDeduction);

  let incomeTax;
  if(taxBase <= 1400)        incomeTax = taxBase * 0.06;
  else if(taxBase <= 5000)   incomeTax = taxBase * 0.15 - 126;
  else if(taxBase <= 8800)   incomeTax = taxBase * 0.24 - 576;
  else if(taxBase <= 15000)  incomeTax = taxBase * 0.35 - 1544;
  else if(taxBase <= 30000)  incomeTax = taxBase * 0.38 - 1994;
  else if(taxBase <= 50000)  incomeTax = taxBase * 0.40 - 2594;
  else if(taxBase <= 100000) incomeTax = taxBase * 0.42 - 3594;
  else                        incomeTax = taxBase * 0.45 - 6594;
  incomeTax = Math.max(0, incomeTax);

  return Math.round(incomeTax * yrs / 12);
}

/* ── 물가상승 반영 연금(Growing Annuity) PMT — 연단위 인출 구조 ──
   simulate()의 stepBalance()는 인출액을 "해당 나이의 1년 동안 12회 동일액"으로 적용하고,
   매년(나이가 바뀔 때) infMul=(1+물가)^(연차)만큼 한 번에 점프 증액한다.
   따라서 PMT도 "연 1회 점프, 연중 12회 동일 월인출" 구조로 풀어야 stepBalance와 정합됨
   (월별로 매달 물가를 반영하는 연속복리 근사식은 실제 인출 패턴과 달라 오차가 컸음).

   pv: 인출 시작 시점 잔액, annualR: 연 수익률(%), annualInf: 연 물가상승률(%),
   N: 인출 연수(년) — N년차 말에 잔액이 0이 되는 "1년차 월 인출액"을 이분탐색으로 산출
*/
function pmtAnnualGrowing(fv, annualR, annualInf, N){
  if(N<=0 || fv<=0) return 0;
  const rm = annualR/100/12;
  const g1 = 1+rm*(20/30), g2 = 1+rm*(10/30); // stepBalance와 동일한 월중 분할

  function finalBalance(A1){ // A1: 1년차 월 인출액
    let bal = fv;
    for(let year=0; year<N; year++){
      const inc = A1 * Math.pow(1+annualInf/100, year);
      for(let m=0;m<12;m++){
        bal = bal*g1;
        bal = Math.max(0, bal-inc)*g2;
      }
    }
    return bal;
  }

  let lo=0, hi=fv; // 월 인출액 탐색 범위 (충분히 넓게 시작)
  let guard=0;
  while(finalBalance(hi) > 0 && guard < 30){ hi *= 2; guard++; }
  for(let i=0;i<60;i++){
    const mid=(lo+hi)/2;
    if(finalBalance(mid) > 0) lo=mid; else hi=mid;
  }
  return (lo+hi)/2;
}

/* ── "필요분만 인출" 플랜 생성 — 완전소진 플랜(nhpay/mfpay/irppay/isam/tm)을
   비례 축소해 오늘 기준 월 합계가 생활비 목표(p.exp)에 맞도록 조정한 사본 반환.
   이미 완전소진 계획이 생활비 목표 이하면(여유 없음) null — 비교 자체가 무의미함.
   ※ 계좌별 우선순위 재배분이 아니라 전 계좌 동일 비율 축소하는 단순화된 근사치임 */
function buildNeedOnlyPlan(p){
  const totalMon = (p.nhpay||0)+(p.mfpay||0)+(p.irppay||0)+(p.isam||0)+(p.tm||0);
  if(totalMon <= 0 || p.exp >= totalMon) return null;
  const scale = p.exp / totalMon;
  return Object.assign({}, p, {
    nhpay:  Math.round((p.nhpay||0)  * scale),
    mfpay:  Math.round((p.mfpay||0)  * scale),
    irppay: Math.round((p.irppay||0) * scale),
    isam:   Math.round((p.isam||0)   * scale),
    tm:     Math.round((p.tm||0)     * scale)
  });
}

// 브라우저(<script src>)에서는 무시되고, Node(node:test)에서만 사용됨
if(typeof module !== 'undefined'){
  module.exports = {
    calcISA_FV, pensionTaxRate, tirpTaxDiscount, dependentStatusCheck,
    healthIncomeItems, dependentTotalIncome, totalPropertyBase, propertyTaxBase,
    PROPERTY_SCORE_TABLE, propertyInsuranceScore, regionalIncomeMonthly,
    HEALTH_RATE_INCOME, HEALTH_RATE_PROPERTY_WON, HEALTH_RATE_LTC,
    HEALTH_CAP_MAX, HEALTH_CAP_MIN, regionalHealthPremium,
    npsAdjustFactor, calcRetirementIncomeTax, pmtAnnualGrowing, buildNeedOnlyPlan
  };
}
