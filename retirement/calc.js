/* ── 순수 계산 함수 모음 (DOM/전역 상태 비의존) ──
   calc.test.js에서 Node 내장 테스트러너(node:test)로 직접 테스트됨.
   브라우저에서는 index.html이 <script src="calc.js">로 그대로 불러와 사용.

   ※ 세법·제도 기준과 출처는 CALC_SOURCES.md에 정리돼 있다. 세법이 바뀌면 그 문서와 아래 상수를 같이 고칠 것.

   단위: 금액은 모두 만원. 월 수령액 입력(nhpay·mfpay·irppay·tm·isam)과 국민연금(np)은 "오늘(p.age세) 기준"
   금액이고, simulate()가 매년 물가배수 infMul=(1+물가)^(나이-현재나이)를 곱해 명목 금액으로 계산한다.
   자동설계·배너·차트·지표는 모두 simulate() 결과 하나만 읽는다(같은 돈을 두 곳에서 따로 합산하지 않음).
*/

// ── 세법·제도 상수 (2026년 기준, CALC_SOURCES.md) ──
const SA = {base:{r:0,inf:0}, opt:{r:2,inf:-0.5}, pes:{r:-2,inf:1}}; // 시나리오: 수익률·물가 가감(%p)
const PRIVATE_PENSION_SEP_LIMIT = 1500; // 사적연금 저율 분리과세 기준(연, 명목 고정) — 넘으면 16.5% 분리과세/종합과세 중 선택
const SEP_TAX_HIGH = 0.165;             // 1,500만원 초과 시 분리과세 세율(지방세 포함)
const LOCAL_TAX_MUL = 1.1;              // 지방소득세 10%
const ISA_TOTAL_CAP = 10000;            // ISA 총 납입한도(만기 연장해 계속 보유 시) 1억원
const ISA_EXEMPT = 200;                 // ISA 비과세 한도(일반형)
const ISA_TAX_RATE = 0.099;             // ISA 비과세 초과 수익 분리과세(지방세 포함)
const PENSION_SAVINGS_DEDUCT_CAP = 600; // 연금저축 세액공제 대상 한도(연)
const PENSION_TOTAL_DEDUCT_CAP = 900;   // 연금저축+IRP 합산 세액공제 대상 한도(연)
const PENSION_ANNUAL_PAY_CAP = 1800;    // 연금계좌 합산 연 납입한도
const PRIN_CONFIRMED_YEAR = 2026;       // 안세공 입력칸 = 이 해 말 확정 금액. 다음 해부터 세액공제 초과 납입분을 자동 합산
const STD_TAX_CREDIT = 7;               // 종합소득 표준세액공제(만원)

// 수익률·물가(시나리오 반영)
function scenarioRates(p, adj){
  adj = adj || SA.base;
  return {nh:p.rnh+adj.r, mf:p.rmf+adj.r, irp:p.rirp+adj.r, tirp:p.rtirp+adj.r, isa:p.risa+adj.r, inf:p.inf+adj.inf};
}

// 연 단위로 잔액을 굴릴 때의 배수 — 인출 없는 해의 stepBalance(월복리 12회)와 정확히 같은 값.
// 예전엔 자동설계가 (1+r)^n, 시뮬레이션이 (1+r/12)^12n을 써서 계좌마다 잔액이 조금씩 남았다.
function growYears(annualR, years){
  return years > 0 ? Math.pow(1 + annualR/1200, 12*years) : 1;
}

/* ── 연초 일시납 FV (IRP·퇴직연금 DC·ISA) ──
   매년 지정한 달(payMonth, 1~12) 21일에 연납입을 한 번에 넣는다고 보고, 그해 남은 기간
   (12-payMonth개월+10/30)만큼만 복리를 붙인다. 1월이면 11+10/30개월.
   isaType==='isa'면 만기 연장으로 계속 보유하는 ISA로 보고 총 납입한도 1억원을 적용한다
   (이미 넣은 원금은 현재 잔액으로 대신함 — 수익이 섞여 있으면 남은 한도가 약간 적게 잡히는 보수적 근사).
   반환 bal은 세전 평가액. ISA 해지 과세(비과세 200만 초과분 9.9%)는 simulate()가 원금을 다 인출해
   계좌를 닫는 시점에 전 기간 순이익 기준으로 한 번 차감한다. */
function calcISA_Detail(curBal, isay, curAge, startAge, endAge, retAge, annualR, isaType, payMonth){
  const pm       = payMonth>=1 && payMonth<=12 ? payMonth : 1;
  const rm       = annualR/100/12;
  const growFull = Math.pow(1+rm, 12);
  const growDep  = Math.pow(1+rm, (12-pm)+10/30);
  const isIsa    = isaType === 'isa';
  let room = isIsa ? Math.max(0, ISA_TOTAL_CAP - (curBal||0)) : Infinity;
  let bal = curBal||0, principal = curBal||0, capHitAge = null;
  for(let age=curAge; age<retAge; age++){
    const paying = age>=startAge && age<=endAge;
    let dep = 0;
    if(paying){
      dep = Math.min(isay||0, room);
      room -= dep;
      if(isIsa && dep < (isay||0) && capHitAge === null) capHitAge = age;
    }
    bal = bal*growFull + dep*growDep;
    principal += dep;
  }
  return {bal: Math.max(0, Math.round(bal)), principal: Math.round(principal), capHitAge};
}
function calcISA_FV(curBal, isay, curAge, startAge, endAge, retAge, annualR, isaType, payMonth){
  return calcISA_Detail(curBal, isay, curAge, startAge, endAge, retAge, annualR, isaType, payMonth).bal;
}
// ISA 해지 과세: 전 기간 순이익에서 비과세 한도를 뺀 금액 × 9.9%
function isaClosingTax(totalGain){
  return ISA_TAX_RATE * Math.max(0, totalGain - ISA_EXEMPT);
}

/* ── 월납입 복리 계좌(농협·미래에셋 연금저축) 미래가치 — 매월 21일 납입 ──
   기존 잔액은 1개월 전체 복리, 납입금은 10/30개월 복리(선형 근사): b = b*(1+rm) + mon*(1+rm*10/30) */
