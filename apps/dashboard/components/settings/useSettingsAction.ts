"use client";
// 설정 구역 하나의 저장 동작: 한 번에 하나만 보내고(busy), 결과를 안내 문구(aria-live)로 남기고, 서버가 준 새 상태를 화면에 반영한다.
import { useRef, useState } from "react";
import { postSettings, type SettingsOk, type SettingsReply, type SettingsRequest, type SettingsViewData } from "@/lib/settings/client";

export interface SectionMessage {
  kind: "ok" | "error";
  text: string;
}

export function useSettingsAction(onView: (v: SettingsViewData) => void) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<SectionMessage | undefined>();
  const inFlight = useRef(false);

  /** okText: 성공 문구. 동기화가 실패했으면 문구 뒤에 알린다. 이미 처리 중이면 보내지 않고 undefined */
  const run = async (req: SettingsRequest, okText: (r: SettingsOk) => string): Promise<SettingsReply | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      const r = await postSettings(req);
      if (r.ok) {
        if (r.body.view) onView(r.body.view);
        const sync = r.body.synced === false ? " (이 노트북에는 저장됐고 GitHub에 올리는 건 실패했어요. 다음 저장 때 다시 시도해요.)" : "";
        const stale = r.body.saved && !r.body.view ? " 화면을 새로고침하면 최신 상태가 보여요." : "";
        setMessage({ kind: "ok", text: `${okText(r.body)}${sync}${stale}` });
      } else setMessage({ kind: "error", text: r.message });
      return r;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return { busy, message, run, clear: () => setMessage(undefined) };
}
