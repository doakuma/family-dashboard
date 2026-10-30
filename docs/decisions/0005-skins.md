# 0005. 스킨 토큰 구조와 스킨 2종 전환 (#28)

- 날짜: 2026-10-30
- 상태: 구현 완료, 리뷰 대기 (스펙 rev 44 기준)

## 결정

### 구조와 위치
- `apps/dashboard/skins/<id>/tokens.css` + `manifest.json`. 위치는 **대시보드 앱 안**: 토큰은 CSS이고 쓰는 곳이 화면뿐이라 core(브라우저 안전 순수 모듈)에 둘 이유가 없다. 계약(`skins/contract.ts`)·목록(`skins/index.ts`)·테스트 도우미(`color.ts`, `read-tokens.ts`)도 같은 폴더.
- 선택자는 `[data-skin="<id>"]`(낮)와 `[data-skin="<id>"][data-tone="dim"]`(어두운 톤). `data-mode`(day/night)·`data-tone`(normal/dim) 축은 그대로 두고 `data-skin`을 세 번째 독립 축으로 `<html>`에 둔다. 지금은 야간 = dim이지만 축이 분리되어 있어 스킨 × 톤 조합이 모두 정의되어 있어야 한다(테스트).
- 계약: 색 토큰(paper·sheet·ink·muted·faint·line·글자 의미색·구성원 슬롯 8·날씨 아이콘 3)은 낮·dim 블록 **둘 다** 정의, 모양 토큰(글꼴·모서리 4단·그림자·gap·pad·배경 장식 `--deco-bg`)은 낮 블록만. 계약 밖 토큰·누락은 테스트가 막는다. 스킨은 배치(grid)를 바꾸지 않는다(레이아웃 프리셋은 2단계).
- 공통 토큰 `--text-floor`는 `globals.css`에만 있고 스킨이 덮어쓰면 테스트가 실패한다.
- **core에는 `SKIN_IDS`·`CHARACTER_IDS` 목록만** 둔다. 이유: `config.md`의 모르는 값 판정·경고가 core 파서(`parseConfigFile`)에서 일어나야 하는데 파서는 대시보드의 폴더를 볼 수 없다. 대신 폴더 = manifest id = `SKIN_IDS`인지 테스트로 묶는다. 새 스킨은 폴더 + `SKIN_IDS` + `layout.tsx` import + `skins/index.ts` 4곳(모두 테스트가 누락을 잡는다).

### 전환
- 스킨 CSS는 `layout.tsx`가 전부 import해 번들에 포함(지연 로드 없음). `useSkin(skin)`이 `<html data-skin>`을 바꾼다. `Screen`이 폴링한 `state.skin`을 넘기므로 위키의 `skin`을 바꾸면 다음 폴링(60초) 때 새로고침 없이 바뀐다(e2e: 같은 문서 마커 유지 확인).
- `<html>`의 서버 렌더 값은 `default` 고정이라 default가 아닌 스킨의 태블릿은 **첫 로드 때 hydration 전까지 default가 잠깐 보인다**(이후 전환은 즉시). 레이아웃이 위키를 읽게 하면 /setup·오류 화면까지 위키 읽기에 묶이므로 하지 않았다. 필요하면 후속.
- 개발용 `?skin=<id>`: 알려진 id면 위키 값 대신 쓴다(`?at`·`?mode`와 같은 방식, 모르는 값은 무시). 바꾸는 곳(/setup 미리보기·/settings·슬랙 명령)은 #30.

### 위키·API
- `config.md`의 `skin`·`character`는 선택. 없으면 없는 그대로 읽고(다시 쓸 때 줄이 안 생김), **있는데 모르는 값이면** `default`/`none` + 경고(필드 단위 관용, 쓰기 스키마는 엄격 enum). `DashboardState.skin/character`는 해석된 값(없으면 default/none).
- `/api/state`에 `skin` 추가, `character`는 `"none"` 고정(#29 전). `config` 원문은 여전히 안 나간다.
- `/setup` 마법사(`applySetup`)는 skin·character를 쓰지 않는다(없으면 default). 고르기는 #30.

### 구성원 색 슬롯
- 위키는 이름(coral·teal·blue·amber·green·purple·pink·gray)만 저장. `lib/palette.ts`는 hex 표 대신 `var(--member-<name>)`을 돌려준다(이름이 아니라 `#hex`가 위키에 있으면 그대로). 슬롯 8개 = 지금 이름 8개와 1:1이라 위키 데이터 변경 없음. gray는 '가족 전체'.
- 낮·dim마다 슬롯 값이 다르다(어두운 바탕에서 점·막대가 보이게 밝게).
- default의 낮 `coral`(#e9614f -> #dc5444)·`amber`(#d98e0b -> #b57000)는 새 기준(바탕 3:1) 때문에 **조금 어둡게** 바꿨다. 눈에 보이는 변화(오너 확인 대상).

### 기준과 판단 (리뷰 채점 3가지 추가)
1. **글자 대비 WCAG AA**: 기존 토큰 순회 테스트(글자색 토큰 × paper·sheet ≥ 4.5, 오늘 날짜 숫자, 투명도 규칙표)를 **스킨 × 톤 전체**로 확장(2종 × 낮/dim = 4조합). 하드코딩 색 금지 테스트(글자색·setup/form의 hex)는 그대로.
2. **글자 크기 하한**: `--text-floor: 0.75rem`(1280×800에서 12px)을 토큰으로 정의. 태블릿 CSS(대시보드·위젯·세팅 필요 안내)의 모든 `font-size`가 rem이고 하한 이상이어야 한다(테스트). 현재 가장 작은 글자가 0.75rem이라 기존 화면은 그대로. 2~3m에서 12px은 보조 글자(갱신 시각 등)용 최소선이고, 주요 글자(시계·일정)는 이보다 훨씬 크다. 실기기 가독성은 #24에서 확인. 해상도 변수(`html font-size` clamp 11~30px)는 건드리지 않았다.
3. **구성원 색 구분**: 모든 쌍 CIE76 ΔE >= 20(나란히 놓은 점·막대가 다른 색으로 읽히는 수준, 구별 한계는 약 2). 인접 쌍만이 아니라 전체 쌍으로 걸었다(구성원 순서가 위키마다 달라서). 추가로 점·막대는 바탕·종이 위에서 3:1(WCAG 1.4.11). 색각 이상 시뮬레이션은 하지 않았고, 이름·위치가 색 외 단서를 준다(점은 `sr-only` 이름, 달력 줄은 제목).

### 두 번째 스킨 `paper`
- 오너 결정: 임시 검증용. `manifest.json`에 `"temporary": true`. 따뜻한 종이 톤(바탕 #f4ead6, 글자 짙은 갈색), 모서리 각지게, 카드 그림자, 줄 노트 느낌의 배경 장식, 글꼴은 본문 글꼴(Pretendard) 하나 - **새 글꼴 의존성 없음**(키오스크 오프라인). 캐릭터·IP 요소 없음. 정식 스킨이 생기면 지운다.
- 날씨 아이콘 색은 `--icon-*` 토큰으로 옮겼다(SVG 속성 `var()`), `border-radius`는 4단 토큰(`--radius-xs~lg`)으로 바꿨다. 기존 값 중 0.2·0.3rem -> 0.25rem, 0.9rem -> 0.8rem으로 아주 조금 맞췄다.

## 스펙과 다른 점
- 없음. (스펙에 없는 판단: core의 `SKIN_IDS` 목록, ΔE 20·3:1·12px 수치, 첫 로드 때 default가 잠깐 보이는 점, 위 색 두 개 조정)
