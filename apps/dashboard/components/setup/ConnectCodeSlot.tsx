import s from "./setup.module.css";

/**
 * 구성원의 슬랙 연결 코드(6자리)를 보여 주는 자리. 코드 발급·검증은 #19가 한다.
 * code가 없으면 "아직 없음" 자리 표시만 그린다.
 */
export function ConnectCodeSlot({ code }: { code?: string }) {
  if (!code) {
    return (
      <span className={s.code} role="img" aria-label="연결 코드는 아직 발급되지 않았어요">
        ······
      </span>
    );
  }
  return (
    <span className={s.code} aria-label={`연결 코드 ${code.split("").join(" ")}`}>
      {code}
    </span>
  );
}
