// 한 화면 중복 문구 검사 — ios-design 스킬 8절. 보고 전 "화면 상태마다" 돌린다.
//
// 사용(Playwright):
//   const dup = require('<이 파일 경로>');
//   console.log(await dup.run(page));                       // 현재 화면 상태 하나를 검사
//   console.log(await dup.run(page, {frame: signalsFrame})) // iframe(전략 embed) 안쪽도 같이 합산
//
// 규칙: "한 정보는 한 화면에 한 번만" — 이름은 한 곳, 모드는 한 곳, 선택된 탭 이름을 제목으로 다시 쓰지 않는다.
// 눈에 보이는 글자(리프 텍스트)만 모아 다음 셋을 보고한다:
//   exact : 똑같은 문구가 2번 이상(예: 같은 소제목이 두 카드에 둘 다)
//   token : 3글자 이상 낱말이 3번 이상(예: "QQQ"가 바·헤더·카드에, "전략"이 제목·토글·가이드에)
//   names : opts.names 로 준 이름(종목명·계좌명·탭 이름…)이 화면 전체 글자에서 몇 번 나오는지 — 2번 이상이면 중복
//           (예: names:['알파벳 A'] → 종목 행과 "알파벳 A 가격 추이" 제목에 둘 다 나오면 2)
// 정상 반복(기간 탭 1D/5D…, 표 머리글, 숫자·기호, 입력칸 값)은 제외한다 — 결과를 사람이 보고 "진짜 중복"만 고친다.
// 보고서에는 수정 전/후 건수를 함께 적는다.

const IN_PAGE = (opts) => {
  const MIN_LEN = 2, TOKEN_MIN = opts.tokenMin || 3, TOKEN_REPEAT = opts.tokenRepeat || 3;
  const SKIP_TAG = /^(SCRIPT|STYLE|NOSCRIPT|CANVAS|SVG|OPTION|TEXTAREA)$/;
  const ALLOW = new RegExp(opts.allow || '^(\\d+[DMYW]?|YTD|ALL|[0-9.,%+\\-−~·/ ]+)$');   // 기간 탭·숫자만 있는 글자
  const visible = (el) => {
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
    }
    return true;
  };
  const texts = [];
  const walk = (root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      const el = n.parentElement; if (!el || SKIP_TAG.test(el.tagName)) continue;
      if (el.closest('thead, th, .period-tabs, [role=tablist], .fm-l, label')) continue;   // 머리글·탭·입력 라벨은 제외
      const t = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (t.length < MIN_LEN || ALLOW.test(t) || !visible(el)) continue;
      texts.push(t);
    }
  };
  walk(document.body);
  return texts;
};

const analyze = (texts, opts = {}) => {
  const tokenMin = opts.tokenMin || 3, tokenRepeat = opts.tokenRepeat || 3;
  const count = (arr) => arr.reduce((m, t) => (m.set(t, (m.get(t) || 0) + 1), m), new Map());
  const joined = texts.join('');
  const names = (opts.names || []).map(n => [n, joined.split(n).length - 1]).filter(([, c]) => c >= 2);
  const exact = [...count(texts)].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
  const toks = texts.flatMap(t => t.match(/[A-Za-z가-힣&]{3,}/g) || []).filter(w => w.length >= tokenMin);
  const token = [...count(toks)].filter(([, c]) => c >= tokenRepeat).sort((a, b) => b[1] - a[1]);
  return { exact, token, names };
};

async function run(page, opts = {}) {
  const plain = { tokenMin: opts.tokenMin, tokenRepeat: opts.tokenRepeat, allow: opts.allow };   // 직렬화 가능한 값만 넘긴다
  let texts = await page.evaluate(IN_PAGE, plain);
  if (opts.frame) texts = texts.concat(await opts.frame.evaluate(IN_PAGE, plain).catch(() => []));
  const { exact, token, names } = analyze(texts, opts);
  return { texts: texts.length, exact, token, names };
}

module.exports = { run, analyze, IN_PAGE };
