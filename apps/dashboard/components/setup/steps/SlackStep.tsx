"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/form/Button";
import { colorOf } from "@/lib/palette";
import { requestConnectCode } from "@/lib/setup/connect-client";
import { announcement, connectView, dmText } from "@/lib/setup/connect-view";
import { updateMember } from "@/lib/setup/draft";
import { memberLabel } from "@/lib/setup/validate";
import { ConnectCodeSlot } from "../ConnectCodeSlot";
import s from "../setup.module.css";
import { useConnectStates } from "../useConnectStates";
import type { StepProps } from "./types";

/**
 * 3단계: 슬랙 연결. 구성원마다 [코드 받기] -> 6자리 코드 -> 본인이 슬랙에서 봇에게 `연결 123456`을 DM -> '연결됨'.
 * 아무것도 안 해도 다음으로 갈 수 있다(아이는 건너뛰는 게 기본). 코드는 draft(sessionStorage)에 있어 새로고침해도 남는다.
 * 상태 확인은 이 단계가 보이는 동안만 몇 초 간격으로 한다(useConnectStates). 슬랙 ID는 브라우저에 오지 않는다.
 */
export function SlackStep({ draft, onChange }: StepProps) {
  const { states, problem } = useConnectStates(draft.members);
  const [busyKey, setBusyKey] = useState<string | undefined>();
  const [failure, setFailure] = useState<Record<string, string>>({});
  // 최신 draft로 갱신하려고 ref에 둔다(요청이 끝난 뒤 그 사이 바뀐 입력을 덮어쓰지 않게)
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // 상태가 바뀌면 스크린리더에 알린다(aria-live)
  const [live, setLive] = useState("");
  const prev = useRef(states);
  useEffect(() => {
    for (const m of draft.members) {
      if (!m.connectCode) continue;
      const msg = announcement(m.name.trim() || "구성원", prev.current[m.connectCode], states[m.connectCode]);
      if (msg) setLive(msg);
    }
    prev.current = states;
  }, [states, draft.members]);

  const getCode = async (key: string) => {
    const m = draftRef.current.members.find((x) => x.key === key);
    if (!m || busyKey) return;
    setBusyKey(key);
    setFailure((f) => {
      const next = { ...f };
      delete next[key];
      return next;
    });
    const r = await requestConnectCode({ key: m.key, name: m.name, role: m.role });
    setBusyKey(undefined);
    if (r.ok) onChange(updateMember(draftRef.current, key, { connectCode: r.code }));
    else setFailure((f) => ({ ...f, [key]: r.message }));
  };

  return (
    <>
      <p className={s.note}>
        구성원마다 6자리 연결 코드를 받아, 본인이 슬랙에서 봇에게 DM으로 보내면 연결돼요. 아이는 건너뛰어도 괜찮고, 지금 안 해도 돼요.
      </p>
      {problem && (
        <p className={s.summary} role="alert" data-invalid="true">
          {problem}
        </p>
      )}
      <ul className={s.list} aria-label="구성원별 슬랙 연결">
        {draft.members.map((m, i) => {
          const label = memberLabel(m, i);
          const view = connectView(m.connectCode, m.connectCode ? states[m.connectCode] : undefined);
          const canGet = m.name.trim() !== "";
          return (
            <li key={m.key} className={s.item}>
              <span className={s.dot} style={{ background: colorOf(m.color) }} aria-hidden="true" />
              <span className={s.itemMain}>
                <span>{label}</span>
                <span className={s.itemSub}>{m.role === "guardian" ? "보호자" : "아이 · 건너뛰어도 괜찮아요"}</span>
                {view.kind === "pending" && (
                  <span className={s.itemSub}>
                    슬랙에서 봇에게 <strong>{dmText(view.code)}</strong> 라고 DM으로 보내세요. 30분 안에 보내야 해요.
                  </span>
                )}
                {view.kind === "connected" && <span className={s.itemSub}>✓ 연결됨 · 슬랙 계정이 이 구성원으로 연결됐어요</span>}
                {view.kind === "expired" && <span className={s.itemSub}>코드 시간이 지났어요. 다시 받아 주세요.</span>}
                {failure[m.key] && (
                  <span className={s.itemSub} role="alert">
                    {failure[m.key]}
                  </span>
                )}
                {view.kind === "none" && !canGet && <span className={s.itemSub}>2단계에서 이름을 먼저 넣어 주세요</span>}
                {view.kind === "none" && (
                  <Button variant={m.role === "child" ? "quiet" : "secondary"} aria-label={`${label} 연결 코드 받기`} disabled={!canGet || busyKey !== undefined} onClick={() => void getCode(m.key)}>
                    {busyKey === m.key ? "받는 중…" : "코드 받기"}
                  </Button>
                )}
                {(view.kind === "pending" || view.kind === "expired") && (
                  <Button variant="quiet" aria-label={`${label} 연결 코드 다시 받기`} disabled={busyKey !== undefined} onClick={() => void getCode(m.key)}>
                    {busyKey === m.key ? "받는 중…" : "다시 받기"}
                  </Button>
                )}
              </span>
              {view.kind === "none" || view.kind === "expired" ? <ConnectCodeSlot /> : <ConnectCodeSlot code={view.code} />}
            </li>
          );
        })}
      </ul>
      {/* 상태가 바뀔 때만 읽어 주는 안내 */}
      <p className="sr-only" role="status" aria-live="polite">
        {live}
      </p>
    </>
  );
}
