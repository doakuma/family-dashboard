import { headers } from "next/headers";
import QRCode from "qrcode";
import { Screen } from "@/components/Screen";
import { getApiState } from "@/lib/state";

export const dynamic = "force-dynamic";

interface Props {
  // 시안·점검용: ?at=2026-10-29T10:30:00%2B09:00  ?mode=night
  searchParams: Promise<{ at?: string; mode?: string }>;
}

export default async function Page({ searchParams }: Props) {
  const [params, h] = await Promise.all([searchParams, headers()]);
  const at = params.at && !Number.isNaN(Date.parse(params.at)) ? params.at : undefined;
  const state = await getApiState(at ? new Date(at) : undefined);

  // 세팅 필요 여부는 폴링으로 바뀔 수 있어서 QR은 항상 만들어 둔다.
  const url = `http://${h.get("host") ?? "localhost:3000"}/setup`;
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 0, color: { dark: "#1c2a32", light: "#ffffff" } });

  const mode = params.mode === "night" || params.mode === "day" ? params.mode : undefined;
  return <Screen initial={state} qrSvg={qrSvg} url={url} at={at} mode={mode} />;
}
