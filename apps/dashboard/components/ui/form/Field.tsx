import { useId, type ReactNode } from "react";
import s from "./form.module.css";

/** 입력 요소에 붙일 접근성 속성 */
export interface ControlProps {
  id: string;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
}

/**
 * 라벨 + 도움말 + 오류를 한 묶음으로. 입력 요소는 render prop으로 받은 속성을 그대로 붙인다.
 * 오류는 aria-describedby로 입력에 연결하고 aria-invalid를 켠다(안내는 오류 요약과 포커스 이동으로).
 */
export function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: {
  /** 필드 DOM id (포커스 이동에 쓰인다. validate.fieldId) */
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  children: (props: ControlProps) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={s.field}>
      <label htmlFor={id} className={s.label}>
        {label}
        {optional && <span className={s.optional}>(선택)</span>}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && (
        <p id={hintId} className={s.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={s.error}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * 여러 입력(월·일 등)이 하나의 값을 이룰 때: 오류 하나를 묶음 아래에 보이고 모든 입력에 같은 aria 속성을 준다.
 * 첫 입력의 id는 호출자가 정한다(오류 포커스 대상).
 */
export function FieldGroup({
  id,
  error,
  className,
  children,
}: {
  /** 오류 문구 id의 바탕 (`${id}-error`) */
  id: string;
  error?: string;
  className?: string;
  children: (aria: Pick<ControlProps, "aria-invalid" | "aria-describedby">) => ReactNode;
}) {
  const errorId = error ? `${id}-error` : undefined;
  return (
    <>
      <div className={className}>{children({ "aria-invalid": error ? true : undefined, "aria-describedby": errorId })}</div>
      {error && (
        <p id={errorId} className={s.error}>
          {error}
        </p>
      )}
    </>
  );
}

export interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  type?: "text" | "date" | "email";
  inputMode?: "text" | "numeric" | "email" | "none";
  autoComplete?: string;
  autoCapitalize?: "none" | "characters";
  maxLength?: number;
  placeholder?: string;
  max?: string;
  min?: string;
  enterKeyHint?: "next" | "done" | "go";
}

export function TextField({ id, label, value, onChange, hint, error, optional, type = "text", inputMode, autoComplete = "off", autoCapitalize, maxLength, placeholder, max, min, enterKeyHint }: TextFieldProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error} optional={optional}>
      {(aria) => (
        <input
          {...aria}
          className={s.input}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode={inputMode}
          autoComplete={autoComplete}
          autoCapitalize={autoCapitalize ?? "none"}
          autoCorrect="off"
          spellCheck={false}
          maxLength={maxLength}
          placeholder={placeholder}
          max={max}
          min={min}
          enterKeyHint={enterKeyHint}
        />
      )}
    </Field>
  );
}

export function SelectField({
  id,
  label,
  value,
  onChange,
  children,
  hint,
  error,
  optional,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error} optional={optional}>
      {(aria) => (
        <select {...aria} className={s.select} value={value} onChange={(e) => onChange(e.target.value)}>
          {children}
        </select>
      )}
    </Field>
  );
}

/** 같은 이름의 라디오를 큰 버튼처럼. 첫 선택지에 id를 붙여 오류 포커스가 이 묶음으로 오게 한다. */
export function ChoiceGroup<T extends string>({
  id,
  legend,
  value,
  options,
  onChange,
  error,
  hint,
}: {
  id: string;
  legend: string;
  value: T | "";
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  error?: string;
  hint?: ReactNode;
}) {
  const uid = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={s.field}>
      <span id={`${id}-legend`} className={s.label}>
        {legend}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-legend`}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        aria-invalid={error ? true : undefined}
        className={`${s.group}`}
      >
        {options.map((o, i) => (
          <label key={o.value} className={s.choice}>
            <input id={i === 0 ? id : undefined} type="radio" name={uid} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {hint && (
        <p id={hintId} className={s.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={s.error}>
          {error}
        </p>
      )}
    </div>
  );
}

/** 색 견본 고르기. options의 css는 palette(토큰)에서 온 색이다. */
export function SwatchGroup({
  id,
  legend,
  value,
  options,
  onChange,
  error,
  hint,
}: {
  id: string;
  legend: string;
  value: string;
  options: { value: string; label: string; css: string }[];
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
}) {
  const uid = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={s.field}>
      <span id={`${id}-legend`} className={s.label}>
        {legend}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-legend`}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        aria-invalid={error ? true : undefined}
        className={s.group}
      >
        {options.map((o, i) => (
          <label key={o.value} className={s.swatch}>
            <input id={i === 0 ? id : undefined} type="radio" name={uid} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>
              <i style={{ background: o.css }} aria-hidden="true" />
              {o.label}
            </span>
          </label>
        ))}
      </div>
      {hint && (
        <p id={hintId} className={s.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={s.error}>
          {error}
        </p>
      )}
    </div>
  );
}