function calcMonthlyDepositFV(balance, monthlyPay, payStartAge, payEndAge, curAge, retAge, annualR){
  const rm = annualR/100/12;
  const depGrow = 1 + rm * (10/30);
  let b = balance;
  for(let age=curAge; age<retAge; age++){
    const paying = age>=payStartAge && age<=payEndAge;
    const mon = paying ? monthlyPay : 0;
    for(let m=0;m<12;m++) b = b*(1+rm) + mon*depGrow;
  }
  return Math.max(0, Math.round(b));
}

/* ── 은퇴 후 잔액 1년 진행 (매월 21일 수령) ──
   1~20일 잔액 복리(20/30개월) → 21일 수령 → 22일~말일 복리(10/30개월) */
function stepBalance(bal, annualR, monthlyOut){
  return stepBalanceDetail(bal, annualR, monthlyOut).bal;
}
// paid: 그해 실제로 빠져나간 금액(연) — 잔액이 모자란 마지막 해에는 계획액보다 적다(수입·세금은 이 값 기준)
function stepBalanceDetail(bal, annualR, monthlyOut){
  if(bal<=0) return {bal:0, paid:0};
  const rm = annualR/100/12;
  if(monthlyOut<=0) return {bal: Math.max(0, bal * Math.pow(1+rm, 12)), paid:0};
  const g1 = 1 + rm * (20/30);
  const g2 = 1 + rm * (10/30);
  let paid = 0;
  for(let m=0; m<12; m++){
    bal = bal * g1;
    const out = Math.min(bal, monthlyOut);
    paid += out;
    bal = (bal - out) * g2;
  }
  return {bal: Math.max(0, bal), paid};
}

// 은퇴 후 월 수령액 — 목표 수령액(물가반영)과 "잔액/12"(연내 소진 방지) 중 작은 값
function calcMonthlyPayout(balance, payoutStartAge, curAge, monthlyPay, infMul){
  if(curAge<payoutStartAge || balance<=0) return 0;
  return Math.min(Math.round(monthlyPay*infMul), Math.ceil(balance/12));
}
function cappedOut(balance, monthly){
  return (balance<=0 || monthly<=0) ? 0 : Math.min(monthly, Math.ceil(balance/12));
}

/* ── 매월 같은 금액(monthly)을 years년 동안 빼려면 처음에 얼마가 있어야 하는지(현재가치) ──
   stepBalance와 같은 월중 분할 복리. 잔액은 선형이라 0원에서 출발해 음수로 굴린 뒤 되돌리면 된다. */
function pvOfMonthlyStream(monthly, years, annualR){
  if(!(monthly > 0) || !(years > 0)) return 0;
  const rm = annualR/100/12, g1 = 1+rm*(20/30), g2 = 1+rm*(10/30);
  const n = Math.round(years*12);
  let b = 0;
  for(let m=0;m<n;m++){ b = b*g1; b = (b - monthly)*g2; }
  return -b / Math.pow(g1*g2, n);
}

/* ── 물가상승 반영 연금(Growing Annuity) PMT — 연단위 인출 구조 ──
   simulate()는 인출액을 "해당 나이의 1년 동안 12회 동일액"으로 적용하고 매년 물가만큼 한 번에 증액하므로,
   PMT도 같은 구조로 N년차 말에 잔액이 0이 되는 "1년차 월 인출액"을 이분탐색으로 구한다.
   opts.isaPrincipal을 주면 ISA로 보고, 누적 인출액이 원금에 닿는 해에 해지 과세를 계좌에서 차감한다
   (simulate()의 ISA 처리와 같은 규칙). */
function pmtAnnualGrowing(fv, annualR, annualInf, N, opts){
  if(N<=0 || fv<=0) return 0;
  const isaPrin = opts && typeof opts.isaPrincipal === 'number' ? opts.isaPrincipal : null;
  const rm = annualR/100/12;
  const g1 = 1+rm*(20/30), g2 = 1+rm*(10/30);

  function finalBalance(A1){
    let bal = fv, cum = 0, closed = false;
    for(let year=0; year<N; year++){
      const inc = A1 * Math.pow(1+annualInf/100, year);
      for(let m=0;m<12;m++){
        bal = bal*g1;
        bal = Math.max(0, bal-inc)*g2;
      }
      if(isaPrin !== null){
        cum += inc*12;
        if(!closed && cum >= isaPrin){
          closed = true;
          bal = Math.max(0, bal - isaClosingTax(cum + bal - isaPrin));
        }
      }
    }
    return bal;
  }

  let lo=0, hi=fv, guard=0;
  while(finalBalance(hi) > 0 && guard < 30){ hi *= 2; guard++; }
  for(let i=0;i<60;i++){
    const mid=(lo+hi)/2;
    if(finalBalance(mid) > 0) lo=mid; else hi=mid;
  }
  return (lo+hi)/2;
}

/* ── 세금 ── */
// 종합소득세 기본세율(2023년 귀속~): 과세표준(만원) → 산출세액(만원, 지방세 제외)
function basicIncomeTax(base){
  const b = Math.max(0, base);
  let t;
  if(b <= 1400)        t = b * 0.06;
  else if(b <= 5000)   t = b * 0.15 - 126;
  else if(b <= 8800)   t = b * 0.24 - 576;
  else if(b <= 15000)  t = b * 0.35 - 1544;
  else if(b <= 30000)  t = b * 0.38 - 1994;
  else if(b <= 50000)  t = b * 0.40 - 2594;
  else if(b <= 100000) t = b * 0.42 - 3594;
  else                 t = b * 0.45 - 6594;
  return Math.max(0, t);
}

/* 사적연금 저율분리과세 세율 (연령별, 소득세+지방세 원천징수율) */
function pensionTaxRate(age){
  if(age >= 80) return 3.3;
  if(age >= 70) return 4.4;
  return 5.5;
}

/* 퇴직소득세 연금수령 감면율 (실제 수령연차 기준, 21년차~ 50%는 2026.1.1 시행) */
function tirpTaxDiscount(withdrawalYear){
  if(withdrawalYear >= 21) return 0.5;
  if(withdrawalYear >= 11) return 0.4;
  return 0.3;
}

