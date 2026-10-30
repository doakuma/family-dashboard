# 위키 형식 (현재 구현 기준)

이 문서는 `packages/core/src/wiki/*`(파서·직렬화·apply)와 `fixtures/sample-wiki`가 실제로 따르는 형식이다.
스펙과 다르면 스펙(오너 결정)이 우선이고, 이 문서와 코드를 함께 고친다. 검증 규칙은 `packages/core/src/schema.ts`.

## 폴더

```
config.md              가족 설정 (프론트매터만)
members/<id>.md        구성원 1명당 파일 (프론트매터만)
events/YYYY-MM.md      일정, 달마다 파일 하나 (파일 이름이 YYYY-MM.md가 아니면 무시)
tasks.md               장보기·할 일
anniversaries.md       매년 반복 기념일
log.md                 변경 기록 (apply가 한 줄씩 추가)
notes/                 자유 메모 (앱은 읽지 않음)
```

읽을 때 형식이 깨진 줄은 건너뛰고, config·구성원 파일은 **필드 단위로 관용**한다(아래 '읽기 관용'). 쓸 때는 스키마를 통과하지 못하면 거부한다.
파일 맨 앞의 `<!-- 주석 -->`은 허용된다.

## 프론트매터 (config.md, members/*.md)

`---`로 감싼 평평한 `key: value` 한 단계. 중첩·여러 줄 값 없음. 값 양끝의 따옴표는 읽을 때 벗긴다.
쓸 때는 값에 줄바꿈·제어문자, 앞뒤 공백, 따옴표 감쌈이 있으면 거부한다.

### members/<id>.md

```
---
id: haneul
name: 하늘
role: child
birth: 2020-08-15
color: blue
slack: U0123ABC
---
```

| 키 | 필수 | 규칙 |
|---|---|---|
| id | O | `^[A-Za-z0-9_-]+$`, `family`는 예약(내장 '가족 전체') |
| name | O | 1~40자, 제어문자 금지 |
| role | | `guardian`(쓰기 가능) / `child`(질문만). 없거나 틀리면 읽을 때 `child` |
| birth | | `YYYY-MM-DD`, 실제 있는 날짜. 잘못되면 없는 것으로 읽는다 |
| color | | 색 이름(소문자: coral, teal, blue, amber, green, purple, pink, gray) 또는 `#hex`. 기본 `gray` (`Blue`처럼 틀리면 gray로 읽음) |
| slack | | Slack 사용자 ID (영문·숫자). 틀리면 없는 것으로 읽는다 |

구성원이 1명 이상일 때만 내장 구성원 `family`(이름 "가족")가 목록 끝에 붙는다. 구성원 0명이면 "세팅 필요".

### config.md

```
---
familyName: 햇살네
timezone: Asia/Seoul
region: 서울특별시 마포구 망원동
kmaNx: 59
kmaNy: 127
kmaMidLandRegId: 11B00000
kmaMidTaRegId: 11B10101
familyColor: gray
setupCompletedAt: 2026-10-20T20:00:00+09:00
---
```

`familyName`이 없거나 깨지면 config가 없는 것으로 읽는다 → 세팅 필요.
`timezone` 기본 `Asia/Seoul`, `familyColor` 기본 `gray`. `kmaNx/Ny`는 정수. `calendarId`는 공백 없는 문자열(선택).
`setupCompletedAt`은 ISO 8601(시간대 포함).

세팅 필요 판정(`needsSetup`): config가 없거나 구성원이 0명. `setupCompletedAt`은 판정에 쓰지 않으므로 값이 깨져도 QR 세팅 화면으로 바뀌지 않는다.

### 읽기 관용 (필드 단위)

- **필수값**(구성원 `id`·`name`, config `familyName`)이 없거나 스키마에 안 맞으면 그 파일을 버린다(구성원은 목록에서 빠지고, config는 없는 것 = 세팅 필요).
- **그 밖의 필드**는 값이 틀리면 **그 필드만** 기본값(없음 포함)으로 읽고 나머지는 살린다. 예: `color: Blue` -> `gray`, `familyColor: Gray` -> `gray`,
  `calendarId: abc def` -> 없음, `slack: U00-DAD` -> 없음, 모르는 `timezone` -> `Asia/Seoul`, 깨진 `setupCompletedAt` -> 없음, 정수가 아닌 `kmaNx` -> 없음.
  `role`이 없거나 `guardian`·`child`가 아니면 최소 권한인 `child`로 읽고 경고한다(스펙 rev 51).
- 대체·건너뜀은 `readWiki()` 결과의 `warnings: string[]`(`파일: 필드: 내용`)에 모인다. 화면에는 내지 않고 대시보드 서버가 로그(`[wiki] …`)에 남긴다(내용이 바뀔 때만).
- **쓰기 쪽 스키마(`memberSchema`·`familyConfigSchema`, `formatMemberFile`·`formatConfigFile`)는 엄격 그대로**다. 관용은 읽기에만 있다.

## 일정: events/YYYY-MM.md

한 줄이 일정 하나. 시간순(날짜, 시작 시각; 종일은 00:00)으로 정렬해 넣는다.

```
- [ ] 2026-11-03 15:00-16:00 치과 검진 @haneul #evt-a1b2
- [ ] 2026-11-15 12:00-14:00 사촌 모임 점심 @family &cousins #evt-i9j0
- [ ] 2026-11-05 14:00 미술학원 @haneul #evt-2b05
- [x] 2026-10-24 종일 할머니댁 방문 @family #evt-1a01
```

