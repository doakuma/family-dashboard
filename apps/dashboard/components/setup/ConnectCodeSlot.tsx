import s from "./setup.module.css";

/**
 * 구성원의 슬랙 연결 코드(6자리)를 보여 주는 자리.
 * code가 없으면 "아직 없음" 자리 표시, expired면 코드를 지우고 "만료" 자리 표시를 그린다.
 * aria-label은 role이 있는 요소에서만 읽히므로 모두 role="img"를 단다.
 */
export function ConnectCodeSlot({ code, expired }: { code?: string; expired?: boolean }) {
  if (!code || expired) {
    return (
      <span className={s.code} role="img" aria-label={expired ? "만료된 연결 코드예요. 다시 받아 주세요" : "연결 코드는 아직 발급되지 않았어요"}>
        ······
      </span>
    );
  }
  return (
    <span className={s.code} role="img" aria-label={`연결 코드 ${code.split("").join(" ")}`}>
      {code}
    </span>
  );
}
