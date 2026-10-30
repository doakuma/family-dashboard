// /setup 진입 게이트: 세팅 세션이 있거나, QR의 일회용 토큰이 유효해야 열린다.
// 6단계 마법사 본체는 #18.
import { forbidden } from "next/navigation";
import { PinForm } from "@/components/PinForm";
import { authState, readSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";


interface Props {
  searchParams: Promise<{ t?: string; e?: string }>;
}

export default async function SetupPage({ searchParams }: Props) {
  const { t, e } = await searchParams;
  const session = await readSession();

  if (session?.via === "setup") {
    return (
      <main style={{ padding: "2rem", fontSize: "1.2rem", lineHeight: 1.6 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}>가족 세팅</h1>
        <p>확인됐어요. 세팅 화면은 준비 중이에요(#18). 다음 버전에서 여기서 가족을 등록해요.</p>
      </main>
    );
  }
  if (!authState().tokens.isValid(t)) forbidden();
  return <PinForm title="가족 세팅" action="/api/auth/setup" token={t} error={e} />;
}
