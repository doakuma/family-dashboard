"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { AUTO_SCROLL_DEFAULTS, initialCycle, maxScroll, overflows, shouldAutoScroll, stepCycle, type AutoScrollConfig } from "@/lib/auto-scroll";
import s from "./AutoScroll.module.css";

/**
 * 넘칠 때만 천천히 위 -> 아래 -> 처음으로 순환하는 세로 스크롤 영역. 재사용 위젯용.
 * - 스크롤바·버튼은 없다(누를 수 있어 보이지 않게). 터치하면 순환을 멈추고 손으로 스크롤할 수 있으며,
 *   손을 뗀 뒤 resumeAfterTouchMs(기본 120초)가 지나면 현재 위치에서 다시 순환한다.
 * - prefers-reduced-motion이면 자동 순환하지 않는다(손 스크롤만).
 * - 이 영역은 touch-action: pan-y(세로 스크롤만 허용). 화면 전체의 제스처 차단(핀치 줌 등)은 아직 없고 #31에서 한다.
 * 높이는 부모가 정한다(flex 자식이면 min-height:0 과 함께 쓴다).
 */
export function AutoScroll({
  children,
  className,
  config,
  paused = false,
  onOverflowChange,
}: {
  children: ReactNode;
  className?: string;
  config?: Partial<AutoScrollConfig>;
  /** true면 자동 순환을 멈춘다(제어형). 손 스크롤은 그대로 된다 */
  paused?: boolean;
  /** 넘침 여부가 바뀔 때 알린다(멈춤 버튼을 넘칠 때만 보이게 하는 용도) */
  onOverflowChange?: (overflowing: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const cfgRef = useRef<AutoScrollConfig>({ ...AUTO_SCROLL_DEFAULTS, ...config });
  // 렌더 중에는 ref를 쓰지 않는다: 설정은 효과에서 갱신
  useEffect(() => {
    cfgRef.current = { ...AUTO_SCROLL_DEFAULTS, ...config };
  }, [config]);

  const pausedRef = useRef(paused);
  const overflowCb = useRef(onOverflowChange);
  const wakeRef = useRef<() => void>(() => {});
  useEffect(() => {
    pausedRef.current = paused;
    overflowCb.current = onOverflowChange;
    if (!paused) wakeRef.current(); // 다시 켜면 루프를 깨운다
  }, [paused, onOverflowChange]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let reported: boolean | undefined;
    const report = () => {
      const o = overflows(el);
      if (o !== reported) {
        reported = o;
        overflowCb.current?.(o);
      }
    };
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

    // 넘칠 때만 rAF를 돌린다: 크기·내용이 바뀔 때(ResizeObserver) 켜고 끈다.
    const tick = (t: number) => {
      raf = 0;
      if (!overflows(el) || reduce.matches || pausedRef.current) {
        wasRunning = false;
        return; // 넘치지 않으면 루프 종료(관찰자가 다시 깨운다)
      }
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
    const wake = () => {
      report();
      if (raf || pausedRef.current || !overflows(el) || reduce.matches) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const ro = new ResizeObserver(wake);
    const watch = () => {
      ro.disconnect();
      ro.observe(el);
      for (const c of Array.from(el.children)) ro.observe(c);
    };
    wakeRef.current = wake;
    watch();
    const mo = new MutationObserver(() => {
      watch();
      wake();
    });
    mo.observe(el, { childList: true });
    reduce.addEventListener("change", wake);
    wake();

    return () => {
      cancelAnimationFrame(raf);
      wakeRef.current = () => {};
      ro.disconnect();
      mo.disconnect();
      reduce.removeEventListener("change", wake);
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
