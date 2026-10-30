import { describe, expect, it } from "vitest";
import { MAX_FORM_BYTES, readSmallForm } from "./form";

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://x/api", {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded", "content-length": String(new TextEncoder().encode(body).length), ...headers },
  });

describe("readSmallForm", () => {
  it("정상 폼", async () => {
    const r = await readSmallForm(post("pin=4821&t=abc"));
    expect(r.ok && r.form.get("pin")).toBe("4821");
  });
  it("본문이 비어도 400이 아니라 빈 폼으로 읽는다(필드 검사는 호출자)", async () => {
    const r = await readSmallForm(post(""));
    expect(r.ok && r.form.get("pin")).toBeNull();
  });
  it("폼이 아닌 형식은 415", async () => {
    expect(await readSmallForm(post("{}", { "content-type": "application/json" }))).toEqual({ ok: false, status: 415 });
    expect(await readSmallForm(new Request("http://x", { method: "POST", body: "x" }))).toEqual({ ok: false, status: 415 });
  });
  it("길이를 모르면 411, 상한을 넘으면 읽지 않고 413", async () => {
    expect(await readSmallForm(post("pin=1", { "content-length": "" }))).toMatchObject({ ok: false, status: 411 });
    expect(await readSmallForm(post("pin=1", { "content-length": "abc" }))).toMatchObject({ ok: false, status: 411 });
    expect(await readSmallForm(post("pin=1", { "content-length": String(MAX_FORM_BYTES + 1) }))).toEqual({ ok: false, status: 413 });
  });
  it("content-length를 속여도 실제 본문이 크면 413", async () => {
    expect(await readSmallForm(post(`pin=${"1".repeat(MAX_FORM_BYTES + 10)}`, { "content-length": "10" }))).toEqual({ ok: false, status: 413 });
  });
  it("본문 읽기가 실패하면 400", async () => {
    const req = post("pin=1");
    await req.text(); // 이미 소비된 본문
    expect(await readSmallForm(req)).toEqual({ ok: false, status: 400 });
  });
});