/* 퇴직소득세(국세청 공식, 지방세 제외): 근속연수공제 → 환산급여 → 환산급여공제 → 기본세율 → ×근속연수/12
   retirementIncome: 퇴직소득금액(만원) — DC형은 사용자부담금+운용수익 전액(퇴직 시점 평가액)
   공개 예시: 1억·근속 10년 → 387.5만원(+지방소득세 38.75만원) */
function calcRetirementIncomeTax(retirementIncome, serviceYears){
  const yrs = Math.max(1, Math.round(serviceYears));
  const income = Math.max(0, retirementIncome);

  let serviceDeduction;
  if(yrs <= 5)       serviceDeduction = yrs * 100;
  else if(yrs <= 10) serviceDeduction = 500 + (yrs - 5) * 200;
  else if(yrs <= 20) serviceDeduction = 1500 + (yrs - 10) * 250;
  else               serviceDeduction = 4000 + (yrs - 20) * 300;

  const convertedIncome = Math.max(0, income - serviceDeduction) * 12 / yrs;

  let convertedDeduction;
  if(convertedIncome <= 800)        convertedDeduction = convertedIncome;
  else if(convertedIncome <= 7000)  convertedDeduction = 800 + (convertedIncome - 800) * 0.6;
  else if(convertedIncome <= 10000) convertedDeduction = 4520 + (convertedIncome - 7000) * 0.55;
  else if(convertedIncome <= 30000) convertedDeduction = 6170 + (convertedIncome - 10000) * 0.45;
  else                              convertedDeduction = 15170 + (convertedIncome - 30000) * 0.35;

  const taxBase = Math.max(0, convertedIncome - convertedDeduction);
  return Math.round(basicIncomeTax(taxBase) * yrs / 12);
}

// 연금소득공제(소득세법 47조의2): 총연금액(만원) → 공제액, 한도 900만원
function pensionIncomeDeduction(total){
  const t = Math.max(0, total);
  let d;
  if(t <= 350)       d = t;
  else if(t <= 700)  d = 350 + (t - 350) * 0.4;
  else if(t <= 1400) d = 490 + (t - 700) * 0.2;
  else               d = 630 + (t - 1400) * 0.1;
  return Math.min(900, d);
}

/* 연금소득 종합과세 세액(연, 지방세 포함) — 다른 종합소득이 없는 은퇴자 가정.
   총연금액 − 연금소득공제 − 본인 기본공제 150(70세 이상 경로우대 +100) → 기본세율 − 표준세액공제 7 → ×1.1
   ※ 국민연금은 2002년 이후 납입분만 과세되지만 그 비율을 알 수 없어 전액 과세로 본다(보수적). */
function comprehensivePensionTax(totalAnnual, age){
  if(!(totalAnnual > 0)) return 0;
  const income = totalAnnual - pensionIncomeDeduction(totalAnnual);
  const personal = 150 + (age >= 70 ? 100 : 0);
  const tax = Math.max(0, basicIncomeTax(income - personal) - STD_TAX_CREDIT);
  return tax * LOCAL_TAX_MUL;
}

/* 그해 연금소득세(연, 만원) — npAnnual: 국민연금, privAnnual: 사적연금 과세분
   (연금저축·IRP의 세액공제분·운용수익 + 퇴직IRP의 이연퇴직소득 소진 후 운용수익. 과세제외금액·이연퇴직소득은 제외)
   사적연금은 1,500만원 이하면 연령별 저율 분리과세, 초과면 16.5% 분리과세 — 어느 쪽이든 종합과세가 더 싸면 종합과세 선택. */
function pensionTaxes(npAnnual, privAnnual, age){
  const npOnly = comprehensivePensionTax(npAnnual, age);
  if(!(privAnnual > 0)) return {priv:0, np:npOnly, method:'none'};
  const low = privAnnual <= PRIVATE_PENSION_SEP_LIMIT;
  const sepTax = privAnnual * (low ? pensionTaxRate(age)/100 : SEP_TAX_HIGH);
  const compAll = comprehensivePensionTax(npAnnual + privAnnual, age);
  if(compAll - npOnly < sepTax) return {priv: compAll - npOnly, np: npOnly, method:'comp'};
  return {priv: sepTax, np: npOnly, method: low ? 'low' : 'sep165'};
}

/* ── 건강보험 피부양자 자격 판정(소득+재산 기준) ──
   - 재산 과세표준 9억원 초과: 소득 무관 탈락 / 5.4억 초과 9억 이하: 연소득 1,000만원 초과 시 탈락 / 그 외: 2,000만원 초과 시 탈락
   ※ 판정용 "연소득"은 반영률 감면 없이 전액 합산 — 지역가입자 보험료 산정(regionalIncomeMonthly)과 다름 */
function dependentStatusCheck(totalAnnualIncome, realEstateBase){
  const re = realEstateBase || 0;
  if(re > 90000) return {fail:true, reason:'재산 과세표준 9억원 초과 → 소득과 무관하게 자동 탈락'};
  if(re > 54000 && totalAnnualIncome > 1000) return {fail:true, reason:'재산 과세표준 5.4억원 초과 + 소득 연 1,000만원 초과'};
  if(re <= 54000 && totalAnnualIncome > 2000) return {fail:true, reason:'소득 연 2,000만원 초과'};
  return {fail:false, reason:''};
}

/* 건보료 산정용 소득 항목 — npMonthly를 주면 국민연금을 그 금액(예: 수령 개시 시점 명목)으로 본다 */
function healthIncomeItems(p, npMonthly){
  const pensionAnnual = (npMonthly !== undefined ? npMonthly : p.np) * 12;
  const laborAnnual = p.hi_labor || 0;
  const businessAnnual = p.hi_business || 0;
  const otherAnnual = p.hi_other || 0;
  const financeAnnual = (p.hi_interest||0) + (p.hi_dividend||0);
  const financeIncluded = financeAnnual > 1000 ? financeAnnual : 0; // 이자+배당 1,000만원 초과 시 전액, 이하면 0
  return {pensionAnnual, laborAnnual, businessAnnual, otherAnnual, financeIncluded};
}

