"use client";
import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/form/Button";
import { STEP_COUNT } from "@/lib/setup/draft";
import s from "./setup.module.css";

export interface StepFrameProps {
  step: number;
  title: string;
  lead?: ReactNode;
  children: ReactNode;
  /** 오류가 있는 필드 수 (요약 안내용) */
  errorCount: number;
  /** 값이 바뀔 때마다(>0) 첫 오류 필드로 포커스를 옮긴다 */
  focusTick: number;
  nextLabel?: string;
  /** 이전 단계로. 1단계에서는 없다 */
  onBack?: () => void;
  onNext: () => void;
  busy?: boolean;
  /** 마지막 단계의 기본 버튼 모양 */
  nextVariant?: "primary" | "secondary";
}

const FOCUSABLE = "input,select,textarea,button";

/** 단계 공통 틀: 진행 표시(n/6), 제목(단계가 바뀌면 포커스), 오류 요약, 이전/다음. Enter는 다음. */
export function StepFrame({ step, title, lead, children, errorCount, focusTick, nextLabel = "다음", onBack, onNext, busy, nextVariant = "primary" }: StepFrameProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const shownStep = useRef(step);

  // 단계가 바뀌면 제목으로 포커스(스크린리더가 새 단계를 읽고, 키보드 사용자가 위에서부터 시작). 마운트 때 보인 단계 그대로면 옮기지 않는다.
  // '지금 보이는 단계'를 ref로 들고 비교하므로 2단계에서 '이전'으로 1단계에 돌아와도 옮긴다.
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    heading.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step]);

  // 다음을 눌렀는데 오류가 있으면 첫 오류 필드로
  useEffect(() => {
    if (focusTick === 0) return;
    const bad = form.current?.querySelector<HTMLElement>('[aria-invalid="true"],[data-invalid="true"]');
    const target = bad?.matches(FOCUSABLE) ? bad : (bad?.querySelector<HTMLElement>(FOCUSABLE) ?? bad);
    target?.focus();
    // 하단 고정 버튼에 가리지 않게 화면 가운데로 (WCAG 2.4.11)
    target?.scrollIntoView({ block: "center" });
  }, [focusTick]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) onNext();
  };

  return (
    <div className={s.page} data-surface="phone">
      <header className={s.top}>
        <p className={s.brand}>HomeSweetHome · 가족 세팅</p>
        <div className={s.progressText}>
          <span>
            <span className="sr-only">단계 </span>
            {step}/{STEP_COUNT}
          </span>
        </div>
        <div className={s.bar} role="progressbar" aria-label="세팅 진행" aria-valuemin={1} aria-valuemax={STEP_COUNT} aria-valuenow={step} aria-valuetext={`${STEP_COUNT}단계 중 ${step}단계`}>
          <div className={s.barFill} style={{ width: `${(step / STEP_COUNT) * 100}%` }} />
        </div>
      </header>
      <main>
        <form ref={form} className={s.form} noValidate onSubmit={submit} aria-labelledby="step-title">
          <div>
            <h1 id="step-title" ref={heading} tabIndex={-1} className={s.title}>
              {title}
            </h1>
            {lead && <p className={s.lead}>{lead}</p>}
          </div>
          {errorCount > 0 && (
            <p role="alert" className={s.summary}>
              입력을 확인해 주세요. 고칠 곳이 {errorCount}군데 있어요.
            </p>
          )}
          <div className={s.body}>{children}</div>
          <div className={s.footer}>
            {onBack && (
              <Button variant="secondary" onClick={onBack} disabled={busy}>
                이전
              </Button>
            )}
            <Button type="submit" variant={nextVariant} disabled={busy} aria-busy={busy || undefined}>
              {busy ? "저장하는 중…" : nextLabel}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}
