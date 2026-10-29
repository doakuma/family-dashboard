# family-dashboard

HomeSweetHome: 가족이 슬랙에 말하면 일정·할 일·기념일이 위키(`family-wiki` 레포)에 기록되고,
거실 태블릿 대시보드에 보이는 서비스. 기준 문서는 MVP 스펙이다(바뀌면 스펙 먼저, 코드는 그다음).

## 구조

```
apps/dashboard   Next.js App Router. 태블릿 화면 + /api/state + /setup
apps/bot         Node + Slack Bolt (Socket Mode)
packages/core    공통 타입·어댑터 인터페이스·날짜 유틸·위키 파서/apply (브라우저 안전)
packages/core/node  FsWikiRepository (Node 전용: 파일 + git)
fixtures/sample-wiki  예시 가족 위키 (개발·시안·테스트용)
```

## 원칙

- 위키가 원본이다. 구글 캘린더는 알림용 복사본이다.
- LLM은 메시지를 `Change`로 바꾸기만 한다. 파일 쓰기는 `WikiRepository.apply`가 결정적으로 처리한다.
- 위젯은 `@hsh/core` 타입만 안다. 입력·저장·외부 서비스는 어댑터 뒤에 둔다.
- 위젯은 재사용 가능한 컴포넌트로 만들고, 데이터 어댑터와 분리한다.
- 태블릿 화면은 보기 전용이다. 입력 UI, 누를 수 있어 보이는 모양을 쓰지 않는다.
- 레이아웃은 고정 px 대신 fr·minmax 기반 CSS Grid로 만든다.
- 캐릭터·테마는 오리지널만 쓴다. 기존 IP 캐릭터는 금지한다.
- 비밀값은 `.env`에만 둔다. `.env`를 읽거나 커밋하지 않는다.

## 하네스 (2인 팀)

- 구현은 `hsh-engineer`, 검토는 `hsh-reviewer`(코드 수정 금지). 결정 기록: `docs/decisions/0001-two-person-harness.md`.
- 할 일과 통과 여부는 `features.json`, 진행 로그는 `progress.md`. 작업을 시작하기 전에 둘 다 읽는다.
- 끝내기 전 `pnpm check`(typecheck + lint + test) 통과가 필수다.
- 위키(`family-wiki`, `WIKI_REPO_PATH`)는 직접 고치지 않는다. 훅이 막는다. 테스트·시안은 `fixtures/sample-wiki`를 쓴다.
- 오너에게 올릴 것: 스펙 변경, 비용, 계정·키, 되돌리기 어려운 작업, 화면 디자인·캐릭터, 두 번 실패한 문제.

## 명령

```bash
pnpm install
pnpm typecheck          # 전체 타입 체크
pnpm --filter @hsh/dashboard dev
pnpm --filter @hsh/bot dev
pnpm --filter @hsh/bot try "다음 주 화요일 3시 하늘 치과"   # 슬랙 없이 의도 추출 시험
pnpm check              # typecheck + lint + test
pnpm build
```
