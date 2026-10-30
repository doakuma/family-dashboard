"use client";
import { setupSchema } from "@hsh/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { clearDraft, initialDraft, loadDraft, saveDraft, STEP_COUNT, type Draft } from "@/lib/setup/draft";
import { parseCompleteResponse } from "@/lib/setup/response";
import { serverIssuesToErrors, toSetupInput } from "@/lib/setup/build";
import { firstErrorStep, stepOfField, validateStep, type Errors } from "@/lib/setup/validate";
import { StepFrame } from "./StepFrame";
import { AnniversaryStep } from "./steps/AnniversaryStep";
import { CalendarStep } from "./steps/CalendarStep";
import { HomeStep } from "./steps/HomeStep";
import { MembersStep } from "./steps/MembersStep";
import { ReviewStep } from "./steps/ReviewStep";
import { SlackStep } from "./steps/SlackStep";
import s from "./setup.module.css";

export interface SetupWizardProps {
  /** 세팅 전인데 이전 세팅 파일이 남아 있는지 (덮어쓰기 확인 단계를 보여 준다) */
  hasExisting: boolean;
  /** 서버가 위키에 쓸 수 있는 설정인지 */
  writable: boolean;
}

const TITLES: Record<number, { title: string; lead?: string }> = {
  1: { title: "우리 집", lead: "가족 이름과 사는 지역을 알려 주세요." },
  2: { title: "구성원 추가", lead: "함께 쓰는 가족을 한 명씩 넣어 주세요. 나중에 슬랙에서 더 추가할 수도 있어요." },
  3: { title: "슬랙 연결", lead: "슬랙으로 말하면 대시보드에 기록돼요." },
  4: { title: "기념일", lead: "생일은 자동으로 들어가요. 결혼기념일 같은 날을 더해 주세요." },
  5: { title: "구글 캘린더 (선택)", lead: "알림을 받고 싶을 때만 연결해요." },
  6: { title: "확인하고 시작하기", lead: "아래 내용으로 가족 위키를 만들어요." },
};

function sessionStore(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined; // 사생활 보호 모드 등: 새로고침 대비만 못 할 뿐 마법사는 그대로 동작한다
  }
}

type Phase = { kind: "edit" } | { kind: "saving" } | { kind: "done"; synced: boolean; syncError?: string };

