# portfolio-retirement

UI(버튼·토글·배너·아이콘·글자색/배경색 조합·카드·팝업·차트·레이아웃)를 만들거나 고치는 작업은 **반드시 먼저 `ios-design` 스킬(`.claude/skills/ios-design/SKILL.md`)과 `portfolio/DESIGN_GUIDELINES.md`를 읽고 그 규칙(iOS 디자인 컨셉, Fold7 3상태 한 화면 맞춤, 빈 여백 스크롤 금지, **한 화면 중복 워딩 금지**)을 따른다.** 사용자가 따로 지정하지 않은 세부 스타일은 iOS 기본값으로 정하고, 보고 전에 스킬 8절의 Playwright 실측 검증(중복 문구 검사 `dup-check.js` 포함)을 마친다.

**공개 저장소 규칙**: 이 저장소와 `kis-buy-signal`은 공개다. 코드·기본값·테스트에 **실제 잔액·보유 수량·평단·실제 이메일을 넣지 않는다**(가상의 둥근 샘플만). 백업 JSON은 저장소 밖에 둔다. 화면은 이 저장소에서만 고치고, `kis-buy-signal`은 데이터 엔진이다(운영·복구는 `RECOVERY.md`).
