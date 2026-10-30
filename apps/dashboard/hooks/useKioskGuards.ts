"use client";
import { useEffect } from "react";

/**
 * 키오스크로 쓰는 태블릿의 오작동 방지(JS 층). CSS(touch-action·overscroll-behavior·user-select)가 1차 방어이고,
 * CSS를 따르지 않는 브라우저를 위해 이벤트 쪽도 막는다:
 * - 길게 눌러 뜨는 메뉴(contextmenu), 글자 선택(selectstart), 끌기(dragstart)
 * - 두 손가락 핀치(touchmove 2점 이상)와 iOS Safari의 gesturestart
 * 한 손가락 스크롤(오늘 일정)과 탭은 막지 않는다.
 */
export function useKioskGuards() {
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    const pinch = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    document.addEventListener("contextmenu", stop);
    document.addEventListener("selectstart", stop);
    document.addEventListener("dragstart", stop);
    document.addEventListener("gesturestart", stop);
    document.addEventListener("gesturechange", stop);
    document.addEventListener("touchmove", pinch, { passive: false });
    return () => {
      document.removeEventListener("contextmenu", stop);
      document.removeEventListener("selectstart", stop);
      document.removeEventListener("dragstart", stop);
      document.removeEventListener("gesturestart", stop);
      document.removeEventListener("gesturechange", stop);
      document.removeEventListener("touchmove", pinch);
    };
  }, []);
}
