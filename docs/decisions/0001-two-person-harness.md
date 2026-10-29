# 0001. 마일스톤 ①은 2인 팀(엔지니어 + 리뷰어)으로 진행

- 날짜: 2026-10-29
- 상태: 채택

## 결정
`hsh-engineer`(sonnet, 구현)와 `hsh-reviewer`(opus, 검토 전용, Edit/Write 금지) 두 에이전트로 시작한다.
8인 팀 설계는 보관하고 하네스 학습 Ch08에서 다시 판단한다. `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`는 Ch06 직전까지 켜지 않는다.

## 이유
- 할 일 26개 규모에서 7명을 직접 관리하는 리더 구조는 조율 비용이 더 크다.
- 구현과 검토를 나누는 것만으로 "자기 채점" 문제를 막을 수 있다.
- 결정적인 검사(tsc·eslint·위키 보호)는 에이전트 지시가 아니라 훅으로 강제한다.

## 장치
- engineer PostToolUse 훅: 바꾼 파일 패키지 `tsc --noEmit` + 그 파일 eslint, 실패 시 exit 2.
- 프로젝트 PreToolUse 훅: 위키 직접 수정·삭제 차단.
- `features.json`(할 일·통과 여부), `progress.md`(진행 로그).
