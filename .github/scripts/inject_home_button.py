"""배포 시점에 kis-buy-signal에서 그대로 받아온 signals/index.html에 "홈으로" 이동
버튼을 심는다. kis-buy-signal 저장소(그 사이트 단독 방문자도 있음)는 절대 건드리지
않고, 여기(portfolio-retirement-dashboard)의 빌드 산출물에만 삽입한다.

<body> 태그를 앵커로 쓰는 이유: kis-buy-signal/docs/index.html의 내부 구조(클래스명 등)가
나중에 바뀌어도 <body>는 항상 존재하므로, 그 저장소를 계속 신경 쓰지 않아도 되는
가장 견고한 삽입 지점이다. 스니펫 자체도 그 페이지의 CSS 변수/클래스에 의존하지 않는
완전 독립형(인라인 색상, 라이트/다크 하드코딩)으로 작성했다.
"""

import sys
from pathlib import Path

SNIPPET = """
<a href="../" class="pr-home-fab" title="홈으로" aria-label="홈으로 이동">🏠</a>
<style>
.pr-home-fab{position:fixed;top:8px;left:8px;z-index:99999;width:32px;height:32px;
  border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:15px;text-decoration:none;border:1px solid rgba(11,11,11,0.10);
  background:#f2f1ee;color:#52514e;box-shadow:0 1px 4px rgba(0,0,0,0.15);}
.pr-home-fab:hover{background:#e7e5e0;}
@media (prefers-color-scheme: dark){
  .pr-home-fab{border-color:rgba(255,255,255,0.10);background:#232322;color:#c3c2b7;}
  .pr-home-fab:hover{background:#2c2c2a;}
}
body.fullscreen-open .pr-home-fab{display:none;}
</style>
"""


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: inject_home_button.py <path-to-signals-index.html>")

    path = Path(sys.argv[1])
    html = path.read_text(encoding="utf-8")

    marker = "<body>"
    if marker not in html:
        # 배포가 부분/깨진 상태로 나가면 안 되므로, 예상한 앵커가 없으면 이 스텝
        # 자체를 실패시켜 build job을 막는다(그러면 deploy job도 돌지 않아 직전
        # 정상 배포가 그대로 유지된다).
        sys.exit(f"ERROR: <body> tag not found in {path} - aborting build")

    html = html.replace(marker, marker + SNIPPET, 1)
    path.write_text(html, encoding="utf-8")
    print(f"Injected home button into {path}")


if __name__ == "__main__":
    main()
