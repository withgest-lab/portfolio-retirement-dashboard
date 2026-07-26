# 포트폴리오 · 은퇴 현금흐름 대시보드

자산 포트폴리오 대시보드와 은퇴 후 현금흐름 시뮬레이션을 하나로 통합한 정적 웹사이트입니다.
빌드 도구 없이 순수 HTML/JS로 동작하며, 모든 데이터는 브라우저 `localStorage`에만 저장됩니다.

- 📊 [자산 포트폴리오](./portfolio/) — 이전: [-New-portfolio-dashboard](https://withgest-lab.github.io/-New-portfolio-dashboard/)
- 🧮 [은퇴 후 현금흐름](./retirement/) — 이전: [Retirement-dashboard-](https://withgest-lab.github.io/Retirement-dashboard-/)

## 구조

```
/
├── index.html         # 랜딩 페이지 (두 대시보드로 이동)
├── portfolio/
│   └── index.html     # 자산 포트폴리오 대시보드
├── retirement/
│   └── index.html     # 은퇴 후 현금흐름 시뮬레이션
└── shared/
    └── bridge.js       # 포트폴리오 잔액 → 은퇴 계좌 잔액 집계 (localStorage 읽기 전용)
```

## 포트폴리오 ↔ 은퇴 연동 방식

1. 포트폴리오에서 개인연금(`pension_personal`) 자산을 추가/수정할 때 **세부계좌(농협/미래에셋)**를 지정할 수 있습니다.
2. 은퇴 대시보드의 각 계좌 섹션(농협·미래에셋 연금저축, IRP, 퇴직연금, ISA)에 있는
   **"🔗 포트폴리오 값으로 채우기"** 버튼을 누르면, `shared/bridge.js`가 포트폴리오의
   `pf_assets_v1` 데이터를 읽어 계좌별 잔액(KRW 환산, 만원 단위)을 계산해 채워줍니다.
3. 필드가 🔓(잠금 해제) 상태로 사용자가 직접 값을 수정한 경우에는 자동으로 덮어쓰지 않습니다.
   다시 자동 연동을 받으려면 🔒(잠금) 상태로 되돌리면 됩니다.
4. 개인연금 자산 중 세부계좌가 지정되지 않은 항목은 농협/미래에셋 어느 쪽에도 합산되지 않고,
   버튼 클릭 시 별도 경고 메시지로 안내됩니다.

국민연금 수령액, 계좌별 예상 수익률, 물가상승률, 월 생활비, 비공제원금 등 포트폴리오에
존재하지 않는 개념은 계속 은퇴 대시보드에서 수동으로 입력합니다.

## 보안 메모

- 신규 백엔드/서버 없음 — 정적 파일 + 브라우저 `localStorage`만 사용합니다.
- `shared/bridge.js`는 외부 요청을 전혀 하지 않고, `localStorage`를 읽어 집계만 수행합니다.
- 시세 조회(포트폴리오)는 야후 파이낸스/네이버 API를 CORS 프록시로 호출하며, 이때 전송되는 값은
  티커 심볼뿐이고 계좌 잔액·개인 재무 정보는 전송되지 않습니다.
- 실제 자산·잔액 데이터는 코드/커밋에 포함되지 않고, 각 사용자의 브라우저 `localStorage`에만 남습니다.

## 로컬 실행

```
npx serve .
```

또는 VS Code의 Live Server 확장 등으로 정적 서버를 띄운 뒤 `index.html`을 엽니다.
`file://`로 직접 열면 일부 브라우저에서 `localStorage`/모듈 로드가 제한될 수 있습니다.
