// server.ts가 레포 루트 .env를 읽을지 정하는 부분. server.ts가 직접 불러오므로 상대 import는 쓰지 않는다(Node 타입 제거 실행).
// 시험 전용 스위치: HSH_ENV_FILE=none 이면 루트 .env를 읽지 않는다(e2e가 실제 비밀값·경로를 끌어오지 않게).
// 운영·개발에서는 이 변수를 설정하지 않는다.
export const ENV_FILE_SWITCH = "HSH_ENV_FILE";

export function shouldLoadRootEnv(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[ENV_FILE_SWITCH]?.trim().toLowerCase() !== "none";
}

/** 루트 .env를 읽는다(스위치가 none이면 읽지 않고 false). loader는 @next/env의 loadEnvConfig. */
export function loadRootEnv(loader: (dir: string, dev: boolean) => unknown, rootDir: string, dev: boolean, env: Readonly<Record<string, string | undefined>>): boolean {
  if (!shouldLoadRootEnv(env)) return false;
  loader(rootDir, dev);
  return true;
}
