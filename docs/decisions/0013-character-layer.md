# 0013. 캐릭터 층: 구조·로더·none (#29)

- 날짜: 2026-11-10
- 상태: 구현 완료(구조만), 리뷰 대기 (스펙 rev 63 기준)

## 범위
스펙: "캐릭터: 스킨과 별도 층이다. `skins/`와 따로 `characters/<id>/`에 두고 스킨과 자유롭게 조합한다. 오리지널 캐릭터만 쓴다." / "MVP: 캐릭터 그림도 오너가 정한다."
이번에는 **구조·로더·`none`·전환 축까지만** 만들었다. 캐릭터 그림·SVG·그리는 컴포넌트·화면 자리는 없다(배치·디자인은 오너 결정 대기). DOM·그리드·CSS 배치 변경 없음. 바꾸는 곳(/setup·/settings·슬랙 명령)은 #30.

## 결정
- **위치**: `apps/dashboard/characters/<id>/manifest.json`, 계약 `characters/contract.ts`(zod), 목록·로더 `characters/index.ts`. 스킨과 같은 이유로 대시보드 앱 안. core에는 `CHARACTER_IDS`만(파서가 모르는 값을 판정해야 해서, 0005와 같음).
- **매니페스트**: `id`·`name`·`version`·`original: true`(리터럴 true만 통과 = 기존 IP 금지 선언)·`assets`(폴더 안 상대 경로 배열, 확장자 svg/png/webp만, 절대 경로·`..`·`.`·역슬래시·빈 조각·드라이브 문자 거절)·선택 `description`. 모르는 필드는 거절(strict) - 색·글꼴 같은 걸 슬쩍 못 싣게.
- **`none`**: `assets: []`. `getCharacter("none")`은 **null**을 돌려준다("그릴 것 없음"을 호출하는 쪽이 바로 알 수 있게). `CHARACTER_MANIFESTS`(Record)에는 none도 들어 있어 목록·검사는 일관된다.
- **독립 축**: `<html data-character="<id>">`는 `data-skin`·`data-mode`·`data-tone`과 별개 축. 레이아웃이 서버에서 config.md로 해석(`getCharacterForLayout`, `getSkinForLayout`과 같은 요청 단위 캐시 한 번 읽기, 실패 시 `none`), 폴링 뒤 변경은 `useCharacter`(useSkin과 같은 패턴)가 `state.character`로 바꾼다. `toPublicState`의 `character`는 "none" 고정에서 **해석된 값**으로 바꿨다.
- **미리보기 `?character=<id>`**: 넣었다. `parsePreview`의 다른 쿼리와 같게 `previewQuery`가 켜졌을 때만, 알려진 id만 받는다(운영에서는 무시). 지금은 id가 none뿐이라 화면 변화는 없지만, 캐릭터가 생겼을 때 e2e·시안이 skin과 같은 방식으로 조합을 볼 수 있다.
- **스킨과 독립**: 캐릭터 폴더에는 CSS·코드·글꼴이 없고(json·그림만), 어떤 파일에도 `--*` 토큰 정의·`data-skin`이 없어야 한다(테스트). 스킨의 tokens.css도 `data-character`를 모른다. 캐릭터는 색·글꼴을 바꾸지 못하고, 스킨 위에 그림만 얹는 층이다.

## 새 캐릭터 추가 절차 (오너 결정 뒤)
1. `apps/dashboard/characters/<id>/`에 `manifest.json`과 그림 파일(svg/png/webp)을 둔다. manifest `original: true`, `assets`에 폴더 안 상대 경로로 전부 나열.
2. core `packages/core/src/types.ts`의 `CHARACTER_IDS`에 id 추가.
3. `characters/index.ts`의 `CHARACTER_MANIFESTS`에 import해서 추가(Record라 빠지면 타입 오류).
4. (그리는 컴포넌트·배치를 만들 때) 별도 결정으로 `data-character`를 쓰는 CSS/컴포넌트 추가 - 이번 범위 밖.
5. `docs/wiki-format.md`의 character 설명 목록 갱신.

테스트가 잡는 것: 폴더 = manifest id = `CHARACTER_IDS`(1·3 누락), 스키마·`original: true`, 에셋이 실제 존재하고 선언 안 된 파일이 없음, 캐릭터 폴더에 CSS·`--*`·`data-skin` 없음, 모든 스킨 × 모든 캐릭터 조합 유효, `getCharacter`. 테스트가 못 잡는 것: **그림이 정말 오리지널인지**(선언만 확인 가능 - 오너·리뷰 확인), 그림의 시각 품질·접근성(대체 텍스트·대비), 스킨 × 캐릭터 조합의 실제 어울림(캐릭터가 생기면 skin e2e에 조합 캡처를 더해야 함).

## 스펙과 다른 점
- 없음. 스펙에 없어 정한 것: `getCharacter("none") === null`, 매니페스트 필드와 `original: true` 리터럴, 에셋 확장자 3종, `?character=` 미리보기 쿼리, 캐릭터 폴더에 CSS·코드 금지.

## 오너 확인할 것
- 캐릭터가 화면 어디에 어떻게 보일지(자리·크기·낮/야간 변형·터치 반응 여부)와 그림 자체.
- 에셋 형식 3종(svg/png/webp)과 `original: true` 선언 외에 출처 증빙(작가·라이선스 필드)을 남길지.
- 에셋의 접근성 처리(장식이면 `aria-hidden`, 대체 텍스트 필요 여부).
- (리뷰 낮음) SVG 에셋 안의 `<script>`·`on*` 속성·`<style>`(글꼴·색)은 아직 검사하지 않는다. 그리기 작업 때 `<img>`로만 렌더하도록 정하거나 SVG 내용 검사 테스트를 더한다.
