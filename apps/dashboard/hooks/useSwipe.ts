"use client";
import { useEffect, useRef, type RefObject } from "react";
import { SWIPE_DEFAULTS, swipeDirection } from "@/lib/swipe";

/**
 * 요소 위에서의 좌우 스와이프를 알린다(터치·펜만, 마우스 드래그는 무시). 판정은 lib/swipe.ts.
 * 요소에 touch-action: pan-y 를 걸어 두면 가로 움직임을 브라우저가 가로채지 않고 세로 스크롤만 그대로 둔다.
 * 스와이프가 끝나면 그 손짓이 만든 클릭 한 번은 삼킨다(날짜 칸이 같이 눌리지 않게).
 */
export function useSwipe(ref: RefObject<HTMLElement | null>, onSwipe: ((dir: "next" | "prev") => void) | undefined) {
  const cb = useRef(onSwipe);
  useEffect(() => {
    cb.current = onSwipe;
  }, [onSwipe]);
  const enabled = Boolean(onSwipe);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let start: { id: number; x: number; y: number; t: number } | undefined;
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      start = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
    };
    const up = (e: PointerEvent) => {
      if (!start || start.id !== e.pointerId) return;
      const dir = swipeDirection(e.clientX - start.x, e.clientY - start.y, e.timeStamp - start.t, SWIPE_DEFAULTS);
      start = undefined;
      if (!dir) return;
      const swallow = (ev: Event) => ev.stopPropagation();
      el.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 400);
      cb.current?.(dir);
    };
    const cancel = () => {
      start = undefined;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
    };
  }, [ref, enabled]);
}
