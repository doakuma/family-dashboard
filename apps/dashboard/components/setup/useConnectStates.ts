"use client";
// 3단계가 보이는 동안만 연결 상태를 몇 초 간격으로 묻는 훅. 이 훅을 쓰는 컴포넌트가 사라지면(다른 단계로 가면) 멈춘다.
// 탭이 가려져 있으면 묻지 않고, 다시 보이면 바로 한 번 묻는다. 연결됨·만료인 코드는 더 묻지 않는다.
import { useEffect, useRef, useState } from "react";
import { fetchConnectStates, type ConnectState, type StatusResult } from "@/lib/setup/connect-client";
import { pollableCodes } from "@/lib/setup/connect-view";

export const POLL_MS = 3000;
/** 코드를 받은 직후·탭이 다시 보일 때 첫 확인까지 */
const FIRST_MS = 400;

export interface ConnectStates {
  states: Record<string, ConnectState>;
  /** 조회가 계속 안 될 때의 안내(세션 끝남 등). 일시적인 네트워크 오류는 다음 주기에 다시 시도하고 문구는 띄우지 않는다 */
  problem?: string;
}

/** 상태를 묻는 함수. 기본은 마법사용(/api/setup/connect/status), /settings는 자기 API를 넣는다 */
export type StatesFetcher = (codes: readonly string[], signal: AbortSignal) => Promise<StatusResult>;
const wizardFetcher: StatesFetcher = (codes, signal) => fetchConnectStates(codes, fetch, signal);

export function useConnectStates(members: readonly { connectCode?: string }[], fetchStates: StatesFetcher = wizardFetcher): ConnectStates {
  const [states, setStates] = useState<Record<string, ConnectState>>({});
  const [problem, setProblem] = useState<string | undefined>();
  const statesRef = useRef(states);
  statesRef.current = states;
  const membersRef = useRef(members);
  membersRef.current = members;
  const fetchStatesRef = useRef(fetchStates);
  fetchStatesRef.current = fetchStates;

  // 묻는 대상(코드 목록)이 바뀌면 타이머를 새로 건다
  const codes = pollableCodes(members, states).join(",");
  const hasCodes = codes !== "";

  useEffect(() => {
    if (!hasCodes) return;
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let inFlight = false; // visibilitychange 등으로 poll이 겹쳐 돌아 타이머 줄이 둘이 되는 것을 막는다

    const poll = async () => {
      const want = pollableCodes(membersRef.current, statesRef.current);
      if (stopped || inFlight || want.length === 0) return;
      if (typeof document !== "undefined" && document.hidden) return; // 보일 때 visibilitychange로 다시 시작한다
      inFlight = true;
      const r = await fetchStatesRef.current(want, ctl.signal).finally(() => {
        inFlight = false;
      });
      if (stopped) return;
      if (r.ok) {
        setProblem(undefined);
        setStates((prev) => ({ ...prev, ...r.states }));
        // 상태가 바뀌어 codes가 달라지면 effect가 다시 돌며 타이머를 새로 건다. 아니면 여기서 이어간다
      } else if (r.status === 401 || r.status === 409) {
        setProblem(r.message);
        return; // 다시 물어도 소용없다
      }
      timer = setTimeout(() => void poll(), POLL_MS);
    };
    const onVisible = () => {
      if (!document.hidden && !stopped && !inFlight) {
        clearTimeout(timer);
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    timer = setTimeout(() => void poll(), FIRST_MS); // 코드를 받은 직후에는 곧바로 한 번 확인
    return () => {
      stopped = true;
      clearTimeout(timer);
      ctl.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [codes, hasCodes]);

  return { states, problem };
}