`- [체크] 날짜 언제 제목 @구성원… [&그룹id] #id`

- 체크: `[ ]` 진행 전, `[x]` 완료.
- 언제: `종일` 또는 `HH:MM` 또는 `HH:MM-HH:MM`(24시간).
- 제목: 공백 포함 가능. 줄 끝의 `@멤버`(여러 개)와 `#evt-…` 토큰을 뗀 나머지.
- 공유 그룹 `&그룹id`(선택, 스펙 rev 35): `@구성원` 뒤, `#id` 앞. 없으면 우리 가족만. 그룹 id는 `^[a-z0-9_-]+$`(구성원 id와 같은 형식이되 소문자만), 일정당 1개.
  MVP는 **필드만** 있다 — 공유 동작·그룹 정의·화면 변화 없음, `/api/state`에도 내보내지 않는다. 파서·직렬화는 토큰을 보존하고, `event.update`로 다른 필드를 고쳐도 유지한다.
  `Change`(LLM 경로)에는 share가 없어 LLM이 만들거나 바꿀 수 없다(스키마가 버림, 제목의 `&토큰`은 거부/봇이 제거). 손으로 위키를 고쳐 넣는 값만 유효하다.
  깨진 토큰(대문자, 2개 이상, `&`만 있음)은 줄을 버리지 않고 share만 없는 것으로 읽고 경고한다(`events/…: share: …`). 그 줄을 apply로 다시 쓰면 깨진 토큰은 사라진다.
- id: `evt-` + 영숫자(새로 만들면 `evt-` + 16진 4자리). 파일 전체에서 유일.
- 일정이 아닌 줄(주석 등)은 읽을 때 무시하고 쓸 때 그대로 둔다.
- 파일은 날짜의 `YYYY-MM`으로 정해진다. 날짜를 다른 달로 고치면 파일이 옮겨진다.

쓰기 규칙: 제목 1~80자, `#`·`@`·단어 앞 `&`(`&cousins` 꼴; `R&D`·`A & B`는 허용)·줄바꿈·제어문자 금지. 시간이 있는(allDay=false) 일정은 start 필수, end는 start보다 늦어야 한다.
구성원은 1명 이상이고 id 규칙을 따른다.

## 할 일: tasks.md

```
## 장보기
- [ ] 우유 #task-3c01
- [ ] 기저귀 4단계 @mom #task-3c03
- [x] 계란 한 판 #task-3c05

## 할 일
- [ ] 도서관 책 반납 @haneul #task-3d01
```

- 섹션 제목은 정확히 `## 장보기`(shopping) 또는 `## 할 일`(todo). 다른 섹션·섹션 밖 항목은 무시.
- 항목: `- [체크] 제목 [@구성원] #task-…`. 담당은 최대 1명(여러 명 적혀 있으면 첫 번째).
- 새 항목은 해당 섹션의 마지막 항목 뒤에 들어간다. 섹션이 없으면 만든다.
- 완료는 `[ ]`를 `[x]`로 바꾸는 것이 전부다(삭제 없음).

## 기념일: anniversaries.md

```
- 03-12 엄마 생일 @mom
- 11-21 결혼기념일 @family
```

`- MM-DD 제목 [@구성원]`, 매년 반복. `MM-DD` 순으로 정렬해 넣는다. 형식이 맞지 않는 줄(예: `13-01`)은 무시.
제목 규칙은 일정과 같다. 제목에 "생일"이 있고 구성원에게 `birth`가 있으면 화면에 나이를 보여 준다.

## log.md

`# 변경 기록` 아래에 apply가 한 줄씩 추가한다.

```
- 2026-11-01 10:02 [task.add] 장보기 추가: 우유 (by U0123) #task-3c01
```

시각은 Asia/Seoul. 사람이 손으로 고쳐도 앱은 읽지 않는다.

## 쓰기와 커밋

모든 쓰기는 `WikiRepository.apply(change)` 하나로 한다(LLM은 파일을 쓰지 않는다).
apply는 `Change`를 스키마로 다시 검증하고 → 바뀐 파일과 log.md를 쓰고 → 그 파일들만 `git add`/`commit`(`[종류] 요약`) → 원격이 있으면 push한다.
commit이 실패하면 파일을 원래대로 되돌린다. push가 실패하면 예외 없이 `pushed: false`를 돌려주고 커밋은 로컬에 남는다.
쓰기는 큐로 한 번에 하나씩, `pull`(메인 PC에서 고친 내용 반영)도 같은 큐를 탄다.
위키 폴더는 독립 git 레포의 루트여야 한다(읽기 전용으로 여는 예시 위키 제외).
push 실패는 결과의 `pushError`(git 메시지 요약)와 경고 로그에 남는다.
커밋은 apply가 쓴 파일 경로만 지정해서 한다(사람이 stage해 둔 다른 파일이 딸려 들어가지 않는다). commit 실패 롤백도 사람이 stage한 index 항목은 원래 값으로 복구한다.
`pull`이 충돌하면 진행 중인 rebase를 `--abort`(autostash 복구 포함)하고 오류를 던진다. 레포가 rebase·merge 진행 중이거나 detached HEAD면 apply·pull을 거부한다. 읽기 전용 인스턴스는 pull도 거부한다.
