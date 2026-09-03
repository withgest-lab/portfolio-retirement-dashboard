/*
 * 포트폴리오 시세 갱신용 CORS 프록시 (Cloudflare Workers)
 *
 * 배경: 야후 파이낸스/네이버 API는 브라우저에서 직접 fetch할 수 없어(CORS 헤더 없음)
 * 무료 서드파티 프록시(allorigins/corsproxy.io/codetabs/cors.lol)를 거쳐왔는데,
 * 이 프록시들이 하나씩 죽거나(API 키 요구) rate-limit에 걸려 시세 갱신이 자주
 * 실패했다(portfolio/index.html의 PROXIES 배열, 2026-08-24·2026-09-01 커밋 참고).
 * 이 Worker를 직접 띄우면 그 프록시들에 의존하지 않는 안정적인 후보가 하나 생긴다.
 *
 * 배포 방법 (Cloudflare 대시보드, CLI 불필요):
 *   1. cloudflare.com 무료 가입 (이메일만 있으면 됨)
 *   2. 대시보드 → Workers & Pages → Create → Workers → "Create Worker" 선택
 *   3. 아무 이름이나 입력 (예: pf-cors-proxy) 후 "Deploy"로 기본 템플릿 배포
 *   4. "Edit code"를 눌러 에디터에서 기본 코드를 전부 지우고 이 파일 내용을 붙여넣기
 *   5. 다시 "Deploy" → 화면에 뜨는 https://xxx.workers.dev 형태 URL을 확인
 *   6. 그 URL을 portfolio/index.html의 PROXIES 배열에 '<URL>/?url=' 형태로 추가
 *      (예: 'https://pf-cors-proxy.내계정.workers.dev/?url=')
 *
 * 보안: 아무 URL이나 중계해주는 열린 프록시가 되지 않도록 대상 호스트를 화이트리스트로
 * 제한한다. workers.dev 서브도메인은 추측이 어렵지만, 혹시 URL이 노출되더라도 이
 * 화이트리스트에 없는 곳으로는 중계하지 않는다.
 */

const ALLOWED_HOSTS = new Set([
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'm.stock.naver.com',
  'polling.finance.naver.com',
]);

export default {
  async fetch(request) {
    // 브라우저가 보내는 프리플라이트(OPTIONS) 요청에는 헤더만 붙여 바로 응답
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const inUrl = new URL(request.url);
    const target = inUrl.searchParams.get('url');
    if (!target) {
      return new Response('missing url param', { status: 400, headers: CORS_HEADERS });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch (e) {
      return new Response('invalid url', { status: 400, headers: CORS_HEADERS });
    }
    if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
      return new Response('host not allowed', { status: 403, headers: CORS_HEADERS });
    }

    let upstream;
    try {
      upstream = await fetch(targetUrl.toString(), {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        cf: { cacheTtl: 0 },
      });
    } catch (e) {
      return new Response('upstream fetch failed: ' + e.message, { status: 502, headers: CORS_HEADERS });
    }

    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
      },
    });
  },
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};
