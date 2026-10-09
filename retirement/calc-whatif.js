/* ── "부족 대책"·"위기 점검" 계산 (순수 함수, DOM 비의존) ──
   calc.js의 simulate·computeAutoPlan을 입력만 바꿔 다시 돌려 "하나만 바꾸면 최저 세후가 얼마나 달라지나"를 구한다.
   숫자는 추정식이 아니라 실제 시뮬레이션 결과다. 한 행이 자동설계를 여러 번 돌리므로(1회 약 0.1초) 행 단위 작업(task)으로
   쪼개 두고, 화면이 하나씩 실행해 표를 채운다(그 사이 화면이 멈추지 않게).
   브라우저에서는 calc.js 뒤에 <script src>로 불러 전역 함수를 쓰고, Node(테스트)에서는 require('./calc.js')로 같은 함수를 쓴다. */
(function(root, K){
  'use strict';
  const {simulate, computeAutoPlan, SA, npsAdjustFactor, npsMembershipFactor, PENSION_ANNUAL_PAY_CAP} = K;

  const ISA_YEAR_CAP = 2000;   // ISA 연 납입한도(만원)
  const END_KEYS = ['isaend', 'nhend', 'mfend', 'irpend', 'tdcend'];

  // 자동설계를 적용한 입력 — 한 행의 "바꾼 뒤" 값은 모두 평탄화 최적 플랜 기준이라 서로 같은 잣대로 비교된다
  function planned(p, adj){ return Object.assign({}, p, computeAutoPlan(p, adj || SA.base)); }

  // 한 번의 시뮬레이션 요약 — 생활비 판정은 세후·오늘 돈 가치(simulate의 minNetReal)
  function stats(q, adj, opts){
    const s = simulate(q, adj || SA.base, opts);
    const n = s.rows.length;
    return {
      minNet: Math.round(s.minNetReal * 10) / 10,
      avgNet: n ? Math.round(s.lifetimeNetReal / 12 / n * 10) / 10 : 0,
      shortYears: s.shortNetYears, firstShortAge: s.firstShortNetAge,
      runway: s.runway, ok: s.runway === q.life, leftover: s.leftover, years: n,
      surplusYears: s.rows.filter(x => x.netInc > x.curExp).length,
    };
  }

  // 납입 종료 나이: 자동설계가 채우는 값(은퇴−1)이었으면 새 은퇴 나이−1로, 직접 정한 값은 새 은퇴 전까지로만 자른다
  function withRet(p, ret2){
    const q = Object.assign({}, p, {ret: ret2});
    for(const k of END_KEYS) q[k] = (p[k] === p.ret - 1 || !(p[k] > 0)) ? ret2 - 1 : Math.min(p[k], ret2 - 1);
    return q;
  }
  function withNpage(p, npage2){
    const q = Object.assign({}, p, {npage: npage2});
    q.np = Math.round(p.npbase * (1 + npsAdjustFactor(npage2)) * npsMembershipFactor(q));
    return q;
  }
  // 연금저축(개인연금 농협) 월 납입을 extra만큼 늘린다 — 연금계좌 합산 한도(연 1,800만) 안에서만. 늘릴 여지가 없으면 null
  function saveRoom(p){
    if(p.ret <= p.age) return 0;
    const used = ((p.nhm || 0) + (p.mfm || 0)) * 12 + (p.irpy || 0);
    return Math.max(0, Math.floor((PENSION_ANNUAL_PAY_CAP - used) / 12));
  }
  function withSave(p, extra){ return Object.assign({}, p, {nhm: (p.nhm || 0) + extra}); }

  const fmt1 = v => Math.round(v * 10) / 10;

  /* 부족 대책 작업 목록 — 각 task: {key, label, run()} → run()이 행 하나 {key,label,change,minNet,delta,reach,note}를 돌려준다.
     base(자동설계 기준 최저 세후)가 생활비(p.exp)보다 작으면 "부족", 같거나 크면 "여유" 방향으로 문구가 바뀐다. */
  function whatIfTasks(p){
    const exp = p.exp;
    let baseQ = null, base = null;
    const ensureBase = () => {
      if(!base){ baseQ = planned(p); base = stats(baseQ); }
      return base;
    };
    const short = () => ensureBase().minNet < exp - 0.5;
    const tasks = [];

    tasks.push({key: 'base', run: () => {
      const b = ensureBase();
      return {key: 'base', minNet: b.minNet, avgNet: b.avgNet, ok: b.ok, runway: b.runway, shortYears: b.shortYears, surplusYears: b.surplusYears,
              leftover: b.leftover, short: b.minNet < exp - 0.5};
    }});

    tasks.push({key: 'exp', run: () => {
      const b = ensureBase();
      // 지속 가능 생활비 = 자동설계로 평탄화했을 때 매년 보장되는 최저 세후(오늘 돈 가치)
      return {key: 'exp', from: exp, to: Math.floor(b.minNet), reach: b.minNet >= exp - 0.5 ? null : Math.floor(b.minNet),
              minNet: b.minNet, delta: fmt1(Math.floor(b.minNet) - exp)};
    }});

    tasks.push({key: 'ret', run: () => {
      const b = ensureBase();
      const row = {key: 'ret', from: p.ret, minNet: b.minNet, delta: 0, reach: null, tried: []};
      if(short()){
        // 늦추기: +1세부터 부족이 풀리거나 70세에 닿을 때까지
        for(let r = p.ret + 1; r <= 70; r++){
          const s = stats(planned(withRet(p, r)));
          if(r === p.ret + 1){ row.to = r; row.minNet = s.minNet; row.delta = fmt1(s.minNet - b.minNet); }
          if(s.minNet >= exp - 0.5 && s.ok){ row.reach = r; break; }
        }
      } else {
        // 여유: 앞당길 수 있는 가장 이른 나이(생활비·기대수명까지 유지 조건)
        let best = p.ret;
        for(let r = p.ret - 1; r > p.age && r >= 50; r--){
          const s = stats(planned(withRet(p, r)));
          if(s.minNet >= exp - 0.5 && s.ok) best = r; else break;
        }
        row.to = best; row.reach = best < p.ret ? best : null;
        if(best < p.ret){ const s = stats(planned(withRet(p, best))); row.minNet = s.minNet; row.delta = fmt1(s.minNet - b.minNet); }
      }
      return row;
    }});

    tasks.push({key: 'save', run: () => {
      const b = ensureBase();
      const room = saveRoom(p);
      const row = {key: 'save', room, minNet: b.minNet, delta: 0, reach: null};
      if(room <= 0) return Object.assign(row, {none: true});
      const step = Math.min(room, 30);
      const s1 = stats(planned(withSave(p, step)));
      Object.assign(row, {extra: step, minNet: s1.minNet, delta: fmt1(s1.minNet - b.minNet)});
      if(short()){
        // 필요한 월 납입 증가분 — 한도 안에서 이분 탐색(정수 만원). 한도까지 늘려도 부족하면 reach=null
        const sMax = stats(planned(withSave(p, room)));
        if(sMax.minNet >= exp - 0.5 && sMax.ok){
          let lo = step, hi = room;
          while(hi - lo > 1){
            const mid = Math.floor((lo + hi) / 2);
            const sm = stats(planned(withSave(p, mid)));
            if(sm.minNet >= exp - 0.5 && sm.ok) hi = mid; else lo = mid;
          }
          row.reach = hi;
        } else row.capped = {extra: room, minNet: sMax.minNet};
      }
      return row;
    }});

    tasks.push({key: 'np', run: () => {
      const b = ensureBase();
      const row = {key: 'np', from: p.npage, minNet: b.minNet, delta: 0};
      if(p.npage >= 70) return Object.assign(row, {none: true});
      const q = planned(withNpage(p, p.npage + 1));
      const s = stats(q);
      return Object.assign(row, {to: p.npage + 1, minNet: s.minNet, delta: fmt1(s.minNet - b.minNet), ok: s.ok});
    }});

    // 필요분만 인출 — 세후가 생활비를 넘는 해가 있을 때만 의미 있음(현재 입력 기준)
    tasks.push({key: 'need', run: () => {
      const cur = stats(p);
      if(!cur.surplusYears) return {key: 'need', none: true};
      const full = simulate(p, SA.base), need = simulate(p, SA.base, {needOnly: true});
      return {key: 'need', surplusYears: cur.surplusYears, leftoverFull: full.leftover, leftoverNeed: need.leftover};
    }});

    return tasks;
  }

  /* 위기 점검 — 지금 입력한 계획(인출액 그대로)에 위기 상황을 하나씩 얹는다. 환경만 바꾸고 계획은 안 바꾼다.
     행: {key,label,note,minNet,shortYears,firstShortAge,ok,runway,life,leftover}. 상황의 경계는 CALC_SOURCES에 적은 가정이다. */
  function stressRows(p){
    const row = (key, label, note, q, adj, opts) => {
      const s = stats(q, adj, opts);
      return Object.assign({key, label, note, life: q.life}, s);
    };
    const rows = [row('base', '기본', '', p)];
    const sg = v => (v >= 0 ? '+' : '−') + Math.abs(v);
    rows.push(row('opt', '낙관', `수익률 ${sg(SA.opt.r)}%p · 물가 ${sg(SA.opt.inf)}%p`, p, SA.opt));
    rows.push(row('pes', '비관', `수익률 ${sg(SA.pes.r)}%p · 물가 ${sg(SA.pes.inf)}%p`, p, SA.pes));
    rows.push(row('crash', '은퇴 직후 폭락', '은퇴 시점 자산 −30%', p, SA.base, {retShock: 0.7}));
    rows.push(row('long', '100세까지 생존', `기대수명 ${p.life}→100세`, Object.assign({}, p, {life: 100}), SA.base));
    rows.push(row('infl', '물가 급등', '물가 +1%p(전 기간)', p, {r: 0, inf: 1}));
    rows.push(row('hi', '건보료율 인상', '소득 보험료율 8%(법정 상한)', p, SA.base, {hiRate: 0.08}));
    return rows;
  }

  const api = {planned, stats, withRet, withNpage, withSave, saveRoom, whatIfTasks, stressRows, ISA_YEAR_CAP};
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis,
   // Node: require. 브라우저: calc.js의 전역 함수·상수를 이름으로 직접 참조(최상위 const는 window 속성이 아님)
   (typeof module !== 'undefined' && module.exports) ? require('./calc.js')
     : {simulate, computeAutoPlan, SA, npsAdjustFactor, npsMembershipFactor, PENSION_ANNUAL_PAY_CAP});