// 피부양자 판정용 총소득(연) — 전 항목 100% 합산
function dependentTotalIncome(p, npMonthly){
  const it = healthIncomeItems(p, npMonthly);
  return it.pensionAnnual + it.laborAnnual + it.businessAnnual + it.otherAnnual + it.financeIncluded;
}

// 국민연금 수령 개시 시점의 명목 월액 — 피부양자 2,000만원 기준선은 명목 고정이라 이 금액으로 판정한다
function npNominalAtStart(p, adj){
  const r = scenarioRates(p, adj);
  return Math.round(p.np * Math.pow(1 + r.inf/100, Math.max(0, p.npage - p.age)));
}

// 재산세 과세표준 + 전월세 재산 인정액 (지역가입자 재산보험료 산정용)
function totalPropertyBase(p){
  return (p.realestate||0) + (p.hi_rentprop||0);
}

/* 재산세 과세표준액(지방세법 시행령 109조, 2026 공정시장가액비율)
   1세대 1주택 특례: 공시가격 3억 이하 43% / 3억~6억 44% / 6억 초과 45%, 다주택·법인 60% */
function propertyTaxBase(gongsigaMan, houseType){
  const g = gongsigaMan || 0;
  let ratio;
  if(houseType === 'multi') ratio = 0.60;
  else if(g <= 30000)       ratio = 0.43;
  else if(g <= 60000)       ratio = 0.44;
  else                      ratio = 0.45;
  return Math.round(g * ratio);
}

/* 재산보험료부과점수 60등급표 (국민건강보험법 시행령 별표4) — 재산금액(만원) 상한 "이하" 구간 */
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

// 1억원 기본공제 후 60등급표 조회 — 공제 후 남는 재산이 없으면 재산보험료 0(점수 0)
function propertyInsuranceScore(totalPropertyMan){
  const base = Math.max(0, (totalPropertyMan||0) - 10000);
  if(base <= 0) return 0;
  for(const row of PROPERTY_SCORE_TABLE){ if(base <= row.max) return row.score; }
  return PROPERTY_SCORE_TABLE[PROPERTY_SCORE_TABLE.length-1].score;
}

// 지역가입자 소득월액(만원/월) — 공적연금·근로 50%, 사업·기타 100%, 금융소득(1,000만원 초과 시 전액) 100%
function regionalIncomeMonthly(p){
  const it = healthIncomeItems(p);
  const weightedAnnual = it.pensionAnnual*0.5 + it.laborAnnual*0.5 + it.businessAnnual + it.otherAnnual + it.financeIncluded;
  return weightedAnnual / 12;
}

// 지역가입자 건보료 요율(2026)
const HEALTH_RATE_INCOME = 0.0719;      // 소득보험료율
const HEALTH_RATE_PROPERTY_WON = 211.5; // 재산보험료부과점수당 금액(원)
const HEALTH_RATE_LTC = 0.1314;         // 장기요양보험료율(건강보험료 대비)
const HEALTH_CAP_MAX = 4591740;         // 월 상한(원)
const HEALTH_CAP_MIN = 20160;           // 월 하한(원) — 소득분에만 적용(연소득 336만원 이하 세대 최저보험료)

/* 건강보험료 = max(하한, 소득월액×7.19%) + 재산점수×211.5원, 월 상한 적용 / 장기요양 = 건강보험료×13.14% */
function regionalHealthPremium(incomeMonthly, propertyMan){
  const score = propertyInsuranceScore(propertyMan);
  const rawIncomeWon = (incomeMonthly||0) * 10000 * HEALTH_RATE_INCOME;
  const incomePremiumWon = Math.max(HEALTH_CAP_MIN, rawIncomeWon);
  const propertyPremiumWon = score * HEALTH_RATE_PROPERTY_WON;
  const rawHealthWon = incomePremiumWon + propertyPremiumWon;
  const healthPremiumWon = Math.min(HEALTH_CAP_MAX, rawHealthWon);
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
    capped: rawIncomeWon < HEALTH_CAP_MIN || rawHealthWon > HEALTH_CAP_MAX
  };
}

/* 국민연금 조기·연기수령 가산율 — 정상수급나이(65세, 1969년생~) 대비 1년당 조기 -6%, 연기 +7.2% */
function npsAdjustFactor(npage){
  const NORMAL_AGE = 65;
  if(npage < NORMAL_AGE) return -(NORMAL_AGE - npage) * 0.06;
  if(npage > NORMAL_AGE) return (npage - NORMAL_AGE) * 0.072;
  return 0;
}

/* ── 과세제외금액(안세공) ──
   연금계좌 인출은 법으로 ① 과세제외금액(세액공제 안 받은 원금) → ② 이연퇴직소득 → ③ 세액공제분·운용수익
   순서로 빠져나간다(소득세법 시행령 40조의3). 과세제외금액은 원금만이고 그 운용수익은 ③(과세)이다.
   그래서 계좌 잔액은 하나로 굴리고, 비과세로 분류할 수 있는 남은 원금(T, 명목 고정)만 따로 추적한다.

   futurePrinAdd: 안세공 입력값은 PRIN_CONFIRMED_YEAR(2026) 말 확정 금액이고, 그다음 해부터는 매년
   세액공제 한도(연금저축 600만·IRP 합산 900만)를 넘게 낸 금액을 자동으로 더한다. 이미 지난 해(2027~작년)도
   포함하므로 입력을 매년 고치지 않아도 빠지지 않는다(그 해에도 지금 입력한 납입액·기간 그대로였다고 가정).
   나이↔연도는 생일을 모르므로 "올해 = 현재 나이"로 연 단위 근사. */
