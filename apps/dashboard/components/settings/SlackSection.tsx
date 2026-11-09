"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/form/Button";
import { colorOf } from "@/lib/palette";
import { fetchSettingsConnectStates, type SettingsViewData } from "@/lib/settings/client";
import { announcement, connectView, dmText } from "@/lib/setup/connect-view";
import { ConnectCodeSlot } from "../setup/ConnectCodeSlot";
import s from "../setup/setup.module.css";
import { useConnectStates } from "../setup/useConnectStates";
import { SectionStatus } from "./SectionStatus";
import x from "./settings.module.css";
import { useSettingsAction } from "./useSettingsAction";

interface Props {
  view: SettingsViewData;
  onView: (v: SettingsViewData) => void;
}

const fetchStates = (codes: readonly string[], signal: AbortSignal) => fetchSettingsConnectStates(codes, fetch, signal);

/**
 * 슬랙 연결 구역: 구성원별 연결됨/안 됨, 코드 받기 -> 본인이 슬랙에서 봇에게 `연결 123456` DM -> 화면이 폴링으로 확인 -> [연결 반영]으로 저장.
 * 슬랙 ID는 브라우저에 오지 않는다: 반영할 때 서버가 연결 기록에서 꺼내 위키에 쓴다.
 */
export function SlackSection({ view, onView }: Props) {
  const act = useSettingsAction(onView);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [confirmUnlink, setConfirmUnlink] = useState<string | undefined>();
  const { states, problem } = useConnectStates(
    view.members.map((m) => ({ connectCode: codes[m.id] })),
    fetchStates,
  );

  // 연결 상태가 바뀌면 스크린리더에 알린다(aria-live)
  const [live, setLive] = useState("");
  const prev = useRef(states);
  useEffect(() => {
    for (const m of view.members) {
      const code = codes[m.id];
      if (!code) continue;
      const msg = announcement(m.name, prev.current[code], states[code]);
      if (msg) setLive(msg);
    }
    prev.current = states;
  }, [states, codes, view.members]);

  const forget = (id: string) =>
    setCodes((c) => {
      const next = { ...c };
      delete next[id];
      return next;
    });

  const getCode = async (id: string, name: string) => {
    setConfirmUnlink(undefined);
    const r = await act.run({ kind: "slack.code", id }, () => `${name} 님의 연결 코드를 받았어요.`);
    if (r?.ok && r.body.code) {
      const code = r.body.code;
      setCodes((c) => ({ ...c, [id]: code }));
    }
  };

  const save = async (id: string, name: string) => {
    const code = codes[id];
    if (!code) return;
    const r = await act.run({ kind: "slack.save", id, code }, () => `${name} 님을 슬랙 계정에 연결했어요.`);
    if (r?.ok) forget(id);
  };

  const unlink = async (id: string, name: string) => {
    setConfirmUnlink(undefined);
    const r = await act.run({ kind: "slack.unlink", id }, () => `${name} 님의 슬랙 연결을 풀었어요.`);
    if (r?.ok) forget(id);
    requestAnimationFrame(() => document.getElementById(`settings-slack-btn-${id}`)?.focus());
  };

  return (
    <section className={s.card} aria-labelledby="settings-slack-title">
      <h2 id="settings-slack-title" className={s.sectionTitle}>
        슬랙 연결
      </h2>
      <p className={s.note}>구성원마다 6자리 연결 코드를 받아, 본인이 슬랙에서 봇에게 DM으로 보내면 연결돼요. 처음 연결하거나, 계정을 바꾸거나, 연결을 풀 수 있어요.</p>
      {problem && (
        <p className={s.summary} role="alert" data-invalid="true">
          {problem}
        </p>
      )}
      <ul className={s.list} aria-label="구성원별 슬랙 연결">
        {view.members.map((m) => {
          const code = codes[m.id];
          const v = connectView(code, code ? states[code] : undefined);
          const busy = act.busy;
          return (
            <li key={m.id} className={`${s.item} ${x.itemWrap}`}>
              <span className={s.dot} style={{ background: colorOf(m.color) }} aria-hidden="true" />
              <span className={s.itemMain}>
                <span>{m.name}</span>
                <span className={s.itemSub}>
                  {v.kind === "none" && (m.connected ? "✓ 연결됨" : "연결 안 됨")}
                  {v.kind === "pending" && (
                    <>
                      슬랙에서 봇에게 <strong>{dmText(v.code)}</strong> 라고 DM으로 보내세요. 30분 안에 보내야 해요.
                    </>
                  )}
                  {v.kind === "connected" && "✓ 슬랙 계정이 확인됐어요. 아래 '연결 반영'을 눌러야 저장돼요."}
                  {v.kind === "expired" && "코드 시간이 지났어요. 다시 받아 주세요."}
                </span>
              </span>
              {v.kind === "none" ? <ConnectCodeSlot /> : <ConnectCodeSlot code={v.code} expired={v.kind === "expired"} />}
              <div className={x.editor}>
                <div className={x.actions}>
                  {v.kind === "connected" ? (
                    <Button id={`settings-slack-btn-${m.id}`} aria-label={`${m.name} 슬랙 연결 반영`} aria-disabled={busy} onClick={() => !busy && void save(m.id, m.name)}>
                      {busy ? "저장하는 중…" : "연결 반영"}
                    </Button>
                  ) : (
                    <Button
                      id={`settings-slack-btn-${m.id}`}
                      variant={m.connected || v.kind !== "none" ? "quiet" : "secondary"}
                      aria-label={`${m.name} ${v.kind === "none" ? (m.connected ? "다른 계정으로 다시 연결하기" : "연결 코드 받기") : "연결 코드 다시 받기"}`}
                      aria-disabled={busy}
                      onClick={() => !busy && void getCode(m.id, m.name)}
                    >
                      {v.kind === "none" ? (m.connected ? "다른 계정으로 연결" : "코드 받기") : "다시 받기"}
                    </Button>
                  )}
                  {m.connected && v.kind === "none" && confirmUnlink !== m.id && (
                    <Button variant="quiet" aria-label={`${m.name} 슬랙 연결 풀기`} aria-disabled={busy} onClick={() => !busy && setConfirmUnlink(m.id)}>
                      연결 풀기
                    </Button>
                  )}
                </div>
                {confirmUnlink === m.id && (
                  <div role="group" aria-label={`${m.name} 연결 풀기 확인`} className={x.editor}>
                    <p className={s.itemSub}>풀면 {m.name} 님은 다시 연결하기 전까지 슬랙으로 말할 수 없어요.</p>
                    <div className={x.actions}>
                      <Button aria-label={`${m.name} 슬랙 연결 풀기 확정`} aria-disabled={busy} onClick={() => !busy && void unlink(m.id, m.name)}>
                        풀기
                      </Button>
                      <Button variant="secondary" onClick={() => setConfirmUnlink(undefined)}>
                        그대로 두기
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <SectionStatus message={act.message} />
      <p className="sr-only" role="status" aria-live="polite">
        {live}
      </p>
    </section>
  );
}
