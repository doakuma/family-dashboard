import { describe, expect, it } from "vitest";
import { IDLE_RESET_MS, INITIAL_VIEW, canMove, isIdleExpired, msUntilReset, viewMonthOf, viewReducer, type DashboardViewState } from "./view-state";

const BASE = "2026-11";
const T0 = 1_000_000;

describe("viewReducer", () => {
  it("날짜를 누르면 시트가 열리고 터치 시각이 기록된다", () => {
    const v = viewReducer(INITIAL_VIEW, { type: "selectDate", date: "2026-11-03", at: T0 });
    expect(v).toMatchObject({ selectedDate: "2026-11-03", selectedEventId: undefined, lastTouchAt: T0, monthOffset: 0 });
  });

  it("일정을 누르면 상세, 목록으로 돌아가면 상세만 닫힌다", () => {
    let v = viewReducer(INITIAL_VIEW, { type: "selectDate", date: "2026-11-03", at: T0 });
    v = viewReducer(v, { type: "selectEvent", id: "evt-1", at: T0 + 1 });
    expect(v.selectedEventId).toBe("evt-1");
    v = viewReducer(v, { type: "selectEvent", at: T0 + 2 });
    expect(v).toMatchObject({ selectedDate: "2026-11-03", selectedEventId: undefined });
  });

  it("시트가 닫혀 있으면 일정 선택은 무시한다", () => {
    expect(viewReducer(INITIAL_VIEW, { type: "selectEvent", id: "evt-1", at: T0 }).selectedEventId).toBeUndefined();
  });

  it("닫기: 날짜·일정 선택을 지우지만 보던 달은 유지한다", () => {
    let v = viewReducer(INITIAL_VIEW, { type: "changeMonth", delta: 2, baseMonth: BASE, at: T0 });
    v = viewReducer(v, { type: "selectDate", date: "2027-01-05", at: T0 });
    v = viewReducer(v, { type: "closeSheet", at: T0 + 5 });
    expect(v).toEqual({ monthOffset: 2, selectedDate: undefined, selectedEventId: undefined, lastTouchAt: T0 + 5 });
  });

  it("달 이동: 이번 달 기준 offset, 해를 넘고, 시트는 닫힌다", () => {
    let v: DashboardViewState = viewReducer(INITIAL_VIEW, { type: "selectDate", date: "2026-11-03", at: T0 });
    v = viewReducer(v, { type: "changeMonth", delta: 1, baseMonth: BASE, at: T0 + 1 });
    expect(v).toMatchObject({ monthOffset: 1, selectedDate: undefined });
    expect(viewMonthOf(BASE, v.monthOffset)).toBe("2026-12");
    v = viewReducer(v, { type: "changeMonth", delta: 1, baseMonth: BASE, at: T0 + 2 });
    expect(viewMonthOf(BASE, v.monthOffset)).toBe("2027-01");
    v = viewReducer(v, { type: "changeMonth", delta: -14, baseMonth: BASE, at: T0 + 3 });
    expect(viewMonthOf(BASE, v.monthOffset)).toBe("2025-11");
    expect(v.monthOffset).toBe(-12);
  });

  it("범위 끝에서는 더 가지 않고 시트도 그대로", () => {
    const base = "2100-12";
    let v: DashboardViewState = viewReducer(INITIAL_VIEW, { type: "selectDate", date: "2100-12-03", at: T0 });
    v = viewReducer(v, { type: "changeMonth", delta: 1, baseMonth: base, at: T0 + 1 });
    expect(v).toMatchObject({ monthOffset: 0, selectedDate: "2100-12-03", lastTouchAt: T0 + 1 });
    expect(canMove(base, 0, 1)).toBe(false);
    expect(canMove(base, 0, -1)).toBe(true);
    expect(canMove("2000-01", 0, -1)).toBe(false);
  });

  it("reset은 초기 상태(이번 달·시트 닫힘·손댄 적 없음)", () => {
    const v = viewReducer({ monthOffset: 3, selectedDate: "2027-02-01", selectedEventId: "x", lastTouchAt: T0 }, { type: "reset" });
    expect(v).toEqual(INITIAL_VIEW);
    expect(v.lastTouchAt).toBeUndefined();
  });
});

describe("자동 복귀 판단", () => {
  const touched: DashboardViewState = { monthOffset: 2, selectedDate: "2027-01-05", lastTouchAt: T0 };

  it("120초가 정확히 되는 순간부터 만료, 1ms 전은 아직", () => {
    expect(IDLE_RESET_MS).toBe(120_000);
    expect(isIdleExpired(touched, T0 + IDLE_RESET_MS - 1)).toBe(false);
    expect(isIdleExpired(touched, T0 + IDLE_RESET_MS)).toBe(true);
  });

  it("손댄 적 없으면 만료도 타이머도 없다", () => {
    expect(isIdleExpired(INITIAL_VIEW, T0 * 100)).toBe(false);
    expect(msUntilReset(INITIAL_VIEW, T0)).toBeUndefined();
  });

  it("남은 시간은 터치할 때마다 120초로 다시 시작한다", () => {
    expect(msUntilReset(touched, T0 + 30_000)).toBe(90_000);
    const again = viewReducer(touched, { type: "touch", at: T0 + 100_000 });
    expect(msUntilReset(again, T0 + 100_000)).toBe(IDLE_RESET_MS);
    expect(msUntilReset(touched, T0 + 999_999)).toBe(0);
  });

  it("idleCheck: 만료되면 초기 상태, 아니면 같은 객체(리렌더 없음)", () => {
    expect(viewReducer(touched, { type: "idleCheck", now: T0 + IDLE_RESET_MS })).toEqual(INITIAL_VIEW);
    expect(viewReducer(touched, { type: "idleCheck", now: T0 + 1000 })).toBe(touched);
  });
});
