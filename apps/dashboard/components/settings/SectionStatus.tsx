import s from "../setup/setup.module.css";
import type { SectionMessage } from "./useSettingsAction";

/**
 * 구역의 저장 결과. 성공은 늘 그려 둔 aria-live 영역에 글만 바뀌고(스크린리더가 읽음), 실패는 role=alert로 바로 알린다.
 * 성공 문구가 없을 때는 화면에서 보이지 않는다(sr-only).
 */
export function SectionStatus({ message }: { message?: SectionMessage }) {
  const ok = message?.kind === "ok";
  return (
    <>
      <p role="status" aria-live="polite" className={ok ? s.note : "sr-only"}>
        {ok ? message.text : ""}
      </p>
      {message?.kind === "error" && (
        <p role="alert" className={s.summary} data-invalid="true">
          {message.text}
        </p>
      )}
    </>
  );
}
