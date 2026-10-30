// PM2 설정 (노트북 상시 실행). 사용: 먼저 `pnpm --filter @hsh/dashboard build`, 그다음 `pm2 start ecosystem.config.cjs`.
// Node 22.18+ 가 필요하다(.ts를 그대로 실행). 비밀값은 각 앱 폴더의 .env에서 읽는다(여기에 쓰지 않는다):
//   apps/dashboard/.env  (PORT, WIKI_REPO_PATH, DASHBOARD_BASE_URL, ADMIN_PIN_HASH ...)
//   apps/bot/.env        (슬랙 토큰, LLM 설정 ...)
// Windows에서도 node가 직접 실행하도록 .bin 래퍼 대신 interpreter/interpreter_args를 쓴다.
module.exports = {
  apps: [
    {
      name: "hsh-dashboard",
      cwd: "apps/dashboard",
      script: "server.ts",
      interpreter: "node",
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: "hsh-bot",
      cwd: "apps/bot",
      script: "src/index.ts",
      interpreter: "node",
      interpreter_args: "--env-file-if-exists=.env --import tsx", // 봇은 .env를 스스로 읽지 않아 node가 읽게 한다
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      stop_exit_codes: [78], // 봇 토큰이 잘못됐을 때(설정 오류): 다시 띄워도 소용없어 멈춘다. 그 밖의 종료는 재시작
    },
  ],
};
