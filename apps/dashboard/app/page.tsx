import { needsSetup } from "@hsh/core";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { Dashboard } from "@/components/Dashboard";
import { SetupNeeded } from "@/components/SetupNeeded";
import { getDashboardState } from "@/lib/state";

export const dynamic = "force-dynamic";

interface Props {
  // 시안·점검용: ?at=2026-10-29T10:30:00%2B09:00  ?mode=night
  searchParams: Promise<{ at?: string; mode?: string }>;
}

export default async function Page({ searchParams }: Props) {
  const [params, h] = await Promise.all([searchParams, headers()]);
  const at = params.at && !Number.isNaN(Date.parse(params.at)) ? params.at : undefined;
  const state = await getDashboardState(at ? new Date(at) : undefined);

  if (needsSetup(state)) {
    const url = `http://${h.get("host") ?? "localhost:3000"}/setup`;
    const qrSvg = await QRCode.toString(url, { type: "svg", margin: 0, color: { dark: "#1c2a32", light: "#ffffff" } });
    return <SetupNeeded qrSvg={qrSvg} url={url} />;
  }

  const mode = params.mode === "night" || params.mode === "day" ? params.mode : undefined;
  return <Dashboard initial={state} at={at} mode={mode} />;
}
