"use client";
import { useEffect, useState } from "react";

/**
 * 1초마다 갱신되는 현재 시각.
 * - fixed: 그 시각에 멈춘다(시안·테스트용).
 * - initial: 서버가 렌더링한 시각(ISO). 첫 렌더를 서버 HTML과 같게 맞춰 hydration 불일치를 막고,
 *   마운트 직후 실제 시각으로 바꾼다.
 */
export function useNow(fixed?: string, initial?: string): Date {
  const [now, setNow] = useState(() => new Date(fixed ?? initial ?? Date.now()));
  useEffect(() => {
    if (fixed) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [fixed]);
  return now;
}
