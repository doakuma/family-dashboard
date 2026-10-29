"use client";
import { useEffect, useState } from "react";

/** 1초마다 갱신되는 현재 시각. fixed를 주면 그 시각에 멈춘다(시안·테스트용). */
export function useNow(fixed?: string): Date {
  const [now, setNow] = useState(() => (fixed ? new Date(fixed) : new Date()));
  useEffect(() => {
    if (fixed) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [fixed]);
  return now;
}
