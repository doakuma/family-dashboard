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
