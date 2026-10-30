"use client";
import { useEffect, useRef, type ReactNode } from "react";
import s from "./Sheet.module.css";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 오른쪽에서 나오는 시트(모달 대화상자). 재사용 컴포넌트라 내용은 모른다.
 * - role=dialog + aria-modal, aria-labelledby로 제목 연결
 * - 열리면 `[data-initial-focus]`(없으면 시트 자신)로 포커스를 옮기고, 닫히면 열기 전 요소(또는 getReturnFocus)로 돌려준다
 * - Tab은 시트 안에서만 돈다. Esc·바깥(어두운 영역) 탭으로 닫는다
 * 열려 있을 때만 렌더하세요(닫힘 = 언마운트). 뒤 화면을 막는 inert는 호출하는 쪽이 건다.
 */
export function Sheet({
  onClose,
  labelledBy,
  getReturnFocus,
  children,
}: {
  onClose: () => void;
  /** 제목 요소의 id */
  labelledBy: string;
  /** 닫을 때 포커스를 돌려줄 요소. 없으면 열기 직전에 포커스가 있던 요소 */
  getReturnFocus?: () => HTMLElement | null;
  children: ReactNode;
}) {
  const box = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const returnRef = useRef(getReturnFocus);
  useEffect(() => {
    closeRef.current = onClose;
    returnRef.current = getReturnFocus;
  }, [onClose, getReturnFocus]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (el.querySelector<HTMLElement>("[data-initial-focus]") ?? el).focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!el.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const target = returnRef.current?.() ?? before;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, []);

  return (
    <>
      <div className={s.scrim} onClick={() => onClose()} aria-hidden="true" data-testid="sheet-scrim" />
      <aside ref={box} className={s.sheet} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}>
        {children}
      </aside>
    </>
  );
}
