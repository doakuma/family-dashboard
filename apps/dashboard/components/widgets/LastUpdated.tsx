import { timeIn } from "@hsh/core";
import { isStale } from "@/lib/view";
import s from "./LastUpdated.module.css";

/** 우측 하단 "마지막 갱신 HH:MM". 연결이 끊기거나 3분 넘게 갱신이 없으면 경고색. */
export function LastUpdated({ at, offline, now }: { at: string; offline: boolean; now: Date }) {
  const stale = isStale({ offline, now, updatedAt: at });
  return (
    <p className={s.updated} data-stale={stale || undefined} role="status">
      마지막 갱신 {timeIn(new Date(at))}
      {stale && <span className={s.warn}> · 서버 연결 끊김</span>}
    </p>
  );
}
