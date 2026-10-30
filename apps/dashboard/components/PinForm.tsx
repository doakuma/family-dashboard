import s from "./PinForm.module.css";

const MESSAGES: Record<string, string> = {
  wrong: "PIN이 맞지 않아요. 다시 입력해 주세요.",
  unconfigured: "관리자 PIN이 아직 설정되지 않았어요. 서버에서 pnpm pin:hash로 만든 값을 .env의 ADMIN_PIN_HASH에 넣어 주세요.",
};

/** 관리자 PIN 입력(휴대폰용). 서버로 보내는 일반 폼이라 스크립트 없이 동작한다. */
export function PinForm({
  title,
  action,
  token,
  error,
  lockedMinutes,
}: {
  title: string;
  action: string;
  token?: string;
  error?: string;
  /** 잠겨 있을 때 남은 분(올림). 서버가 지금 잠금 상태에서 계산해 넘긴다 */
  lockedMinutes?: number;
}) {
  const locked = error === "locked" && lockedMinutes !== undefined ? `시도가 너무 많아 잠시 잠겼어요. 약 ${lockedMinutes}분 뒤에 다시 해 주세요.` : "시도가 너무 많아 잠시 잠겼어요. 잠시 뒤에 다시 해 주세요.";
  const message = error === "locked" ? locked : error ? MESSAGES[error] : undefined;
  return (
    <main className={s.page}>
      <h1 className={s.title}>{title}</h1>
      <form method="post" action={action} className={s.form}>
        {token && <input type="hidden" name="t" value={token} />}
        <label className={s.label} htmlFor="pin">
          관리자 PIN
        </label>
        <input id="pin" name="pin" type="password" inputMode="numeric" autoComplete="off" pattern="\d{4,6}" minLength={4} maxLength={6} required className={s.input} />
        {message && (
          <p role="alert" className={s.error}>
            {message}
          </p>
        )}
        <button type="submit" className={s.button}>
          확인
        </button>
      </form>
    </main>
  );
}

