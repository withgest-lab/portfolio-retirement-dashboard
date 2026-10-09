const { test } = require('node:test');
const assert = require('node:assert/strict');
const w = require('./calc-whatif.js');
const { simulate, computeAutoPlan } = require('./calc.js');

// 화면 기본값과 같은 입력(calc.test.js의 BASE와 같은 값 — 가상의 둥근 샘플)
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
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} 기대 ${b}, 실제 ${a} (허용 ±${tol})`);
const run = (p) => Object.fromEntries(w.whatIfTasks(p).map(t => [t.key, t.run()]));

test('whatIf 기준행: 자동설계 기준 최저 세후가 simulate와 같고, 생활비 부족 방향을 판정한다', () => {
  const r = run(BASE);
  const q = Object.assign({}, BASE, computeAutoPlan(BASE));
  near(r.base.minNet, Math.round(simulate(q).minNetReal * 10) / 10, 1e-9, '최저 세후');
  assert.equal(r.base.short, true);                       // 기본 샘플은 최저 281만 < 생활비 400만
  assert.equal(r.exp.to, Math.floor(r.base.minNet));
  assert.equal(r.exp.delta, Math.floor(r.base.minNet) - 400);
});

test('whatIf 은퇴 나이: 표의 "충족 나이"로 실제 입력을 바꾸면 생활비를 채우고, 한 해 앞 나이는 못 채운다(손계산 대조)', () => {
  const r = run(BASE);
  assert.ok(r.ret.reach && r.ret.reach > BASE.ret);
  const at = w.stats(w.planned(w.withRet(BASE, r.ret.reach)));
  const before = w.stats(w.planned(w.withRet(BASE, r.ret.reach - 1)));
  assert.ok(at.minNet >= BASE.exp - 0.5 && at.ok, `충족 나이 ${r.ret.reach}세 최저 ${at.minNet}`);
  assert.ok(before.minNet < BASE.exp - 0.5 || !before.ok, `${r.ret.reach - 1}세는 부족`);
  // +1세 행 숫자 = 직접 계산한 값
  const one = w.stats(w.planned(w.withRet(BASE, BASE.ret + 1)));
  near(r.ret.minNet, one.minNet, 1e-9); near(r.ret.delta, Math.round((one.minNet - r.base.minNet) * 10) / 10, 0.11);
});

test('whatIf 은퇴 나이를 바꿀 때 납입 종료 나이: 자동값(은퇴−1)은 같이 움직이고 직접 값은 새 은퇴 전까지만 자른다', () => {
  const q = w.withRet(Object.assign({}, BASE, {nhend: 54}), 59);
  assert.equal(q.isaend, 58); assert.equal(q.irpend, 58);   // 기존 은퇴−1 = 56 → 새 은퇴−1 = 58
  assert.equal(q.nhend, 54);                                // 직접 정한 54세는 유지
  assert.equal(w.withRet(Object.assign({}, BASE, {nhend: 56}), 55).nhend, 54);
});

test('whatIf 추가 납입: 연금계좌 합산 한도(연 1,800만) 안에서만, 한도까지 늘려도 부족하면 "충족 불가"로 표시', () => {
  assert.equal(w.saveRoom(BASE), Math.floor((1800 - (99 * 12 + 300)) / 12));   // 26만/월
  assert.equal(w.saveRoom(Object.assign({}, BASE, {ret: 51})), 0);             // 이미 은퇴 = 납입할 해가 없음
  const r = run(BASE).save;
  assert.equal(r.room, 26);
  assert.equal(r.reach, null);                                                  // 샘플은 한도 안에서 부족 해소 불가
  assert.ok(r.capped && r.capped.extra === 26);
  assert.ok(r.delta > 0, '납입을 늘리면 최저 세후는 늘어난다');
  // 해소 가능한 경우: 생활비를 낮추면 이분 탐색으로 필요한 증가분이 나온다
  const easy = Object.assign({}, BASE, {exp: 292});
  const e = run(easy);
  if(e.base.short){
    assert.ok(e.save.reach === null || e.save.reach <= e.save.room);
    if(e.save.reach){
      const ok = w.stats(w.planned(w.withSave(easy, e.save.reach))), under = w.stats(w.planned(w.withSave(easy, e.save.reach - 1)));
      assert.ok(ok.minNet >= 292 - 0.5 && under.minNet < 292 - 0.5, '이분 탐색 경계');
    }
  }
});

test('whatIf 국민연금 1년 연기: np가 조기·연기 가산율로 다시 계산되고 최저 세후가 늘어난다', () => {
  const r = run(BASE).np;
  assert.equal(r.to, 66);
  const q = w.withNpage(BASE, 66);
  assert.equal(q.np, Math.round(170 * 1.072));
  assert.ok(r.delta > 0);
  assert.equal(run(Object.assign({}, BASE, {npage: 70})).np.none, true);
});

test('whatIf 여유 방향: 생활비가 최저 세후 이하면 은퇴를 앞당길 수 있는 나이를 찾고, 그 나이로 실제 충족된다', () => {
  const p = Object.assign({}, BASE, {exp: 250});
  const r = run(p);
  assert.equal(r.base.short, false);
  assert.equal(r.exp.reach, null);
  if(r.ret.reach){
    assert.ok(r.ret.reach < p.ret);
    const s = w.stats(w.planned(w.withRet(p, r.ret.reach)));
    assert.ok(s.minNet >= 250 - 0.5 && s.ok);
  }
});

test('whatIf 필요분만 인출: 세후가 생활비를 넘는 해가 없으면 행을 만들지 않는다', () => {
  const planned = w.planned(BASE);
  assert.equal(run(Object.assign({}, planned, {exp: 600})).need.none, true);
});

test('위기 점검: 기본 행 = 지금 입력 그대로의 시뮬레이션, 폭락·장수·물가·건보료율은 기본보다 나쁘거나 같다', () => {
  const q = w.planned(BASE);
  const rows = Object.fromEntries(w.stressRows(q).map(r => [r.key, r]));
  const base = w.stats(q);
  assert.equal(rows.base.minNet, base.minNet); assert.equal(rows.base.runway, base.runway);
  assert.equal(rows.base.ok, true);                                  // 자동설계 직후 계획은 기대수명까지 유지
  assert.ok(rows.crash.runway <= rows.base.runway && rows.crash.leftover <= rows.base.leftover, '폭락');
  assert.ok(rows.long.life === 100 && !rows.long.ok, '100세까지는 기대수명 90세 계획으로 못 버틴다');
  assert.ok(rows.pes.runway < rows.base.runway && rows.opt.minNet >= rows.base.minNet, '비관·낙관');
  assert.ok(rows.infl.runway <= rows.base.runway, '물가 +1%p');
  assert.ok(rows.hi.minNet <= rows.base.minNet, '건보료율 8%');
});

test('simulate opts: retShock은 은퇴 시점 잔액만 줄이고(인출 계획 그대로), hiRate는 소득 보험료율만 덮어쓴다', () => {
  const q = w.planned(BASE);
  const a = simulate(q), b = simulate(q, undefined, {retShock: 0.7});
  const t = k => Object.values(k.rows[0].bal).reduce((x, y) => x + y, 0);
  assert.ok(t(b) < t(a), '첫해 말 잔액이 줄어듦');
  assert.equal(b.rows[0].totalInc, a.rows[0].totalInc, '인출 계획은 그대로 → 첫해 수입 같음(잔액이 충분한 해)');
  assert.deepEqual(simulate(q, undefined, {retShock: 1}).rows.map(x => x.netInc), a.rows.map(x => x.netInc), '1이면 변화 없음');
  const hi = simulate(q, undefined, {hiRate: 0.08});
  assert.ok(hi.rows[hi.rows.length - 1].hi > a.rows[a.rows.length - 1].hi, '국민연금 수령 후 보험료율 7.19→8%(공백기는 최저보험료라 같음)');
  near(hi.lifetimeHi / a.lifetimeHi, 0.08 / 0.0719, 0.2, '소득분이 대부분이면 보험료 비율≈요율 비');
});

test('whatIf 주택연금: 집이 있고 미가입일 때만 행이 생기고, 그 행 값 = 직접 가입 나이를 넣어 돌린 결과', () => {
  assert.equal(run(BASE).hp.none, true);                                       // 공시가격·시세 없음
  const p = Object.assign({}, BASE, {gongsiga: 40000, hp_price: 60000});
  const r = run(p).hp;
  assert.ok(!r.none && r.age === 65 && r.monthly > 100);
  const s = w.stats(w.planned(Object.assign({}, p, {hp_age: 65})));
  near(r.minNet, s.minNet, 1e-9); assert.ok(r.delta > 0, '월 수입이 늘어 최저 세후가 오른다');
  assert.equal(run(Object.assign({}, p, {hp_age: 70})).hp.none, true, '이미 가입이면 행 없음');
});

test('whatIf: 생활비 단계를 쓰면 최저 세후를 그해 생활비 비율로 보정한 값으로 비교한다', () => {
  const p = Object.assign({}, BASE, {exp_s1_age: 75, exp_s1_pct: 70});
  const q = w.planned(p), s = simulate(q);
  assert.equal(w.stats(q).minNet, Math.round(s.minNetEq * 10) / 10);
  assert.ok(w.stats(q).minNet >= Math.round(s.minNetReal * 10) / 10);
});


test('몬테카를로: 시드 고정(같은 입력 = 같은 결과), 변동성이 클수록 성공 확률이 낮아지고, 변동성 0에 가까우면 결정적 결과와 같다', () => {
  const q = w.planned(BASE);
  const a = w.monteCarlo(q, {n: 200, vol: 12}), b = w.monteCarlo(q, {n: 200, vol: 12});
  assert.deepEqual(a, b);
  const hi = w.monteCarlo(q, {n: 200, vol: 25});
  assert.ok(hi.successPct <= a.successPct, `변동성 25%p ${hi.successPct}% ≤ 12%p ${a.successPct}%`);
  const calm = w.monteCarlo(q, {n: 20, vol: 0.001});
  assert.equal(calm.successPct, 100);                                   // 자동설계 직후 계획은 기대수명까지 유지
  near(calm.minNetP10, w.stats(q).minNet, 0.5, '변동성 0 ≈ 기본 시나리오 최저 세후');
  assert.ok(a.successPct >= 0 && a.successPct <= 100 && a.n === 200);
});

test('위기 점검 마지막 행은 몬테카를로(성공 확률)', () => {
  const rows = w.stressRows(w.planned(BASE));
  const mc = rows[rows.length - 1];
  assert.equal(mc.key, 'mc'); assert.ok(mc.successPct >= 0 && mc.successPct <= 100);
});
