// e2e가 띄우는 server.ts 자식 프로세스의 격리.
// server.ts는 레포 루트 .env를 읽는다. HSH_SKIP_ROOT_ENV=1이면 읽지 않아서, 실제 KMA_SERVICE_KEY·HSH_FAMILY_ID·HSH_STATE_DIR 같은 값이 들어오지 않는다.
// e2e는 서버를 spawnServer로만 띄운다(lib/root-env.test.ts가 직접 spawn 호출을 막는다).
import { spawn } from "node:child_process";

export const ISOLATED_ENV = { HSH_SKIP_ROOT_ENV: "1" };

/**
 * 서버(node ...)를 격리 env로 띄운다. env는 부모 env 위에 합치고, 격리 값은 맨 뒤라서 호출자가 덮어쓸 수 없다.
 * spawnFn은 시험용 주입.
 */
export function spawnServer(args, { cwd, env = {}, spawnFn = spawn } = {}) {
  return spawnFn("node", args, { cwd, env: { ...process.env, ...env, ...ISOLATED_ENV }, stdio: "ignore" });
}
