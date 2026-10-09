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
const STD_TAX_CREDIT_WAGE = 13;         // 근로소득이 있을 때 표준세액공제(만원)
const FIN_COMP_THRESHOLD = 2000;        // 금융소득종합과세 기준금액(이자+배당 연, 만원)
const FIN_WITHHOLD = 0.14;              // 이자·배당 원천징수세율(지방세 제외)
const GEN_OV_TAX = 0.22;                // 해외주식 양도소득세율(지방세 포함)
const GEN_OV_DEDUCT = 250;              // 양도소득 기본공제(연, 만원)
const NEED_MARGIN = 1.5;                // 필요한 만큼만 인출 모드: 월 세후를 생활비보다 이만큼(만원) 높게 맞춰 표시 반올림 미달을 막는다
const NPS_MIN_YEARS = 10;               // 노령연금 최소 가입기간(년)
const NPS_FULL_AGE = 60;                // 국민연금 보험료 납부 종료 나이(공단 예상액은 여기까지 계속 납부 가정)
const NPS_VOL_PREMIUM_RATE = 0.095;     // 2026 국민연금 임의가입·임의계속가입 보험료율(기준소득월액 대비)
const VOL_HEALTH_MONTHS = 36;           // 건강보험 임의계속가입 최대 기간(개월)

