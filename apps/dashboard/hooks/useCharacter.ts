"use client";
import { DEFAULT_CHARACTER, type CharacterId } from "@hsh/core";
import { useEffect } from "react";

/** <html data-character>를 바꾼다. data-skin과 별도의 독립 축이다(서로 영향 없음). */
export function useCharacter(character: CharacterId) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.character = character;
    return () => {
      root.dataset.character = DEFAULT_CHARACTER;
    };
  }, [character]);
}
