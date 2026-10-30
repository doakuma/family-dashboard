# 진행 로그

최신이 아래. 한 항목 3~5줄: 날짜 · 할 일 번호 · 한 일 · 남은 문제.

## 2026-10-29 · #1 #4 #5
- family-wiki 기본 구조·CLAUDE.md, 모노레포 골격(dashboard·bot·core), 스펙 타입 옮김.

## 2026-10-29 · 하네스
- 2인 팀: `.claude/agents/hsh-engineer.md`(수정 후 tsc+eslint 훅), `hsh-reviewer.md`(쓰기 금지, 채점 4항목).
- `.claude/settings.json`: deny 목록 + 위키 보호 PreToolUse 훅. 두 훅 모두 막는 경우·통과 경우 직접 확인.

## 2026-10-29 · #2 #6 #7
- 스펙 먼저 수정(rev 31): config.md 형식, 구성원 `role`, `@family` 내장, LLM_PROVIDER.
- core: 위키 파서·직렬화(`wiki/format.ts`), 순수 `applyChange`, `readWiki`, `FsWikiRepository`(쓰기 큐 + commit + push + pull).
- 테스트: 왕복 변환, 깨진 줄 무시, 달 이동, 동시 쓰기 순서, 위키 밖 경로 거부, bare 원격 push.

## 2026-10-29 · #8 (부분)
- `LlmClient` 어댑터: Ollama(로컬, structured output) / Anthropic. 응답은 zod 검증 후 코드가 Change로 보정.
- 상대 날짜는 프롬프트에 3주 달력 표를 넣어 LLM이 찾게 하고, 코드가 날짜 범위·형식·구성원·대상 id를 다시 검사.
- 남은 문제: 실제 모델 정확도 미검증 → `pnpm --filter @hsh/bot try "메시지"`로 노트북에서 확인.

## 2026-10-29 · #13 #14 #15 #16 (시안)
- `/api/state`(예시 날씨), 위젯 6종 + 야간 화면 + 마지막 갱신 + 세팅 필요 QR 화면.
- 1280×800·1920×1200 스크롤 없음 확인. 캡처: `docs/screens/`. `?at=ISO&mode=night`로 시각 고정 미리보기.
- 남은 문제: 리뷰어 검토 전, 실제 태블릿 해상도 확인 전(#24).

## 2026-10-29 · #14 버그 수정
- 시계 hydration 불일치: 서버와 클라이언트가 각자 `new Date()`로 첫 렌더 → 서버 렌더 시각(`updatedAt`)으로 시작하고 마운트 후 실제 시각으로 바꿈.
- 브라우저 콘솔 오류 없음 확인(실시간·고정 시각 모두).

## 2026-10-30 · 리뷰 반영 (#14 되돌림, #5 #7 #8 #13 #15 #16)
- #14: 오늘 일정 칸 `min-width:0`으로 긴 제목 말줄임. 스트레스 픽스처(긴 제목·하루 8건) 1280×800·1024×600 겹침 없음, 캡처 `docs/screens/stress-agenda-1280.png`. #14 passes=false 유지(재리뷰 대기).
- #7: pull 큐잉, commit 실패 시 파일·스테이징 롤백, `{commit, pushed}` 분리, 독립 git 루트 확인. #5·#4: applyChange가 changeSchema로 재검증, Member·FamilyConfig 스키마를 읽기·쓰기 공용, frontmatter 줄바꿈 거부. #8: 후보 여럿이면 선택 후 끝 시간 계산, LLM 응답 검증·timeout.
- #13 #16 #15: /api/state zod 검증+needsSetup, 세팅 화면↔대시보드 폴링 전환, 글자 명암비 4.5:1(야간 muted·warn 조정), dashboard 테스트 포함, `docs/wiki-format.md` 추가.
- 남은 문제: 오너 결정 대기(Change 유니언 확장, PIN 저장 위치, passes 정의). `/api/state`는 아직 인증 없음(#17). Anthropic 호출·실제 Ollama 미검증, 태블릿 실기기 확인은 #24.
