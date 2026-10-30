# 0003. 서비스 전환 대비: 확장 이음새 5가지와 위키 암호화 방향

- 날짜: 2026-10-30
- 상태: 채택 (오너 결정). 스펙 반영 대기

## 배경
- 지금 구조(위키 = git 레포, 노트북 서버)는 git을 다룰 수 있는 가정만 쓸 수 있다.
- 로드맵 2단계(가정용 템플릿 판매)는 두 갈래가 가능하다.
  - A. 셀프호스팅 템플릿: IT에 밝은 가정 대상, git 그대로.
  - B. 호스팅 서비스: 일반 가정 대상, 가입 + 슬랙 연결만.
- 지금 A/B를 고르지 않는다. 대신 둘 다 열어 두는 이음새를 MVP에 심는다.

## 결정

### 확장 이음새 5가지 (MVP부터 지킨다)
1. **`familyId`**: core 도메인 타입과 저장소 경계에 처음부터 둔다. MVP에서는 값이 하나여도 된다.
2. **`WikiRepository`에 git 개념을 노출하지 않는다**: commit·branch·sha 대신 `version`(또는 etag) 같은 중립 이름을 쓴다. git 세부는 `FsWikiRepository` 안에만 둔다.
3. **`ConfigProvider`**: 설정·비밀값은 이 인터페이스로 받는다. MVP는 `.env` 구현, 서비스는 DB/비밀 저장소 구현.
4. **`LlmAdapter`**: 모델·키·제공자를 봇 코드 밖에 둔다. BYOK와 서비스 키+사용량 과금 어느 쪽도 가능하게.
5. **슬랙 토큰은 `installationStore` 형태로 조회**: MVP는 토큰 하나를 돌려주는 구현. 서비스는 워크스페이스별 OAuth 설치.

### 서비스 전환 시 바뀌는 것 / 안 바뀌는 것
- 안 바뀜: 위젯·스킨 토큰, 도메인 타입, "LLM은 `Change`만, 쓰기는 코드가" 파이프라인, `MessengerAdapter`.
- 바뀜: `FsWikiRepository` → `DbWikiRepository`(가족별 마크다운 문서를 DB에 저장, 내보내기 유지), 단일 가족 → 멀티 테넌트, Socket Mode → HTTP 이벤트, 노트북 → 클라우드.

### 위키 데이터 암호화
- 기본: `family-wiki`는 private + 2FA + 그 레포로 한정한 deploy key + 노트북 디스크 암호화.
- 민감 정보(연락처·주소·아이 학교 정보 등)는 `private/` 폴더로 분리하고 **이 폴더만 처음부터 git-crypt로 암호화**한다. 일정·할 일·기념일은 평문(diff·LLM 접근 유지).
- **실제 가족 데이터를 처음 push하기 전에** 적용한다. git 기록은 영구라 나중에 암호화해도 과거 평문이 남는다.
- 저장 금지: 주민번호·계좌·카드·비밀번호. `docs/wiki-format.md`에 명시하고, 봇이 이런 패턴을 감지하면 저장을 거부한다.
- 약속 범위를 구분한다: "운영자도 데이터를 못 본다"는 **셀프호스팅에서만** 성립한다. 호스팅 서비스는 LLM 처리를 위해 서버가 평문을 다루므로 저장 시 암호화 + 가족별 키(봉투 암호화) + 운영자 접근 기록·최소화로 대응한다.

## 이유
- 이음새 5가지는 지금 비용이 거의 없고, 나중에 넣으면 타입·호출부 전체를 고쳐야 한다.
- 저장 방식은 이미 어댑터(`WikiRepository`) 뒤에 있어 교체 비용이 국소적이다.
- 전체 암호화는 LLM Wiki 취지(사람·LLM이 마크다운을 직접 읽음)와 충돌하므로 민감 폴더만 암호화한다.

## 현재 코드와의 차이 (2026-10-30 기준, #32에서 1~5번 반영)
- 반영됨(1) `familyId`: core에 브랜드 타입 `FamilyId`(`asFamilyId`·`isFamilyId`, MVP 값 `DEFAULT_FAMILY_ID="default"`, 설정 `HSH_FAMILY_ID`). `DashboardState`/`WikiState.familyId`, `WikiRepository.read/apply/applySetup`의 첫 인자. `FsWikiRepository`는 생성 옵션 `familyId`(폴더 하나 = 가족 하나)를 갖고 다른 id로 부르면 `FamilyMismatchError`. 위키 파일 형식은 그대로이고 `toPublicState`(/api/state)는 내보내지 않는다(테스트). 봇 메시지(`IncomingMessage`)에 가족을 싣는 것(설치 -> 가족 매핑)은 서비스 전환 때.
- 반영됨(2) 결과 중립화: `apply`·`applySetup`이 `WriteResult { version, synced, syncError? }`를 돌려준다. `FsWikiRepository`의 `version`은 커밋 sha이고 git 용어는 구현 클래스 안에만 있다. 대시보드 응답(`/api/setup/complete`)은 `{ok, synced, syncError?}`만 내보내고 version은 서버 로그에 남긴다.
- 반영됨(3) `ConfigProvider`: core 포트 `get(key)`와 키 타입 `AppConfig`(familyId·nodeEnv·port·wikiRepoPath·dashboardBaseUrl·adminPinHash·llm·slack). MVP 구현 `EnvConfigProvider`(`@hsh/core/node`, 호출마다 env를 읽음). 대시보드는 서버 전용 `lib/config.ts`(`server-only`)로만 쓴다. `llm` 키는 읽을 때만 검증한다. 앱 코드의 `process.env`는 eslint가 막고, 예외는 `server.ts`(Next보다 먼저 뜨는 부트스트랩, Node가 직접 실행해 core를 못 불러옴)와 `proxy.ts`(서버가 만든 내부 증명 비밀값)뿐. `loadEnvConfig` 선로딩 유지.
  - 판단: 포트는 동기(`get`)로 했다. 환경 변수는 이미 메모리에 있고, DB 구현은 시작할 때 읽어 캐시하게 한다. 가족별 값(adminPinHash 등)이 필요해지면 `get(key, familyId)`로 넓힌다.
- 반영됨(4) `LlmAdapter`·`LlmRequest`는 core 포트(`ports.ts`), 봇은 포트만 안다(`extractIntent(…, llm: LlmAdapter)`). 구현(Ollama/Anthropic)과 `createLlmAdapter(LlmConfig)`는 봇에 둔다 - SDK 의존이 봇에만 필요하고 core는 브라우저에서도 불러서. 설정은 `config.get("llm")`.
- 반영됨(5) 슬랙: `EnvInstallationStore`(Bolt `InstallationStore` 호환, `fetchInstallation()`이 env 토큰 하나를 돌려줌)와 `authorizeWith(store, whoami)`. Bolt는 저장소를 직접 쓰려면 OAuth 설치 설정(clientId 등)이 필요해서 `authorize` 훅으로 잇는다. 봇 id는 `auth.test`로 한 번 채워 캐시. Socket Mode(`appToken`)는 그대로.
- 남음: git-crypt 세팅, 키 백업 절차, 금지 패턴 필터 -> 할 일 추가 필요(별도).
