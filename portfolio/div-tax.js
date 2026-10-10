/* ── 배당·세금 순수 계산 (DOM·전역 상태 비의존) ──
   div-tax.test.js가 Node 내장 테스트러너(node:test)로 직접 검증하고, index.html은 <script src="div-tax.js">로 불러 쓴다.
   화면 쪽(index.html)은 보유 종목·매매 이력·스냅샷·야후 배당 이력·과거 환율을 모아 넘기고, 여기서는 계산만 한다.

   금액 단위: 장부·양도세는 원, 금융소득 추가 세액(finExtraTaxMan)은 만원(소득세 구간표가 만원 기준).
   근거(basis) 필드 — 화면이 "추정"을 표시하는 기준이다:
     qtyBasis  snapinf(매도 기록 없이 사라진 종목 — 연결된 스냅샷 수량) · snap(31일 이내 스냅샷 수량에서 매매 재생) · log(매매 이력·스냅샷이 배당락일 전부터 있음) · now(앞으로의 배당, 현재 수량) · assumed(근거 없음 → 현재 수량 가정)
     payBasis  record(기록일) · learned(이 종목의 실제 지급 지연을 기록에서 학습) · est(배당락일 + 시장별 지연)
     fxBasis   hist(지급일·결제일 환율) · now(현재 환율) · na(원화)
   세법 근거
     해외주식 양도차익: 취득·양도가액은 각 대금청산일(결제일) 기준환율로 원화 환산, 취득가액은 선입선출이 원칙이고
       증권사가 이동평균법을 적용하면 그 방식도 인정(국세청 서면-2022-국제세원-0764). 기본공제 연 250만, 세율 22%(지방세 포함).
     국내 상장 해외 ETF를 일반계좌에서 판 이익은 배당소득(과표기준가 기준) — 여기서는 매매차익으로 추정, 손실은 통산하지 않음.
     금융소득종합과세: 이자·배당(세전) 연 2,000만 초과 시 비교과세 max(①2,000만×14% + 기본세율(다른 과표+초과분), ②전액×14% + 기본세율(다른 과표)). */
