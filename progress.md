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
- 남은 문제: Change 유니언 확장은 오너 결정 대기(PIN 저장 위치·passes 정의는 결정됨: 0002). `/api/state`는 아직 인증 없음(#17). Anthropic 호출·실제 Ollama 미검증, 태블릿 실기기 확인은 #24.

## 2026-10-30 · #17 관리자 PIN, 내부망 접근 제한
- PIN은 `.env`의 `ADMIN_PIN_HASH`(scrypt+salt, `pnpm -s pin:hash`)만. QR 토큰(메모리, 30분, 일회용, `DASHBOARD_BASE_URL` 기반) -> PIN -> 세션 쿠키(HttpOnly·Strict·서명·30분), 5회 실패 15분 잠금. `/settings`는 PIN만. 결정 기록 `docs/decisions/0002`.
- 내부망: Next 16은 `proxy.ts`이지만 소켓 주소를 못 얻고 XFF는 위조 가능 -> `server.ts`(커스텀 서버)가 소켓으로 거르고 `x-hsh-peer`에 덮어써 넘김. `dev`/`start`가 `node server.ts`로 바뀜. `/api/state`는 `toPublicState`(허용 목록)로 축소, 나이는 서버가 `turns`로 계산.
- 검증: `pnpm check` 통과, `node apps/dashboard/e2e/auth.e2e.mjs`(Playwright, check에는 미포함) 통과.
- 남은 문제: 실제 사설망 밖 주소에서의 거부는 단위 테스트만(여기선 외부 소켓 불가). 토큰이 `/` HTML에 노출(PIN이 실제 방어선). `/setup` 마법사는 #18, `/settings` 본체 없음. 리뷰 전이라 passes=false. 태블릿 실기기·Windows 노트북에서 `node server.ts` 확인 필요(#24).

## 2026-10-30 · 재검토 반영 (#7 #15 #6 #14 + 스펙 rev 46·50)
- #7: pull 충돌 시 `rebase --abort`(autostash 복구)하고 오류 반환, rebase·merge 진행 중·detached HEAD면 apply·pull 거부, readOnly는 pull도 거부. 같은 줄 충돌 시나리오·human stage 보존 테스트. push 실패는 `pushError`+경고 로그, commit은 경로 지정(`-- rels`), 롤백은 index 항목을 원래 값으로 복구.
- #6 읽기 관용(rev 46): config·구성원은 필드 단위로 기본값 대체 + `readWiki().warnings`(대시보드 서버 로그에 변경 시에만 출력). 필수값(id·name·familyName)이 깨질 때만 파일을 버림. 쓰기 스키마는 엄격 그대로.
  결정: `setupCompletedAt`이 깨지면 없는 것으로 읽고 경고만 남긴다. `needsSetup`은 원래 config가 읽히는지+구성원 수만 보므로 QR 화면으로 바뀌지 않는다(테스트 있음).
- #14·#15: 오늘 일정은 남은 일정 먼저·지난 일정 아래(글자색 --muted), '외 n건' 제거, 재사용 `AutoScroll`(순환 판단은 `lib/auto-scroll.ts` 순수 함수, 터치 후 120초 재개, reduced-motion 순환 없음, 스크롤바 없음, 이 영역만 touch-action: pan-y). 야간 긴 제목 가로 넘침 수정, 야간/낮 모드와 별개의 톤 축(`data-tone`) 분리(구조만).
  명암비: --sunday·pop 글자색 토큰화(4.5:1 이상), 테스트가 CSS에서 글자색 토큰을 모아 검사하고 opacity 규칙도 계산에 반영(다른 달 날짜 .35는 면제로 등록, 오너 확인 필요). 스트레스 픽스처 `fixtures/stress-wiki`, `e2e/stress.e2e.mjs`(1280×800·1024×600 야간 scrollWidth==뷰포트, 낮 자동 순환·화면 스크롤 0·터치), 캡처 `docs/screens/stress-*`.
- 장부: features.json passes 정리(#1 #2 #4 #5 #14 #16 true, 나머지 false, review 필드 pass/pending/null), #27~#31 목록만 추가. CLAUDE.md 원칙 문구는 rev 50 취지로.
- 남은 문제: 키오스크 제스처 전역 차단·달력 터치는 #31(하지 않음). 실제 태블릿 터치·해상도는 #24.

## 2026-10-30 · #17 리뷰 되돌림 수정
- DNS 리바인딩: server.ts가 Host 허용 목록(BASE_URL host, localhost/127.0.0.1/[::1], 사설 IP 리터럴)만 받고 나머지는 403. 폼 출처 확인은 Host 대신 BASE_URL origin과 비교(개발 모드만 localhost 추가). `lib/auth/host.ts` + 테스트, e2e에 `Host: evil.example -> 403` 단계.
- x-hsh-peer 위조: server.ts가 시작 시 랜덤 비밀값을 env에 두고 `x-hsh-peer-proof`(HMAC)를 붙이고, proxy.ts가 timingSafeEqual로 대조. `next start` 단독은 헤더를 꾸며도 항상 403(e2e 갱신). 이동: stampPeer·PEER_HEADER는 `lib/auth/peer.ts`.
- Windows/PM2: engines >=22.18, `ecosystem.config.cjs`(대시보드+봇), server.ts 맨 앞 `loadEnvConfig`(@next/env 의존성 추가). setup-qr 응답 zod 검증, 로그인·세팅 폼 400/411/413/415, 잠금 안내에 남은 분, next ~16.4 고정(+zod 의존성).
- 오너 결정 반영: PIN 잠금 반복 시 2배(15·30·60분…, 상한 24시간), 성공하면 초기화(테스트 있음). 결정 0002에 기록.
- 검증: pnpm check, build, auth e2e 통과. #17은 passes=false 유지(재리뷰 전). 남은 문제: .env 로딩(PM2)·Windows 실행은 실제 노트북에서 확인 필요(#24), 실제 DNS 리바인딩 공격은 Host 위조 요청으로만 검증.

## 2026-10-30 · 리뷰 통과 후속 (#6 #14 #15 #17 + 장부)
- #6: role이 없거나 틀리면 child(최소 권한)로 읽고 경고(스펙 rev 51). 없음·틀림 테스트, docs/wiki-format.md 수정. 필드 관용 읽기(rev 46)는 그대로. 재리뷰 대기라 passes=false·review=pending.
- 낮은 항목: DdayList 색 점을 말줄임 밖 별도 칸으로, AutoScroll은 ResizeObserver/MutationObserver로 넘칠 때만 rAF(렌더 중 ref 쓰기 제거), 세로 미디어쿼리에서 .agenda contain:none, gitReason null 가드, lenient 불필요 캐스팅 제거, autostash 재적용 충돌 회귀 테스트 추가. AutoScroll·stress e2e 주석/단계명을 실제 검증 내용으로(전체 제스처 차단은 #31).
- 장부: #7 #15 #17 #14 passes=true review=pass 반영(오너 지시), $comment·hsh-engineer.md에 "리뷰 통과 뒤 코드가 바뀌면 review를 pending으로" 명시, #28 제목 dim 톤 변형, #31 수용 기준(핀치 줌 차단 e2e).
- 남은 문제: 세로 배치(.agenda contain:none)는 눈으로만 확인 필요(e2e 없음).

## 2026-10-30 · #14 #15 오너 디자인 결정 반영 (스펙 rev 52)
- 오늘 일정 자동 넘김 토글: 넘칠 때만 헤더 오른쪽에 48px 버튼(일시정지/재생 SVG, aria-label·aria-pressed). `AutoScroll`에 `paused`(제어형)·`onOverflowChange` 추가, 상태는 `usePersistedFlag`(localStorage, 실패 시 메모리). CLAUDE.md 원칙에 예외 한 줄.
- 지난 일정 흐림: 오늘 일정 opacity 0.45, 달력 0.5. 명암비 테스트 면제 표에 사유("오너 결정 2026-10-30")와 함께 등록(다른 달 날짜 면제는 그대로). D-day: 30일 이내 D-n 굵고 크게(`DDAY_SOON_DAYS`/`isSoon`, 경계 테스트).
- 검증: pnpm check, build, stress·auth e2e 통과(stress에 토글 단계 추가), stress-* 캡처 갱신. #14 #15는 passes=false, review=pending(리뷰 통과 후 코드 변경 규칙).
- 남은 문제: 흐림 정도(0.45/0.5)는 오너가 눈으로 최종 확인. 키보드 포커스 링·실기기 터치는 #24.

## 2026-10-30 · 리뷰 통과 정리 (#6 #14 #15)
- 리뷰어 재검토 통과 → features.json #6 #14 #15 passes=true, review=pass (오너 반영).
- 자동 넘김 토글 라벨을 "자동 넘김 멈춤"으로 고정하고 상태는 aria-pressed로만 전달(스크린리더 이중 읽기 방지), e2e 갱신.
- 남은 문제: 세로 배치 e2e 없음, 실기기 터치·포커스 링은 #24에서 확인.

## 2026-10-30 · #27 일정 share 필드 (스펙 rev 35, 필드만)
- `ShareGroupId`·`Event.share?`, `shareGroupIdSchema`(`^[a-z0-9_-]+$`), 파서/직렬화가 `@구성원` 뒤·`#id` 앞 `&그룹` 토큰 보존. `Change`에는 share가 없어 LLM이 만들거나 바꿀 수 없고(event.update도 기존 값 유지), 제목의 단어 앞 `&`는 쓰기 거부·봇 cleanTitle이 제거.
- 깨진 토큰(대문자·2개 이상·빈 `&`)은 줄을 살리고 share만 무시 + `readWiki().warnings`. `toPublicState`는 share를 내보내지 않음(테스트). sample-wiki에 `&cousins` 일정(evt-2b13) 추가, docs/wiki-format.md 갱신.
- 검증: pnpm check 통과. 남은 문제: 그룹 id 대문자 허용 여부는 아래 보고 참고(소문자로 결정), 공유 동작·그룹 정의는 후속.

## 2026-10-30 · #18 /setup 마법사 6단계
- 쓰기: `WikiRepository.applySetup(setup, {overwrite?})`(Change 확장 없음). 쓰기 큐 안에서 검증 -> needsSetup 판정(아니면 409) -> config.md·members/*.md·anniversaries.md(+log.md)를 커밋 하나로, 실패 시 파일·index 롤백, `{commit, pushed}`. 남은 세팅 파일이 있으면 `needs_confirm`(덮어쓰기 확인), 확인하면 이전 구성원 파일도 같은 커밋에서 삭제. `setupSchema`·`regions.ts`(서울 25구·인천·경기 32곳 + 직접 입력).
- 화면: 휴대폰 6단계(우리 집·구성원·슬랙 자리·기념일·캘린더·확인/미리보기). 입력은 클라이언트 상태+sessionStorage, 마지막에 `POST /api/setup/complete`(#17 출처·세션·본문 제한·zod). 완료하면 토큰 전부 폐기·쿠키 삭제. 한글 이름 id는 member-N(직접 수정 가능). 결정 `docs/decisions/0004`, 지역표 `docs/regions.md`.
- 검증: pnpm check(369 테스트)·build, e2e 3종(auth 수정 1줄·stress·setup 15단계: 빈 위키 -> QR -> PIN -> 6단계 -> 위키 커밋 1개 확인 -> needsSetup=false -> 태블릿 전환) 통과. 캡처 `docs/screens/setup-*.png`.
- 남은 문제: 지역표는 기상청 원본과 대조 전. 실기기(iOS/삼성 인터넷) 날짜 입력·하단 고정 버튼 미확인(#24). 스펙에 없는 검증(보호자 1명 이상, 12명 상한)·log.md 한 줄은 오너 확인 필요. #17 파일 4곳을 덧붙임 수정해 #17 review를 pending으로 돌림.

## 2026-10-30 · #27 리뷰 되돌림 수정 (스펙 rev 54)
- 그룹 id를 구성원 id와 같은 형식(`^[A-Za-z0-9_-]+$`)으로, 비교 헬퍼 `sameShareGroup`(대소문자 무시) 추가. 깨진 `&`토큰(2개 이상·`&`단독·`&bad!`)은 파서가 심볼 키 내부 필드로 원문을 들고 있다가 formatEventLine이 그대로 재기록(state·Change·JSON에는 안 나감), apply 테스트 추가.
- 꼬리의 `@`/`&` 토큰은 순서 무관하게 읽고 정규 순서로 재기록, 꼬리 밖 `&x` 토큰이 제목에 남으면 경고. cleanTitle `&+`, auth.e2e 제외 키에 "share", docs/wiki-format.md 갱신.
- 남은 문제: docs의 day-nov.png 재캡처는 메인(#18)과 충돌 방지로 하지 않음 — 메인 반영 후 재캡처 필요.
- 리뷰 통과 후 보강: ParsedEvent 타입(캐스팅 제거), 다른 달 이동 시 원문 보존 테스트, 원문 유실 주의 주석. features #27 passes=true·review=pass(오너 반영).

## 2026-10-30 · 리뷰 통과 정리 (#17 #18)
- 리뷰어 통과: #18 passes=true·review=pass, #17 덧붙임 확인 review=pass (오너 반영).
- 오너 결정(스펙 rev 57): 보호자 1명 이상·구성원 12명 상한 유지, log.md 세팅 한 줄 유지, 지역표 원본 대조는 #26 때 오너가 직접.
- 남은 문제: 리뷰 [중간] 4건(1단계 포커스, 하단 고정 버튼 가림, applySetup 포트 타입, 완료 응답 검증) 후속. 봇이 위키에 쓰기 시작하면(#9) 프로세스 간 잠금 결정 필요.

## 2026-10-30 · #18 리뷰 후속 수정
- [중간] 이전으로 1단계에 와도 제목 포커스(ref로 지금 단계 비교), 하단 고정 버튼 가림 방지(phone scroll-padding-bottom + 오류 필드 scrollIntoView center), 서버가 setupSchema.safeParse 후 data만 넘기고 실패 시 422(포트는 SetupInput 유지), 완료 응답을 zod(`lib/setup/response.ts`)로 검증하고 실패 시 일반 문구.
- [낮음] 401 안내(새 탭 PIN 후 원래 탭), 구성원·기념일 삭제 후 포커스 이동, fs-wiki JSDoc 위치, setupSchema id 32자·기념일 구성원 정확 일치, Windows 예약어 slug -2, build.ts 캐스팅 제거, ReviewStep key, 월·일을 공용 FieldGroup으로.
- setup e2e는 `--shots`일 때만 캡처, 2단계->이전->1단계 포커스·하단 버튼 가림 검증 추가. docs/screens/day-nov.png를 sample-wiki 기준으로 재캡처(11/15 일정 포함).
- 검증: pnpm check(379 테스트)·build, e2e 3종 통과(setup은 SKIP_TABLET_WAIT). 남은 문제: 실기기 키보드·가림은 #24. #18은 passes=false, review=pending(재리뷰 대기).

## 2026-10-30 · #32 서비스 전환 이음새 (결정 0003, 스펙 rev 59) - 동작 변경 없음
- 1 `FamilyId` 브랜드 타입(`DEFAULT_FAMILY_ID`, `HSH_FAMILY_ID`)을 `DashboardState`와 `WikiRepository.read/apply/applySetup` 첫 인자에. Fs 구현은 다른 id면 거부. `/api/state` 응답엔 없음(테스트). 2 결과를 `{version, synced, syncError?}`로 중립화(호출부·화면·테스트·문서 갱신, version은 서버 로그에만).
- 3 `ConfigProvider` 포트 + `EnvConfigProvider`; 대시보드는 서버 전용 `lib/config.ts`. 앱의 `process.env` 직접 참조는 eslint가 막고 예외는 server.ts·proxy.ts뿐. 4 `LlmAdapter` core 포트(구현은 봇). 5 `EnvInstallationStore` + `authorizeWith`(Bolt authorize 훅), Socket Mode 유지.
- 문서: 0003 '현재 코드와의 차이'에 반영 결과, wiki-format.md·0004의 commit/pushed 용어 갱신. features #18 passes=true·review=pass 반영(오너 지시), #32 추가(passes=false, review=pending).
- 남은 문제: 봇 슬랙 연결은 실제 토큰이 없어 단위 테스트만(authorize 훅 실연결 미확인). 가족별 설정(`get(key, familyId)`)·메시지→가족 매핑은 서비스 전환 때.

## 2026-10-30 · #32 리뷰 통과
- 리뷰어 통과 → features.json #32 passes=true·review=pass (오너 반영). 비밀값 클라이언트 번들 미노출 확인.
- 남은 문제: 봇 토큰 검증이 첫 이벤트로 미뤄짐([중간], #9 전에 시작 시 검증), 낮음 5건은 #32 note 참고.

## 2026-10-30 · #28 스킨 토큰 구조 + 스킨 2종 (스펙 rev 44, 결정 0005)
- `apps/dashboard/skins/<id>/{tokens.css,manifest.json}` + 계약 `contract.ts`. `[data-skin][data-tone=dim]`로 기존 mode/tone 축과 독립. default(기존 값 이전) + paper(임시 검증용, `temporary:true`). 구성원 색은 `lib/palette.ts` -> `var(--member-<name>)` 슬롯 8개, 모서리 4단·그림자·배경 장식·날씨 아이콘색도 토큰화.
- core: `SKIN_IDS`/`CHARACTER_IDS`, config `skin`·`character`(없으면 그대로, 모르는 값이면 default/none + 경고), `DashboardState.skin/character`, `/api/state`에 skin(character none 고정). `useSkin`이 폴링 때 data-skin 교체, `?skin=<id>` 미리보기. 바꾸는 UI는 #30.
- 테스트: 글자 대비를 스킨 × 톤 4조합으로 확장, 글자 크기 하한 `--text-floor`(12px), 슬롯 8개 ΔE>=20·바탕 3:1, 계약·폴더·layout import 일치. reviewer 채점에 스킨 항목 추가.
- 검증: pnpm check(453 테스트)·build, e2e 4종(auth·stress·setup·skin 신규) 통과, 캡처 `docs/screens/skin-*.png`.
- 남은 문제: default가 아닌 스킨은 첫 로드 때 default가 잠깐 보임(hydration 전). default의 coral·amber를 3:1 때문에 조금 어둡게 함(오너 확인). 실기기 가독성은 #24. #28은 passes=false, review=pending.

## 2026-10-30 · #28 리뷰 통과
- 리뷰어 통과 → #28 passes=true·review=pass (오너 반영). 오너 승인: default 낮 coral #dc5444·amber #b57000, 리뷰 기준(스킨 3기준) 추가.
- 오너 결정: [중간] 3건(배치 불변 검사, gap·pad 공통 토큰, 첫 로드 서버 렌더)은 #31 전에 처리. ?skin=·?at=·?mode=는 개발 모드에서만.

## 2026-10-30 · #28 리뷰 후속 수정 (결정 0005 갱신)
- 배치 불변: tokens.css 선택자 2개·선언 `--*`/`color-scheme`만 검사 테스트, `--gap`·`--pad`를 globals.css 공통 토큰으로(contract COMMON_TOKENS, 스킨 정의 금지 테스트). skin e2e에 위젯 영역 6개 boundingBox 비교 -> 4px 차이 발견, 글꼴 의존 줄 2곳에 line-height 명시로 해결.
- 첫 로드: layout이 `getSkinForLayout()`(config.md만, 실패 시 default)로 `<html data-skin>` 렌더, suppressHydrationWarning 제거, themeColor는 manifest `themeColor`로 스킨·낮밤 반영(첫 로드 한정). `?skin/?at/?mode`는 `previewQuery`(개발 모드 또는 테스트 전용 `HSH_PREVIEW_QUERY=1`)일 때만; e2e는 플래그로 켜고, 꺼진 서버가 무시하는 단계 추가. public-state 빈 줄 정리.
- 검증: pnpm check(458 테스트)·build, e2e 4종 통과. 남은 문제: 폴링 뒤 낮밤 전환에는 themeColor가 따라가지 않음, 서버 렌더 data-tone 없음(야간 첫 로드 깜빡임은 별건). #28은 passes=false, review=pending(재리뷰 대기).

## 2026-10-30 · #28 후속 리뷰 통과
- 리뷰어 통과 → #28 passes=true·review=pass (오너 반영).
- 남은 문제(#31에서 처리): 야간 data-tone/data-mode 서버 렌더(첫 로드 깜빡임), skin e2e theme-color 기대값 시각 의존, config.md 이중 읽기.

## 2026-10-30 · #31 달력 보기 터치 (스펙 rev 50, 결정 0006)
- 보기 상태 `DashboardViewState`(monthOffset·selectedDate·selectedEventId·lastTouchAt)는 `Screen`의 `useDashboardView`가 폴링과 따로 갖고, 위젯은 `onSelectDate·onSelectEvent·onChangeMonth`만 받는다(없으면 보기 전용). 날짜 칸 탭 -> `Sheet`(role=dialog·포커스 이동/복귀·Esc)에 그날 일정 전부 -> 일정 탭 -> 상세(시간·구성원·공유 그룹·슬랙 안내). ‹ › 48px·좌우 스와이프로 달 이동, 마지막 터치 120초 뒤 자동 복귀(순수 리듀서 `viewReducer`·`isIdleExpired`·`swipeDirection` 단위 테스트).
- `/api/state?month=YYYY-MM`(없으면 이번 달, 2000-01~2100-12, 잘못되면 400): 그 달 달력 칸 + 오늘·내일 일정만 싣는다. 공개 응답에 `share` 그룹 id만 추가(깨진 원문 토큰은 안 나감). 키오스크: `touch-action: pan-y`·`overscroll-behavior: none`·`user-select: none`(tablet 표식 안에서만), 태블릿 page만 viewport 확대 차단, `useKioskGuards`. 야간 터치 -> 낮 화면 구성 + dim, 120초 뒤 야간 복귀(`displayOf`).
- #28 후속: layout이 `/`일 때만 서버 시각 기준 data-mode·data-tone 렌더(proxy가 `x-hsh-path` 헤더), skin e2e theme-color를 시각 기준으로, `getSkinForLayout`을 react `cache`로.
- 검증: pnpm check(490 테스트)·build, e2e 5종(auth·stress·setup·skin·touch 신규 14단계) 통과. 캡처 `docs/screens/touch-*.png`. e2e가 잡은 것: 스와이프 직후 탭 삼킴(에뮬레이션 한정), 야간 깨우는 탭이 날짜 칸을 누름(600ms 클릭 삼킴으로 수정), 합성 핀치는 isMobile에서만 viewport를 따름(대조군 포함).
- 남은 문제: 실기기 제스처(핀치·뒤로 가기·길게 누르기)는 #24. 야간 첫 HTML의 night 분기는 e2e가 서버 시각을 못 바꿔 단위 테스트로만. 응답이 전체 일정 -> 달 단위로 바뀜. 재리뷰 필요: #13·#14·#15·#16·#17·#27·#28 review=pending으로 돌림(코드를 덧붙여 수정). #31은 passes=false, review=pending.

## 2026-10-30 · #31 리뷰 되돌림 수정
- [높음] MonthCalendar 행 정의를 자식 3개에 맞게 `auto auto minmax(0, 1fr)`로. touch e2e에 격자 바닥이 카드 바닥까지 차는지, 빈 달(2027-02)의 `[data-date]` 버튼이 모두 48px 이상인지 단언 추가.
- [중간] `useDashboardState`가 `at`을 `/api/state`에 같이 보냄(서버는 previewQuery일 때만 받고 운영은 무시, parsePreview 규칙). e2e: 달을 넘긴 뒤에도 오늘 일정·내일 줄 유지.
- [낮음] Sheet Shift+Tab(목록 밖 요소면 last), wiki-format share 문구 정정, useDashboardView 캐스팅 제거. 응답한 달(`loadedMonth`)이 보는 달과 다르면 달력 칸 일정을 비우고 "불러오는 중/가져오지 못했어요" 표시, 날짜 칸은 버튼이 아님.
- 검증: pnpm check(490 테스트)·build, e2e 5종 통과, touch-*.png 재생성. 남은 문제: 로딩 상태·Shift+Tab은 단위 테스트 없이 e2e로만. #14·#31 passes=false, review=pending(재리뷰 대기).

## 2026-10-30 · #14 #31 리뷰 통과
- 리뷰어 재검토 통과 → #14 #31 passes=true·review=pass (오너 반영). #13 #15 #16 #17 #27 #28 review=pass는 #31 리뷰 결과를 오너 지시로 반영한 것.
- 남은 문제(낮음): Sheet.tsx:56 캐스팅, MonthCalendar 실패 문구 말줄임, loadedMonth 분기 단위 테스트. 실기기 터치는 #24.

## 2026-10-30 · #32 #18 #31 리뷰 후속 정리
- #32: `slack/startup.ts` checkBotToken으로 app.start() 전 auth.test 1회. 토큰 오류(invalid_auth 등)는 exit 78 + ecosystem `stop_exit_codes: [78]`(다시 띄워도 소용없어 PM2 재시작 반복 방지), 네트워크 등 일시 오류는 exit 1(PM2가 5초 간격 재시도). app.client 기본 토큰 없음 주석. whoami 부분값 캐시 금지·예외 시 재시도 테스트, installation.ts·env-config.ts 캐스팅 제거, eslint가 process.env 우회(구조분해·`process["env"]`·`import { env }`) 차단(임시 파일로 확인), applySetup 가족 불일치 테스트.
- #18: core `isWindowsReservedName`을 서버 setupSchema·클라이언트 검증·suggestMemberId가 공유. ReviewStep은 `extraAnniversaryRows`(key 동봉). setup e2e 가림 검사는 `data-testid="setup-footer"`.
- #31: Sheet `instanceof HTMLElement`, MonthCalendar 상태 문구 2줄 말줄임(‹ › 고정), `monthStatus`를 lib/view 순수 함수로 + 단위 테스트(Dashboard prop이 monthLoaded -> monthStatus).
- 검증: pnpm check(503 테스트)·build, e2e 5종 통과. 남은 문제: `import * as ns from "node:process"; ns.env`는 lint가 못 잡음. 말줄임은 e2e 단언 없음(CSS만). #18 #31 #32 passes=false, review=pending.

## 2026-10-30 · #18 #31 #32 후속 리뷰 통과
- 리뷰어 통과 → #18 #31 #32 passes=true·review=pass (오너 반영). 남은 낮음은 각 note.
- 운영 방식 변경: 이후 할 일은 할 일당 새 대화(프로젝트 문서 claude/agent-team.md '대화 운영 방식').

## 2026-10-30 · #10 질문 응답
- extractIntent 한 번 호출에 question 필드(qFrom·qTo·qKinds·qMembers·qKeyword)를 평평하게 추가, Intent는 `question{query}`. 답 문장은 `answer/answer.ts`의 `answerFromQuery`가 위키 항목에서 결정적으로 만든다(LLM 문장은 안 씀). `answerQuestion`은 `Pick<WikiRepository,"read">`만 받아 쓰기가 타입으로 막힌다.
- `answer/range.ts` 상대 날짜 해석기(오늘·내일·모레·이번/다음 주 X요일·주말·N월 N일·N월·이번/다음 달, 주=월요일 시작, 최대 62일)가 LLM 범위보다 우선. LLM 키워드는 질문에 글자 그대로 있을 때만, 구성원은 실제 id만 사용. 없으면 "11/1(일)에는 위키에 등록된 일정이 없어요."; LLM 실패·형식 오류·범위 불명은 되묻기. `formatWhen`을 `src/format.ts`로 옮김(extract.ts가 재export), CLI `try`는 위키를 readOnly로 열고 question이면 답도 출력.
- 검증: pnpm check(564 테스트) 통과. 남은 문제: 실제 Ollama/Anthropic이 q* 필드를 잘 채우는지 미검증(#8과 같음), 슬랙 응답 연결은 #3·#9 이후. #10은 passes=false, review=pending.

## 2026-10-30 · #10 리뷰 되돌림 수정
- [높음] 종류를 글의 단서(할 일·장보기·생일 등, 한글 단어 경계 적용)로 정함. 날짜가 잡히면 일정+기념일 항상 포함, LLM qKinds는 날짜 없을 때 tasks를 더하는 데만 사용, 되묻기 판단에는 안 씀. "내일 회사야?"·"내일 할 일정"이 장보기·할 일로 걸리던 문제 수정.
- [중간] 연도 없는 날짜는 오늘에서 가장 가까운 해, "YYYY년 M월 D일"·ISO 읽기, "다음 주 토요일이랑 일요일"은 주 수식 상속, 떨어진 날짜("오늘이랑 모레")는 되묻기. 구성원 이름 조사 경계("하늘색" 제외).
- [낮음] 이중 캐스팅 제거(matchAll), '가까운' 목록은 전체 건수+"…외 N건", CLI는 answerQuestion 경유. 검증: pnpm check(587 테스트). 주 시작 차이(봇 월요일/대시보드 일요일)는 고치지 않고 features #10 note에 오너 확인으로 남김. #10 review=pending.

## 2026-10-30 · #10 리뷰 통과
- 리뷰어 재검토 통과(728ac06) → #10 passes=true·review=pass·status=done (오너 반영). 1차 되돌림 [높음] LLM qKinds가 포함 종류를 덮어씀 → 글의 단서로 결정, 날짜 질문은 일정+기념일 항상 포함.
- 남은 문제: 슬랙 응답 연결은 #9(#3 토큰 후), 실제 LLM이 q* 필드를 채우는지는 #8과 함께 검증. 오너 확인: 스펙에 주 기준(봇 월요일/달력 일요일)과 연도 없는 날짜 규칙(가장 가까운 해) 한 줄. 낮음 4건은 #10 note.

## 2026-10-30 · #10 후속: 날짜 해석 rev 62 + 회귀 테스트 이식
- `answer/range.ts`를 rev 62에 맞춤: 주=일~토, "이번 주 일요일"=돌아오는 일요일(당일이면 오늘), "다음 주 일요일"=그다음 일요일, "이번 주말"=이번 주 토+돌아오는 일, 연도 없는 날짜·달·요일만은 과거형("했어?"·"있었지?")이면 가장 최근에 지난 날, 아니면 다가오는 날(오늘 포함), 연도 명시는 그대로. "A 말고 B"는 B에 날짜가 있으면 B. `intent/prompt.ts` 달력 표도 일요일 시작.
- answer.ts: 날짜가 잡힌 질문에서 위키 제목에 없는 keyword("계획"·"행사"·"하늘이")와 구성원 이름은 거르지 않음(alt 브랜치 회귀 이식). 테스트: alt의 (a) 키워드 비소거 (b) 말고 (c) 하늘 생일 (d) 수영 언제야 + 일요일/토요일/수요일 경계·과거형/미래형·연도 명시.
- 오너 확인 필요(문구 그대로 구현): (1) 일요일 당일 "이번 주말"은 토요일(6일 뒤)+오늘이라 떨어져 되묻기 (2) "지난 주 일요일"=지난 주 첫날(예외는 이번/다음만), "지난 주말"=지난 주 토+그다음 일, "다다음 주 일요일"=그다음의 그다음 일요일은 유추 (3) 과거형에서 오늘은 '지난 날'이 아님("10월 30일 뭐 했어?"가 오늘이면 작년) (4) 달: 과거형은 이미 시작한 가장 최근 달, 그 외는 이번 달 포함 (5) 그냥 "주말"은 기존 유지.
- 검증: pnpm check(612 테스트) 통과. #10 코드 변경이라 review=pending으로 돌려야 함(passes는 오너 반영).

## 2026-10-30 · #10 후속 리뷰 되돌림 수정
- 과거형 판별을 받침 ㅆ 음절(갔·봤·샀·됐·였…, '있' 제외)+어미로. 달 과거형 `first <= today`(1일 당일은 이번 달). 질문 답에서 올해가 아닌 날짜는 "2027년 8/15(일)"처럼 연도 표시. alt 테스트 추가: LLM 범위만 있는 "그날 계획", "치과 말고 학원 언제야?", 연도 단언.
- 오너 확인 필요(고치지 않음): 일요일 당일 "다음 주말"/"지난 주말" 해석, "이번 주 일요일+월요일" 섞기, 과거형 오탐("예약했어?"는 과거형으로 읽힘), 위키에 없는 keyword 안내 문구. #10 passes=false, review=pending(리뷰 통과 뒤 규칙이 바뀜).

## 2026-10-30 · #10 후속 재리뷰 수정
- 과거형 판별에서 '겠'(추측·미래)도 '있'처럼 제외, "있었겠지"는 '었'으로 과거 유지. 회귀 테스트 추가.
- 오너 확인 필요(고치지 않음): 연결형 '갔다'("토요일 갔다 올 거야?")는 과거형으로 읽혀 10/24로 감.
- 리뷰 통과 정리(#10 후속): 3차 재리뷰 통과(e14c3f9, pnpm check 617). 오너 반영으로 #10 status=done, passes=true, review=pass. 브랜치 hsh-10-question-alt는 테스트 이식 뒤 삭제.

## 2026-10-30 · #10 후속2: 말고 제외 조건·말고 뒤 일부 날짜·과거형 오탐
- range.ts: "말고" 뒤가 "N일"만이면 앞이 절대 날짜일 때 그 달, 아니면 다가오는(과거형이면 지난) N일. 뒤가 요일만이면 앞의 주 수식 상속. 날짜처럼 보이는데 못 읽으면 ambiguous. 앞에 날짜만 있으면("토요일 말고 …") 빼는 조건이라 범위 없음. 과거형 판별은 날짜 든 문장만 보고 "~던/기로 했(었)/~다 올/어야"는 과거로 안 봄.
- answer.ts: "말고" 앞에만 있는 LLM keyword는 제외 조건(일정·기념일 제목 일치분만 뺌), 남는 게 없으면 "'치과' 말고는 … 없어요". 말고 문장은 LLM from/to 보조 범위를 쓰지 않음.
- 검증: pnpm check(669 테스트) 통과. features.json 미변경(#10 review는 오너/리뷰어 판단).
- 남은 문제: 제외 keyword는 LLM qKeyword가 있어야 동작(없으면 앞 날짜 범위만). "3일 이내" 같은 N일 표현이 말고 뒤에 오면 날짜로 읽힘.

## 2026-10-30 · #10 후속2 리뷰 통과
- 다른 대화의 #10 후속(c93b135)과 겹쳐 오너 A안: main 기준으로 dup 구현 리뷰에서 나온 문제만 옮겨 고침(6b065a0). 리뷰어 통과 → #10 done·passes=true·review=pass (오너 반영).
- 남은 중간 2건·낮음·오너 확인(일요일 당일 주말 되묻기)은 #10 note. 원격 브랜치 hsh-10-question-alt·hsh-10-followup-dup은 삭제 대기(오너 확인).

## 2026-10-31 · #10 후속3: LLM 우선·자산 지도·날짜 채점
- rev 63 반영: answer.ts chooseRange는 LLM qFrom/qTo(형식·62일 검증)를 우선하고 range.ts는 LLM 범위가 없거나 형식이 틀릴 때만 보조. "말고" 제외는 LLM qExcludeKeyword/qExcludeDates를 검증해 사용(splitContrast 판단·말고 문장에서 LLM 범위 버리기 삭제). 스키마에 qTense(qFrom 앞)·qExcludeKeyword·qExcludeDates 추가.
- core `buildAssetMap`(달력표 일요일 시작·구성원 부르는 이름·제목→구성원→날짜→매주 추정·기념일, 상한 3000자)을 프롬프트에 붙이고 rev 62 규칙을 판단 기준으로 명시.
- 질문 모음 apps/bot/eval/date-questions.json(106문항, owner-check 5) + src/eval/{date-cases,date-eval,run-date-eval}.ts. 노트북 채점: `pnpm --filter @hsh/bot eval:dates` (옵션 `--only <문자열>` `--json`, LLM_PROVIDER 그대로).
- 검증: pnpm check(711 테스트, 실제 LLM 호출 없음). 남은 문제: 실제 qwen3:8b 정답률은 아직 미측정(노트북에서 채점 후 프롬프트 조정), 시제 판단 오탐/말고 문장은 모델 의존. #10 review는 오너/리뷰어가 pending으로.
