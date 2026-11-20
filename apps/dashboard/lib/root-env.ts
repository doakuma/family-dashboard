// server.ts가 레포 루트 .env를 읽을지 정하는 부분. server.ts가 직접 불러오므로 상대 import는 쓰지 않는다(Node 타입 제거 실행).
// 시험 전용 스위치: HSH_SKIP_ROOT_ENV=1이면 루트 .env를 읽지 않는다(e2e가 실제 비밀값·경로를 끌어오지 않게).
// 운영·개발에서는 이 변수를 설정하지 않는다. 값이 비어 있지 않은데 1이 아니면 켜지지 않고 경고만 남긴다.
export const SKIP_ROOT_ENV = "HSH_SKIP_ROOT_ENV";

type Env = Readonly<Record<string, string | undefined>>;

export function shouldLoadRootEnv(env: Env): boolean {
  return env[SKIP_ROOT_ENV]?.trim() !== "1";
}

/** 스위치 값이 비어 있지 않은데 1이 아니면 경고 문구, 아니면 null. */
export function skipRootEnvWarning(env: Env): string | null {
  const v = env[SKIP_ROOT_ENV]?.trim();
  return v && v !== "1" ? `${SKIP_ROOT_ENV}는 1일 때만 켜져요(받은 값은 무시하고 루트 .env를 읽어요)` : null;
}

/** 루트 .env를 읽는다(스위치가 1이면 읽지 않고 false). loader는 @next/env의 loadEnvConfig. */
export function loadRootEnv(loader: (dir: string, dev: boolean) => unknown, rootDir: string, dev: boolean, env: Env, warn: (msg: string) => void = () => {}): boolean {
  const w = skipRootEnvWarning(env);
  if (w) warn(w);
  if (!shouldLoadRootEnv(env)) return false;
  loader(rootDir, dev);
  return true;
}