function futurePrinAdd(p, currentYear){
  const out = {nh:0, mf:0, irp:0, years:0, overPayAges:[]};
  const cy = Number.isFinite(currentYear) ? currentYear : PRIN_CONFIRMED_YEAR;
  const inWin = (a, s, e) => a >= s && a <= Math.min(p.ret - 1, e);
  for(let y = PRIN_CONFIRMED_YEAR + 1; y <= PRIN_CONFIRMED_YEAR + 80; y++){
    const a = p.age + (y - cy);
    if(!(a <= p.ret - 1)) break;
    const nhM  = inWin(a, p.nhstart,  p.nhend)  ? (p.nhm  || 0) : 0;
    const mfM  = inWin(a, p.mfstart,  p.mfend)  ? (p.mfm  || 0) : 0;
    const irpY = inWin(a, p.irpstart, p.irpend) ? (p.irpy || 0) : 0;
    const ps = (nhM + mfM) * 12;
    if(ps + irpY > PENSION_ANNUAL_PAY_CAP) out.overPayAges.push(a);
    const psDed  = Math.min(PENSION_SAVINGS_DEDUCT_CAP, ps);
    const irpDed = Math.min(irpY, Math.max(0, PENSION_TOTAL_DEDUCT_CAP - psDed));
    const psEx = ps - psDed, irpEx = irpY - irpDed;
    if(ps > 0){ out.nh += psEx * (nhM*12 / ps); out.mf += psEx * (mfM*12 / ps); }
    out.irp += irpEx;
    if(psEx + irpEx > 0) out.years++;
  }
  out.nh = Math.round(out.nh); out.mf = Math.round(out.mf); out.irp = Math.round(out.irp);
  return out;
}

// 은퇴 시점 계좌별 과세제외금액(비과세 원금) T — 입력(2026년 말 확정) + 2027년~ 자동 합산
function taxFreeBases(p){
  const add = futurePrinAdd(p, p.curYear);
  const nhInput = Math.min(p.nhprin||0, p.nh||0);
  const mfInput = Math.min(p.mfprin||0, p.mf||0);
  return {nh: nhInput + add.nh, mf: mfInput + add.mf, irp: add.irp, nhInput, mfInput, add};
}

// 공백기(은퇴~국민연금 개시 전) 추가 인출: 비과세 원금 T를 공백기 개월 수로 나눈 명목 정액 — 같은 계좌 잔액에서 빠짐
function gapExtraMonthly(T, p){
  const gap = p.npage - p.ret;
  if(gap <= 0) return {nh:0, mf:0, years:0};
  return {nh: Math.round(T.nh / (gap*12)), mf: Math.round(T.mf / (gap*12)), years: gap};
}

/* ── 은퇴(retAge) 시점 계좌별 평가액 — simulate·buildAccRows·자동설계가 모두 이 함수 하나를 쓴다 ──
   납입 기간은 [max(현재나이, 시작), min(은퇴나이-1, 종료)]. 농협·미래에셋은 안세공을 포함한 전체 잔액. */
function accWindows(p){
  return {
    nh:  [Math.max(p.age, p.nhstart),  Math.min(p.ret-1, p.nhend)],
    mf:  [Math.max(p.age, p.mfstart),  Math.min(p.ret-1, p.mfend)],
    irp: [Math.max(p.age, p.irpstart), Math.min(p.ret-1, p.irpend)],
    isa: [Math.max(p.age, p.isastart), Math.min(p.ret-1, p.isaend)],
    dc:  [Math.max(p.age, p.tdcstart), Math.min(p.ret-1, p.tdcend)],
  };
}
function accumulate(p, adj, retAge){
  const end = retAge === undefined ? p.ret : retAge;
  const r = scenarioRates(p, adj);
  const w = accWindows(p);
  const isa = calcISA_Detail(p.isa||0, p.isay||0, p.age, w.isa[0], w.isa[1], end, r.isa, 'isa', p.isaymon);
  return {
    nhFV:   calcMonthlyDepositFV(p.nh||0, p.nhm||0, w.nh[0], w.nh[1], p.age, end, r.nh),
    mfFV:   calcMonthlyDepositFV(p.mf||0, p.mfm||0, w.mf[0], w.mf[1], p.age, end, r.mf),
    irpFV:  calcISA_FV(p.irp||0,  p.irpy||0, p.age, w.irp[0], w.irp[1], end, r.irp,  undefined, p.irpymon),
    tirpFV: calcISA_FV(p.tirp||0, p.tdc||0,  p.age, w.dc[0],  w.dc[1],  end, r.tirp, undefined, p.tdcymon),
    isaFV: isa.bal, isaPrin: isa.principal, isaCapHitAge: isa.capHitAge,
  };
}

/* ── 은퇴 후 연도별 시뮬레이션 ──
   opts.needOnly: 매년 계획 인출액이 그해 생활비를 넘으면 사적 인출(국민연금 제외)만 같은 비율로 줄여 생활비에 맞춤.
   사적연금 1,500만원은 인출 상한이 아니라 세율 경계 — 넘는 해에도 인출은 계획대로 하고 세금만 달라진다. */
