# HomeSweetHome 🏠

가족이 슬랙에 말하면 일정·할 일·기념일이 마크다운 위키에 기록되고, 거실 태블릿 대시보드에 자동으로 보이는 서비스.

- **입력**: 슬랙 봇 (다른 메신저는 `MessengerAdapter`로 추가)
- **원본**: 마크다운 + Git 위키 (별도 private 레포)
- **표시**: 안 쓰는 태블릿을 브라우저 키오스크로
- **서버**: 남는 노트북 1대에서 봇 + 대시보드를 PM2로 상시 실행

## 구성

TypeScript 모노레포 (pnpm workspace)

| 패키지 | 역할 |
|---|---|
| `apps/dashboard` | Next.js App Router, 태블릿 화면과 상태 API |
| `apps/bot` | Slack Bolt (Socket Mode) |
| `packages/core` | 공통 타입, 어댑터 인터페이스 |

## 시작하기

```bash
pnpm install
cp .env.example .env   # 값 채우기
pnpm --filter @hsh/dashboard dev
```
