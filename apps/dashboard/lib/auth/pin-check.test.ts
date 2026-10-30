import { describe, expect, it } from "vitest";
import { createLockout } from "./lockout";
import { checkPin } from "./pin-check";
import { hashPin } from "./pin";

const storedHash = hashPin("4821");
const make = () => {
  let t = 0;
  const lockout = createLockout({ maxFailures: 5, lockMs: 600_000, now: () => t });
  return { deps: { lockout, storedHash }, advance: (ms: number) => (t += ms) };
};

describe("checkPin", () => {
  it("맞으면 ok, 틀리면 wrong", () => {
    const { deps } = make();
    expect(checkPin(deps, "4821").status).toBe("ok");
    expect(checkPin(deps, "0000").status).toBe("wrong");
  });
  it("5회 연속 실패하면 5번째 응답부터 locked, 이후 맞는 PIN도 거부", () => {
    const { deps } = make();
    for (let i = 0; i < 4; i++) expect(checkPin(deps, "0000").status).toBe("wrong");
    expect(checkPin(deps, "0000")).toEqual({ status: "locked", retryAfterMs: 600_000 });
    expect(checkPin(deps, "4821").status).toBe("locked");
  });
  it("잠금이 풀린 뒤 맞는 PIN은 통과", () => {
    const { deps, advance } = make();
    for (let i = 0; i < 5; i++) checkPin(deps, "0000");
    advance(600_000);
    expect(checkPin(deps, "4821").status).toBe("ok");
  });
  it("중간에 성공하면 실패 횟수가 초기화", () => {
    const { deps } = make();
    for (let i = 0; i < 4; i++) checkPin(deps, "0000");
    expect(checkPin(deps, "4821").status).toBe("ok");
    for (let i = 0; i < 4; i++) expect(checkPin(deps, "0000").status).toBe("wrong");
  });
  it("형식이 틀린 입력도 실패로 센다", () => {
    const { deps } = make();
    for (let i = 0; i < 4; i++) checkPin(deps, "");
    expect(checkPin(deps, "abc").status).toBe("locked");
  });
  it("ADMIN_PIN_HASH가 없으면 어떤 PIN도 거부(unconfigured), 실패로 세지 않는다", () => {
    const { deps } = make();
    for (let i = 0; i < 10; i++) expect(checkPin({ ...deps, storedHash: undefined }, "4821").status).toBe("unconfigured");
    expect(checkPin({ ...deps, storedHash: "  " }, "4821").status).toBe("unconfigured");
    expect(checkPin(deps, "4821").status).toBe("ok");
  });
});