function simulate(p, adj, opts){
  adj = adj || SA.base; opts = opts || {};
  const r = scenarioRates(p, adj);
  const infR = r.inf;
  const yrs = Math.max(0, p.ret - p.age);
  const acc = accumulate(p, adj);
  const {nhFV, mfFV, irpFV, tirpFV, isaFV, isaPrin} = acc;
  const totalFV = nhFV + mfFV + irpFV + tirpFV + isaFV;

  // 비과세 원금(과세제외금액) — 명목 고정, 계좌별 인출액에서 먼저 차감(법정 인출순서)
  const T = taxFreeBases(p);
  let nhT = T.nh, mfT = T.mf, irpT = T.irp;
  const extra = gapExtraMonthly(T, p);

  // 퇴직IRP: 이연퇴직소득 = 은퇴 시점 DC 평가액. 그만큼 먼저 퇴직소득세(지방세 포함)×(1-감면율)로 과세하고,
  // 다 쓴 뒤 인출분은 운용수익 → 사적연금 과세분(1,500만원 판정 포함)
  let tirpDeferred = tirpFV;
  const tirpTaxRate = tirpFV > 0 ? (p.tirptax||0) * LOCAL_TAX_MUL / tirpFV : 0;

  const expAtRet = Math.round(p.exp * Math.pow(1 + infR/100, yrs));
  let nhB=nhFV, mfB=mfFV, irpB=irpFV, tirpB=tirpFV, isaB=isaFV;
  let isaCum = 0, isaClosed = false, isaTaxPaid = 0, isaCloseAge = null;
  let runway = p.life;
  const rows = [];
  let gapSum=0, gapCount=0, fullSum=0, fullCount=0, netGapSum=0, netFullSum=0;
  let lifetimeTax = 0, maxPrivAnnual = 0, maxPrivAge = null, firstOverPlimitAge = null, firstOverLawAge = null, overPlimitYears = 0;
  let prinExhaustAge = null;

  for(let age=p.ret; age<=p.life; age++){
    const el = age - p.ret;
    const curExp = Math.round(expAtRet * Math.pow(1+infR/100, el));
    const infMul = Math.pow(1+infR/100, age - p.age);
    const inGap = age < p.npage;

    // 계좌별 그해 계획 월 인출액(명목) — 계획 수령액(오늘 기준×물가) + 공백기 비과세 원금 추가 인출
    const plan = {
      nh:   cappedOut(nhB,   (age>=p.nhage  ? Math.round(p.nhpay*infMul)  : 0) + (inGap ? extra.nh : 0)),
      mf:   cappedOut(mfB,   (age>=p.mfage  ? Math.round(p.mfpay*infMul)  : 0) + (inGap ? extra.mf : 0)),
      irp:  cappedOut(irpB,   age>=p.irpage ? Math.round(p.irppay*infMul) : 0),
      tirp: cappedOut(tirpB,  age>=p.tage   ? Math.round(p.tm*infMul)     : 0),
      isa:  cappedOut(isaB,   age>=p.isaage ? Math.round(p.isam*infMul)   : 0),
    };
    const npInc = age >= p.npage ? Math.round(p.np * infMul) : 0; // 국민연금: 현재가치 입력 → 매년 물가연동

    if(opts.needOnly){
      const sum = plan.nh + plan.mf + plan.irp + plan.tirp + plan.isa;
      const need = Math.max(0, curExp - npInc);
      if(sum > need && sum > 0){
        const s = need / sum;
        for(const k in plan) plan[k] = Math.round(plan[k]*s);
      }
    }

    // 잔액 진행 — 수입·세금은 실제로 빠져나간 금액(paid, 연) 기준
    const sNh = stepBalanceDetail(nhB, r.nh, plan.nh),   sMf = stepBalanceDetail(mfB, r.mf, plan.mf);
    const sIrp = stepBalanceDetail(irpB, r.irp, plan.irp), sTirp = stepBalanceDetail(tirpB, r.tirp, plan.tirp);
    const sIsa = stepBalanceDetail(isaB, r.isa, plan.isa);
    nhB = sNh.bal; mfB = sMf.bal; irpB = sIrp.bal; tirpB = sTirp.bal; isaB = sIsa.bal;
    const nhA = sNh.paid, mfA = sMf.paid, irpA = sIrp.paid, tirpA = sTirp.paid, isaA = sIsa.paid;

    // 법정 인출순서로 과세 구분(연 단위): 과세제외금액 먼저
    const nhFreeA  = Math.min(nhA,  nhT);  nhT  -= nhFreeA;
    const mfFreeA  = Math.min(mfA,  mfT);  mfT  -= mfFreeA;
    const irpFreeA = Math.min(irpA, irpT); irpT -= irpFreeA;
    if(prinExhaustAge === null && T.nh + T.mf + T.irp > 0 && nhT + mfT + irpT <= 1e-9) prinExhaustAge = age;
    const tirpDefA = Math.min(tirpA, tirpDeferred); tirpDeferred -= tirpDefA;
    const tirpGainA = tirpA - tirpDefA;
    const privTaxableA = (nhA - nhFreeA) + (mfA - mfFreeA) + (irpA - irpFreeA) + tirpGainA;

    // 세금(연)
    const pt = pensionTaxes(npInc*12, privTaxableA, age);
    const tirpTaxA = tirpDefA > 0 ? tirpDefA * tirpTaxRate * (1 - tirpTaxDiscount(age - p.tage + 1)) : 0;

    // 화면 표시용 월 금액: 비과세 분류액은 "안세공" 막대로 분리, 계좌 막대는 과세분 — 합계는 인출액 그대로(중복 없음)
    const nhW = Math.round(nhA/12), mfW = Math.round(mfA/12), irpW = Math.round(irpA/12);
    const tirpW = Math.round(tirpA/12), isaW = Math.round(isaA/12);
    const prinNh = Math.min(nhW, Math.round(nhFreeA/12)), prinMf = Math.min(mfW, Math.round(mfFreeA/12)), prinIrp = Math.min(irpW, Math.round(irpFreeA/12));
    const nhInc = nhW - prinNh, mfInc = mfW - prinMf, irpInc = irpW - prinIrp;
    const prinInc = prinNh + prinMf + prinIrp;
    const totalInc = nhW + mfW + irpW + npInc + tirpW + isaW;

    // ISA 해지 과세: 원금을 다 인출한 해에 전 기간 순이익 기준으로 한 번(계좌에서 차감 — 세후 계산에 다시 넣지 않음)
    let isaTax = 0, isaTaxFromIncome = 0;
    isaCum += isaA;
    if(!isaClosed && isaFV > 0 && isaA > 0 && isaCum >= isaPrin){
      isaClosed = true; isaCloseAge = age;
      isaTax = isaClosingTax(isaCum + isaB - isaPrin);
      const fromBal = Math.min(isaB, isaTax);
      isaB -= fromBal;
      isaTaxFromIncome = isaTax - fromBal; // 잔액이 모자라면 그해 인출액에서 부담
      isaTaxPaid += isaTax;
    }

    const taxAnnual = pt.priv + pt.np + tirpTaxA + isaTaxFromIncome;
    const taxTotal = Math.round(taxAnnual/12);
    const netInc = Math.max(0, totalInc - taxTotal);
    lifetimeTax += pt.priv + pt.np + tirpTaxA + isaTax;

    if(privTaxableA > maxPrivAnnual){ maxPrivAnnual = privTaxableA; maxPrivAge = age; }
    if(privTaxableA > p.plimit){ overPlimitYears++; if(firstOverPlimitAge === null) firstOverPlimitAge = age; }
    if(privTaxableA > PRIVATE_PENSION_SEP_LIMIT && firstOverLawAge === null) firstOverLawAge = age;

    const totalAsset = nhB + mfB + irpB + tirpB + isaB;
    if(totalAsset <= 0 && runway === p.life) runway = age;

    if(inGap){ gapSum += totalInc; gapCount++; netGapSum += netInc; }
    else     { fullSum += totalInc; fullCount++; netFullSum += netInc; }

    rows.push({
      age, label: age+'세', infMul,
      nhInc, mfInc, irpInc, privInc: Math.round(privTaxableA/12),
      npInc, tirpInc: tirpW, isaInc: isaW, prinInc, totalInc, curExp,
      taxPriv: Math.round(pt.priv/12), taxNp: Math.round(pt.np/12), taxTirp: Math.round(tirpTaxA/12), taxTotal,
      taxMethod: pt.method, isaTax: Math.round(isaTax), netInc,
      privTaxableAnnual: privTaxableA,
      gross: {nh:nhA, mf:mfA, irp:irpA, tirp:tirpA, isa:isaA}, // 연간 실제 인출액
      freeAnnual: {nh:nhFreeA, mf:mfFreeA, irp:irpFreeA}, tirpDeferredAnnual: tirpDefA,
      bal: {nh:nhB, mf:mfB, irp:irpB, tirp:tirpB, isa:isaB},
      privB: Math.round((nhB+mfB+irpB)/10000*10)/10,
      nhB_억: Math.round(nhB/10000*10)/10,
      mfB_억: Math.round(mfB/10000*10)/10,
      irpB_억: Math.round(irpB/10000*10)/10,
      tirpB: Math.round(tirpB/10000*10)/10,
      isaB:  Math.round(isaB/10000*10)/10,
    });
  }

  const firstGapRow = rows.find(x => x.age === p.ret) || rows[0];
  const last = rows[rows.length-1];
  return {
    nhFV, mfFV, irpFV, tirpFV, isaFV, isaPrin, isaCapHitAge: acc.isaCapHitAge, totalFV,
    gapMonthly:  gapCount  ? Math.round(gapSum/gapCount)   : 0,
    fullMonthly: fullCount ? Math.round(fullSum/fullCount) : 0,
    netGapMonthly:  gapCount  ? Math.round(netGapSum/gapCount)   : 0,
    netFullMonthly: fullCount ? Math.round(netFullSum/fullCount) : 0,
    privAnnual: firstGapRow ? Math.round(firstGapRow.privTaxableAnnual) : 0,
    maxPrivAnnual: Math.round(maxPrivAnnual), maxPrivAge, firstOverPlimitAge, firstOverLawAge, overPlimitYears,
    lifetimeTax, isaTaxPaid, isaCloseAge, prinExhaustAge, taxFree: T, extra, tirpTaxRate,
    leftover: last ? last.bal.nh + last.bal.mf + last.bal.irp + last.bal.tirp + last.bal.isa : 0,
    runway, rows
  };
}

