# 운영·복구 안내 (한 장)

이 앱은 **서버 없이 GitHub만으로** 돌아간다. 내 자산 데이터는 **내 브라우저(localStorage)에만** 있고, 저장소에는 화면 코드와 가상 샘플만 있다.

## 1. 어디를 고치면 어디로 나가나

| 바꾸고 싶은 것 | 고칠 곳 | 반영 |
|---|---|---|
| 포트폴리오·현금흐름·홈·**매매전략 화면**·나란히 비교·풀다운 | 이 저장소 (`portfolio-retirement-dashboard`) | `main`에 push → 자동 배포 |
| 종목 추가, 신호 계산·알림 규칙, ETF 매칭 규칙(`signal_bot/proxies.py`), 금리·공포지수 데이터 | 전략 저장소 (`kis-buy-signal`) | `main`에 push → **바로 `daily.yml` 수동 실행 1회**(`gh workflow run daily.yml -R withgest-lab/kis-buy-signal --ref main`) → data 브랜치 발행 → 이 저장소 배포. 다음 정기 실행까지 기다리지 않는다(Claude는 엔진 수정 검증 때 항상). 로컬에서 KIS API를 부른 직후 1분 안에는 실행 금지(토큰 발급 1분 1회) |
| 시세·신호 데이터 | 자동 — 평일 미국 정규장 마감 직후(16:02 ET, 겨울 06:02·여름 05:02 KST) 전략 저장소 `us-close-timer.yml`이 `daily.yml`을 실행, 주말·대체 실행은 매일 07:30 KST 예약 | 이 저장소 `signals-watch.yml`이 새 데이터가 올라오는 즉시 배포(약 06:15 KST). `deploy.yml`도 2시간마다 확인(대체) |

```
[전략 저장소 us-close-timer.yml] 마감 몇 시간 전부터 여러 번 깨어나 16:02 ET까지 대기 → daily.yml 실행
[전략 저장소 daily.yml: 16:04 ET까지 대기·SPY 확인 → 시세→신호→텔레그램]
        └─ data 브랜치에 scores.json + detail/*.json 발행
                          │  (signals-watch.yml: 마감 뒤 30초마다 확인 → 올라오면 바로 / deploy.yml: 2시간마다)
[이 저장소 deploy.yml] ◀──┘
   화면(main) + 데이터 스냅샷 → 무결성 점검 통과 시에만 GitHub Pages 배포
```

- 두 저장소를 잇는 것은 **공개 JSON 데이터뿐**이다. 비밀 토큰으로 서로를 호출하지 않는다.
- GitHub 예약 실행은 몇 시간씩 밀린다(2026-11: 07:30 예약이 실제 11~13시 시작). 그래서 타이머·감시 워크플로는 마감 몇 시간 전부터 매시 깨어나고, 먼저 깨어난 것이 정해진 시각까지 기다린다(같은 저장소 실행은 `GITHUB_TOKEN`으로 가능, 공개 저장소라 대기 비용 없음).
- 배포 직전 점검(`deploy.yml`의 *Validate strategy data*)이 실패하면 **직전 정상 배포가 그대로 유지**된다. 실패 메일이 오면 Actions 로그의 `::error::` 줄을 본다.
- 어떤 데이터로 배포됐는지: `https://withgest-lab.github.io/portfolio-retirement-dashboard/signals/_source.json` (`data_sha`, `as_of_date`, `built_at`).

## 2. 무엇이 사라지면 → 어떻게 복구하나

| 상황 | 복구 |
|---|---|
| 브라우저 데이터 삭제·새 기기 | 포트폴리오 우측 상단 **백업 / 복원 → JSON 파일 선택**. 백업 파일이 있어야 한다 |
| 백업을 오래 안 했다 | 💾 버튼에 빨간 점이 뜬다(30일 초과·없음). 열어서 JSON 다운로드 후 **저장소 밖**(구글 드라이브 등)에 보관 |
| 전략 데이터(`data` 브랜치)가 깨졌다 | 전략 저장소 Actions → *KIS 매수신호 알림* → **Run workflow**. 끝나면 이 저장소 Actions → **Run workflow** |
| MDD 기준 캐시 만료 | 자동 재수집(첫 실행은 10분 이상 걸릴 수 있음) |
| 일일 실행이 실패했다 | 텔레그램에 "실행이 실패했습니다" 알림이 온다. 실행 기록 링크에서 어느 단계인지 확인 |
| 아침에 매매전략이 안 바뀌었다 | 전략 저장소 Actions → *미국장 마감 타이머* 기록(대기·실행 요청 줄), 이 저장소 *매매전략 데이터 마감 직후 배포* 기록 확인. 급하면 *KIS 매수신호 알림* → **Run workflow** 뒤 이 저장소 *Deploy* → **Run workflow** |
| 한국투자증권 키 만료·교체 | 전략 저장소 Settings → Secrets: `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_ACCT_NO` 갱신 후 수동 실행 |
| 텔레그램 봇 교체 | Secrets `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` 갱신 |
| 시세 프록시(Cloudflare Worker) 장애 | `portfolio/cors-worker.js`를 Cloudflare Worker로 다시 배포하고 `portfolio/index.html`의 주소 갱신 |
| Pages가 안 뜬다 | 이 저장소 Settings → Pages → Source = **GitHub Actions**. (전략 저장소 Pages는 `data` 브랜치 `/docs` — 안내 페이지만 있음) |
| 저장소 자체가 지워질 위험 대비 | 월 1회 `git bundle create 저장소밖경로/portfolio.bundle --all` 후 보관, 또는 로컬 clone 유지. 복원은 `git clone 번들파일` |
| 스케줄이 멈췄다(60일 무활동) | `deploy.yml`의 keepalive가 50일째에 빈 커밋을 남겨 막는다. 그래도 멈췄으면 Actions 탭에서 워크플로 *Enable* |

## 3. 연 1회 점검 체크리스트

- [ ] GitHub 계정 **2단계 인증** 켜져 있는지 (Settings → Password and authentication)
- [ ] GitHub **이메일 비공개**: Settings → Emails → *Keep my email addresses private* + *Block command line pushes that expose my email*
- [ ] Secrets 5개가 아직 유효한지(한국투자증권 앱키 만료일, 텔레그램 봇), 필요하면 교체
- [ ] Dependabot PR(월 1회 액션 버전) 확인·병합
- [ ] 백업 JSON이 저장소 밖에 있고 최근 것인지

## 4. 개인정보 규칙 (공개 저장소)

- 두 저장소는 **공개**다. 코드·기본값·테스트에 **실제 잔액·보유 수량·평단·실제 이메일을 넣지 않는다.** 기본값은 가상의 둥근 수치만 쓴다.
- 커밋 작성자 이메일은 GitHub 비공개 주소(`<번호>+<아이디>@users.noreply.github.com`)를 쓴다 (`git config --global user.email`).
- 백업 JSON·번들 파일은 저장소 밖에 둔다(`.gitignore`가 `*백업*.json`, `포트폴리오-백업-*`, `*.bundle`을 막아 둠).
- 과거 이력에서 개인 수치와 이메일을 제거하려고 이력을 한 번 다시 썼다(2026-10-05). 그 전의 사본·캐시된 커밋 주소는 GitHub에 남아 있을 수 있어, 필요하면 GitHub Support에 *cached views / orphaned commits 삭제 요청*을 넣는다. 이력 정리 전 전체 백업은 저장소 밖 `_backup/*.bundle`에 있다(개인 수치가 들어 있으니 공유 금지).
