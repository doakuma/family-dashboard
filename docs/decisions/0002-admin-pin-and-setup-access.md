# 0002. 관리자 PIN, 세팅 진입, 내부망 제한 (#17)

- 날짜: 2026-10-30
- 상태: 채택 (오너 결정, 스펙 rev 39). 구현 확인 후 리뷰 대기

## 결정

### PIN
- 관리자 PIN(숫자 4~6자리)은 `.env`의 `ADMIN_PIN_HASH`에 **해시로만** 둔다. 서버는 어떤 파일에도 비밀값을 쓰지 않는다.
- `pnpm -s pin:hash`(루트) = `@hsh/dashboard`의 `pin:hash`. PIN을 stdin으로 받고(화면에 안 보임, 두 번 입력) `ADMIN_PIN_HASH=...` 한 줄만 stdout에 낸다. 파이프 입력도 된다.
- 해시: `node:crypto` scrypt(N=16384, r=8, p=1, 32바이트) + 랜덤 salt 16바이트, 비교는 `timingSafeEqual`.
  형식은 `scrypt:N:r:p:salt:hash`(base64url). **`$`를 쓰지 않는다**: Next가 `.env` 값의 `$이름`을 변수로 치환한다.
- `ADMIN_PIN_HASH`가 없으면 아무도 못 들어간다(기본 PIN 없음). 이 경우 실패 횟수로 세지 않는다.
- 시도 제한: 5회 연속 실패 시 15분 잠금(메모리, 서버 재시작 시 초기화). 잠긴 동안은 맞는 PIN도 거부. 접속자 구분 없이 하나로 센다.

### /setup 진입
- 서버가 `needsSetup`일 때 일회용 토큰(32바이트 랜덤)을 **메모리**에 만든다. 만료 30분, PIN 확인까지 통과해 세션이 발급되면 폐기(모든 토큰), 다음 요청에서 재발급.
  만료 5분 전부터는 새 토큰을 내보내되 이미 나간 토큰은 자기 만료까지 유효(QR을 찍고 입력하는 중에 바뀌지 않게). 저장은 sha256 해시로.
- QR 주소는 `DASHBOARD_BASE_URL`의 origin으로 만든다. **Host 헤더는 보지 않는다.** 없으면 개발 모드에서만 `http://localhost:PORT`, 운영에서는 QR 대신 안내 문구(조용한 localhost QR은 휴대폰에서 안 열려서 원인 찾기 어렵다).
- 태블릿 화면은 `/api/setup-qr`를 1분마다 받아 QR을 갱신한다(세팅 필요일 때만 토큰 발급).
- 흐름: QR(`/setup?t=토큰`) -> 토큰 검증 -> PIN -> 세션 쿠키. 토큰 없음/틀림은 403.
  틀린 PIN은 토큰을 소모하지 않는다(PIN 시도는 잠금이 막는다).
- `/settings`: PIN -> 같은 세션 쿠키. 세션에 `via`(setup/pin)를 담아, `/setup`은 `via=setup`일 때만 열린다.
- 세션 쿠키 `hsh_session`: HttpOnly, SameSite=Strict, HMAC-SHA256 서명, 30분 만료. 서명 키는 프로세스 메모리의 랜덤값이라 서버를 다시 켜면 모든 세션이 끝난다.
  폼 POST는 Origin(없으면 Referer) host가 요청 Host와 같을 때만 받는다(SameSite와 이중 장치).
  `Secure`는 붙이지 않는다: 집 안 http라 붙이면 쿠키가 저장되지 않는다. 대신 내부망 제한이 있다.
- `Referrer-Policy: same-origin`: 토큰이 든 URL이 다른 사이트로 새지 않게. (`no-referrer`는 폼 POST의 Origin을 `null`로 만들어 출처 확인이 깨져서 쓰지 않는다.)

### 내부망 제한
- 허용: 127/8, 10/8, 172.16/12, 192.168/16, `::1`, fc00::/7, fe80::/10, IPv4-mapped IPv6(안의 IPv4가 위 대역일 때). 그 밖과 해석 불가는 거부. 169.254/16, 100.64/10(Tailscale 등)은 **허용하지 않는다**(필요하면 오너가 결정).
- 이 레포의 Next는 16.4.3: `middleware`는 deprecated, **`proxy.ts`**(기본 Node 런타임)를 쓴다.
- 문제: proxy·route handler는 소켓 주소를 얻지 못한다(`NextRequest.ip` 없음). Next가 `x-forwarded-for`를 채우긴 하지만 `??=`라서 **클라이언트가 보낸 값이 그대로 남는다** -> 믿지 않는다.
- 결정: **커스텀 서버(`apps/dashboard/server.ts`)** 가 `req.socket.remoteAddress`로 먼저 거르고(403), 허용되면 그 값을 `x-hsh-peer` 헤더에 **항상 덮어써서** 넘긴다. `proxy.ts`는 그 헤더만 본다. 헤더가 없거나 사설 대역이 아니면 거부(fail closed).
  개발 모드 HMR 웹소켓도 같은 검사를 거치고, 운영에서는 웹소켓 업그레이드를 모두 끊는다.
