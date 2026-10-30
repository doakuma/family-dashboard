"use client";
import { useEffect, useState } from "react";
import { setupQrSchema, type SetupQrView } from "@/lib/setup-qr-schema";

export type { SetupQrView };

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
        const parsed = setupQrSchema.safeParse(await res.json());
        if (parsed.success && alive) setQr(parsed.data); // 모양이 다른 응답은 무시하고 이전 QR을 유지
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