(function(root){
'use strict';
const DAY = 86400000;
const DIV_WHT = {KRW:.154, USD:.15, JPY:.15315};          // 배당소득 원천징수율(지방세 포함, 미국은 한미 조약 15%)
const SHELTERED = ['isa','pension_personal','pension_retirement','irp'];
const CGT_EXEMPT = 2500000, CGT_RATE = 0.22;              // 해외주식 양도세 기본공제(원)·세율
const FIN_THRESHOLD_MAN = 2000, FIN_WITHHOLD = 0.14, LOCAL_TAX_MUL = 1.1;
// 소득세 세율표(소득세법 55조, 과세표준 만원 기준) — [상한, 세율]
const INCOME_TAX_BANDS = [[1400,.06],[5000,.15],[8800,.24],[15000,.35],[30000,.38],[50000,.40],[100000,.42],[Infinity,.45]];

// 계좌유형 → 과세 구분. 프리셋 외에 직접 입력한 이름("중개형ISA", "연금저축")도 비과세 계좌로 읽는다.
function normAcct(t){
  if(!t || t==='general') return 'general';
  if(SHELTERED.includes(t) || t==='cash') return t;
  const s = String(t).replace(/\s/g,'').toUpperCase();
  if(/ISA/.test(s)) return 'isa';
  if(/IRP/.test(s)) return 'irp';
  if(/퇴직/.test(s)) return 'pension_retirement';
  if(/연금/.test(s)) return 'pension_personal';
  return 'general';
}
const isSheltered = acct => SHELTERED.includes(normAcct(acct));

function incomeTaxMan(base){ let t = 0, lo = 0; for(const [hi, r] of INCOME_TAX_BANDS){ if(base > lo) t += (Math.min(base, hi) - lo) * r; lo = hi; } return t; }
const marginalRate = base => (INCOME_TAX_BANDS.find(([hi])=>base<=hi) || INCOME_TAX_BANDS[INCOME_TAX_BANDS.length-1])[1];
// 금융소득 F(만원)가 2,000만을 넘을 때 원천징수(14%) 외에 더 내는 세금(지방세 포함, 만원) — 비교과세에서 ②는 추가분 0이므로
// max(①,②) − 원천징수 − 다른 소득만의 세금 = max(0, 기본세율(base+초과) − 기본세율(base) − 초과×14%). 배당가산(Gross-up)·세액공제 미반영.
function finExtraTaxMan(F, base){
  const ex = F - FIN_THRESHOLD_MAN;
  if(!(ex > 0)) return 0;
  const b = Math.max(0, base||0);
  return Math.max(0, incomeTaxMan(b + ex) - incomeTaxMan(b) - ex*FIN_WITHHOLD) * LOCAL_TAX_MUL;
}


// ── 날짜 ──
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const dateStr = ts => ymd(new Date(ts));
const md = d => `${d.getMonth()+1}-${d.getDate()}`;
const dayStart = ts => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const HOLI = {   // 고정일 휴장일(음력 명절·메모리얼데이 등은 무시 — 지급일 추정·결제일 귀속의 연말 경계가 목적)
  US: new Set(['1-1','6-19','7-4','12-25']),
  KR: new Set(['1-1','3-1','5-5','6-6','8-15','10-3','10-9','12-25','12-31']),
  JP: new Set(['1-1','1-2','1-3','12-31']),
};
function isHoliday(d, mkt){
  const hol = HOLI[mkt] || HOLI.US;
  if(hol.has(md(d))) return true;
  if(mkt==='US'){   // 대체 휴장: 토요일 휴일은 전날(1/1 제외 — 전년도로 넘기지 않음), 일요일 휴일은 다음 날
    const w = d.getDay();
    if(w===5){ const n = new Date(d.getFullYear(), d.getMonth(), d.getDate()+1); if(hol.has(md(n)) && md(n)!=='1-1') return true; }
    if(w===1){ const p = new Date(d.getFullYear(), d.getMonth(), d.getDate()-1); if(hol.has(md(p))) return true; }
  }
  return false;
}
const isBiz = (d, mkt) => d.getDay()!==0 && d.getDay()!==6 && !isHoliday(d, mkt);
function addBizDays(ts, n, mkt){
  let d = new Date(ts), k = 0;
  while(k < n){
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate()+1, d.getHours(), d.getMinutes());
    if(isBiz(d, mkt)) k++;
  }
  return d.getTime();
}
// 그날이 휴일이면 다음 영업일(달력 일수로 더한 지급일이 주말·휴일에 떨어지지 않게)
function nextBiz(ts, mkt){ let d = new Date(ts); while(!isBiz(d, mkt)) d = new Date(d.getFullYear(), d.getMonth(), d.getDate()+1, d.getHours(), d.getMinutes()); return d.getTime(); }
const mktOf = ccy => ccy==='USD' ? 'US' : ccy==='JPY' ? 'JP' : 'KR';
const isDateOnly = at => { const d = new Date(at); return d.getHours()===0 && d.getMinutes()===0 && d.getSeconds()===0 && d.getMilliseconds()===0; };
// 체결일(그 시장의 날짜, 한국 시간 자정 타임스탬프). 날짜만 적은 기록(자정)은 그 날짜.
// 앱이 체결 시각으로 기록한 미국 거래: 한국 9~18시 = 미국 야간(주간거래) → 다음 미국 거래일 = 한국 날짜, 그 밖 = 미국 날짜(−14시간).
function tradeDay(at, ccy){
  if(ccy!=='USD' || isDateOnly(at)) return dayStart(at);
  const h = new Date(at).getHours();
  return (h >= 9 && h < 18) ? dayStart(at) : dayStart(at - 14*3600000);
}
// 결제일(양도·취득 시기) — 미국 T+1(2024-05-28부터, 그 전 T+2), 일본·국내 T+2 영업일
function settleDate(at, ccy){
  const day = tradeDay(at, ccy);
  if(ccy==='USD') return addBizDays(day, day >= new Date(2024,4,28).getTime() ? 1 : 2, 'US');
  return addBizDays(day, 2, mktOf(ccy));
}

// ── 환율 ──
// series: {USD:[[ts, rate]...], JPY:[...]}(시간순, 그날 한국 자정). 그날 또는 그 전 마지막 값.
// 미래·오늘은 현재 환율(now), 기록 시작 전(5년 넘은 기초 보유분)은 가장 이른 값(est).
function makeFxAt(series, now, current){
  const cur = current || {};
  return function fxAt(ccy, ts){
    if(!ccy || ccy==='KRW') return {rate:1, basis:'na'};
    const s = series && series[ccy];
    const fallback = {rate: cur[ccy] || 1, basis:'now'};
    if(!s || !s.length || ts >= now - DAY/2) return fallback;
    if(ts < s[0][0]) return {rate: s[0][1], basis:'est'};
    let lo = 0, hi = s.length - 1;
    while(lo < hi){ const mid = (lo + hi + 1) >> 1; if(s[mid][0] <= ts) lo = mid; else hi = mid - 1; }
    return {rate: s[lo][1], basis:'hist'};
  };
}

// ── 배당락일 보유 수량 ──
// h: {id, quantity, ccy, soldOut}, trades: 이 보유 항목과 매칭된 매수·매도 [{at, type, quantity}], snaps: [{timestamp, byAsset, byQty}]
// 가장 가까운 기준점(스냅샷 수량 또는 현재 수량)에서 그 사이 매매만 앞/뒤로 재생한다 — 보유종목을 직접 고쳐(이력 없이) 수량이 바뀌어도
// 스냅샷이 그 전 수량을 기억하고 있으면 과거 배당락일에 새 수량을 쓰지 않는다.
// 배당 권리는 날짜로 판단: 체결일(시장 날짜) < 배당락일이면 권리 있음(배당락일 당일 매수는 못 받는다).
// h.snapIds: 이 보유의 스냅샷 id들(목록에서 사라진 종목은 linkSnapIds가 찾아 준 옛 id, 없으면 [h.id])
// h.inferred: 매도 기록 없이 목록에서 사라진 종목 — h.endAt(스냅샷에 마지막으로 보인 시각)까지만 보유로 보고, 그 뒤 배당락은 수량 0
function qtyAt(h, ex, trades, snaps, now){
  const inferred = !!h.inferred;
  if(inferred && !(ex <= h.endAt)) return {qty: 0, basis:'snapinf'};
  if(ex > now) return {qty: Math.max(0, h.quantity||0), basis:'now'};
  const exD = dayStart(ex), ccy = h.ccy || 'KRW';
  const after = r => tradeDay(r.at, ccy) >= exD;
  const anchors = inferred ? [] : [{t: now, q: h.quantity||0, snap:false}];
  const ids = h.snapIds && h.snapIds.length ? h.snapIds : (h.id != null ? [h.id] : []);
  (snaps||[]).forEach(s=>ids.forEach(id=>{
    const v = s.byAsset && s.byAsset[id], q = s.byQty && s.byQty[id];
    if(v > 0 && q > 0) anchors.push({t: s.timestamp, q, snap:true});
  }));
  if(!anchors.length) return {qty: 0, basis:'snapinf'};
  let best = anchors[0];
  anchors.forEach(a=>{ if(Math.abs(a.t - ex) < Math.abs(best.t - ex)) best = a; });
  let q = best.q;
  (trades||[]).forEach(r=>{
    const n = +r.quantity || 0, s = r.type==='sell' ? -1 : r.type==='buy' ? 1 : 0;
    if(!s) return;
    if(best.t > ex){ if(after(r) && r.at <= best.t) q -= s*n; }    // 기준점이 뒤: 배당락 이후 체결을 되돌린다
    else if(r.at > best.t && !after(r)) q += s*n;                  // 기준점이 앞: 그 뒤~배당락 전 체결을 적용
  });
  let basis;
  if(inferred) basis = 'snapinf';
  else if(best.snap && Math.abs(best.t - ex) <= 31*DAY) basis = 'snap';
  else if(h.soldOut || anchors.some(a=>a.snap && a.t <= ex) || (trades||[]).some(r=>(r.type==='buy'||r.type==='sell') && !after(r))) basis = 'log';
  else basis = 'assumed';
  return {qty: Math.max(0, q), basis};
}

// ── 옛 스냅샷 id 연결 ──
// 스냅샷에는 자산 id→수량·평가액만 있어 목록에서 사라진 종목은 어느 종목인지 모른다. 그 id를 과거 보유(매매 이력으로 만든 수량 곡선)와 대조해
// 명확하게 맞는 것만 이어 준다 — 같은 시점 수량이 2번 이상 일치(어긋남 20% 이하)하거나, 1번 일치 + 단가가 가까운 체결 단가의 ±25% 이내.
// groups: [{key, trades:[{at,type,quantity,totalKRW}]}], snaps, liveIds(현재 자산 id) → Map(key → {ids, endAt})  (endAt = 연결된 스냅샷 중 마지막 시각)
function linkSnapIds(groups, snaps, liveIds){
  const live = new Set([...(liveIds||[])].map(String)), pts = new Map();
  (snaps||[]).forEach(s=>{
    const bq = s.byQty || {}, ba = s.byAsset || {};
    Object.keys(bq).forEach(id=>{
      const q = +bq[id], v = +ba[id];
      if(live.has(String(id)) || !(q > 0 && v > 0)) return;
      if(!pts.has(id)) pts.set(id, []);
      pts.get(id).push({t:s.timestamp, q, v});
    });
  });
  const cands = [];   // {key, id, m, endAt, ts:Set}
  (groups||[]).forEach(g=>{
    const trs = (g.trades||[]).filter(r=>(r.type==='buy'||r.type==='sell') && +r.quantity>0).slice().sort((a,b)=>a.at-b.at);
    if(!trs.length) return;
    const sgn = r => (r.type==='sell' ? -1 : 1) * (+r.quantity);
    const hasSell = trs.some(r=>r.type==='sell');
    const opening = hasSell ? Math.max(0, -trs.reduce((s,r)=>s+sgn(r), 0)) : 0;   // 전량 매도 종목이면 기록 이전부터 가진 수량
    const qAt = t => opening + trs.reduce((s,r)=>s + (r.at <= t ? sgn(r) : 0), 0);
    pts.forEach((P, id)=>{
      let m = 0, x = 0, endAt = 0;
      P.forEach(p=>{ const q = qAt(p.t); if(Math.abs(p.q - q) <= Math.max(1e-6, q*0.005)){ m++; endAt = Math.max(endAt, p.t); } else x++; });
      if(!m || x > (m + x) * 0.2) return;
      if(m < 2){
        const p = P.find(p=>Math.abs(p.q - qAt(p.t)) <= Math.max(1e-6, qAt(p.t)*0.005));
        const near = trs.filter(r=>+r.totalKRW > 0).sort((a,b)=>Math.abs(a.at-p.t) - Math.abs(b.at-p.t))[0];
        if(!near) return;
        const ref = near.totalKRW / near.quantity, unit = p.v / p.q;
        if(Math.abs(unit/ref - 1) > 0.25) return;
      }
      cands.push({key:g.key, id, m, endAt, ts:new Set(P.map(p=>p.t))});
    });
  });
  const idCount = new Map();
  cands.forEach(c=>idCount.set(c.id, (idCount.get(c.id)||0) + 1));
  const out = new Map();
  cands.filter(c=>idCount.get(c.id)===1).sort((a,b)=>b.m - a.m).forEach(c=>{   // 같은 id가 여러 종목에 맞으면 버린다
    const cur = out.get(c.key) || {ids:[], endAt:0, ts:new Set()};
    if([...c.ts].some(t=>cur.ts.has(t))) return;   // 같은 시점에 두 id가 동시에 있으면 한 종목의 곡선이 아니다
    cur.ids.push(c.id); cur.endAt = Math.max(cur.endAt, c.endAt); c.ts.forEach(t=>cur.ts.add(t));
    out.set(c.key, cur);
  });
  out.forEach((v, k)=>out.set(k, {ids:v.ids, endAt:v.endAt}));
  return out;
}

// ── 지급일 ──
// 국내 주식 지급 지연(일) — 옛 방식(분기 말 기준일, 이사회 뒤 지급)과 새 방식(배당액 먼저 정하고 기준일을 그 뒤로, 2024~)을 배당락일로 구분한다.
//   분기 말(3·6·9·12월 24일 이후) 배당락 = 옛 방식: 12월 결산은 다음 해 4월(약 110일), 분기·중간은 약 50일(예: 삼성전자 기준일 3/31 → 5/20)
//   그 밖의 날짜 = 새 방식: 1~3월은 결산 배당(주총 뒤 4월 지급, 약 48일), 나머지는 기준일 약 2주 뒤(예: KB금융 배당락 8/6 → 8/21)
//   리츠는 결산 후 약 3개월
function krStockLagDays(ex, name){
  if(/리츠|REIT/i.test(name||'')) return 90;
  const d = new Date(ex), m = d.getMonth();
  if((m===2 || m===5 || m===8 || m===11) && d.getDate() >= 24) return m===11 ? 110 : 50;
  if(m===0 && d.getDate() <= 5) return 110;   // 12월 말 기준일이 연초 휴장으로 넘어간 경우
  return m <= 2 ? 48 : 15;
}
// 지급 시기가 다른 미국 ETF — SPDR 신탁형(SPY·DIA·MDY)은 배당락 다음 달 마지막 영업일에 지급
const US_NEXT_MONTH_END = new Set(['SPY','DIA','MDY']);
function basePay(ex, inst){
  const ccy = inst.ccy || 'KRW', etf = inst.kind==='etf', d = new Date(ex), m = d.getMonth();
  if(ccy==='USD'){
    if(US_NEXT_MONTH_END.has(String(inst.ticker||'').trim().toUpperCase())){
      let t = new Date(d.getFullYear(), m+2, 0, d.getHours(), d.getMinutes()).getTime();
      while(!isBiz(new Date(t), 'US')) t -= DAY;
      return t;
    }
    return addBizDays(ex, etf ? 4 : 10, 'US');                       // 미국 ETF 3~4영업일, 개별주는 2~3주가 많다(+국내 입금 1일)
  }
  if(ccy==='JPY') return nextBiz(ex + (m===2 ? 88 : m===8 ? 68 : 75)*DAY, 'JP');   // 3월 결산 → 6월 말, 9월 중간 → 12월 초
  if(ccy==='KRW') return etf ? addBizDays(ex, 3, 'KR')               // 국내 ETF: 기준일(배당락 다음 영업일) + 2영업일
    : nextBiz(ex + krStockLagDays(ex, inst.name)*DAY, 'KR');
  return ex + 30*DAY;
}
// 야후는 배당락일만 준다. inst: {ccy, kind:'etf'|'stock', ticker, name}. corr(ms) = 이 종목의 기록으로 배운 "추정 대비 실제 지급일 차이"
function payDate(ex, inst, corr){
  const base = basePay(ex, inst);
  return corr != null ? {pay: base + corr, basis:'learned'} : {pay: base, basis:'est'};
}
// 실제 날짜로 적은 기록(수동·날짜를 고친 확인·옛 현금 폼)에서 종목별 지급일 보정치(중앙값) — 회차마다 계절 규칙(12월 결산 110일 등)은 그대로 두고 차이만 더한다
const LEARN_SRC = new Set(['manual','edited', undefined, null, '']);
function learnLag(recs, ev, inst){
  const out = [];
  (recs||[]).forEach(r=>{
    if(!LEARN_SRC.has(r.src)) return;
    let best = null, bd = Infinity;
    (ev||[]).forEach(e=>{
      if(r.exAt != null && dateStr(r.exAt)!==dateStr(e.ex)) return;
      if(e.ex > r.at + 3*DAY) return;
      const dd = Math.abs(r.at - basePay(e.ex, inst));
      if(dd < bd){ bd = dd; best = e; }
    });
    if(!best) return;
    const corr = r.at - basePay(best.ex, inst);
    if(Math.abs(corr) <= 60*DAY) out.push(corr);
  });
  if(!out.length) return null;
  out.sort((a,b)=>a-b);
  return out[Math.floor(out.length/2)];
}

const freqOf = n => n>=9 ? 'month' : n>=3 ? 'quarter' : n===2 ? 'half' : 'year';
// 배당 주기(ms) — 최근 배당락 간격(최대 4개)의 중앙값. 1년 안 횟수로 정하면 끊긴 분기 배당이 반기로 보여 계속 예상된다.
function periodOf(ev){
  const xs = ev.slice(-5), gaps = [];
  for(let i = 1; i < xs.length; i++) gaps.push(xs[i].ex - xs[i-1].ex);
  if(!gaps.length) return 365.25*DAY;
  gaps.sort((a,b)=>a-b);
  return Math.min(400*DAY, Math.max(25*DAY, gaps[Math.floor(gaps.length/2)]));
}

// 확정 기록 한 건 → 세전·원천·세후. 세전을 모르는 옛 기록(입금액만 적음)은 세후로 보고 세전을 역산(est)
function recordAmounts(r, acct){
  const ccy = r.currency || 'KRW', rate = DIV_WHT[ccy] ?? DIV_WHT.KRW, tax = !isSheltered(acct);
  if(r.gross != null){ const wht = +r.wht || 0; return {gross:+r.gross, wht, net:r.gross - wht, est:false}; }
  if(r.basis==='gross'){ const gross = +r.totalKRW||0, wht = tax ? gross*rate : 0; return {gross, wht, net:gross - wht, est:false}; }
  const net = +r.totalKRW||0, gross = tax ? net/(1-rate) : net;
  return {gross, wht:gross - net, net, est:true};
}

/* 한 연도(지급일 기준)의 배당 장부.
   o.holdings: [{key, id, ticker, name, ccy, acct, legacyAcct, company, quantity, kind, soldOut, trades:[{at,type,quantity}], ev:[{ex,dps}]}]
     key = 티커|계좌|금융회사 (같은 티커를 다른 증권사 일반계좌에 나눠 둬도 따로). legacyAcct = 옛 화면이 쓰던 계좌 키(제외 목록 호환)
   o.records: 매매이력 type:'dividend' 행 + owners(이 기록과 맞는 holdings key 목록, 화면이 계산해 넘김)
   o.snaps, o.fxAt(ccy, ts), o.dismiss(Set — 새 키 "key|날짜"와 옛 키 "티커|계좌|날짜" 모두), o.now
   기록은 연도와 무관하게 전 회차와 짝짓는다: ① exAt(배당락일)이 같은 회차 ② 나머지는 지급일이 가장 가까운 회차(창 안, 가까운 쌍부터).
   항목: {src:'confirmed'|'auto'|'proj', id, key, akey, name, ticker, acct, company, ccy, ex, pay, qty, dps, gross, wht, net, est, known,
          qtyBasis, payBasis, fxBasis, guess} — guess = 화면에 "추정"으로 보일 항목(수량 근거 없음 또는 작년 회차로 만든 예상) */
function buildLedger(o){
  const now = o.now, year = o.year;
  const y0 = new Date(year,0,1).getTime(), y1 = new Date(year+1,0,1).getTime();
  const fxAt = o.fxAt || makeFxAt(null, now, {});
  const dismiss = o.dismiss || new Set();
  const hByKey = new Map((o.holdings||[]).map(h=>[h.key, h]));
  const recs = (o.records||[]).map(r=>({r, used:false}));
  const items = [];
  // 1) 확정 기록
  recs.forEach(x=>{
    const r = x.r;
    if(r.at < y0 || r.at >= y1) return;
    const owner = (r.owners||[]).map(k=>hByKey.get(k)).find(Boolean) || null;
    const acct = r.acct || (owner ? owner.acct : 'general');
    const a = recordAmounts(r, acct);
    items.push({src:'confirmed', id:r.id, key:r.id, akey: owner ? owner.key : null, name:r.name||'(미지정)', ticker:r.ticker||'', acct,
      company: r.company || (owner ? owner.company : null), ccy:r.currency||'KRW', ex:r.exAt||null, pay:r.at, qty:r.quantity||null, dps:r.price||null,
      gross:a.gross, wht:a.wht, net:a.net, est:a.est, known:true, qtyBasis:'record', payBasis:'record', fxBasis:'record', guess:false});
  });
  // 2) 보유 항목별 야후 배당 이력 → 자동(지급 지남)·지급 예정(이미 배당락), 3) 작년 같은 회차 반복 → 예상
  (o.holdings||[]).forEach(h=>{
    const ev = (h.ev||[]).slice().sort((a,b)=>a.ex-b.ex);
    if(!ev.length) return;
    const acct = h.acct, tax = !isSheltered(acct), rate = DIV_WHT[h.ccy] ?? DIV_WHT.KRW;
    const inst = {ccy:h.ccy, kind:h.kind, ticker:h.ticker, name:h.name};
    const myRecs = recs.filter(x=>(x.r.owners||[]).includes(h.key));
    // 국내 ETF는 영업일 규칙이 정확하므로 학습하지 않는다
    const corr = (h.ccy==='KRW' && h.kind==='etf') ? null : learnLag(myRecs.map(x=>x.r), ev, inst);
    const cyc = ev.map(e=>{ const pd = payDate(e.ex, inst, corr); return {e, pd, win: 20*DAY + 0.3*Math.max(0, pd.pay - e.ex), rec:null}; });
    // 기록 ↔ 회차 짝짓기(연도 무관)
    myRecs.forEach(x=>{
      if(x.used || x.r.exAt==null) return;
      const c = cyc.find(c=>!c.rec && dateStr(c.e.ex)===dateStr(x.r.exAt));
      if(c){ c.rec = x; x.used = true; }
    });
    const pairs = [];
    myRecs.forEach(x=>{
      if(x.used) return;
      cyc.forEach(c=>{ if(!c.rec && x.r.at >= c.e.ex - 3*DAY && x.r.at <= c.pd.pay + c.win) pairs.push({x, c, d:Math.abs(x.r.at - c.pd.pay)}); });
    });
    pairs.sort((a,b)=>a.d-b.d).forEach(p=>{ if(!p.x.used && !p.c.rec){ p.c.rec = p.x; p.x.used = true; } });
    const mk = (ex, pay, payBasis, dps, q, src, known) => {
      const fx = pay <= now ? fxAt(h.ccy, pay) : fxAt(h.ccy, now + DAY);
      const gross = dps * q.qty * fx.rate, wht = tax ? gross*rate : 0;
      return {src, id:null, key:`${h.key}|${dateStr(ex)}`, akey:h.key, name:h.name, ticker:h.ticker, acct, company:h.company||null, ccy:h.ccy,
        ex, pay, qty:q.qty, dps, gross, wht, net:gross - wht, est:false, known, qtyBasis:q.basis, payBasis, fxBasis:fx.basis,
        guess: q.basis==='assumed' || !known};
    };
    const T = String(h.ticker).trim().toUpperCase();
    cyc.forEach(c=>{
      if(c.rec || c.pd.pay < y0 || c.pd.pay >= y1) return;
      const q = qtyAt(h, c.e.ex, h.trades, o.snaps, now);
      if(!(q.qty > 0)) return;
      const it = mk(c.e.ex, c.pd.pay, c.pd.basis, c.e.dps, q, c.pd.pay <= now ? 'auto' : 'proj', true);
      const d = dateStr(c.e.ex);
      if(dismiss.has(it.key) || dismiss.has(`${T}|${acct}|${d}`) || (h.legacyAcct && dismiss.has(`${T}|${h.legacyAcct}|${d}`))) return;
      items.push(it);
    });
    if(h.soldOut || !(h.quantity > 0)) return;
    const recent = ev.filter(e=>e.ex >= now - 365*DAY && e.ex <= now);
    if(!recent.length) return;
    const period = periodOf(ev.filter(e=>e.ex <= now)), last = recent[recent.length-1];
    if(now - last.ex > period*1.6) return;   // 배당이 끊긴 종목은 예상하지 않는다
    const cands = [];
    if(ev[0].ex > now - 365*DAY + period/2){
      // 배당을 시작한 지 1년이 안 됨 → 작년 회차가 없으니 최근 1년 평균을 같은 간격으로 반복
      const avg = recent.reduce((s,e)=>s+e.dps,0)/recent.length;
      for(let ex = last.ex + period; ex < y1; ex += period) cands.push({ex, dps:avg});
    } else ev.filter(e=>e.ex > now - 365*DAY - period/2 && e.ex <= now).forEach(e=>cands.push({ex:e.ex + 365*DAY, dps:e.dps}));
    cands.forEach(k=>{
      if(ev.some(e=>Math.abs(e.ex - k.ex) < period/2)) return;               // 이미 야후에 올라온 배당과 같은 회차
      const pd = payDate(k.ex, inst, corr);
      if(pd.pay <= now || pd.pay < y0 || pd.pay >= y1) return;
      if(myRecs.some(x=>!x.used && Math.abs(x.r.at - pd.pay) < period/2)) return;   // 그 회차를 이미 기록함
      items.push(mk(k.ex, pd.pay, pd.basis, k.dps, {qty:h.quantity, basis:'now'}, 'proj', false));
    });
  });
  return items.sort((a,b)=>a.pay-b.pay);
}

/* ── 해외주식 양도차익(원화) ──
   groups: [{key, name, ticker, ccy, acct, company, quantity, avgPrice, firstSeen, trades:[{id, at, type, quantity, price, totalKRW, pnl}]}]
     일반계좌·비원화·비가상자산 종목(보유 중 + 전량 매도한 종목). 국내 상장 해외 ETF(배당소득 추정)도 ccy:'KRW'로 같은 함수를 쓴다.
   method: 'fifo' | 'avg', fxAt(ccy, ts), buyFx: {key: 원/외화} — 이력 전부터 보유한 몫(기초 보유분)의 매입 환율(사용자 입력)
   기초 보유분 수량 = 현재 수량 + 매도 합 − 매수 합. 그 평단은 앱 평단(외화 이동평균)을 매수 이력으로 거꾸로 풀어 구하고
   (평단 = a·기초평단 + b 로 진행), 전량 매도했거나 중간에 0주가 됐던 종목은 매도 기록의 손익으로 그 시점 평단을 풀어 구한다.
   매입 환율은 입력값(없으면 처음 보인 날 환율 = 추정). */
const tradeOrder = ccy => (x, y) => (tradeDay(x.at, ccy) - tradeDay(y.at, ccy)) || ((x.type==='buy' ? 0 : 1) - (y.type==='buy' ? 0 : 1)) || (x.at - y.at);
function openingAvg(g){
  const ccy = g.ccy || 'KRW';
  const trades = (g.trades||[]).filter(r=>r.type==='buy' || r.type==='sell').slice().sort(tradeOrder(ccy));
  const sumB = trades.filter(r=>r.type==='buy').reduce((s,r)=>s+(+r.quantity||0),0);
  const sumS = trades.filter(r=>r.type==='sell').reduce((s,r)=>s+(+r.quantity||0),0);
  const q0 = (g.quantity||0) + sumS - sumB;
  if(!(q0 > 1e-6 * Math.max(1, sumB + sumS + (g.quantity||0)))) return {q0:0, avg:null};
  let a = 1, b = 0, q = q0;
  const atSell = [];
  trades.forEach(r=>{
    const n = +r.quantity||0;
    if(r.type==='buy'){ const t = q + n; if(t > 0){ a = q*a/t; b = (q*b + n*r.price)/t; } q = t; }
    else { atSell.push({r, a, b}); q -= n; if(q <= 1e-9){ q = 0; a = 0; b = 0; } }
  });
  let avg = null;
  if(g.quantity > 0 && g.avgPrice > 0 && a > 1e-9) avg = (g.avgPrice - b)/a;
  else {
    const s = atSell.find(x=>x.a > 1e-9 && x.r.pnl!=null && x.r.price>0 && x.r.quantity>0 && x.r.totalKRW>0);
    if(s){ const fx = s.r.totalKRW/(s.r.price*s.r.quantity), avgS = s.r.price - s.r.pnl/(s.r.quantity*fx); avg = (avgS - s.b)/s.a; }
  }
  if(!(avg > 0) || !isFinite(avg)) avg = null;
  return {q0, avg};
}
// 원가 근거의 확실성 순서 — 여러 로트를 합친 매도는 가장 불확실한 근거를 따른다
const BASIS_RANK = {log:0, input:1, est:2, unknown:3};
const worse = (a, b) => (BASIS_RANK[b]||0) > (BASIS_RANK[a]||0) ? b : a;
function realizeGains(o){
  const method = o.method==='avg' ? 'avg' : 'fifo', fxAt = o.fxAt, buyFx = o.buyFx || {};
  const sales = [], remaining = {}, needFx = [], opening = [];
  (o.groups||[]).forEach(g=>{
    const ccy = g.ccy || 'KRW';
    const trades = (g.trades||[]).filter(r=>(r.type==='buy'||r.type==='sell') && +r.quantity>0 && +r.price>0).sort(tradeOrder(ccy));
    const op = openingAvg(Object.assign({}, g, {trades}));
    const seenFx = () => fxAt(ccy, g.firstSeen || (trades[0] ? trades[0].at : Date.now())).rate;
    let lots = [];   // {qty, nat(외화 단가, null=모름), fx, basis}
    if(op.q0 > 0){
      const inFx = buyFx[g.key];
      let fx, basis;
      if(ccy==='KRW'){ fx = 1; basis = 'log'; }
      else if(inFx > 0){ fx = inFx; basis = 'input'; }
      else { fx = seenFx(); basis = 'est'; }
      if(op.avg == null) basis = 'unknown';
      lots.push({qty:op.q0, nat:op.avg, fx, basis});
      if(ccy!=='KRW'){ opening.push(g.key); if(!(inFx > 0)) needFx.push(g.key); }
    }
    const take = (qty, sell) => {   // 매도 수량만큼 취득가(원)·외화 원가·근거를 가져온다
      // 원가를 모르는 로트는 처음 팔릴 때 그 매도가·환율을 원가로 본다(양도차익 0, 근거 unknown) — 0원 취득가로 세금이 부풀지 않게
      lots.forEach(l=>{ if(l.nat == null){ l.nat = sell.price; l.fx = sell.fx; } });
      let cost = 0, nat = 0, fxPart = 0, basis = 'log', left = qty;
      const use = (lot, n) => { cost += n*lot.nat*lot.fx; nat += n*lot.nat; fxPart += n*lot.nat*(sell.fx - lot.fx); basis = worse(basis, lot.basis); };
      if(method==='avg' && lots.length){
        const tq = lots.reduce((s,l)=>s+l.qty,0), tc = lots.reduce((s,l)=>s+l.qty*l.nat*l.fx,0), tn = lots.reduce((s,l)=>s+l.qty*l.nat,0);
        const worst = lots.reduce((w,l)=>worse(w, l.basis), 'log');
        const n = Math.min(left, tq);
        if(n > 0){
          const pool = {qty:tq, nat:tn/tq, fx: tn > 0 ? tc/tn : sell.fx, basis:worst};
          use(pool, n); left -= n;
          lots = tq - n > 1e-9 ? [{qty:tq - n, nat:pool.nat, fx:pool.fx, basis:worst}] : [];
        }
      } else {
        while(left > 1e-9 && lots.length){ const l = lots[0], n = Math.min(left, l.qty); use(l, n); l.qty -= n; left -= n; if(l.qty <= 1e-9) lots.shift(); }
      }
      if(left > 1e-9) use({nat: sell.price, fx: sell.fx, basis:'unknown'}, left);   // 기록보다 많이 판 몫: 원가를 모름(양도차익 0)
      return {cost, nat, fxPart, basis};
    };
    trades.forEach(r=>{
      const st = settleDate(r.at, ccy);
      const fx = fxAt(ccy, st);
      if(r.type==='buy'){ lots.push({qty:+r.quantity, nat:+r.price, fx:fx.rate, basis:'log'}); return; }
      const t = take(+r.quantity, {fx: fx.rate, price: +r.price});
      const proceeds = r.price * r.quantity * fx.rate;
      sales.push({id:r.id, key:g.key, name:g.name, at:r.at, settle:st, year:new Date(st).getFullYear(), qty:+r.quantity, price:+r.price, ccy,
        proceeds, cost:t.cost, gain:proceeds - t.cost, fxGain: ccy==='KRW' ? 0 : t.fxPart, sellFx:fx.rate, buyFx: t.nat > 0 ? t.cost/t.nat : null,
        costBasis:t.basis, fxBasis:fx.basis});
    });
    // 아직 안 팔린 원가 모름 로트는 지금 평단·처음 보인 날 환율로 본다("지금 팔면" 계산용)
    lots.forEach(l=>{ if(l.nat == null){ l.nat = g.avgPrice || 0; l.fx = ccy==='KRW' ? 1 : seenFx(); } });
    remaining[g.key] = {qty:lots.reduce((s,l)=>s+l.qty,0), cost:lots.reduce((s,l)=>s+l.qty*l.nat*l.fx,0), nat:lots.reduce((s,l)=>s+l.qty*l.nat,0),
      basis: lots.reduce((w,l)=>worse(w, l.basis), 'log')};
  });
  return {sales, remaining, needFx, opening};
}
// 연도별 양도세 — 해외주식 매도(결제일이 그 해) + 수동 입력(원). 손익통산 후 공제·세율. 원가를 모르는 매도 수(nUnknown)는 화면이 따로 알린다
function cgtSummary(sales, manual, year){
  const ys = sales.filter(s=>s.year===year && s.ccy!=='KRW'), ms = (manual||[]).filter(m=>new Date(m.at).getFullYear()===year);
  const gain = ys.reduce((s,x)=>s+x.gain,0) + ms.reduce((s,x)=>s+(+x.pnl||0),0);
  const profit = ys.filter(x=>x.gain>0).reduce((s,x)=>s+x.gain,0) + ms.filter(x=>+x.pnl>0).reduce((s,x)=>s+(+x.pnl),0);
  const taxable = Math.max(0, gain - CGT_EXEMPT);
  return {sales:ys, manual:ms, gain, profit, loss: gain - profit, taxable, tax: Math.round(taxable*CGT_RATE), left: Math.max(0, CGT_EXEMPT - Math.max(0, gain)),
    nUnknown: ys.filter(x=>x.costBasis==='unknown').length};
}
const cgtTaxOf = gain => Math.round(Math.max(0, gain - CGT_EXEMPT) * CGT_RATE);
// 국내 상장 해외 ETF(일반계좌) 매매차익 → 배당소득 추정(원): 결제일이 그 해인 매도마다 이익만, 손실은 다른 매도와 통산하지 않는다
const etfDivIncome = (sales, year) => sales.filter(s=>s.year===year && s.ccy==='KRW').reduce((t,s)=>t + Math.max(0, s.gain), 0);

const api = {DAY, DIV_WHT, SHELTERED, CGT_EXEMPT, CGT_RATE, FIN_THRESHOLD_MAN, INCOME_TAX_BANDS,
  normAcct, isSheltered, incomeTaxMan, marginalRate, finExtraTaxMan, dateStr, addBizDays, nextBiz, tradeDay, settleDate, makeFxAt,
  qtyAt, linkSnapIds, basePay, payDate, learnLag, freqOf, periodOf, recordAmounts, buildLedger, openingAvg, realizeGains, cgtSummary, cgtTaxOf, etfDivIncome};
if(typeof module !== 'undefined' && module.exports) module.exports = api;
else root.DivTax = api;
})(typeof window !== 'undefined' ? window : this);