/* ── 은퇴 전(적립기) 연도별 행 — 차트 표시 전용 ──
   잔액은 simulate()와 같은 accumulate()로 retAge만 age+1(=그해 말)로 바꿔 계산 → 은퇴 시점 값과 그대로 이어진다. */
function buildAccRows(p, adj){
  adj = adj || SA.base;
  const rows = [];
  if(p.ret <= p.age) return rows;
  const w = accWindows(p);
  const on = (k,age)=> age>=w[k][0] && age<=w[k][1];
  const r1 = v => Math.round(v/10000*10)/10; // 만원 → 억(소수 1자리)
  let prevTotal = (p.nh||0)+(p.mf||0)+(p.irp||0)+(p.tirp||0)+(p.isa||0);
  let isaRoom = Math.max(0, ISA_TOTAL_CAP - (p.isa||0));
  for(let age=p.age; age<p.ret; age++){
    const a = accumulate(p, adj, age+1);
    const isaDep = on('isa',age) ? Math.min(p.isay||0, isaRoom) : 0;
    isaRoom -= isaDep;
    const dep = {
      nh:  on('nh',age)  ? p.nhm  : 0,   // 월
      mf:  on('mf',age)  ? p.mfm  : 0,   // 월
      irp: on('irp',age) ? p.irpy : 0,   // 연(일시납)
      isa: isaDep,                       // 연(일시납, 총 1억 한도 반영)
      dc:  on('dc',age)  ? p.tdc  : 0,   // 연(회사 적립)
    };
    const depYearTotal = (dep.nh+dep.mf)*12 + dep.irp + dep.isa + dep.dc;
    const total = a.nhFV + a.mfFV + a.irpFV + a.tirpFV + a.isaFV;
    rows.push({
      age, label:age+'세', phase:'acc', yearsLeft:p.ret-age, dep,
      nhDep:dep.nh, mfDep:dep.mf, irpDep:Math.round(dep.irp/12), isaDep:Math.round(dep.isa/12), dcDep:Math.round(dep.dc/12),
      depYearTotal, depMonthTotal:Math.round(depYearTotal/12),
      gain: Math.round(total - prevTotal - depYearTotal),
      totalB: r1(total),
      privB: r1(a.nhFV+a.mfFV+a.irpFV), nhB_억:r1(a.nhFV), mfB_억:r1(a.mfFV), irpB_억:r1(a.irpFV),
      tirpB: r1(a.tirpFV), isaB: r1(a.isaFV),
    });
    prevTotal = total;
  }
  return rows;
}

// 자동설계 월 수령액은 소수 1자리 — 정수로 반올림하면 작은 계좌(IRP 등)는 기대수명에 수%가 남는다
function round1(v){ return Math.round(v*10)/10; }

// startAge~endAge 동안 매년 물가만큼 늘려 fv를 정확히 소진하는 첫해 월 인출액을 "오늘 기준"으로 환산
function pmtTodayValue(p, r, fv, ratePct, startAge, endAge, opts){
  const N = endAge - startAge + 1;
  if(N <= 0 || fv <= 0) return 0;
  const first = pmtAnnualGrowing(fv, ratePct, r.inf, N, opts);
  return first / Math.pow(1 + r.inf/100, startAge - p.age);
}

/* ── 퇴직IRP 수령 시작 나이 — 후보마다 simulate()를 돌려 "생애 총세금(명목 합) 최소 + 기대수명까지 자산 유지" ──
   만 55세 이상부터 연금수령 가능. 수령연차가 쌓일수록 퇴직소득세 감면(30→40→50%)이 커진다. */
