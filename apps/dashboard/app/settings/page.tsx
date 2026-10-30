// /settings: PIN 확인 후 같은 세션 쿠키. 설정 화면 본체는 아직 없다(자리).
import { PinForm } from "@/components/PinForm";
import { lockRemainingMs, readSession, retryMinutes } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const minutes = () => {
  const ms = lockRemainingMs();
  return ms === undefined ? undefined : retryMinutes(ms);
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  if (!(await readSession())) return <PinForm title="설정" action="/api/auth/login" error={e} lockedMinutes={minutes()} />;
  return (
    <main style={{ padding: "2rem", fontSize: "1.2rem", lineHeight: 1.6 }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}>설정</h1>
      <p>확인됐어요. 설정 화면은 준비 중이에요.</p>
      <form method="post" action="/api/auth/logout">
        <button type="submit">나가기</button>
      </form>
    </main>
  );
}
