/* ── 보유 종목 평가·수익률 순수 계산 (DOM·전역 상태 비의존) ──
   pf-calc.test.js가 Node 내장 테스트러너(node:test)로 직접 검증하고, index.html은 <script src="pf-calc.js">로 불러 쓴다.
   금액 단위는 원. 변화추이의 스냅샷 평가액은 이미 원화로 환산돼 있어 평단도 원화로 받는다. */
(function(root){
'use strict';
const DAY = 86400000;

/* 확정금리 채권의 평가액과 전일가(외화면 그 통화).
   발행일부터 표면금리+가산금리로 연복리, 만기일 뒤로는 이자가 붙지 않는다. 시세가 없어 전일가도 하루 전 시각의 평가액으로 만든다
   — 전일가를 매입원금에 두면 누적 이자 전체가 하루 등락으로 보인다. 만기일이 없거나 발행일 이전이면 만기 없음으로 본다. */
function bondValues(a, now){
  const issue = new Date(a.bondIssueDate+'T00:00:00').getTime();
  const m = a.bondMaturityDate ? new Date(a.bondMaturityDate+'T00:00:00').getTime() : NaN;
  const maturity = m > issue ? m : Infinity;
  const rate = (a.bondCouponRate||0) + (a.bondSpreadRate||0), principal = a.bondPrincipal||0;
  const at = ts => Math.round(principal * Math.pow(1+rate, Math.max(0, Math.min(ts, maturity) - issue)/DAY/365) * 100) / 100;
  return {value: at(now), prev: at(now - DAY)};
}

/* 한 종목의 시점별 원화 단가·기준단가·수익률 — 변화추이 그래프와 통계 바가 같이 쓴다.
   history: [{byAsset:{id:원화 평가액}, byQty:{id:수량}}], qty: 현재 수량, avgKRW: 평단(원화 환산).
   수량 변화에 흔들리지 않게 단가로 비교한다. 기준단가는 기간 첫 지점부터 있으면 그 단가, 기간 중에 새로 생긴 종목이면 원화 평단.
   weight(기준금액) = 기준단가 × 현재 수량 */
function chartSeries(history, id, qty, avgKRW){
  const q0 = qty || 1;
  const prices = history.map(h=>{
    const ev = h.byAsset[id];
    if(ev == null) return null;
    const q = (h.byQty && h.byQty[id]) ? h.byQty[id] : q0;
    return ev / q;
  });
  const fi = prices.findIndex(p=>p!=null);
  if(fi === -1) return null;
  const base = fi === 0 ? (prices[0] || 1) : (avgKRW || prices[fi] || 1);
  const pct = prices.map((p,i)=> (i<fi || p==null) ? null : (p-base)/base*100);
  return {prices, fi, base, pct, qty:q0, weight: base*q0};
}
/* 여러 종목(또는 같은 종목의 계좌들)을 합친 idx 시점 수익률 — 기준금액으로 가중한다. 그 시점 데이터가 없는 종목은 뺀다.
   현재 평가액으로 가중하면 많이 오른 종목이 과대 반영된다(200→300이 +66.67%). 기준금액 가중이면
   합계 % = 합계 손익 ÷ 합계 기준금액이라 함께 보이는 손익(seriesPnl 합)과 항상 맞는다. */
function mergedPct(list, idx){
  let acc = 0, w = 0;
  list.forEach(s=>{ const v = s.pct[idx]; if(v==null) return; acc += v*s.weight; w += s.weight; });
  return w > 0 ? acc/w : null;
}
// 현재 수량 기준 손익(원) = (마지막 단가 − 기준단가) × 수량
function seriesPnl(s){
  for(let i = s.prices.length-1; i >= 0; i--) if(s.prices[i]!=null) return (s.prices[i] - s.base)*s.qty;
  return 0;
}

/* 스냅샷 기반 월별 성과 — 손익 = 끝 잔액 − 시작 잔액 − 그 사이 순입출금.
   snaps: [{timestamp, totalValue}], flows: [{at, type:'deposit'|'withdrawal', totalKRW}].
   입출금은 달력이 아니라 "그 달의 시작 스냅샷 뒤 ~ 끝 스냅샷까지"에 넣는다. 잔액이 그 구간의 입출금만 담고 있으므로 이렇게 해야 손익이 맞다
   — 첫 스냅샷 전 입금(이미 잔액에 포함)은 빼고, 스냅샷이 드문 옛 구간의 달 경계 입출금은 잔액에 처음 나타나는 달로 간다.
   달마다 끝 스냅샷 = 다음 달 시작 스냅샷이라 월별 손익을 더하면 연도별 손익과 같다. */
function monthlyPerformance(snaps, flows){
  const S = (snaps||[]).slice().sort((a,b)=>a.timestamp-b.timestamp);
  if(!S.length) return [];
  const F = (flows||[]).slice().sort((a,b)=>a.at-b.at);
  const firstFlowAt = F.length ? F[0].at : null;
  const atOrBefore = ts => { let best = null; for(const s of S){ if(s.timestamp<=ts) best = s; else break; } return best; };
  const atOrAfter = ts => S.find(s=>s.timestamp>=ts) || null;
  const start = new Date(S[0].timestamp), end = new Date(S[S.length-1].timestamp);
  const out = [];
  for(let y = start.getFullYear(), m = start.getMonth(); y<end.getFullYear() || (y===end.getFullYear() && m<=end.getMonth()); ){
    const monthStart = new Date(y,m,1).getTime(), monthEnd = new Date(y,m+1,1).getTime()-1;
    const a = atOrBefore(monthStart-1) || atOrAfter(monthStart), b = atOrBefore(monthEnd) || a;   // 시작 = 지난달의 끝 스냅샷
    const netFlow = F.reduce((t,r)=> (r.at > a.timestamp && r.at <= b.timestamp) ? t + (r.type==='deposit'?1:-1)*(r.totalKRW||0) : t, 0);
    const startVal = a.totalValue, endVal = b.totalValue, pnl = endVal - startVal - netFlow;
    out.push({year:y, month:m, startVal, endVal, netFlow, hasFlowData: firstFlowAt!==null && monthEnd >= firstFlowAt, pnl, rtn: startVal>0 ? pnl/startVal*100 : null});
    m++; if(m>11){ m = 0; y++; }
  }
  return out;
}

/* 매매 대금·배당을 넣을 현금 행 고르기 — 같은 통화·금융회사 안에서 ① 구분이 같은 행 ② 구분이 없는 옛 행(하위호환)만 쓴다.
   구분이 다른 행에는 넣지 않는다: 일반계좌 매도 대금이 개인연금 현금으로 들어가면 계좌별 비중·현금흐름 연동이 틀어진다.
   cashAcctType이 없으면(어느 계좌의 돈인지 모름) 그 금융회사·통화의 현금 전체가 후보다.
   norm: 직접 입력한 구분 이름을 프리셋으로 읽는 함수(div-tax.js normAcct). 반환: 행 | null(새로 만들 것) | 'amb'(후보가 여러 개) */
function pickCashRow(rows, currency, company, cashAcctType, norm){
  const co = company||null, want = cashAcctType||null;
  const pool = (rows||[]).filter(a=>a.acctType==='cash' && a.currency===currency && (a.company||null)===co);
  const one = list => list.length===1 ? list[0] : list.length ? 'amb' : null;
  if(!want) { const exact = pool.filter(a=>!a.cashAcctType); return one(exact.length ? exact : pool); }
  const exact = pool.filter(a=>a.cashAcctType===want);
  if(exact.length) return one(exact);
  const same = norm ? pool.filter(a=>a.cashAcctType && a.cashAcctType!=='cash' && norm(a.cashAcctType)===norm(want)) : [];
  if(same.length) return one(same);
  return one(pool.filter(a=>!a.cashAcctType || a.cashAcctType==='cash'));
}

// 종목을 가르는 이름 — 티커가 없는 종목(채권 등)은 이름으로. 티커 칸 "—"로 묶으면 서로 다른 종목이 한 종목이 된다
const tickerOrName = x => x.ticker && x.ticker!=='—' ? x.ticker : x.name;

/* 세금 계산용 종목 묶음 — 매매 한 건은 정확히 한 묶음에만 들어가고, 같은 키(티커|계좌|금융회사)의 보유는 수량·평단을 합쳐 한 묶음이다.
   그래야 자산유형만 다른 두 행이나 금융회사가 안 적힌 옛 기록에서 매도 한 건이 두 번 과세되지 않는다.
   주인 고르기: 소유 판정(o.owns)에 맞는 보유 중 금융회사 → 계좌가 같은 쪽, 그래도 같으면 과세 대상 보유.
   주인이 과세 대상이 아니면(ISA 등) 그 매매는 세금과 무관하고, 주인이 없으면(전량 매도 등) 기록 자체의 계좌·통화로 판정한다.
   holdings: 수량이 있는 보유(현금 제외). o: {owns(r,a), pred(x), keyOf(x), pseudoOf(r), seenOf(a)(처음 보인 시각, 없으면 Infinity), now} */
function taxGroupsOf(log, holdings, o){
  const groups = new Map();
  holdings.filter(o.pred).forEach(a=>{
    const k = o.keyOf(a), g = groups.get(k), seen = o.seenOf(a);
    if(!g){ groups.set(k, {key:k, name:a.name, ticker:a.ticker, ccy:a.currency, acct:'general', company:a.company||null, quantity:a.quantity, avgPrice:a.avgPrice, firstSeen:seen, trades:[], asset:a}); return; }
    const q = g.quantity + a.quantity;
    g.avgPrice = (g.avgPrice*g.quantity + a.avgPrice*a.quantity)/q;
    g.quantity = q;
    g.firstSeen = Math.min(g.firstSeen, seen);
  });
  const score = (r,a) => ((r.company||null)===(a.company||null) ? 4 : 0) + ((r.acctType||null)===(a.acctType||null) ? 2 : 0) + (o.pred(a) ? 1 : 0);
  (log||[]).forEach(r=>{
    if(r.type!=='buy' && r.type!=='sell') return;
    const owners = holdings.filter(a=>o.owns(r,a));
    let key;
    if(owners.length){
      const best = owners.reduce((b,a)=> score(r,a) > score(r,b) ? a : b);
      if(!o.pred(best)) return;
      key = o.keyOf(best);
    } else {
      const p = o.pseudoOf(r);
      if(!o.pred(p)) return;
      key = o.keyOf(p);
      if(!groups.has(key)) groups.set(key, {key, name:r.name, ticker:p.ticker, ccy:p.currency, acct:'general', company:p.company, quantity:0, avgPrice:0, firstSeen:Infinity, trades:[], asset:null});
    }
    const g = groups.get(key);
    g.trades.push(r);
    g.firstSeen = Math.min(g.firstSeen, r.at);
  });
  groups.forEach(g=>{ if(g.firstSeen===Infinity) g.firstSeen = o.now; });
  return [...groups.values()];
}

const api = {bondValues, chartSeries, mergedPct, seriesPnl, monthlyPerformance, pickCashRow, tickerOrName, taxGroupsOf};
if(typeof module !== 'undefined' && module.exports) module.exports = api;
else root.PfCalc = api;
})(typeof window !== 'undefined' ? window : this);
