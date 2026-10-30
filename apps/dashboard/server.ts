// 커스텀 서버: 소켓 주소로 내부망 검사를 하고, 그 값을 proxy.ts에 넘긴다. (결정 기록 0002)
// 실행: `node server.ts`(운영, 먼저 `next build`) / `node server.ts --dev`. Node 22.18+ 의 타입 제거 실행을 쓴다.
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { stampPeer } from "./lib/auth/ip.ts";

const dev = process.argv.includes("--dev");
(process.env as Record<string, string | undefined>).NODE_ENV = dev ? "development" : "production";
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME_BIND ?? "0.0.0.0";

const stamp = (req: IncomingMessage) => stampPeer(req.headers, req.socket.remoteAddress);

// 요청 처리기는 Next를 준비한 뒤에 붙인다(그 전에 들어온 요청은 503).
const ready: { handle?: (req: IncomingMessage, res: ServerResponse) => Promise<void> } = {};
const server = createServer((req, res) => {
  if (!stamp(req)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" }).end("내부망에서만 접근할 수 있어요.");
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
