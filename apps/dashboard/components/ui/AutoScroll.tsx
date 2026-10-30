"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { AUTO_SCROLL_DEFAULTS, initialCycle, maxScroll, overflows, shouldAutoScroll, stepCycle, type AutoScrollConfig } from "@/lib/auto-scroll";
import s from "./AutoScroll.module.css";

/**
 * 넘칠 때만 천천히 위 -> 아래 -> 처음으로 순환하는 세로 스크롤 영역. 재사용 위젯용.
 * - 스크롤바·버튼은 없다(누를 수 있어 보이지 않게). 터치하면 순환을 멈추고 손으로 스크롤할 수 있으며,
 *   손을 뗀 뒤 resumeAfterTouchMs(기본 120초)가 지나면 현재 위치에서 다시 순환한다.
 * - prefers-reduced-motion이면 자동 순환하지 않는다(손 스크롤만).
 * - 이 영역만 touch-action: pan-y — 화면의 나머지는 제스처를 막아 둔다.
 * 높이는 부모가 정한다(flex 자식이면 min-height:0 과 함께 쓴다).
 */
export function AutoScroll({ children, className, config }: { children: ReactNode; className?: string; config?: Partial<AutoScrollConfig> }) {
  const box = useRef<HTMLDivElement>(null);
  const cfgRef = useRef<AutoScrollConfig>({ ...AUTO_SCROLL_DEFAULTS, ...config });
  cfgRef.current = { ...AUTO_SCROLL_DEFAULTS, ...config };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let touching = false;
    let lastTouchAt: number | undefined;
    let cycle = initialCycle(el.scrollTop);
    let wasRunning = false;
    let last = performance.now();
    let raf = 0;

    const touch = (down: boolean) => () => {
      touching = down;
      lastTouchAt = performance.now();
    };
    const onDown = touch(true);
    const onUp = touch(false);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("touchstart", onDown, { passive: true });
    el.addEventListener("touchend", onUp, { passive: true });
    el.addEventListener("touchcancel", onUp, { passive: true });
    el.addEventListener("wheel", onUp, { passive: true });

    const tick = (t: number) => {
      const dt = Math.min(t - last, 250); // 탭이 멈췄다 돌아올 때 한꺼번에 튀지 않게
      last = t;
      const run = shouldAutoScroll({
        overflows: overflows(el),
        reducedMotion: reduce.matches,
        touching,
        lastTouchAt,
        now: t,
        resumeAfterTouchMs: cfgRef.current.resumeAfterTouchMs,
      });
      if (run) {
        if (!wasRunning) cycle = initialCycle(el.scrollTop); // 손으로 옮긴 위치에서 이어서
        cycle = stepCycle(cycle, dt, maxScroll(el), cfgRef.current);
        el.scrollTop = cycle.pos;
      }
      wasRunning = run;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("touchstart", onDown);
      el.removeEventListener("touchend", onUp);
      el.removeEventListener("touchcancel", onUp);
      el.removeEventListener("wheel", onUp);
    };
  }, []);

  return (
    <div ref={box} className={`${s.scroll} ${className ?? ""}`} data-auto-scroll>
      {children}
    </div>
  );
}
