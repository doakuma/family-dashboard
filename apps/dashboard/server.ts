// 커스텀 서버: 소켓 주소로 내부망 검사, Host 허용 목록 검사를 하고, 소켓 주소를 증명과 함께 proxy.ts에 넘긴다. (결정 기록 0002)
// 실행: `node server.ts`(운영, 먼저 `next build`) / `node server.ts --dev`. Node 22.18+ 의 타입 제거 실행을 쓴다.
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import nextEnv from "@next/env";

const dev = process.argv.includes("--dev");
// .env를 가장 먼저 읽는다: PORT·DASHBOARD_BASE_URL을 아래에서 쓰기 전에 반영돼야 한다(PM2로 띄워도 .env가 적용되게).
// (Next도 나중에 읽지만 그때는 이미 이 파일이 PORT를 정한 뒤다.) 이미 있는 환경 변수는 덮어쓰지 않는다.
nextEnv.loadEnvConfig(process.cwd(), dev);
(process.env as Record<string, string | undefined>).NODE_ENV = dev ? "development" : "production";

const { isAllowedHost } = await import("./lib/auth/host.ts");
const { PEER_SECRET_ENV, createPeerSecret, stampPeer } = await import("./lib/auth/peer.ts");

// 부트스트랩이라 ConfigProvider(@hsh/core)를 쓰지 않는다: Node가 직접 실행하는 파일이라 확장자 없는 core 모듈을 못 불러온다.
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME_BIND ?? "0.0.0.0";

// 시작할 때마다 새로 만드는 비밀값. proxy.ts가 같은 값(env)으로 증명을 확인한다. 밖으로 나가지 않는다.
const peerSecret = createPeerSecret();
process.env[PEER_SECRET_ENV] = peerSecret;

/** 소켓 주소가 내부망이고 Host가 허용 목록에 있어야 통과. 통과하면 주소+증명 헤더를 (덮어써서) 붙인다. */
const stamp = (req: IncomingMessage) => {
  const peerOk = stampPeer(req.headers, req.socket.remoteAddress, peerSecret);
  return peerOk && isAllowedHost(req.headers.host, { dashboardBaseUrl: process.env.DASHBOARD_BASE_URL, nodeEnv: process.env.NODE_ENV, port });
};

// 요청 처리기는 Next를 준비한 뒤에 붙인다(그 전에 들어온 요청은 503).
const ready: { handle?: (req: IncomingMessage, res: ServerResponse) => Promise<void> } = {};
const server = createServer((req, res) => {
  if (!stamp(req)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" }).end("내부망에서만, 등록된 주소로만 접근할 수 있어요.");
    return;
  }
  if (!ready.handle) {
    res.writeHead(503).end();
    return;
  }
  void ready.handle(req, res);
});

// WebSocket(개발 모드 HMR)도 같은 검사를 먼저 한다. 운영에서는 웹소켓을 쓰지 않으므로 전부 끊는다.
// Next가 httpServer에 붙이는 upgrade 처리기보다 앞에 두려고 prependListener를 쓴다.
server.prependListener("upgrade", (req: IncomingMessage, socket: Duplex) => {
  if (!dev || !stamp(req)) socket.destroy();
});

const { default: next } = await import("next");
const app = next({ dev, hostname, port, httpServer: server });
const nextHandle = app.getRequestHandler();
await app.prepare();
ready.handle = (req, res) => nextHandle(req, res);

server.listen(port, hostname, () => {
  console.log(`> 대시보드 http://${hostname}:${port} (${dev ? "개발" : "운영"}, 내부망 전용)`);
});