/** 6단계 마법사 본체. 입력은 클라이언트 상태(+sessionStorage)로 들고 있다가 마지막에 한 번 서버로 보낸다. */
export function SetupWizard({ hasExisting, writable }: SetupWizardProps) {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [errors, setErrors] = useState<Errors>({});
  const [focusTick, setFocusTick] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: "edit" });
  const [message, setMessage] = useState<string | undefined>();
  const [needsOverwrite, setNeedsOverwrite] = useState(hasExisting);
  const [hydrated, setHydrated] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  // 새로고침 대비: 마운트 후 저장된 입력을 복원한다(서버 HTML과 첫 렌더를 같게 두려고 effect에서).
  useEffect(() => {
    const saved = loadDraft(sessionStore());
    if (saved) setDraft(saved);
    setHydrated(true);
  }, []);
  // 복원이 끝난 뒤부터 저장한다(복원 전에 초기값으로 덮어쓰지 않게)
  useEffect(() => {
    if (hydrated && phase.kind !== "done") saveDraft(sessionStore(), draft);
  }, [draft, hydrated, phase.kind]);
  useEffect(() => {
    if (phase.kind === "done") heading.current?.focus();
  }, [phase.kind]);

  const fail = useCallback((next: Errors) => {
    setErrors(next);
    setFocusTick((t) => t + 1);
  }, []);

  /** 입력을 바꾸면, 이미 표시된 오류만 다시 계산해서 고친 것은 바로 지운다(새 오류는 '다음'을 눌러야 나온다). */
  const change = useCallback(
    (next: Draft) => {
      setDraft(next);
      setMessage(undefined);
      setErrors((prev) => {
        const keys = Object.keys(prev);
        if (keys.length === 0) return prev;
        const now = validateStep(next, next.step);
        if (needsOverwrite && next.step === 6 && !next.overwrite) now.overwrite = "덮어쓰기에 체크해 주세요";
        return Object.fromEntries(keys.filter((k) => k in now).map((k) => [k, now[k] as string]));
      });
    },
    [needsOverwrite],
  );

  const go = (step: number) => {
    setErrors({});
    setMessage(undefined);
    setDraft((d) => ({ ...d, step }));
  };

  const submit = async () => {
    // 마지막 방어: 전체를 다시 검증하고, 서버와 같은 스키마로도 한 번 본다
    const all = validateStep(draft, 6);
    if (needsOverwrite && !draft.overwrite) all.overwrite = "덮어쓰기에 체크해 주세요";
    if (Object.keys(all).length > 0) {
      const step = firstErrorStep(all) ?? 6;
      if (step !== 6) {
        setDraft((d) => ({ ...d, step }));
      }
      fail(all);
      return;
    }
    const input = toSetupInput(draft);
    const parsed = setupSchema.safeParse(input);
    if (!parsed.success) {
      fail(serverIssuesToErrors(draft, parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))));
      return;
    }

    setPhase({ kind: "saving" });
    setMessage(undefined);
    let res: Response;
    try {
      res = await fetch("/api/setup/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ setup: input, overwrite: needsOverwrite && draft.overwrite }),
        credentials: "same-origin",
      });
    } catch {
      setPhase({ kind: "edit" });
      setMessage("서버에 연결하지 못했어요. 집 와이파이에 연결되어 있는지 확인하고 다시 눌러 주세요.");
      return;
    }
    let body: ReturnType<typeof parseCompleteResponse>;
    try {
      body = parseCompleteResponse(await res.json());
    } catch {
      body = undefined; // JSON이 아님
    }
    if (res.ok && body?.ok) {
      clearDraft(sessionStore());
      setPhase({ kind: "done", synced: body.synced, syncError: body.syncError });
      return;
    }
    setPhase({ kind: "edit" });
    const f = body && !body.ok ? body : undefined;
    if (res.status === 401) setMessage("세팅 시간이 지나 연결이 끊겼어요. 태블릿의 QR코드를 다시 찍어 새 탭에서 PIN을 입력한 뒤, 이 화면(원래 탭)으로 돌아와 시작하기를 다시 눌러 주세요. 입력한 내용은 이 화면에 남아 있어요.");
    else if (f?.code === "invalid" && f.issues) {
      const errs = serverIssuesToErrors(draft, f.issues);
      const step = firstErrorStep(errs) ?? 6;
      if (step !== 6) setDraft((d) => ({ ...d, step }));
      fail(errs);
    } else if (f?.code === "needs_confirm") {
      setNeedsOverwrite(true);
      setMessage(f.message);
    } else setMessage(f?.message ?? "저장하지 못했어요. 잠시 뒤에 다시 해 주세요.");
  };

  const next = () => {
    const errs = validateStep(draft, draft.step);
    if (Object.keys(errs).length > 0) return fail(errs);
    if (draft.step < STEP_COUNT) go(draft.step + 1);
  };

  if (phase.kind === "done") {
    return (
      <div className={s.page} data-surface="phone">
        <main className={s.done}>
          <h1 ref={heading} className={s.title} tabIndex={-1}>
            세팅 완료!
          </h1>
          <p>태블릿이 1분 안에 바뀝니다. 이 화면은 닫아도 돼요.</p>
          {phase.syncError && <p className={s.note}>위키는 이 노트북에 저장됐고, GitHub에 올리는 데 실패했어요. 다음 저장 때 다시 시도해요.</p>}
          <p className={s.itemSub}>슬랙 연결은 앱이 준비되면 안내해 드릴게요.</p>
        </main>
      </div>
    );
  }

  const step = draft.step;
  const meta = TITLES[step] ?? { title: "" };
  const props = { draft, errors, onChange: change };
  const saving = phase.kind === "saving";
  const calendarEmpty = draft.calendarId.trim() === "";

  return (
    <StepFrame
      step={step}
      title={meta.title}
      lead={meta.lead}
      errorCount={Object.keys(errors).filter((k) => stepOfField(k) === step).length}
      focusTick={focusTick}
      onBack={step > 1 ? () => go(step - 1) : undefined}
      onNext={step === STEP_COUNT ? () => void submit() : next}
      nextLabel={step === 3 ? "건너뛰기" : step === 5 && calendarEmpty ? "건너뛰기" : step === STEP_COUNT ? "시작하기" : "다음"}
      busy={saving}
    >
      {step === 1 && <HomeStep {...props} />}
      {step === 2 && <MembersStep {...props} />}
      {step === 3 && <SlackStep {...props} />}
      {step === 4 && <AnniversaryStep {...props} />}
      {step === 5 && <CalendarStep {...props} />}
      {step === 6 && <ReviewStep {...props} needsOverwrite={needsOverwrite} writable={writable} message={message} />}
    </StepFrame>
  );
}
