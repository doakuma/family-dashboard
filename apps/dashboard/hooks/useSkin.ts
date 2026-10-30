"use client";
import { DEFAULT_SKIN, type SkinId } from "@hsh/core";
import { useEffect } from "react";

/**
 * <html data-skin>을 바꾼다. 스킨 CSS는 번들에 전부 들어 있어 새로고침·지연 로드 없이 바로 바뀐다.
 * (data-mode/data-tone과 다른 축이라 서로 영향을 주지 않는다.)
 */
export function useSkin(skin: SkinId) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.skin = skin;
    return () => {
      root.dataset.skin = DEFAULT_SKIN;
    };
  }, [skin]);
}
