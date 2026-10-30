// /setup 진입 게이트(#17): 세팅 세션이 있거나, QR의 일회용 토큰이 유효해야 열린다. 세션이 있으면 6단계 마법사(#18).
import { forbidden } from "next/navigation";
import { PinForm } from "@/components/PinForm";
import { SetupWizard } from "@/components/setup/SetupWizard";
import { authState, lockRemainingMs, readSession, retryMinutes } from "@/lib/auth/server";
import { getSetupContext } from "@/lib/state";

export const dynamic = "force-dynamic";


const lockedMinutes = () => {
  const ms = lockRemainingMs();
  return ms === undefined ? undefined : retryMinutes(ms);
};

interface Props {
  searchParams: Promise<{ t?: string; e?: string }>;
}

export default async function SetupPage({ searchParams }: Props) {
  const { t, e } = await searchParams;
  const session = await readSession();

  if (session?.via === "setup") {
    const ctx = await getSetupContext();
    if (!ctx.needsSetup) {
      // MVP는 세팅 전(needsSetup)일 때만 마법사를 연다. 다시 세팅하는 화면은 /settings(#22)
      return (
        <main data-surface="phone" style={{ padding: "2rem 1.25rem", lineHeight: 1.6, maxWidth: "30rem", margin: "0 auto" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}>이미 세팅이 끝났어요</h1>
          <p>가족 설정을 바꾸는 화면은 설정(/settings)에서 열릴 예정이에요.</p>
        </main>
      );
    }
    const hasExisting = ctx.existing.config || ctx.existing.members > 0 || ctx.existing.anniversaries > 0;
    return <SetupWizard hasExisting={hasExisting} writable={ctx.writable} />;
  }
  if (!authState().tokens.isValid(t)) forbidden();
  // PIN 화면도 휴대폰에서 열리므로 휴대폰 표면(16px 기준)으로 그린다
  return (
    <div data-surface="phone">
      <PinForm title="가족 세팅" action="/api/auth/setup" token={t} error={e} lockedMinutes={lockedMinutes()} />
    </div>
  );
}
