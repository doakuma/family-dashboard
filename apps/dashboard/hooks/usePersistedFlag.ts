"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * localStorage에 저장되는 불리언. 저장소가 막혀 있으면(프라이빗 모드 등) 메모리에만 둔다.
 * 첫 렌더는 기본값(서버 HTML과 같게)이고 마운트 뒤에 저장된 값을 읽는다.
 */
export function usePersistedFlag(key: string, initial = false): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(raw === "1");
    } catch {
      /* 저장소를 못 읽으면 기본값 */
    }
  }, [key]);
  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        /* 저장 실패: 메모리 값만 유지 */
      }
    },
    [key],
  );
  return [value, set];
}
