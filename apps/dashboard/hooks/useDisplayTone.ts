"use client";
import { useEffect } from "react";

/**
 * <html data-mode data-tone>를 바꾼다. body 배경까지 반영하려고 html에 건다.
 * 모드(day/night, 화면 구성)와 톤(normal/dim, 색)은 따로다. 첫 HTML은 서버가 서버 시각 기준으로 이미 넣어 두고(layout), 여기서 실제 상태로 맞춘다.
 */
export function useDisplayTone(mode: "day" | "night", tone: "normal" | "dim") {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.mode = mode;
    root.dataset.tone = tone;
    return () => {
      root.dataset.mode = "day";
      root.dataset.tone = "normal";
    };
  }, [mode, tone]);
}