function optimizeTage(p, adj){
  adj = adj || SA.base;
  const r = scenarioRates(p, adj);
  const acc = accumulate(p, adj);
  const minAge = Math.max(p.ret, 55);
  const maxAge = Math.min(80, p.life - 1);
  let best = null, bestAny = null;
  for(let cand = minAge; cand <= maxAge; cand++){
    const N = p.life - cand + 1;
    if(N <= 0 || acc.tirpFV <= 0) continue;
    const first = pmtAnnualGrowing(acc.tirpFV * growYears(r.tirp, cand - p.ret), r.tirp, r.inf, N);
    if(first <= 0) continue;
    const tm = round1(first / Math.pow(1 + r.inf/100, cand - p.age));
    const sim = simulate(Object.assign({}, p, {tage:cand, tm}), adj);
    const rec = {tage:cand, tm, totalTax: sim.lifetimeTax};
    if(sim.runway === p.life && (!best || rec.totalTax < best.totalTax)) best = rec;
    if(!bestAny || rec.totalTax < bestAny.totalTax) bestAny = rec;
  }
  return best || bestAny || {tage:minAge, tm:0, totalTax:0};
}

/* ── 자동설계(순수 계산) — 각 계좌를 기대수명(또는 지정 구간 끝)에 정확히 0원이 되도록 물가증액 인출액 산정 ──
   ① ISA: 공백기(은퇴~국민연금 개시 전) 소진 ② 비과세 원금: 공백기 정액 추가 인출 ③ 미래에셋: 55세~공백기 끝
   ④ 농협: 55세~기대수명 ⑤ IRP개인: 국민연금 개시~기대수명 ⑥ 퇴직IRP: optimizeTage.
   은퇴 ≥ 국민연금 개시(공백기 없음)면 ISA·미래에셋은 은퇴~기대수명, IRP는 55세(또는 은퇴)부터.
   p의 납입 종료 나이는 호출 전에 정규화돼 있어야 한다(getP). */
function computeAutoPlan(p, adj){
  adj = adj || SA.base;
  const r = scenarioRates(p, adj);
  const acc = accumulate(p, adj);
  // 퇴직소득세 자동값: DC 평가액(사용자부담금+운용수익) 기준, 근속연수는 은퇴 시점까지
  const tservAtRet = (p.tservice||0) + Math.max(0, p.ret - p.age);
  const tirptax = calcRetirementIncomeTax(acc.tirpFV, tservAtRet);
  const q = Object.assign({}, p, {tirptax});

  const T = taxFreeBases(q);
  const extra = gapExtraMonthly(T, q);
  const hasGap = q.npage > q.ret;
  const gapYears = hasGap ? q.npage - q.ret : 0;
  const gapEnd = hasGap ? q.npage - 1 : q.life;
  const pStart = Math.max(q.ret, 55);

  const isaage = q.ret;
  const isam = round1(pmtTodayValue(q, r, acc.isaFV, r.isa, isaage, gapEnd, {isaPrincipal: acc.isaPrin}));

  const mfEnd = (hasGap && q.npage - 1 >= pStart) ? q.npage - 1 : q.life;
  const mfBase = Math.max(0, acc.mfFV - pvOfMonthlyStream(extra.mf, gapYears, r.mf)) * growYears(r.mf, pStart - q.ret);
  const mfpay = round1(pmtTodayValue(q, r, mfBase, r.mf, pStart, mfEnd));

  const nhBase = Math.max(0, acc.nhFV - pvOfMonthlyStream(extra.nh, gapYears, r.nh)) * growYears(r.nh, pStart - q.ret);
  const nhpay = round1(pmtTodayValue(q, r, nhBase, r.nh, pStart, q.life));

  const irpage = hasGap ? Math.min(q.npage, q.life - 1) : pStart;
  const irppay = round1(pmtTodayValue(q, r, acc.irpFV * growYears(r.irp, irpage - q.ret), r.irp, irpage, q.life));

  const plan = {isaage, isam, mfage:pStart, mfpay, nhage:pStart, nhpay, irpage, irppay, tirptax};
  const opt = optimizeTage(Object.assign({}, q, plan), adj);
  plan.tage = opt.tage;
  plan.tm = opt.tm;
  plan.info = {T, extra, hasGap, gapEnd, mfEnd, acc, tservAtRet, tirpLifetimeTax: opt.totalTax,
               acctMaxMon: {nh:nhpay, mf:mfpay, irp:irppay}};
  return plan;
}

// 브라우저(<script src>)에서는 무시되고, Node(node:test)에서만 사용됨
if(typeof module !== 'undefined'){
  module.exports = {
    SA, PRIVATE_PENSION_SEP_LIMIT, SEP_TAX_HIGH, LOCAL_TAX_MUL, ISA_TOTAL_CAP, ISA_EXEMPT, ISA_TAX_RATE,
    PENSION_SAVINGS_DEDUCT_CAP, PENSION_TOTAL_DEDUCT_CAP, PENSION_ANNUAL_PAY_CAP, PRIN_CONFIRMED_YEAR,
    scenarioRates, growYears, calcISA_Detail, calcISA_FV, isaClosingTax, calcMonthlyDepositFV, stepBalance, stepBalanceDetail,
    calcMonthlyPayout, pvOfMonthlyStream, pmtAnnualGrowing, basicIncomeTax, pensionTaxRate, tirpTaxDiscount,
    calcRetirementIncomeTax, pensionIncomeDeduction, comprehensivePensionTax, pensionTaxes,
    dependentStatusCheck, healthIncomeItems, dependentTotalIncome, npNominalAtStart, totalPropertyBase,
    propertyTaxBase, PROPERTY_SCORE_TABLE, propertyInsuranceScore, regionalIncomeMonthly,
    HEALTH_RATE_INCOME, HEALTH_RATE_PROPERTY_WON, HEALTH_RATE_LTC, HEALTH_CAP_MAX, HEALTH_CAP_MIN,
    regionalHealthPremium, npsAdjustFactor, futurePrinAdd, taxFreeBases, gapExtraMonthly,
    accWindows, accumulate, simulate, buildAccRows, pmtTodayValue, optimizeTage, computeAutoPlan
  };
}
