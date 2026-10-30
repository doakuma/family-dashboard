"use client";
import { apiStateSchema, type ApiState } from "@hsh/core";
import { useEffect, useRef, useState } from "react";

export interface PolledState {
  state: ApiState;
  /** 마지막 폴링이 실패했는지 (노트북 꺼짐·응답 형식 오류 등) */
  offline: boolean;
}

export interface PollOptions {
  /** 달력 둘러보기용 달(YYYY-MM). 바뀌면 바로 한 번 가져온다. 없으면 서버의 이번 달 */
  month?: string;
  intervalMs?: number;
}

/**
 * /api/state를 주기적으로 가져온다. 실패하거나 응답 형식이 다르면 마지막 상태를 그대로 둔다.
 * 보기 상태(보는 달·시트)는 이 훅 밖(DashboardViewState)에 있어서, 폴링 결과가 와도 바뀌지 않는다.
 */
export function useDashboardState(initial: ApiState, { month, intervalMs = 60_000 }: PollOptions = {}): PolledState {
  const [polled, setPolled] = useState<PolledState>({ state: initial, offline: false });
  const firstMonth = useRef(month); // 서버가 첫 화면에 이미 실어 준 달은 바로 다시 가져오지 않는다
  const seq = useRef(0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const mine = ++seq.current;
      try {
        const res = await fetch(month ? `/api/state?month=${encodeURIComponent(month)}` : "/api/state", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const state = apiStateSchema.parse(await res.json());
        // 달을 빠르게 넘기면 늦게 온 이전 달 응답이 덮어쓰지 않게 가장 마지막 요청만 반영
        if (alive && mine === seq.current) setPolled({ state, offline: false });
      } catch {
        if (alive && mine === seq.current) setPolled((p) => ({ ...p, offline: true }));
      }
    };
    if (month !== firstMonth.current) {
      firstMonth.current = month;
      void tick();
    }
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [month, intervalMs]);

  return polled;
}
