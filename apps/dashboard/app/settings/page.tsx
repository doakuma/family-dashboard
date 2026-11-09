// /settings: PIN 확인 후 같은 세션 쿠키(via=pin). 구성원 추가·색 변경·슬랙 재연결·지역 변경. 휴대폰·PC 전용(태블릿 화면에는 쓰기 UI가 없다).
import { PinForm } from "@/components/PinForm";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { lockRemainingMs, readSession, retryMinutes } from "@/lib/auth/server";
import { toSettingsView } from "@/lib/settings/view";
import { getSettingsState } from "@/lib/state";

export const dynamic = "force-dynamic";

const minutes = () => {
  const ms = lockRemainingMs();
  return ms === undefined ? undefined : retryMinutes(ms);
};

const phone = { padding: "2rem 1.25rem", lineHeight: 1.6, maxWidth: "30rem", margin: "0 auto" } as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  // PIN을 거친 세션(via=pin, 마법사를 거친 via=setup도 기존대로 열린다 - 0002)만. 세션이 없으면 PIN 화면
  if (!(await readSession())) {
    return (
      <div data-surface="phone">
        <PinForm title="설정" action="/api/auth/login" error={e} lockedMinutes={minutes()} />
      </div>
    );
  }
  let loaded;
  try {
    loaded = await getSettingsState();
  } catch (err) {
    console.error(`[settings] 위키를 읽지 못했어요: ${err instanceof Error ? err.message : String(err)}`);
    return (
      <main data-surface="phone" style={phone}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}>설정</h1>
        <p role="alert">위키를 읽지 못했어요. 서버의 WIKI_REPO_PATH를 확인해 주세요.</p>
      </main>
    );
  }
  if (loaded.state.members.length === 0 || !loaded.state.config) {
    return (
      <main data-surface="phone" style={phone}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}>설정</h1>
        <p>아직 첫 세팅이 끝나지 않았어요. 태블릿의 QR코드로 먼저 세팅해 주세요.</p>
      </main>
    );
  }
  return <SettingsScreen initial={toSettingsView(loaded.state)} writable={loaded.writable} />;
}
