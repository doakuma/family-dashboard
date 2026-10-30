"use client";
import { useEffect, useState } from "react";

/** /api/setup-qr 응답(서버의 SetupQr와 같은 모양. server-only 모듈이라 타입을 따로 둔다) */
export type SetupQrView = { ok: true; label: string; url: string; svg: string } | { ok: false; reason: "missing" | "invalid" };

/** 세팅 필요 화면이 떠 있는 동안 QR(일회용 토큰)을 주기적으로 새로 받는다. 토큰은 30분마다 바뀌고, 쓰면 폐기된다. */
export function useSetupQr(initial: SetupQrView | undefined, active: boolean, intervalMs = 60_000): SetupQrView | undefined {
  const [qr, setQr] = useState(initial);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/setup-qr", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as SetupQrView;
        if (alive) setQr(body);
      } catch {
        // 다음 주기에 다시
      }
    };
    void load();
    const id = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [active, intervalMs]);

  return qr;
}
