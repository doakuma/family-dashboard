# 0006. 달력 보기 터치 (#31)

- 날짜: 2026-10-30
- 상태: 구현 완료, 리뷰 대기 (스펙 rev 50 '터치 (보기 전용)' 기준. 스펙과 다른 점은 맨 아래)

## 결정

### 보기 상태는 위젯 밖에, 폴링과 따로
- `DashboardViewState { monthOffset, selectedDate?, selectedEventId?, lastTouchAt? }`(`lib/view-state.ts`)는 `Screen`의 `useDashboardView`가 갖는다. 위키 데이터(DashboardState/ApiState)와 섞지 않고 저장·전송하지 않는다. 위젯(`MonthCalendar`·`DaySheet`)은 일정·달·콜백(`onSelectDate`·`onSelectEvent`·`onChangeMonth`)만 받는 표시 컴포넌트이고, **콜백이 없으면 보기 전용**이다(`/setup` 미리보기의 `Dashboard`는 `browse`를 안 넘긴다).
- 상태 변경은 순수 리듀서(`viewReducer`) + 단위 테스트. 폴링은 `state`만 바꾸고 보기 상태는 건드리지 않아 1분 폴링이 와도 시트·달이 유지된다(e2e로 확인: 폴링 뒤 새 일정이 열린 시트에 들어옴).
- **자동 복귀**: 마지막 터치(`lastTouchAt`, `pointerdown`·`keydown` 캡처) 뒤 `IDLE_RESET_MS = 120_000`이 지나면 `INITIAL_VIEW`로 돌아간다(시트 닫힘, 이번 달, 터치 기록 지움). `setTimeout`을 터치마다 새로 걸고, 일찍 깨면 남은 시간만큼 다시 건다. 판단은 `isIdleExpired`·`msUntilReset`(순수). 정확히 120초가 되는 순간부터 만료.
- 달이 바뀌면 시트는 닫힌다(고른 날짜가 보는 달 밖일 수 있음). 범위 끝이면 이동하지 않는다(시트 유지).

### 달 이동 범위와 `/api/state?month=YYYY-MM`
- 화면은 사실상 제한이 없다(‹ › 와 스와이프). 서버는 **2000-01 ~ 2100-12**만 받는다(`MONTH_MIN/MAX`, `parseMonth`는 형식 `^\d{4}-(0[1-9]|1[0-2])$` + 범위). 범위 끝에서 ‹ › 는 `disabled`(투명도 0.35, 비활성이라 대비 면제로 명시 등록). 이유: 서버가 터무니없는 값을 400으로 거르는 한계가 필요하고, 100년은 손으로 넘길 수 없는 거리다.
- 틀리면 **400** `{error:"invalid_month"}`: 형식 오류, 범위 밖, 빈 값(`?month=`), 여러 번(`month=a&month=b`), 앞뒤 공백.
- 없으면 이번 달. 응답 일정 = **그 달 달력 칸(이웃 달 날짜 포함)의 일정 + 서버 기준 오늘·내일 일정**(`eventsForMonthView`). 오늘·내일은 보는 달과 상관없이 오늘 일정·야간 화면이 쓰기 때문. `events/YYYY-MM.md`가 없는 달은 읽을 파일이 없어 자연히 빈 달. 이전 응답은 "전체 일정"이었으므로 **응답 크기가 줄어든다**(동작 변경).
- 클라이언트는 폴링마다 `?month=<보는 달>`을 붙이고, 달이 바뀌면 바로 한 번 가져온다. 늦게 온 이전 달 응답이 덮어쓰지 않게 마지막 요청만 반영. (알려진 한계: `?at` 미리보기 중에는 서버의 "오늘·내일"이 실제 오늘이라 미리보기 시각과 어긋날 수 있다. 개발 전용.)

### 공개 응답에 `share` 추가 (그룹 id만)
- 상세 시트가 "공유 그룹"을 보여 줘야 하므로 `toPublicState`의 일정에 **올바른 `share` 그룹 id만** 싣는다(허용 목록 방식 유지: `...(e.share ? { share: e.share } : {})`). 판단: 그룹 id는 가족이 위키에 직접 쓴 짧은 식별자이고 민감 정보(주소·slackId·생일 등)가 아니다. 그룹 이름·구성은 정의되지 않았으므로(후속) 화면은 id를 그대로 보여 준다.
- 깨진 원문 토큰(`&a &b`, `&bad!`)은 파서가 심볼 키로만 들고 있어 허용 목록에서 골라 담지 않으면 나가지 않는다(테스트). 0005/#27의 "share는 공개하지 않는다" 테스트는 이 결정으로 바꿨다. auth e2e의 금지 키에서 `share`를 뺐다.

