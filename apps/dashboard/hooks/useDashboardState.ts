"use client";
import type { DashboardState } from "@hsh/core";
import { useEffect, useState } from "react";

export interface PolledState {
  state: DashboardState;
  /** 마지막 폴링이 실패했는지 (노트북 꺼짐 등) */
  offline: boolean;
}

/** /api/state를 주기적으로 가져온다. 실패하면 마지막 상태를 그대로 둔다. */
export function useDashboardState(initial: DashboardState, intervalMs = 60_000): PolledState {
  const [polled, setPolled] = useState<PolledState>({ state: initial, offline: false });

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const state = (await res.json()) as DashboardState;
        if (alive) setPolled({ state, offline: false });
      } catch {
        if (alive) setPolled((p) => ({ ...p, offline: true }));
      }
    };
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);

  return polled;
}