// 수익률·물가(시나리오 반영)
function scenarioRates(p, adj){
  adj = adj || SA.base;
  return {nh:p.rnh+adj.r, mf:p.rmf+adj.r, irp:p.rirp+adj.r, tirp:p.rtirp+adj.r, isa:p.risa+adj.r, gen:(p.rgen !== undefined && p.rgen !== null ? p.rgen : p.rnh)+adj.r, inf:p.inf+adj.inf};
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

// 은퇴 후 월 인출액 — 계획액(물가반영)과 "잔액/12"(연내 소진 방지) 중 작은 값
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

/* 근로소득공제(소득세법 47조, 한도 2,000만원): 총급여(만원) → 공제액 */
function wageIncomeDeduction(gross){
  const g = Math.max(0, gross);
  let d;
  if(g <= 500)        d = g * 0.7;
  else if(g <= 1500)  d = 350 + (g - 500) * 0.4;
  else if(g <= 4500)  d = 750 + (g - 1500) * 0.15;
  else if(g <= 10000) d = 1200 + (g - 4500) * 0.05;
  else                d = 1475 + (g - 10000) * 0.02;
  return Math.min(2000, d);
}

/* 근로소득세액공제(소득세법 59조): 산출세액(만원, 지방세 제외)·총급여 → 공제액. 130만원 이하 55%, 초과분 30%, 총급여별 한도 */
function wageTaxCredit(calcTax, gross){
  const t = Math.max(0, calcTax);
  const raw = t <= 130 ? t * 0.55 : 71.5 + (t - 130) * 0.30;
  let cap;
  if(gross <= 3300)       cap = 74;
  else if(gross <= 7000)  cap = Math.max(66, 74 - (gross - 3300) * 0.008);
  else if(gross <= 12000) cap = Math.max(50, 66 - (gross - 7000) * 0.5);
  else                    cap = Math.max(20, 50 - (gross - 12000) * 0.5);
  return Math.min(raw, cap);
}

/* 종합과세 산출세액과 세액공제 — 공적연금 + 근로·사업·기타 + 금융소득 초과분.
   ex: {labor(총급여), business, other, finExcess} (모두 만원, 기본 0). ex가 전부 0이면 연금만 과세하는 기존 식과 같다.
   총연금액 − 연금소득공제 + 근로소득금액 + 사업 + 기타 − 본인 기본공제 150(70세 이상 +100) → 기본세율(산출세액)
   세액공제 = 근로세액공제 + 표준세액공제(근로소득이 있으면 13, 없으면 7) — 비교과세는 산출세액끼리 비교한 뒤 공제한다 */
function comprehensiveCore(pensionAnnual, ex, age){
  const labor = (ex && ex.labor) || 0, biz = (ex && ex.business) || 0, oth = (ex && ex.other) || 0, fe = (ex && ex.finExcess) || 0;
  const pen = Math.max(0, pensionAnnual);
  const laborInc = Math.max(0, labor - wageIncomeDeduction(labor));
  const income = pen - pensionIncomeDeduction(pen) + laborInc + biz + oth + fe;
  if(!(income > 0)) return {calc: 0, credit: 0};
  const personal = 150 + (age >= 70 ? 100 : 0);
  const calc = basicIncomeTax(income - personal);
  const credit = (labor > 0 ? wageTaxCredit(calc * (laborInc / income), labor) + STD_TAX_CREDIT_WAGE : STD_TAX_CREDIT);
  return {calc, credit};
}

/* 그해 전체 종합과세 세액(지방세 포함): 금융소득(이자+배당) 2,000만원 이하는 14% 원천징수로 끝, 초과분은 종합합산 후 비교과세
   (금융소득 전체×14% + 다른 소득 산출세액  vs  2,000만원×14% + 합산 산출세액 중 큰 쪽 → 그 뒤 세액공제).
   배당가산(Gross-up)·배당세액공제는 반영하지 않는다(CALC_SOURCES) */
function comprehensiveTotal(pensionAnnual, ex, age){
  const fin = (ex && ex.fin) || 0;
  const base = Object.assign({}, ex, {finExcess: 0});
  const c0 = comprehensiveCore(pensionAnnual, base, age);
  if(fin <= FIN_COMP_THRESHOLD){
    const t = Math.max(0, c0.calc - c0.credit) + Math.max(0, fin) * FIN_WITHHOLD;
    return t * LOCAL_TAX_MUL;
  }
  const c1 = comprehensiveCore(pensionAnnual, Object.assign({}, ex, {finExcess: fin - FIN_COMP_THRESHOLD}), age);
  const a = FIN_WITHHOLD * FIN_COMP_THRESHOLD + c1.calc;
  const b = FIN_WITHHOLD * fin + c0.calc;
  // 금융소득 초과분이 종합소득에 들어가므로 어느 쪽이 선택돼도 합산 기준(c1)의 세액공제를 받는다
  return Math.max(0, Math.max(a, b) - c1.credit) * LOCAL_TAX_MUL;
}

/* 연금소득 종합과세 세액(연, 지방세 포함) — 다른 종합소득이 없는 은퇴자 가정(ex를 주면 그 소득과 합산).
   ※ 국민연금은 2002년 이후 납입분만 과세되지만 그 비율을 알 수 없어 전액 과세로 본다(보수적). */
function comprehensivePensionTax(totalAnnual, age, ex){
  if(!(totalAnnual > 0) && !(ex && (ex.labor || ex.business || ex.other || ex.fin))) return 0;
  return comprehensiveTotal(totalAnnual, ex, age);
}

/* 그해 연금소득세(연, 만원) — npAnnual: 국민연금, privAnnual: 사적연금 과세분
   (연금저축·IRP의 세액공제분·운용수익 + 퇴직IRP의 이연퇴직소득 소진 후 운용수익. 과세제외금액·이연퇴직소득은 제외)
   사적연금은 1,500만원 이하면 연령별 저율 분리과세, 초과면 16.5% 분리과세 — 어느 쪽이든 종합과세가 더 싸면 종합과세 선택.
   ex(근로·사업·기타·금융소득)가 있으면 그 소득의 세금은 oth로 따로 돌려주고, np·priv는 그 위에 얹히는 증가분으로 계산한다(합계 = oth+np+priv). */
function pensionTaxes(npAnnual, privAnnual, age, ex){
  const f = pen => comprehensiveTotal(pen, ex, age);
  const t0 = f(0);
  const npOnly = f(npAnnual) - t0;
  if(!(privAnnual > 0)) return {priv:0, np:npOnly, oth:t0, method:'none'};
  const low = privAnnual <= PRIVATE_PENSION_SEP_LIMIT;
  const sepTax = privAnnual * (low ? pensionTaxRate(age)/100 : SEP_TAX_HIGH);
  const compAll = f(npAnnual + privAnnual) - f(npAnnual);
  if(compAll < sepTax) return {priv: compAll, np: npOnly, oth: t0, method:'comp'};
  return {priv: sepTax, np: npOnly, oth: t0, method: low ? 'low' : 'sep165'};
}

/* ── 건강보험 피부양자 자격 판정(소득+재산 기준) ──
   - 재산 과세표준 9억원 초과: 소득 무관 탈락 / 5.4억 초과 9억 이하: 연소득 1,000만원 초과 시 탈락 / 그 외: 2,000만원 초과 시 탈락
   - 사업소득: 사업자등록이 있으면 1원만 있어도 탈락, 없어도 연 500만원 초과면 탈락(등록 여부는 입력이 없어 경고로 안내)
   ※ 판정용 "연소득"은 반영률 감면 없이 전액 합산 — 지역가입자 보험료 산정(regionalIncomeMonthly)과 다름 */
function dependentStatusCheck(totalAnnualIncome, realEstateBase, businessIncome){
  const re = realEstateBase || 0, biz = businessIncome || 0;
  if(re > 90000) return {fail:true, reason:'재산 과세표준 9억원 초과 → 소득과 무관하게 자동 탈락', warn:''};
  if(biz > 500) return {fail:true, reason:'사업소득 연 500만원 초과(사업자등록이 없어도 탈락)', warn:''};
  if(re > 54000 && totalAnnualIncome > 1000) return {fail:true, reason:'재산 과세표준 5.4억원 초과 + 소득 연 1,000만원 초과', warn:''};
  if(re <= 54000 && totalAnnualIncome > 2000) return {fail:true, reason:'소득 연 2,000만원 초과', warn:''};
  return {fail:false, reason:'', warn: biz > 0 ? '사업자등록이 있으면 사업소득이 있는 것만으로 탈락합니다' : ''};
}

/* 건보료 산정용 소득 항목 — npMonthly를 주면 국민연금을 그 금액(예: 수령 개시 시점 명목)으로 본다 */
function healthIncomeItems(p, npMonthly, age){
  const a = age !== undefined ? age : Math.max(p.ret, p.npage || p.ret);   // 기본: 국민연금 수령 개시 시점(소득 기간 칸 반영)
  const o = otherIncomeReal(p, a);
  const pensionAnnual = (npMonthly !== undefined ? npMonthly : p.np) * 12;
  const financeIncluded = o.fin > 1000 ? o.fin : 0; // 이자+배당 1,000만원 초과 시 전액, 이하면 0
  return {pensionAnnual, laborAnnual: o.labor, businessAnnual: o.business, otherAnnual: o.other, financeIncluded};
}

// 피부양자 판정용 총소득(연) — 전 항목 100% 합산. 기준선이 명목 고정이라 국민연금(npMonthly)은 명목, 나머지 소득은 그 해 물가를 곱해 명목으로
function dependentTotalIncome(p, npMonthly, age){
  const a = age !== undefined ? age : Math.max(p.ret, p.npage || p.ret);
  const it = healthIncomeItems(p, npMonthly, a);
  const mul = Math.pow(1 + (p.inf || 0)/100, Math.max(0, a - p.age));
  return it.pensionAnnual + (it.laborAnnual + it.businessAnnual + it.otherAnnual + it.financeIncluded) * mul;
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

/* 집 1·2·3 공시가격(만원) → 합계·채수·주택 유형. 2채 이상이면 다주택('multi'), 아니면 1세대 1주택('single').
   집별 입력이 하나도 없으면 옛 단일 값(p.gongsiga)을 1채로 본다(호환). */
function houseSummary(p){
  const v = [p.gongsiga1, p.gongsiga2, p.gongsiga3].map(x => Math.max(0, +x || 0));
  const any = v.some(x => x > 0);
  const sum = any ? v.reduce((a, b) => a + b, 0) : Math.max(0, +p.gongsiga || 0);
  const count = any ? v.filter(x => x > 0).length : (sum > 0 ? 1 : 0);
  return {sum, count, type: count >= 2 ? 'multi' : 'single'};
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
function regionalIncomeMonthly(p, age){
  const it = healthIncomeItems(p, undefined, age);
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
function regionalHealthPremium(incomeMonthly, propertyMan, incomeRate){
  const score = propertyInsuranceScore(propertyMan);
  const rawIncomeWon = (incomeMonthly||0) * 10000 * (incomeRate || HEALTH_RATE_INCOME);
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

/* ── 은퇴 후 근로·사업·기타 소득(오늘 가치, 연) — 칸마다 시작~종료 나이(0·빈칸이면 은퇴~기대수명). 이자·배당은 은퇴 후 계속.
   건보료(healthPremiumYear)와 현금흐름 수입·세금(evalYear)이 같은 값을 쓴다. */
function otherIncomeReal(p, age){
  const win = (amt, from, to) => {
    if(!(amt > 0)) return 0;
    const a = from > 0 ? Math.max(from, p.ret) : p.ret, b = to > 0 ? to : (p.lifeInc || p.life);   // lifeInc: 100세 시뮬레이션에서도 소득 칸 빈 종료 나이는 원래 기대수명
    return (age >= a && age <= b) ? amt : 0;
  };
  const fin = (p.hi_interest||0) + (p.hi_dividend||0);
  return {
    labor: win(p.hi_labor, p.hi_labor_from, p.hi_labor_to),
    business: win(p.hi_business, p.hi_business_from, p.hi_business_to),
    other: win(p.hi_other, p.hi_other_from, p.hi_other_to),
    fin: age >= p.ret ? fin : 0,
  };
}

/* 국민연금 가입기간 보정 — 공단 예상액은 만 60세까지 보험료를 계속 낸다고 가정한다. 60세 전에 은퇴하고 "중단"을 고르면
   가입기간이 줄어든 만큼 연금도 줄어든다(가입기간 비례 근사 — CALC_SOURCES). 계속 납부(기본)는 보정 없음(임의가입 보험료는 evalYear에서 지출로). */
function npsMembershipFactor(p){
  const n = p.npyears;
  if(p.npcont !== 'stop' || !(n > 0) || p.ret >= NPS_FULL_AGE) return 1;
  const have = n + Math.max(0, p.ret - p.age), full = n + Math.max(0, NPS_FULL_AGE - p.age);
  if(have < NPS_MIN_YEARS) return 0;   // 가입기간 10년 미만이면 노령연금이 아니라 반환일시금 — 연금 0
  return Math.min(1, have / full);
}

/* ── 주택연금(종신지급·정액형·일반주택) 월지급금 — 한국주택금융공사 2026.3.1 기준 예시표(주택가격 1억원당, 천원 — 5억원 칸 ÷ 5) ──
   가입 나이 55~80세 구간 직선 보간(80세 초과는 80세 값 — 실제는 더 많아 보수적), 주택가격에 비례(예: 70세 3억원 = 92.3만원).
   가입 요건: 부부 중 1명 55세 이상, 공시가격 12억원 이하(월지급금은 시세·감정가 기준). 명목 고정 지급(물가연동 아님), 소득세·건보료 소득 아님. */
const HOUSING_PENSION_PER_1EOK = [[55,156],[60,210.6],[65,252.8],[70,307.8],[75,381.2],[80,483.2]];   // 5억원 예시 ÷ 5(소수 보존 — 3억 70세 = 92.3만)
function housingPensionMonthly(age, priceMan){
  if(!(age >= 55) || !(priceMan > 0)) return 0;
  const t = HOUSING_PENSION_PER_1EOK;
  let v;
  if(age >= t[t.length-1][0]) v = t[t.length-1][1];
  else { let i = 0; while(age >= t[i+1][0]) i++; v = t[i][1] + (t[i+1][1] - t[i][1]) * (age - t[i][0]) / (t[i+1][0] - t[i][0]); }
  return Math.round(v * (Math.min(priceMan, 120000) / 10000) / 10 * 10) / 10;   // 천원/억 → 만원
}
// 주택연금 가입 시 월 수령액(명목 고정, 만원) — 주택 시세 입력이 없으면 공시가격÷0.69(공시가격 현실화율)로 추정
function housingPensionOf(p){
  // 주택연금은 가입하는 1채(집1, 비었으면 첫 번째 집) 가격으로 월지급금을 구하고, 가입 요건은 보유 주택 합산 공시가격 12억 이하(다주택도 합산 기준)
  const hs = houseSummary(p);
  const list = [p.gongsiga1, p.gongsiga2, p.gongsiga3].map(x => +x || 0).filter(x => x > 0);
  const house1 = list.length ? list[0] : hs.sum;
  if(!(p.hp_age >= 55) || hs.sum > 120000) return 0;   // 합산 공시가격 12억원 초과는 가입 불가로 본다(2주택 3년 내 처분 조건 가입은 반영 안 함)
  const price = p.hp_price > 0 ? p.hp_price : (house1 > 0 ? house1 / 0.69 : 0);
  return housingPensionMonthly(p.hp_age, price);
}

// 나이별 생활비 단계: 그 나이부터 기본 생활비의 pct%. 칸을 안 쓰면(나이 0·pct 100) 전 기간 100%
function expPct(p, age){
  let pct = 100, at = -1;
  for(const i of [1,2]){
    const a = p['exp_s'+i+'_age'], v = p['exp_s'+i+'_pct'];
    if(a > 0 && v > 0 && age >= a && a > at){ pct = v; at = a; }   // 입력 순서와 무관하게 "그 나이 이하 중 가장 늦은 단계"
  }
  return pct / 100;
}
// 일시 지출(오늘 가치 만원, 나이별 최대 3건) — 은퇴 후 그 나이의 한 해에 쓰는 총액(명목)
function lumpsAt(p, age, infMul){
  let t = 0;
  for(const i of [1,2,3]) if(p['lump'+i+'_age'] === age && p['lump'+i+'_amt'] > 0) t += p['lump'+i+'_amt'] * infMul;
  return t;
}

/* ── 은퇴 후 그해 건보료(명목, 만원/연) — 현금흐름 세후에서 세금과 함께 차감 ──
   은퇴 전은 직장가입자(급여에서 공제)라 0. 은퇴 후는 지역가입자로 보고 2026 요율·등급표를 "오늘 가치"에 적용한 뒤
   그해 물가(infMul)를 곱한다 — 국민연금은 물가연동이라 수령 후 건보료는 오늘 가치로 일정하다.
   소득: 국민연금(그해 실제 수령분)·근로 50%, 사업·기타 100%, 이자+배당은 합계 1,000만원 초과 시 전액(칸마다 해당 기간만).
   재산: 재산세 과세표준 + 전월세 인정액(현재값 고정). 사적연금·ISA 인출은 2026 현행 부과 대상이 아니다.
   p.hi_dep==='yes'(피부양자 등록 가능한 직장가입자 가족 있음)이면 그해 명목 소득으로 피부양자 판정을 해 통과한 해는 0.
   p.hi_vol==='yes'(임의계속가입 신청)이면 은퇴 후 36개월은 min(지역가입자 보험료, 임의계속 보험료) — 임의계속 보험료는
   p.hi_volprem(월, 퇴직 직전 보수월액 기준 건강보험료+장기요양 전액, 오늘 가치)을 퇴직 시점 물가로 환산해 36개월 고정(재산 미반영).
   infRate: 물가상승률(%) — 임의계속 고정액의 퇴직 시점 환산에 쓴다. */
function healthPremiumYear(p, age, npRealMonthly, infMul, infRate, extraFinNominal){
  if(age < p.ret) return {annual:0, monthlyReal:0, dependent:false, volContinued:false};
  const npAnnual = (npRealMonthly||0) * 12;
  const o = otherIncomeReal(p, age);
  const xf = (extraFinNominal || 0) / infMul;                  // 일반계좌 국내상장 해외ETF 실현이익(오늘 가치로 환산)
  const finIncl = (o.fin + xf) * infMul > 1000 ? o.fin + xf : 0;   // 1,000만원 기준선은 명목 고정
  const labor = o.labor, biz = o.business, other = o.other;
  if(p.hi_dep === 'yes'){
    const nominalIncome = (npAnnual + labor + biz + other + finIncl) * infMul;  // 기준선(2,000/1,000만원)은 명목 고정
    if(!dependentStatusCheck(nominalIncome, p.realestate||0, biz * infMul).fail) return {annual:0, monthlyReal:0, dependent:true, volContinued:false};
  }
  const incomeMonthly = (npAnnual*0.5 + labor*0.5 + biz + other + finIncl) / 12;
  const monthlyReal = regionalHealthPremium(incomeMonthly, totalPropertyBase(p), p.hiRate).total;   // p.hiRate: 위기 점검용 소득 보험료율 덮어쓰기
  const regionalAnnual = monthlyReal * 12 * infMul;
  if(p.hi_vol === 'yes' && p.hi_volprem > 0 && age < p.ret + VOL_HEALTH_MONTHS/12){
    const volAnnual = p.hi_volprem * 12 * Math.pow(1 + (infRate||0)/100, p.ret - p.age);   // 퇴직 시점 명목 고정액
    if(volAnnual < regionalAnnual) return {annual: volAnnual, monthlyReal: volAnnual / 12 / infMul, dependent:false, volContinued:true};
  }
  return {annual: regionalAnnual, monthlyReal, dependent:false, volContinued:false};
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

/* 55세 전 가교 인출: 은퇴가 만 55세보다 이르면, 연금저축을 연금으로 받을 수 없는 은퇴~54세 동안 비과세 원금 T에서
   명목 정액을 같은 계좌 잔액에서 뺀다(과세제외금액은 언제 빼도 세금이 없다). 금액은 T ÷ (공백기 개월 수).
   55세 이후에는 추가 인출을 하지 않는다 — 법정 순서상 어차피 연금 인출액에서 먼저 비과세로 빠지므로
   일부러 앞당기면 공백기에만 돈이 몰린다(2026-10-04 2차 점검에서 공백기 쏠림의 주원인으로 확인돼 제거). */
function bridgeExtraMonthly(T, p){
  const years = Math.max(0, Math.min(55, p.life + 1) - p.ret);
  if(years <= 0) return {nh:0, mf:0, years:0};
  const spread = Math.max(p.npage - p.ret, years);
  return {nh: Math.round(T.nh / (spread*12)), mf: Math.round(T.mf / (spread*12)), years};
}

/* 연금수령한도(소득세법 시행령 40조의2): 연금수령연차 1~10년차는 연초 평가액 ÷ (11 − 연차) × 120%까지만 "연금수령",
   넘는 금액은 연금외수령이다. 연차 11년 이상은 한도가 없고, 수령 요건(만 55세) 전은 전액 연금외수령(한도 0).
   연차는 최초로 연금수령할 수 있는 해를 1년차로 센다 — 연금저축·IRP는 55세(가입 5년 경과 가정, 2013.3 이전 가입
   6년차 기산 특례는 반영하지 않아 보수적), 퇴직IRP는 max(은퇴, 55)세(이연퇴직소득은 5년 요건 면제). */
const PENSION_LIMIT_YEARS = 10;
function pensionLimitAnnual(balanceAtYearStart, withdrawalYear){
  if(withdrawalYear < 1) return 0;
  if(withdrawalYear > PENSION_LIMIT_YEARS) return Infinity;
  return balanceAtYearStart / (11 - withdrawalYear) * 1.2;
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
/* ── 일반계좌(세금이 다른 3칸) ──
   ov(해외주식: 양도세 22%·연 250만 공제, 건보료 무관) / etf(국내상장 해외ETF: 매매차익 15.4% 배당소득 → 금융소득 합산)
   / kr(국내주식·ETF·현금: 비과세 근사). 칸마다 평가액(bal)과 원가(cost)를 따로 굴린다. 입력의 "수익률"은 현재 평가손익률(원가 환산용). */
function genInit(p){
  const mk = (ev, rtn) => {
    ev = Math.max(0, ev || 0);
    const rr = Number.isFinite(rtn) ? Math.max(-90, rtn) : 0;   // 수익률을 안 넣으면 0%(원가 = 평가액)
    return {bal: ev, cost: ev > 0 ? ev / (1 + rr / 100) : 0};
  };
  return {ov: mk(p.gen_ov, p.gen_ovr), etf: mk(p.gen_etf, p.gen_etfr), kr: {bal: Math.max(0, p.gen_kr || 0), cost: Math.max(0, p.gen_kr || 0)}};
}
const genSum = g => g.ov.bal + g.etf.bal + g.kr.bal;
const genClone = g => ({ov: Object.assign({}, g.ov), etf: Object.assign({}, g.etf), kr: Object.assign({}, g.kr)});
// 250만 공제 활용(해마다 공제 한도만큼 이익 실현 후 재매수 → 원가 상향, 세금 0)
function genHarvest(g, usedGain){
  const unreal = Math.max(0, g.ov.bal - g.ov.cost);
  const h = Math.min(unreal, Math.max(0, GEN_OV_DEDUCT - (usedGain || 0)));
  g.ov.cost += h;
  return h;
}
// 인출 없이 years년 굴린다(적립기). harvest면 해마다 250만 공제 활용
function genGrow(g0, rate, years, harvest){
  const g = genClone(g0), f = growYears(rate, 1);
  for(let y = 0; y < years; y++){
    g.ov.bal *= f; g.etf.bal *= f; g.kr.bal *= f;
    if(harvest) genHarvest(g, 0);
  }
  return g;
}
/* 한 해 일반계좌: paidGen(연 인출, stepBalanceDetail 결과)·balNext(그 합계 잔액)를 칸에 나눈다.
   세금 적은 순: 해외주식(그해 이익 250만 공제 이내) → 국내·현금 → 국내상장 해외ETF → 해외주식(과세). 칸 비율로 원가도 줄인다(평균원가 근사). */
function genYear(g0, paidGen, balNext, rate, harvest){
  const f = growYears(rate, 1), B = genSum(g0);
  const bg = {ov: g0.ov.bal * f, etf: g0.etf.bal * f, kr: g0.kr.bal * f};
  const ratio = (k) => bg[k] > 0 ? Math.max(0, 1 - g0[k].cost / bg[k]) : 0;
  const take = {ov: 0, etf: 0, kr: 0};
  let rest = paidGen;
  const ovFree = ratio('ov') > 0 ? Math.min(bg.ov, GEN_OV_DEDUCT / ratio('ov')) : bg.ov;
  let a = Math.min(rest, ovFree); take.ov += a; rest -= a;
  a = Math.min(rest, bg.kr); take.kr += a; rest -= a;
  a = Math.min(rest, bg.etf); take.etf += a; rest -= a;
  a = Math.min(rest, bg.ov - take.ov); take.ov += a; rest -= a;
  // 한 해 합계 잔액(balNext, 월중 인출·복리 반영)에 맞춰 칸별 남은 평가액을 비례 배분 — 돈이 생기거나 사라지지 않게 하고, 원가도 평가액과 같은 비율로 줄인다
  const rem = {}; let remSum = 0;
  for(const k of ['ov','etf','kr']){ rem[k] = Math.max(0, bg[k] - take[k]); remSum += rem[k]; }
  const scale = remSum > 0 ? Math.max(0, balNext) / remSum : 0;
  const next = {};
  for(const k of ['ov','etf','kr']){
    const left = rem[k] * scale;
    next[k] = {bal: left, cost: bg[k] > 0 ? g0[k].cost * (left / bg[k]) : 0};
    if(k === 'kr') next[k].cost = next[k].bal;   // 국내·현금은 원가 = 평가액(이익 없음)
  }
  const ovGain = take.ov * ratio('ov'), etfGain = take.etf * ratio('etf');
  const ovTax = Math.max(0, ovGain - GEN_OV_DEDUCT) * GEN_OV_TAX;
  if(harvest) genHarvest(next, Math.min(ovGain, GEN_OV_DEDUCT));
  return {next, ovGain, etfGain, ovTax, take};
}

function accumulate(p, adj, retAge){
  const end = retAge === undefined ? p.ret : retAge;
  const r = scenarioRates(p, adj);
  const w = accWindows(p);
  const isa = calcISA_Detail(p.isa||0, p.isay||0, p.age, w.isa[0], w.isa[1], end, r.isa, 'isa', p.isaymon);
  const genG = genGrow(genInit(p), r.gen, Math.max(0, end - p.age), p.gen_harvest === 'yes');
  return {
    genG, genFV: genSum(genG),
    nhFV:   calcMonthlyDepositFV(p.nh||0, p.nhm||0, w.nh[0], w.nh[1], p.age, end, r.nh),
    mfFV:   calcMonthlyDepositFV(p.mf||0, p.mfm||0, w.mf[0], w.mf[1], p.age, end, r.mf),
    irpFV:  calcISA_FV(p.irp||0,  p.irpy||0, p.age, w.irp[0], w.irp[1], end, r.irp,  undefined, p.irpymon),
    tirpFV: calcISA_FV(p.tirp||0, p.tdc||0,  p.age, w.dc[0],  w.dc[1],  end, r.tirp, undefined, p.tdcymon),
    isaFV: isa.bal, isaPrin: isa.principal, isaCapHitAge: isa.capHitAge,
  };
}

/* ── 은퇴 후 한 해 계산(순수 함수) ── simulate()의 연도 루프 본문. 상태(st)를 바꾸지 않고 결과와 다음 해 상태(next)만 돌려준다
   — 필요분만 인출처럼 같은 해를 여러 번 평가해야 할 때도 정확하다.
   plan: 계좌별 그해 월 인출액(명목, 잔액 상한 적용 전). 처리 순서:
   ① 잔액 진행(실제로 빠진 금액 paid 기준) ② 법정 인출순서로 과세 구분: 과세제외금액(안세공) → 이연퇴직소득 → 세액공제분·운용수익
   ③ 연금수령한도 초과분은 법정 순서상 마지막 재원부터 연금외수령 ④ 세금 ⑤ ISA 해지 과세 ⑥ 건보료(인출액과 무관) */
function evalYear(st, plan, ctx, age){
  const {p, r, tirpTaxRate, isaFV, isaPrin} = ctx;
  const ACCTS = ['nh','mf','irp','tirp','isa'];
  const step = {}, paid = {};
  for(const k of ACCTS){ step[k] = stepBalanceDetail(st.bal[k], r[k], cappedOut(st.bal[k], plan[k])); paid[k] = step[k].paid; }
  // 일반계좌: 합계로 한 해를 굴린 뒤 세금 적은 순으로 칸에 나눈다
  const genB = st.gen ? genSum(st.gen) : 0;
  const gStep = stepBalanceDetail(genB, r.gen, cappedOut(genB, plan.gen || 0));
  paid.gen = gStep.paid;
  const gy = st.gen ? genYear(st.gen, gStep.paid, gStep.bal, r.gen, p.gen_harvest === 'yes') : {next: null, ovGain: 0, etfGain: 0, ovTax: 0};

  const firstEligible = {nh:55, mf:55, irp:55, tirp:Math.max(p.ret, 55)};
  const limit = k => pensionLimitAnnual(st.bal[k], age - firstEligible[k] + 1);

  // 연금저축·IRP: 과세제외금액 먼저, 나머지는 과세분. 한도 초과분은 뒤쪽(과세분)부터 연금외수령
  const free = {}, taxWithin = {}, taxOver = {}, nextT = Object.assign({}, st.T);
  let overLimitAnnual = 0;
  for(const k of ['nh','mf','irp']){
    free[k] = Math.min(paid[k], st.T[k]);
    nextT[k] = st.T[k] - free[k];
    const taxable = paid[k] - free[k];
    const excess = Math.max(0, paid[k] - limit(k));
    taxOver[k] = Math.min(taxable, excess);
    taxWithin[k] = taxable - taxOver[k];
    overLimitAnnual += excess;
  }
  // 퇴직IRP: 이연퇴직소득 먼저, 다 쓴 뒤는 운용수익. 한도 초과분은 운용수익 → 이연퇴직소득 순으로 연금외수령
  const tirpDef = Math.min(paid.tirp, st.tirpDeferred);
  const tirpGain = paid.tirp - tirpDef;
  const tirpExcess = Math.max(0, paid.tirp - limit('tirp'));
  const gainOver = Math.min(tirpGain, tirpExcess);
  const defOver = Math.min(tirpDef, tirpExcess - gainOver);
  overLimitAnnual += tirpExcess;

  // 사적연금 과세분(연금수령분만 1,500만원 판정) / 연금외수령분(16.5% 기타소득, 분리과세)
  const privTaxableA = taxWithin.nh + taxWithin.mf + taxWithin.irp + (tirpGain - gainOver);
  const otherA = taxOver.nh + taxOver.mf + taxOver.irp + gainOver;
  const npInc = age >= p.npage ? Math.round(p.np * Math.pow(1 + r.inf/100, age - p.age)) : 0; // 국민연금: 현재가치 입력 → 매년 물가연동
  // 은퇴 후 근로·사업·기타 소득과 이자·배당(명목) — 수입에 더하고, 연금소득과 합산해 종합과세(금융소득은 2,000만원 기준)
  const infMulY = Math.pow(1 + r.inf/100, age - p.age);
  const oR = otherIncomeReal(p, age);
  const ex = {labor: oR.labor*infMulY, business: oR.business*infMulY, other: oR.other*infMulY, fin: oR.fin*infMulY};
  const othA = ex.labor + ex.business + ex.other + ex.fin;
  const exT = gy.etfGain > 0 ? Object.assign({}, ex, {fin: ex.fin + gy.etfGain}) : ex;   // 국내상장 해외ETF 매매차익은 금융소득(이자·배당)으로 합산
  const pt = pensionTaxes(npInc*12, privTaxableA, age, (othA > 0 || gy.etfGain > 0) ? exT : undefined);
  // 퇴직소득세 감면 연차는 실제로 처음 받은 해부터(p.tage가 은퇴보다 앞이어도 은퇴 전에는 못 받음)
  const tirpFirstAge = st.tirpFirstAge !== null ? st.tirpFirstAge : (paid.tirp > 0 ? age : null);
  const tirpYear = tirpFirstAge === null ? 1 : age - tirpFirstAge + 1;
  const tirpTaxA = (tirpDef - defOver) * tirpTaxRate * (1 - tirpTaxDiscount(tirpYear)) + defOver * tirpTaxRate;
  const otherTaxA = otherA * SEP_TAX_HIGH;

  // ISA 해지 과세: 원금을 다 인출한 해에 전 기간 순이익 기준으로 한 번 — 계좌에서 차감(세후 계산에 다시 넣지 않음)
  let isaBal = step.isa.bal, isaTax = 0, isaTaxFromIncome = 0, isaClosed = st.isaClosed;
  const isaCum = st.isaCum + paid.isa;
  if(!isaClosed && isaFV > 0 && paid.isa > 0 && isaCum >= isaPrin){
    isaClosed = true;
    isaTax = isaClosingTax(isaCum + isaBal - isaPrin);
    const fromBal = Math.min(isaBal, isaTax);
    isaBal -= fromBal;
    isaTaxFromIncome = isaTax - fromBal; // 잔액이 모자라면 그해 인출액에서 부담
  }

  // 60세 전 은퇴 + "계속 납부"면 국민연금 임의가입 보험료(오늘 가치 월 금액 × 물가)를 만 60세 전까지 낸다
  const npPremA = (p.npcont !== 'stop' && p.np_volprem > 0 && age >= p.ret && age < NPS_FULL_AGE) ? p.np_volprem * 12 * infMulY : 0;
  const hpA = age >= p.hp_age ? housingPensionOf(p) * 12 : 0;   // 주택연금(명목 고정·비과세)
  const grossA = paid.nh + paid.mf + paid.irp + paid.tirp + paid.isa + paid.gen + npInc*12 + othA + hpA;
  const taxA = pt.priv + pt.np + (pt.oth||0) + tirpTaxA + otherTaxA + isaTaxFromIncome + gy.ovTax;
  // 경고용: 한도를 넘어 실제로 세금이 무거워진 금액(55세 전 비과세 원금 가교 인출처럼 세금 없는 연금외수령은 제외)
  const taxedOverA = otherA + defOver;
  // 건보료: 사적연금·ISA는 부과 대상이 아니라 인출 계획과 무관 — 국민연금(오늘 가치 일정)·소득·지출 탭 소득·재산, 그리고 일반계좌 해외ETF 실현이익(금융소득)으로 정해진다
  const hiR = healthPremiumYear(p, age, age >= p.npage ? p.np : 0, infMulY, r.inf, gy.etfGain);
  const hiA = hiR.annual;
  return {
    paid, free, npInc, pt, tirpDef, privTaxableA, otherA, otherTaxA, tirpTaxA, overLimitAnnual, taxedOverA,
    othA, ex, npPremA, hpA, hiVol: hiR.volContinued, genOvTax: gy.ovTax, genTaxA: gy.ovTax + gy.etfGain * 0.154, genOvGain: gy.ovGain, genEtfGain: gy.etfGain,
    isaTax, isaTaxFromIncome, grossA, taxA, hiA, netA: Math.max(0, grossA - taxA - hiA - npPremA),
    next: {
      bal: {nh:step.nh.bal, mf:step.mf.bal, irp:step.irp.bal, tirp:step.tirp.bal, isa:isaBal, gen: gy.next ? genSum(gy.next) : 0},
      gen: gy.next, T: nextT, tirpDeferred: st.tirpDeferred - tirpDef, isaCum, isaClosed, tirpFirstAge,
    },
  };
}

/* ── 은퇴 후 연도별 시뮬레이션 ──
   세후 = 총수령 − 세금 − 건보료(지역가입자, healthPremiumYear).
   opts.needOnly: 그해 세후 소득이 생활비를 넘으면 사적 인출(국민연금 제외)을 같은 비율로 줄여 세후 ≈ 생활비로 맞춤.
   사적연금 1,500만원은 인출 상한이 아니라 세율 경계 — 넘는 해에도 인출은 계획대로 하고 세금만 달라진다.
   반환값의 phase(공백기/완성기)·min/maxNetReal·shortNet*은 "오늘 기준(물가 환산)" 값 — 생활비 입력과 같은 단위. */
function simulate(p, adj, opts){
  adj = adj || SA.base; opts = opts || {};
  // 플랜 모드 'need'(필요한 만큼만 인출): 세후가 생활비를 넘는 해엔 사적 인출을 줄여 생활비에 맞춘다(옵션으로 따로 주면 그 값이 우선)
  if(opts.needOnly === undefined && p.plan_mode === 'need') opts = Object.assign({}, opts, {needOnly: true});
  const r = scenarioRates(p, adj);
  const infR = r.inf;
  const yrs = Math.max(0, p.ret - p.age);
  const acc = accumulate(p, adj);
  const {nhFV, mfFV, irpFV, tirpFV, isaFV, isaPrin, genFV} = acc;
  const totalFV = nhFV + mfFV + irpFV + tirpFV + isaFV + genFV;

  const T = taxFreeBases(p);                // 비과세 원금(명목 고정) — 계좌별 인출액에서 먼저 차감
  const extra = bridgeExtraMonthly(T, p);   // 55세 전 가교 인출(은퇴가 55세보다 이를 때만)
  // 이연퇴직소득 = 은퇴 시점 DC 평가액. 퇴직소득세(지방세 포함)를 그 금액에 대한 비율로 안분
  // 낙관·비관 시나리오는 은퇴 시점 DC 평가액(tirpFV)이 달라지므로 자동값이면 그 평가액으로 퇴직소득세를 다시 계산한다
  // (예전엔 기본 시나리오의 세액이 그대로 쓰여 낙관은 세금이 적게, 비관은 많게 잡혔다). 직접 입력한 값은 그대로 쓴다.
  const tirpTaxInput = (!p.tirptaxManual && adj !== SA.base)
    ? calcRetirementIncomeTax(tirpFV, (p.tservice||0) + Math.max(0, p.ret - p.age))
    : (p.tirptax||0);
  const tirpTaxRate = tirpFV > 0 ? tirpTaxInput * LOCAL_TAX_MUL / tirpFV : 0;
  const ctx = {p: opts.hiRate > 0 ? Object.assign({}, p, {hiRate: opts.hiRate}) : p, r, tirpTaxRate, isaFV, isaPrin};

  let st = {bal:{nh:nhFV, mf:mfFV, irp:irpFV, tirp:tirpFV, isa:isaFV, gen:genFV}, gen:genClone(acc.genG), T:{nh:T.nh, mf:T.mf, irp:T.irp},
            tirpDeferred:tirpFV, isaCum:0, isaClosed:false, tirpFirstAge:null};
  // opts.retShock(0<x<1): 은퇴 시점 계좌 평가액이 그 비율로 줄어든 상황(위기 점검 "은퇴 직후 폭락") — 인출 계획은 그대로
  if(opts.retShock > 0 && opts.retShock < 1){
    for(const k in st.bal) st.bal[k] *= opts.retShock;
    st.tirpDeferred *= opts.retShock;
    for(const k of ['ov','etf','kr']) st.gen[k].bal *= opts.retShock;   // 원가는 그대로(평가이익이 줄어듦)
  }
  const expAtRet = Math.round(p.exp * Math.pow(1 + infR/100, yrs));
  let runway = p.life, isaTaxPaid = 0, isaCloseAge = null, prinExhaustAge = null;
  let lifetimeGenTax = 0;
  let lifetimeTax = 0, lifetimeHi = 0, lifetimeNetReal = 0, maxPrivAnnual = 0, maxPrivAge = null, firstOverPlimitAge = null, firstOverLawAge = null, overPlimitYears = 0;
  let overLimitYears = 0, firstOverLimitAge = null, overLimitTotal = 0;
  const rows = [];
  const ph = {gap:{n:0, gross:0, net:0, grossNom:0, netNom:0}, full:{n:0, gross:0, net:0, grossNom:0, netNom:0}};

  for(let age=p.ret; age<=p.life; age++){
    const infMul = Math.pow(1+infR/100, age - p.age);
    const lumpM = lumpsAt(p, age, infMul) / 12;   // 일시 지출을 12개월로 나눈 월 환산(명목)
    const curExp = Math.round(expAtRet * Math.pow(1+infR/100, age - p.ret) * expPct(p, age) + lumpM);
    const inBridge = age < 55;
    // 계좌별 그해 계획 월 인출액(명목) — 계획 수령액(오늘 기준×물가) + 55세 전 비과세 원금 가교 인출
    const plan = {
      nh:   (age>=p.nhage  ? Math.round(p.nhpay*infMul)  : 0) + (inBridge ? extra.nh : 0),
      mf:   (age>=p.mfage && !(p.mfpayend > 0 && age > p.mfpayend) ? Math.round(p.mfpay*infMul)  : 0) + (inBridge ? extra.mf : 0),
      irp:   age>=p.irpage ? Math.round(p.irppay*infMul) : 0,
      tirp:  age>=p.tage   ? Math.round(p.tm*infMul)     : 0,
      isa:   age>=p.isaage ? Math.round(p.isam*infMul)   : 0,
      gen:   (p.genage > 0 && age>=p.genage && !(p.genpayend > 0 && age > p.genpayend)) ? Math.round((p.genpay||0)*infMul) : 0,
    };
    // opts.path(연 수익률 변동 %p 배열, 은퇴 후 해마다): 몬테카를로용 — 전 계좌 수익률에 같은 충격을 더한다
    if(opts.path){ const d = opts.path[age - p.ret] || 0; ctx.r = {nh:r.nh+d, mf:r.mf+d, irp:r.irp+d, tirp:r.tirp+d, isa:r.isa+d, gen:r.gen+d, inf:r.inf}; }
    // 일시 지출은 개인연금 농협(없으면 인출 가능한 만큼)에서 그해 월 인출에 얹어 낸다 — 세금은 evalYear가 같은 규칙으로 계산
    const mk = pl => lumpM > 0 ? withLump(st, pl, lumpM, ctx, age) : pl;
    let y = evalYear(st, mk(plan), ctx, age);
    if(opts.needOnly && y.netA/12 > curExp){
      // 세후가 생활비를 넘는 만큼만 사적 인출을 줄임: 세후(s) ≥ 생활비인 가장 작은 비율 s를 이분 탐색
      let lo = 0, hi = 1;
      for(let i=0; i<16; i++){
        const mid = (lo+hi)/2, scaled = {};
        for(const k in plan) scaled[k] = plan[k]*mid;
        if(evalYear(st, mk(scaled), ctx, age).netA/12 >= curExp + NEED_MARGIN) hi = mid; else lo = mid;   // 표시 반올림(±1.5)에 걸려 "미달"로 보이지 않게 여유
      }
      const scaled = {};
      for(const k in plan) scaled[k] = plan[k]*hi;
      y = evalYear(st, mk(scaled), ctx, age);
    }
    st = y.next;

    if(prinExhaustAge === null && T.nh + T.mf + T.irp > 0 && st.T.nh + st.T.mf + st.T.irp <= 1e-9) prinExhaustAge = age;
    if(y.isaTax > 0){ isaTaxPaid += y.isaTax; isaCloseAge = age; }

    // 화면 표시용 월 금액: 비과세 분류액은 "안세공" 막대로 분리, 계좌 막대는 과세분 — 합계는 인출액 그대로(중복 없음)
    const nhW = Math.round(y.paid.nh/12), mfW = Math.round(y.paid.mf/12), irpW = Math.round(y.paid.irp/12);
    const tirpW = Math.round(y.paid.tirp/12), isaW = Math.round(y.paid.isa/12), genW = Math.round(y.paid.gen/12);
    const prinNh = Math.min(nhW, Math.round(y.free.nh/12)), prinMf = Math.min(mfW, Math.round(y.free.mf/12)), prinIrp = Math.min(irpW, Math.round(y.free.irp/12));
    const othW = Math.round(y.othA/12), npPremW = Math.round(y.npPremA/12), hpW = Math.round(y.hpA/12);
    const totalInc = nhW + mfW + irpW + y.npInc + tirpW + isaW + othW + hpW + genW;
    const taxTotal = Math.round(y.taxA/12);
    const hiM = Math.round(y.hiA/12);
    const netInc = Math.max(0, totalInc - taxTotal - hiM - npPremW);
    lifetimeTax += y.pt.priv + y.pt.np + (y.pt.oth||0) + y.tirpTaxA + y.otherTaxA + y.isaTax + y.genOvTax;
    lifetimeGenTax += y.genTaxA;
    lifetimeHi += y.hiA;
    lifetimeNetReal += netInc * 12 / infMul;

    if(y.privTaxableA > maxPrivAnnual){ maxPrivAnnual = y.privTaxableA; maxPrivAge = age; }
    if(y.privTaxableA > p.plimit){ overPlimitYears++; if(firstOverPlimitAge === null) firstOverPlimitAge = age; }
    if(y.privTaxableA > PRIVATE_PENSION_SEP_LIMIT && firstOverLawAge === null) firstOverLawAge = age;
    if(y.taxedOverA > 0.5){ overLimitYears++; overLimitTotal += y.taxedOverA; if(firstOverLimitAge === null) firstOverLimitAge = age; }

    const b = st.bal;
    if(b.nh + b.mf + b.irp + b.tirp + b.isa + b.gen <= 0 && runway === p.life) runway = age;

    const g = age < p.npage ? ph.gap : ph.full;
    g.n++; g.gross += totalInc/infMul; g.net += netInc/infMul; g.grossNom += totalInc; g.netNom += netInc;

    rows.push({
      age, label: age+'세', infMul,
      nhInc: nhW - prinNh, mfInc: mfW - prinMf, irpInc: irpW - prinIrp, privInc: Math.round(y.privTaxableA/12),
      npInc: y.npInc, tirpInc: tirpW, isaInc: isaW, genInc: genW, prinInc: prinNh + prinMf + prinIrp, othInc: othW, hpInc: hpW, npPrem: npPremW, lumpM: Math.round(lumpM), pct: expPct(p, age), totalInc, curExp,
      taxPriv: Math.round(y.pt.priv/12), taxNp: Math.round(y.pt.np/12), taxOth: Math.round((y.pt.oth||0)/12), hiVol: y.hiVol, taxTirp: Math.round(y.tirpTaxA/12),
      taxOther: Math.round(y.otherTaxA/12), taxTotal, hi: hiM, taxMethod: y.pt.method, isaTax: Math.round(y.isaTax), netInc,
      realTotal: totalInc/infMul, realNet: netInc/infMul, realEq: Math.max(0, netInc - lumpM) / infMul / expPct(p, age),
      privTaxableAnnual: y.privTaxableA, otherAnnual: y.otherA, overLimitAnnual: y.overLimitAnnual, taxedOverAnnual: y.taxedOverA,
      gross: y.paid,                                        // 연간 실제 인출액
      freeAnnual: y.free, tirpDeferredAnnual: y.tirpDef,
      bal: b,
      privB: Math.round((b.nh+b.mf+b.irp)/10000*10)/10,
      nhB_억: Math.round(b.nh/10000*10)/10,
      mfB_억: Math.round(b.mf/10000*10)/10,
      irpB_억: Math.round(b.irp/10000*10)/10,
      tirpB: Math.round(b.tirp/10000*10)/10,
      isaB:  Math.round(b.isa/10000*10)/10,
      genB:  Math.round(b.gen/10000*10)/10,
    });
  }

  const avg = (o, k) => o.n ? Math.round(o[k]/o.n) : 0;
  const firstGapRow = rows.find(x => x.age === p.ret) || rows[0];
  const last = rows[rows.length-1];
  const shortRows = rows.filter(x => x.netInc < x.curExp);
  return {
    nhFV, mfFV, irpFV, tirpFV, isaFV, genFV, isaPrin, isaCapHitAge: acc.isaCapHitAge, totalFV, lifetimeGenTax: Math.round(lifetimeGenTax),
    // 명목 평균(차트·참고용)
    gapMonthly: avg(ph.gap,'grossNom'), fullMonthly: avg(ph.full,'grossNom'),
    netGapMonthly: avg(ph.gap,'netNom'), netFullMonthly: avg(ph.full,'netNom'),
    // 오늘 기준(물가 환산) 평균 — 생활비 입력과 같은 단위
    phase: {gap:{years:ph.gap.n, gross:avg(ph.gap,'gross'), net:avg(ph.gap,'net')},
            full:{years:ph.full.n, gross:avg(ph.full,'gross'), net:avg(ph.full,'net')}},
    minNetReal: rows.length ? Math.min(...rows.map(x => x.realNet)) : 0,
    maxNetReal: rows.length ? Math.max(...rows.map(x => x.realNet)) : 0,
    // 생활비 단계(나이별 비율)를 반영한 값 = 세후 ÷ 그해 생활비 비율. 단계를 안 쓰면 minNetReal/maxNetReal과 같다 — 자동설계·부족 대책이 쓴다
    minNetEq: rows.length ? Math.min(...rows.map(x => x.realEq)) : 0,
    maxNetEq: rows.length ? Math.max(...rows.map(x => x.realEq)) : 0,
    shortNetYears: shortRows.length, firstShortNetAge: shortRows.length ? shortRows[0].age : null,
    privAnnual: firstGapRow ? Math.round(firstGapRow.privTaxableAnnual) : 0,
    maxPrivAnnual: Math.round(maxPrivAnnual), maxPrivAge, firstOverPlimitAge, firstOverLawAge, overPlimitYears,
    overLimitYears, firstOverLimitAge, overLimitTotal: Math.round(overLimitTotal),
    lifetimeTax, lifetimeHi, lifetimeNetReal, isaTaxPaid, isaCloseAge, prinExhaustAge, taxFree: T, extra, tirpTaxRate,
    leftover: last ? last.bal.nh + last.bal.mf + last.bal.irp + last.bal.tirp + last.bal.isa + (last.bal.gen || 0) : 0,
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
  let prevTotal = (p.nh||0)+(p.mf||0)+(p.irp||0)+(p.tirp||0)+(p.isa||0)+genSum(genInit(p));
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
    const total = a.nhFV + a.mfFV + a.irpFV + a.tirpFV + a.isaFV + a.genFV;
    rows.push({
      age, label:age+'세', phase:'acc', yearsLeft:p.ret-age, dep,
      nhDep:dep.nh, mfDep:dep.mf, irpDep:Math.round(dep.irp/12), isaDep:Math.round(dep.isa/12), dcDep:Math.round(dep.dc/12),
      depYearTotal, depMonthTotal:Math.round(depYearTotal/12),
      gain: Math.round(total - prevTotal - depYearTotal),
      totalB: r1(total),
      privB: r1(a.nhFV+a.mfFV+a.irpFV), nhB_억:r1(a.nhFV), mfB_억:r1(a.mfFV), irpB_억:r1(a.irpFV),
      tirpB: r1(a.tirpFV), isaB: r1(a.isaFV), genB: r1(a.genFV),
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

/* 일시 지출(월 환산 lumpM, 명목)을 그해 인출에 얹는다 — 인출에 붙는 세금을 더해(세후 증가분 = lumpM이 되도록 이분 탐색)
   일반계좌 → 개인연금 농협 → 미래에셋 → ISA 순으로 잔액이 허락하는 만큼 채우고, 남는 몫은 농협에 얹는다(잔액이 모자라면 그 해 생활비 미달로 드러남). */
function withLump(st, pl, lumpM, ctx, age){
  const cap = k => Math.max(0, ((st.bal[k] || 0) - (pl[k] || 0)*12) / 12);
  const alloc = e => {
    const out = Object.assign({gen: 0}, pl); let rest = e;
    for(const k of ['gen','nh','mf','isa']){ const t = Math.min(rest, cap(k)); out[k] += t; rest -= t; }
    out.nh += rest;
    return out;
  };
  const base = evalYear(st, pl, ctx, age).netA / 12;
  let lo = lumpM, hi = lumpM * 3;
  if(evalYear(st, alloc(hi), ctx, age).netA / 12 - base < lumpM) return alloc(hi);
  for(let i = 0; i < 22; i++){
    const mid = (lo + hi) / 2;
    if(evalYear(st, alloc(mid), ctx, age).netA / 12 - base >= lumpM) hi = mid; else lo = mid;
  }
  return alloc(hi);
}

/* ── 자동설계(순수 계산) — 생활비 평탄화 ──
   모든 계좌는 정한 구간 끝에 정확히 0원이 되도록 매년 물가만큼 늘려 인출한다(Growing Annuity).
   고정 규칙: 농협 55세(또는 은퇴)~기대수명, IRP 개인 국민연금 개시~기대수명(공백기 없으면 55세/은퇴부터),
             ISA 은퇴부터, 미래에셋 55세(또는 은퇴)부터, 55세 전 은퇴면 비과세 원금 가교 인출.
   탐색 변수: 퇴직IRP 개시 나이(tage), ISA 소진 나이(isaEnd), 미래에셋 소진 나이(mfEnd), 일반계좌 소진 나이(genEnd, 일반계좌가 있을 때).
   목표: ① 기대수명까지 자산 유지 ② 해마다 "세후·오늘 기준" 소득 중 가장 적은 해를 가장 크게(2% 넘게 좋아질 때만 채택)
        ③ 생애 세금+건보료(명목 합)가 적게 ④ 최고−최저 폭이 작게 — 순서대로 비교. 후보별 월 수령액은 미리 계산해 두고 좌표하강으로 찾는다.
   (최저치는 여러 조합에서 거의 같게 나와 1만원 차이로 고르면 미래에셋을 90세까지 늘려 공백기를 깎고 세금이 수천만원 느는
    조합이 뽑혔다 — 의미 있는 차이(2%)가 아니면 세금이 적은 쪽을 고른다)
   p의 납입 종료 나이는 호출 전에 정규화돼 있어야 한다(getP). */
/* opts.horizon: 자산을 다 쓰는 목표 나이(기본 = 기대수명). 더 크게(예: 100) 주면 같은 규칙으로 그 나이까지 나눠 쓰는 플랜이 나온다 —
   화면·지표·판정은 계속 기대수명까지라 남는 돈이 장수·간병 대비금이 된다(남길 금액 목표 나이는 기대수명 그대로). */
function computeAutoPlan(p, adj, opts){
  adj = adj || SA.base;
  const r = scenarioRates(p, adj);
  const acc = accumulate(p, adj);
  // 퇴직소득세: 직접 입력한 값(p.tirptaxManual)이 있으면 그 값, 없으면 DC 평가액(사용자부담금+운용수익) 기준 자동값
  const tservAtRet = (p.tservice||0) + Math.max(0, p.ret - p.age);
  const tirptax = p.tirptaxManual ? (p.tirptax||0) : calcRetirementIncomeTax(acc.tirpFV, tservAtRet);
  const q = Object.assign({}, p, {tirptax});
  const H = Math.max(q.life, (opts && opts.horizon) || 0);   // 소진 목표 나이

  const T = taxFreeBases(q);
  const extra = bridgeExtraMonthly(T, q);
  const hasGap = q.npage > q.ret;
  const pStart = Math.max(q.ret, 55);
  const isaage = q.ret;
  const genage = q.ret;   // 일반계좌는 나이 제한이 없어 은퇴 때부터(ISA와 같음)
  const irpage = hasGap ? Math.min(q.npage, q.life - 1) : pStart;
  // 남길 금액(기대수명 시점 오늘 가치)과 은퇴 후 일시 지출은 일반계좌 → 개인연금 농협 → 미래에셋 순으로 미리 떼어 둔다 — 은퇴 시점 현재가치로 환산.
  // 일시 지출은 인출 세금을 보충해(÷(1−16.5%), 보수적) 잡고, 개인연금 농협 → 미래에셋 순으로 채운 뒤에도 모자라면 reserveUnmet(오늘 가치)에 기록한다.
  const GU = 1 / (1 - SEP_TAX_HIGH);
  const items = [];
  if(q.bequest > 0) items.push({real: q.bequest, nom: q.bequest * Math.pow(1 + r.inf/100, q.life - q.age), t: q.life - q.ret + 1});
  for(const i of [1,2,3]){
    const a = q['lump'+i+'_age'], amt = q['lump'+i+'_amt'];
    if(a >= q.ret && a <= q.life && amt > 0) items.push({real: amt * GU, nom: amt * GU * Math.pow(1 + r.inf/100, a - q.age), t: a - q.ret + 0.5});
  }
  const genAvail = acc.genFV;
  const takeFrom = (avail, rate) => {   // avail(은퇴 시점 현재가치)만큼 items를 비율로 채우고 채운 현재가치를 돌려준다
    const need = items.reduce((t, it) => t + it.nom * it.left / growYears(rate, it.t), 0);
    if(!(need > 0)) return 0;
    const f = Math.min(1, Math.max(0, avail) / need);
    items.forEach(it => { it.left *= (1 - f); });
    return need * f;
  };
  items.forEach(it => { it.left = 1; });
  const nhAvail = acc.nhFV - pvOfMonthlyStream(extra.nh, extra.years, r.nh);
  const mfAvail = acc.mfFV - pvOfMonthlyStream(extra.mf, extra.years, r.mf);
  const genTake = takeFrom(genAvail, r.gen);   // 남길 금액·일시 지출은 일반계좌에서 먼저 남긴다(세금·나이 제한이 가장 자유로운 돈)
  const genBase = Math.max(0, genAvail - genTake);
  const nhTake = takeFrom(nhAvail, r.nh);
  const mfTake = takeFrom(mfAvail, r.mf);
  const reserveUnmet = items.reduce((t, it) => t + it.real * it.left, 0);
  const nhBase = Math.max(0, nhAvail - nhTake) * growYears(r.nh, pStart - q.ret);
  const mfBase = Math.max(0, mfAvail - mfTake) * growYears(r.mf, pStart - q.ret);
  const nhpay = round1(pmtTodayValue(q, r, nhBase, r.nh, pStart, H));
  const irppay = round1(pmtTodayValue(q, r, acc.irpFV * growYears(r.irp, irpage - q.ret), r.irp, irpage, H));

  const memo = fn => { const m = new Map(); return v => { if(!m.has(v)) m.set(v, fn(v)); return m.get(v); }; };
  const isaPay = memo(end => round1(pmtTodayValue(q, r, acc.isaFV, r.isa, isaage, end, {isaPrincipal: acc.isaPrin})));
  const mfPay  = memo(end => round1(pmtTodayValue(q, r, mfBase, r.mf, pStart, end)));
  const hasGen = acc.genFV > 0;
  const genPay = memo(end => round1(pmtTodayValue(q, r, genBase, r.gen, genage, end)));
  const tmFor  = memo(tage => {
    const N = H - tage + 1;
    if(N <= 0 || acc.tirpFV <= 0) return 0;
    const first = pmtAnnualGrowing(acc.tirpFV * growYears(r.tirp, tage - q.ret), r.tirp, r.inf, N);
    return round1(first / Math.pow(1 + r.inf/100, tage - q.age));
  });
  const build = k => ({isaage, isam:isaPay(k.isaEnd), mfage:pStart, mfpay:mfPay(k.mfEnd), nhage:pStart, nhpay,
                       irpage, irppay, tage:k.tage, tm:tmFor(k.tage), tirptax,
                       genage: hasGen ? genage : 0, genpay: hasGen ? genPay(k.genEnd) : 0,
                       // 자동설계가 정한 마지막 인출 나이 — 이후엔 계획 인출을 멈춰 떼어 둔 남길 금액·일시 지출 몫이 수입으로 새지 않게 한다
                       // (남길 금액·일시 지출이 있을 때만 — 없으면 끝 나이 뒤 반올림 꼬리까지 기존대로 인출해 소진 판정이 흔들리지 않게)
                       mfpayend: items.length ? k.mfEnd : 0, genpayend: (hasGen && items.length) ? k.genEnd : 0});
  const score = k => {
    // 플랜 모드(필요분만 등)는 선택 뒤 simulate가 적용 — 탐색은 항상 같은 기준. H > 기대수명이면 H까지 평가해 기대수명 뒤 소득도 평탄화한다
    const s = simulate(Object.assign({}, q, build(k), {plan_mode: 'max'}, H > q.life ? {life: H, lifeInc: q.life} : {}), adj);
    return {k, ok: s.runway === (H > q.life ? H : q.life), minNet: s.minNetEq, spread: s.maxNetEq - s.minNetEq, tax: s.lifetimeTax + s.lifetimeHi,
            sumNet: s.lifetimeNetReal};
  };
  const better = (a, b) => {
    if(a.ok !== b.ok) return a.ok;
    const tol = Math.max(0.5, 0.02 * Math.max(a.minNet, b.minNet));
    if(Math.abs(a.minNet - b.minNet) > tol) return a.minNet > b.minNet;
    if(Math.abs(a.tax - b.tax) > 10) return a.tax < b.tax;
    return a.spread < b.spread - 1;
  };

  // 기준안(평탄화 전 규칙): ISA·미래에셋은 공백기 끝(없으면 기대수명)까지, 퇴직IRP는 가장 이른 나이
  const gapEnd = hasGap ? q.npage - 1 : H;
  const tMin = pStart, tMax = Math.max(pStart, Math.min(80, q.life - 1));
  let k = {tage: tMin, isaEnd: Math.max(isaage, gapEnd), mfEnd: (hasGap && q.npage - 1 >= pStart) ? q.npage - 1 : H, genEnd: Math.max(genage, gapEnd)};
  let best = score(k);
  const baseline = best;
  const ranges = {tage:[tMin, tMax], isaEnd:[isaage, H], mfEnd:[pStart, H], genEnd:[genage, H]};
  const keys = hasGen ? ['tage', 'isaEnd', 'mfEnd', 'genEnd'] : ['tage', 'isaEnd', 'mfEnd'];
  for(let round = 0; round < 4 && q.life > q.ret; round++){
    let improved = false;
    for(const key of keys){
      const [lo, hi] = ranges[key];
      for(let v = lo; v <= hi; v++){
        if(v === k[key]) continue;
        const cand = score(Object.assign({}, k, {[key]: v}));
        if(better(cand, best)){ best = cand; k = cand.k; improved = true; }
      }
    }
    if(!improved) break;
  }

  const plan = build(k);
  plan.info = {horizon: H, T, extra, hasGap, isaEnd: k.isaEnd, mfEnd: k.mfEnd, genEnd: hasGen ? k.genEnd : null, acc, tservAtRet, reserveUnmet: Math.round(reserveUnmet),
               baseline: {minNet: baseline.minNet, spread: baseline.spread, tax: baseline.tax, sumNet: baseline.sumNet},
               leveled:  {minNet: best.minNet, spread: best.spread, tax: best.tax, sumNet: best.sumNet}};
  return plan;
}

// 브라우저(<script src>)에서는 무시되고, Node(node:test)에서만 사용됨
if(typeof module !== 'undefined'){
  module.exports = {
    SA, PRIVATE_PENSION_SEP_LIMIT, SEP_TAX_HIGH, LOCAL_TAX_MUL, ISA_TOTAL_CAP, ISA_EXEMPT, ISA_TAX_RATE,
    PENSION_SAVINGS_DEDUCT_CAP, PENSION_TOTAL_DEDUCT_CAP, PENSION_ANNUAL_PAY_CAP, PRIN_CONFIRMED_YEAR, PENSION_LIMIT_YEARS,
    scenarioRates, growYears, calcISA_Detail, calcISA_FV, isaClosingTax, calcMonthlyDepositFV, stepBalance, stepBalanceDetail,
    cappedOut, pvOfMonthlyStream, pmtAnnualGrowing, basicIncomeTax, pensionTaxRate, tirpTaxDiscount,
    calcRetirementIncomeTax, pensionIncomeDeduction, comprehensivePensionTax, pensionTaxes,
    NPS_MIN_YEARS, wageIncomeDeduction, wageTaxCredit, comprehensiveCore, comprehensiveTotal, otherIncomeReal, npsMembershipFactor,
    STD_TAX_CREDIT_WAGE, FIN_COMP_THRESHOLD, FIN_WITHHOLD, NPS_FULL_AGE, NPS_VOL_PREMIUM_RATE, VOL_HEALTH_MONTHS,
    dependentStatusCheck, healthIncomeItems, dependentTotalIncome, npNominalAtStart, totalPropertyBase,
    propertyTaxBase, PROPERTY_SCORE_TABLE, propertyInsuranceScore, regionalIncomeMonthly,
    HEALTH_RATE_INCOME, HEALTH_RATE_PROPERTY_WON, HEALTH_RATE_LTC, HEALTH_CAP_MAX, HEALTH_CAP_MIN,
    regionalHealthPremium, healthPremiumYear, npsAdjustFactor, futurePrinAdd, taxFreeBases, bridgeExtraMonthly, pensionLimitAnnual,
    houseSummary, GEN_OV_TAX, GEN_OV_DEDUCT, genInit, genSum, genGrow, genYear, HOUSING_PENSION_PER_1EOK, housingPensionMonthly, housingPensionOf, expPct, lumpsAt, accWindows, accumulate, evalYear, simulate, buildAccRows, pmtTodayValue, computeAutoPlan
  };
}
