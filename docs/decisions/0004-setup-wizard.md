# 0004. /setup 마법사 6단계 (#18)

- 날짜: 2026-10-30
- 상태: 구현 완료, 리뷰 대기 (스펙 rev 53 기준. 스펙과 다른 점은 맨 아래 "스펙과 다른 점")

## 결정

### 쓰기: `WikiRepository.applySetup(familyId, setup, { overwrite? })`
- `Change` 유니언은 늘리지 않았다. LLM·봇 경로에서는 부를 수 없는 별도 메서드이고, 입력 타입은 `SetupInput`(config + members + anniversaries).
- `FsWikiRepository`는 쓰기 큐 안에서 한꺼번에 처리한다: 검증(`setupSchema`) -> 세팅 필요 판정 -> 덮어쓰기 확인 -> 파일 계산(`buildSetupFiles`, 순수 함수) -> 커밋 하나 -> push. `apply`와 같은 `commitFiles`를 쓴다(파일 쓰기, 경로 지정 커밋, 실패 시 파일·index 롤백, push 실패는 `synced:false` - 결과는 `{version, synced, syncError?}`, #32에서 git 용어 중립화).
- 파일: `config.md`(+`setupCompletedAt`, Asia/Seoul +09:00), `members/<id>.md`, `anniversaries.md`(MM-DD 순, 같은 줄은 한 번), 그리고 `log.md` 한 줄(`[setup]`). 커밋 메시지 `[setup] 가족 세팅: 햇살네 (구성원 2명, 기념일 3건)`, 작성자 `setup`.
- **세팅이 필요할 때만 쓴다**(needsSetup = config가 없거나 구성원 0명). 아니면 `SetupError("already_done")` -> HTTP 409. 두 번 눌러도 큐 안에서 판정하므로 한 번만 쓴다(테스트).
- 세팅 전이지만 이전 세팅 파일(config.md·members/*.md·기념일)이 남아 있으면 `needs_confirm`(409). 화면은 6단계에 "덮어쓰기" 체크를 보여 주고 `overwrite:true`로 다시 보낸다. 덮어쓰면 목록에 없는 이전 `members/*.md`는 지우고(같은 커밋, 롤백 시 복원) 기념일 파일은 새 내용으로 대체한다. 위키(git)에는 이전 내용이 남는다.
- 거부 사유는 `SetupError.code`: `invalid`(422, 필드별 issues) · `already_done`/`needs_confirm`(409) · `read_only`(503). 그 밖의 오류(git 등)는 500으로 일반 문구만 내보내고 상세는 서버 로그.
- 대시보드는 읽기용 저장소(`push:false`)와 별도로 **쓰기용 저장소**(push 켬, 작성자 `setup`, `globalThis`에 하나)를 둔다. `WIKI_REPO_PATH`가 없으면 503(`read_only`) — 개발 중 예시 위키는 읽기 전용이라 마법사를 끝까지 못 간다(의도).

### 검증
- `setupSchema`(core)가 서버의 최종 방어선: 기존 `memberSchema`·`familyConfigSchema` + 묶음 규칙(구성원 1~12명, **보호자 1명 이상**, id 대소문자 무시 유일(Windows 파일명), 기념일 구성원은 등록 id 또는 family, 존재하는 MM-DD(2/29 허용), 격자·지역코드 네 값은 모두 있거나 모두 없음, nx 1~149·ny 1~253, 캘린더 ID는 메일 주소 꼴, 따옴표로 감싼 값 거부(프론트매터가 읽을 때 달라짐)).
- 화면은 같은 규칙을 한국어 메시지로 미리 검사한다(`lib/setup/validate.ts`). **"화면 검증을 통과한 값은 서버 스키마도 통과한다"**를 테스트로 확인하고, 6단계에서 서버 스키마로 한 번 더 본 뒤 보낸다. 서버가 422를 주면 `issues` 경로를 화면 필드로 되돌려(`serverIssuesToErrors`) 해당 단계로 돌아가 필드 옆에 보여 준다.
- 보호자 1명 이상은 스펙에 명시된 규칙은 아니다(아래 "스펙과 다른 점"). 보호자가 없으면 슬랙에서 아무도 일정을 쓸 수 없어 세팅이 쓸모없어지기 때문.

### 구성원 id · 색
- `memberIdSchema`(영문·숫자·`_`·`-`) 준수, `family`는 예약. 영문 이름이면 소문자 slug(`Mom` -> `mom`, 중복은 `-2`), **한글 이름은 로마자 변환을 하지 않고 `member-1`, `member-2`…**(비어 있는 가장 작은 번호). 이유: 한글 로마자 표기는 사람마다 달라 틀린 id를 만들기 쉽고, id는 사람이 볼 일이 거의 없다. 사용자는 각 카드의 "위키 id" 접이식 칸에서 직접 고칠 수 있고(영문 입력), 비우면 자동으로 돌아간다. 영문이 1글자뿐인 섞인 이름("민수2")도 `member-N`.
- 색은 `coral, teal, blue, amber, green, purple, pink` 순으로 겹치지 않게 자동 추천(7명 넘으면 가장 적게 쓰인 색). `gray`는 '가족 전체'용이라 구성원 후보에서 뺀다. 색 견본에는 이름(산호·청록…)을 같이 보여 색만으로 구분하지 않는다.
- '가족 전체'(@family)는 구성원 목록 아래 고정 줄("기본 · 삭제할 수 없어요")로만 보이고 파일은 만들지 않는다(읽을 때 내장으로 붙는다).

### 입력 상태는 어디에 두나
- **클라이언트 상태(React) + `sessionStorage`**(`hsh.setup.draft.v1`, try/catch, zod로 모양 확인, 완료 시 삭제). 서버 세션 메모리에 두지 않은 이유: (1) 세션 쿠키가 서명만 하는 무상태 방식(0002)이라 서버에 세션별 저장소가 없고, 만들면 정리·만료·재시작 처리가 늘어난다. (2) 서버 재시작 시 사라진다. (3) PIN·토큰은 저장하지 않으므로 sessionStorage에 민감 정보가 없다. 탭을 닫으면 사라진다.
- 서버로는 마지막에 **한 번만** 보낸다(`POST /api/setup/complete`, JSON). 중간 단계는 서버를 부르지 않는다.
- 세션(30분)이 중간에 끝나면 401 -> "QR을 다시 찍어 PIN을 입력하면 이어서 할 수 있어요. 입력한 내용은 이 화면에 남아 있어요". 같은 탭이면 sessionStorage가 입력을 살려 준다.

### 폼 전송: route handler (서버 액션 아님)
- `/api/setup/complete`가 #17의 방어를 그대로 거친다: 폼 출처(BASE_URL origin) -> 세션(`via=setup`) -> 본문 형식(`application/json`만, 415) · 길이 필수(411) · 32KB 상한(413) · 파싱 실패(400) -> `applySetup`(zod). 로그인 폼과 같은 `form.ts`에 `readSmallJson`을 추가했다.
- 서버 액션 대신 route handler를 쓴 이유: 위 검사를 #17 코드와 같은 모양으로 재사용, 상태 코드(409/422/503)를 명시적으로 돌려주고 e2e에서 HTTP로 직접 시험하기 쉽다.
- 성공하면: 남은 QR 토큰 전부 폐기(`revokeAll`, 태블릿이 중간에 받은 새 토큰 포함), 세션 쿠키 삭제. 세션은 서명형 무상태라 서버에서 폐기할 수 없으므로, 훔친 쿠키가 있어도 `/setup`·이 API는 needsSetup=false라 쓸 수 없게 막는다(e2e: 쿠키 재사용 -> 409, 마법사 대신 "이미 세팅이 끝났어요").
- 태블릿 전환은 기존 폴링(#16, 1분)에 맡긴다(e2e로 확인). 슬랙 환영 메시지는 #20.

### 화면
- 휴대폰 표면: 태블릿 CSS는 `html { font-size: clamp(11px, …) }`·`body { overflow: hidden }`이라 폰에서 11px·스크롤 불가가 된다. `[data-surface="phone"]`을 가진 화면에만 `html:has(...)`로 16px·스크롤을 준다(대시보드 화면 영향 없음). `/setup`의 PIN 화면도 감싸서 같은 기준(0002의 PinForm은 건드리지 않고 `page.tsx`에서 감쌈).
- 재사용 조각: `components/ui/form/`(Field, TextField, SelectField, ChoiceGroup, SwatchGroup, Button, Disclosure), `components/setup/`(StepFrame, 단계별 컴포넌트, DashboardPreview, SkinPreviewSlot, ConnectCodeSlot). 단계 컴포넌트는 `{draft, errors, onChange}`만 받는 표시 컴포넌트이고 상태 변경은 `lib/setup/draft.ts` 순수 함수를 거친다.
- 접근성: 모든 입력에 `label`, 오류는 `aria-invalid` + `aria-describedby`, 오류가 있으면 첫 오류 필드로 포커스(없으면 해당 안내로), 단계가 바뀌면 제목(`h1`)으로 포커스, 진행은 `role=progressbar` + "n/6", 오류 요약은 `role=alert`. 터치 대상 48px(e2e가 모든 입력·버튼·`summary`·라디오 라벨 높이와 가로 넘침을 검사), 입력 글자 16px(iOS 확대 방지), `inputmode`(숫자·이메일), 색 견본은 이름 병기, 고급 입력(id·시간대)은 접이식인데 오류가 생기면 펼치고 고치는 중에는 닫지 않는다.
- 색은 토큰만. 하드코딩 색 테스트의 검사 폴더에 `components/ui/form`, `components/setup`을 추가하고, 마법사·폼 파일에 `#hex`/`rgb()`가 없다는 테스트를 더했다(구성원 색 견본은 `palette.ts`의 이름->색 변환이라 예외). 대시보드와 같은 종이/잉크 톤, 강조는 `--ink` 한 가지.
- 1단계의 스킨 미리보기(#30) 자리는 `SkinPreviewSlot`(children이 없으면 렌더하지 않음). 3단계의 연결 코드 자리는 `ConnectCodeSlot`(코드가 없으면 `······`) — 발급·검증은 #19.
- 6단계 미리보기: 기존 `Dashboard`를 입력값으로 만든 `ApiState`(`toPublicState`)로 **1280×800 무대에 그린 뒤 폭에 맞춰 `transform: scale`로 줄인다**(`inert` + `aria-hidden`, 같은 내용을 위 요약이 읽어 줌). 일정·할 일은 비어 있고 날씨는 예시 데이터(화면에 "날씨는 예시예요" 표기).
- 지역: `regions.ts` 정적 표 + 직접 입력. 범위·출처·검증 상태는 `docs/regions.md`(대조 전 초안).

## 대안과 버리는 이유
- 단계마다 서버에 저장: 서버 상태·정리 로직이 늘고 세션이 무상태라 맞지 않는다.
- 한글 이름 로마자 변환으로 id 생성: 표기 불일치·오류 위험. member-N + 직접 수정으로 충분.
- `Change` 유니언에 `setup.apply` 추가: LLM 경로가 파일 형식을 건드릴 수 있게 되는 쪽으로 열린다(스펙 결정과도 어긋남).
- 미리보기를 iframe(`/setup/preview`)로: 입력값을 서버로 보내야 하고 인증·상태가 늘어난다.
- `zoom` CSS로 미리보기 축소: 브라우저별 차이. `transform` + ResizeObserver로 폭을 맞췄다.
- 세션 즉시 무효화를 위해 서명 키 교체: 다른 세션(/settings)까지 끊는다. needsSetup 게이트로 충분.

## 스펙과 다른 점
1. **`log.md`에 한 줄을 추가로 쓴다**(스펙 요약은 config.md + members/*.md + anniversaries.md). 위키의 모든 쓰기를 log.md에 남긴다는 규칙(wiki-format)과 맞추려는 것. 원하지 않으면 한 줄 지우면 된다(`fs-wiki.ts` applySetup).
2. **보호자 1명 이상 필수**와 **구성원 12명 상한**은 스펙에 없는 검증이다(슬랙에서 쓸 사람이 없는 세팅 방지, 입력 과다 방지). 오너 확인 필요.
3. `setupCompletedAt`은 서버 시각(Asia/Seoul, +09:00)이다. config.timezone이 다르더라도 이 값은 +09:00(MVP는 한국만).

## 못 한 것 / 남은 문제
- 슬랙 연결 코드 발급·검증(#19), 연결 테스트(#11), 슬랙 환영 메시지(#20), 재세팅·설정 변경(#22)은 하지 않았다. 자리와 안내만 있다.
- 지역표는 기상청 원본과 대조 전(docs/regions.md). 전국 표 없음.
- 실기기(iOS Safari·삼성 인터넷)에서 날짜 입력·sticky 하단 버튼·키보드 가림은 보지 못했다(Chromium 390×844만). #24에서 확인.
- 휴대폰이 `DASHBOARD_BASE_URL`이 아닌 주소(예: IP)로 접속하면 폼 출처 검사(0002)에 걸린다 — 기존 동작.