### 시트·스와이프·타이머는 재사용 부품
- `components/ui/Sheet`: 내용을 모르는 오른쪽 모달. `role=dialog`+`aria-modal`+`aria-labelledby`, 열릴 때 `[data-initial-focus]`로 포커스 이동, 닫힐 때 호출한 요소(없으면 `getReturnFocus`)로 복귀, Tab 가둠, Esc, 어두운 바깥 탭으로 닫기. 뒤 화면은 `inert`(Dashboard가 `<main inert>`). 열린 동안만 렌더.
- `components/widgets/DaySheet`: 그날 일정 전부(칸의 "외 n건" 포함, 시간순) -> 일정 항목(버튼, 48px) -> 상세(시간·구성원·공유 그룹·"고치려면 슬랙에서 말해주세요"). 상세로 가면 "목록으로"에, 돌아오면 방금 보던 항목에 포커스.
- `hooks/useSwipe` + `lib/swipe.ts`(순수): 터치·펜만. 가로 60px 이상, 세로의 1.5배 이상, 800ms 이내. 스와이프가 만든 클릭은 400ms 삼킨다. 달력에 `touch-action: pan-y`.
- 날짜 칸은 칸 전체가 `button`(칸 모양 그대로, 누르는 동안만 8% 어둡게; 체크리스트처럼 보이지 않게 테두리·채움·아이콘 없음). ‹ › 는 48px 원형 버튼.
- 체크리스트·날씨·다가오는 날은 손대지 않았다(버튼·`tabindex` 없음; 소스 테스트 + e2e). 오늘 일정은 기존 자동 넘김 버튼 하나만.

### 키오스크 오작동 방지
- CSS(`globals.css`, `Screen`이 단 `data-surface="tablet"`이 있을 때만 `html:has(...)`): `touch-action: pan-y`(핀치 줌·두 번 탭 확대·가로 팬 차단, 세로 스크롤 허용), `overscroll-behavior: none`(당겨서 새로고침·가장자리 뒤로 가기), `user-select: none`, `-webkit-touch-callout: none`. 휴대폰 `/setup`에는 걸리지 않는다(`DashboardPreview`의 Dashboard에도 안 걸리게 표식을 Dashboard가 아니라 Screen에 뒀다).
- viewport: **태블릿 첫 화면(`app/page.tsx`)만** `maximum-scale=1, user-scalable=no`. 루트 레이아웃에 두면 휴대폰 /setup의 확대(접근성)까지 막히기 때문. 레이아웃의 나머지 viewport 값은 병합된다(e2e로 메타 확인).
- JS 보강(`useKioskGuards`): `contextmenu`·`selectstart`·`dragstart`·`gesturestart/change` 차단, 두 손가락 `touchmove` 차단(`passive:false`).
- 핀치 e2e: 데스크톱 에뮬레이션은 viewport 메타를 무시해서 합성 핀치가 확대되므로 **`isMobile` 컨텍스트**에서 확인하고, 보호 없는 대조 페이지가 같은 핀치로 2.5배 확대되는 것도 단언해 검사가 유효함을 보인다.

### 야간 터치
- `displayOf(night, touched)`(순수): **모드**(day/night 화면 구성)는 야간이고 안 만졌을 때만 night, **톤**(normal/dim)은 야간이면 dim. 기존 `data-mode`·`data-tone` 축을 그대로 쓰고 `useDisplayTone`이 설정. 야간에 만지면 `lastTouchAt`이 생겨 낮 화면 구성 + dim, 120초 뒤 `lastTouchAt`이 지워져 야간 화면으로 돌아간다. 깨우는 탭 뒤 600ms는 클릭을 삼킨다(깨어난 낮 화면이 같은 자리에 날짜 칸을 그려 그 탭이 칸을 누르는 것을 e2e가 잡아냈다).

### #28 후속 (함께 처리)
- **layout이 data-tone·data-mode도 서버 렌더**: `proxy.ts`가 요청 경로를 `x-hsh-path` 헤더로 실어(밖에서 온 값은 덮어씀) 레이아웃이 **`/`일 때만** 서버 시각 기준(`isNight`)으로 넣는다. `/setup` 같은 휴대폰 화면은 항상 day/normal이라 밤에 어두워지지 않는다. 대시보드가 아니라 세팅 안내(`SetupNeeded`)가 보이면 `useDisplayTone("day","normal")`이 바로잡는다. 한계: 서버 시각 기준이라 `?at`·`?mode` 미리보기는 하이드레이션 뒤에 맞춰진다.
- **skin e2e theme-color 기대값**: 서울 시각(23~6시 dim)으로 고른다. 언제 돌려도 통과.
- **`getSkinForLayout` 이중 읽기**: `react`의 `cache`로 요청 단위 캐시(레이아웃의 `generateViewport`와 `RootLayout`이 한 번만 읽음). 요청이 끝나면 버려져 폴링 뒤 변경 반영에는 영향 없음.

## 스펙과 다른 점
- 없음. 스펙에 없는 판단: 월 범위 2000-01~2100-12, 400 조건(빈 값·중복), 응답에 오늘·내일 일정 항상 포함, 스와이프 수치(60px·1.5배·800ms), 깨우는 탭 클릭 600ms 삼킴, viewport 확대 차단을 page 단위로 한정, `x-hsh-path` 헤더.

## 알려진 한계 / 후속
- 실기기(안드로이드/삼성 인터넷/iPad Safari)의 핀치·뒤로 가기 제스처·길게 누르기는 에뮬레이션으로만 확인 -> #24.
- 야간 첫 HTML의 night 분기는 e2e가 서버 시각을 못 바꿔 낮에는 day 분기만 확인된다(`displayOf` 단위 테스트가 분기를 덮는다).
- 공유 그룹 이름 표시·그룹 정의는 후속. 지금은 id.
