import type { SetupQrView } from "@/hooks/useSetupQr";
import s from "./SetupNeeded.module.css";

/** 첫 실행: 위키에 config.md나 구성원이 없을 때. 휴대폰으로 QR을 찍어 /setup으로 들어간다. */
export function SetupNeeded({ qr }: { qr: SetupQrView | undefined }) {
  return (
    <main className={s.setup}>
      <div className={s.copy}>
        <h1 className={s.title}>가족 세팅이 필요해요</h1>
        <p className={s.lead}>휴대폰 카메라로 QR코드를 찍으면 가족을 등록하는 화면이 열려요. 5분이면 끝나요.</p>
        <ol className={s.steps}>
          <li>집 와이파이에 연결된 휴대폰으로 찍어 주세요</li>
          <li>관리자 PIN을 입력하고 가족을 추가해요</li>
          <li>끝나면 이 화면이 대시보드로 바뀌어요</li>
        </ol>
        {qr?.ok && <p className={s.url}>{qr.label}</p>}
      </div>
      {qr?.ok ? (
        <div className={s.qr} role="img" aria-label={`${qr.label} QR코드`} dangerouslySetInnerHTML={{ __html: qr.svg }} />
      ) : (
        <p className={s.lead} role="status">
          {qr ? "QR 주소를 만들 수 없어요. 서버 .env의 DASHBOARD_BASE_URL을 확인해 주세요." : "QR을 준비하고 있어요…"}
        </p>
      )}
    </main>
  );
}