- `pnpm dev`/`start`는 `node server.ts [--dev]`(Node 22.18+ 타입 제거 실행, 빌드 단계 없음). `next start`로 직접 띄우면 헤더가 없어 전부 403이 된다(안전한 쪽으로 실패).
- 한계: 앞에 리버스 프록시를 두면 소켓 주소가 프록시 주소가 된다(지금 구성에는 없음). 필요해지면 신뢰할 프록시 주소 목록을 따로 결정한다.

### /api/state 공개 응답
- 태블릿 위젯이 실제로 쓰는 것만 남긴 `ApiState`(허용 목록 `toPublicState`): `familyName`, 구성원 `{id,name,color}`, 일정, 할 일, 기념일, 날씨, `updatedAt`, `needsSetup`.
- 제외: 주소(region), slackId, calendarId, KMA 격자·지역코드, role, timezone, setupCompletedAt, 생일 원문.
- 화면이 생일 원문으로 계산하던 "n살"은 서버가 `turns: {date, age}`(다음 생일 날짜와 그날 나이)로 미리 계산해 준다. 화면은 자기 계산 날짜가 `turns.date`와 같을 때만 표시(자정 직후 갱신 전 어긋남 방지).
- 이 API는 인증이 없다(태블릿이 쿠키 없이 읽는다). 보호는 내부망 제한과 필드 축소가 전부다.

## 대안과 버리는 이유
- **PIN을 위키/설정 파일에 저장**: 서버가 비밀값을 쓰게 되고, 위키는 GitHub로 push된다. 버림.
- **PIN 평문을 .env에**: 유출 시 그대로 노출. 해시만 둔다.
- **bcrypt/argon2 패키지**: 의존성 추가. 4~6자리 PIN은 어차피 해시 강도보다 시도 제한이 방어선이라 내장 scrypt로 충분.
- **X-Forwarded-For로 IP 판정**: 위조 가능. 버림.
- **proxy.ts만으로 처리**: 소켓 주소를 못 얻는다. 헤더를 믿어야 하므로 위조 가능. 커스텀 서버 필요.
- **route handler/layout에서 IP 검사**: 같은 이유로 소켓 주소 접근 불가. (Next 내부 모듈의 비공개 API에 기대면 업그레이드에 취약)
- **OS 방화벽(ufw 등)만**: 좋은 추가 방어지만 레포 밖 설정이라 코드의 보장이 되지 못한다. 운영 문서에서 권장한다.
- **세션을 서버 메모리 목록으로 관리**: 서버 쪽 폐기가 쉽지만 서명 쿠키가 더 단순하고 재시작 시 만료되는 성질은 같다. 로그아웃은 쿠키 삭제만 하므로 도난한 쿠키를 서버에서 즉시 무효화할 수는 없다(만료 30분).

## 알려진 약점 (받아들임)
- QR 토큰은 `/` 화면(HTML)에도 들어 있어, 내부망의 누구든 대시보드를 열면 볼 수 있다. 토큰은 "QR을 본 사람이 휴대폰으로 열기 쉽게 하는 장치 + /setup 무차별 접근 차단"이지 인증이 아니다. **실제 인증은 PIN + 잠금**이다.
- 잠금이 접속자 구분 없이 전역이라 내부망의 누군가가 일부러 잠글 수 있다(15분). 가족 내부망에서는 받아들인다.
- 서버 재시작 시 토큰·세션·잠금 횟수가 초기화된다(잠금 우회가 되지만 재시작은 서버 접근 권한이 필요).

## passes 정의
`features.json`의 `passes`는 **`pnpm check` 통과 + 리뷰 통과 후에만 true**. 구현자(`hsh-engineer`)는 바꾸지 않고, 리뷰어가 제안하면 오너가 반영한다.
(`features.json` `$comment`, `.claude/agents/hsh-engineer.md`를 이 정의로 맞췄다.)
