import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "@fontsource/jua";
import "../skins/default/tokens.css";
import "../skins/paper/tokens.css"; // 스킨 CSS는 전부 번들에 넣는다(전환 때 지연 로드 없음). 새 스킨은 여기에 더하고 skins 테스트가 확인한다.
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { timeIn } from "@hsh/core";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { SKIN_MANIFESTS } from "../skins";
import { getSkinForLayout } from "@/lib/state";
import { PATH_HEADER } from "@/lib/auth/peer";
import { displayOf, isNight } from "@/lib/view";

// 첫 HTML에 data-skin을 넣으려고 요청마다 config의 skin만 읽는다(실패하면 default).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "HomeSweetHome",
};

/** 주소창 색도 스킨을 따른다. 톤은 서버 시각 기준 야간(23~6시)이면 dim - 폴링 뒤 낮밤 전환까지 따라가진 않는다(첫 로드 한정). */
export function generateViewport(): Viewport {
  const skin = getSkinForLayout();
  const { themeColor } = SKIN_MANIFESTS[skin];
  return { width: "device-width", initialScale: 1, themeColor: isNight(timeIn(new Date())) ? themeColor.dim : themeColor.day };
}

/**
 * 대시보드 화면("/")의 첫 HTML에 서버 시각 기준 data-mode·data-tone도 넣는다(야간 첫 로드에서 낮 색이 번쩍하지 않게).
 * 그 밖의 경로(/setup 같은 휴대폰 화면)는 항상 낮·보통 톤. 이후 실제 상태는 클라이언트(useDisplayTone)가 맞춘다.
 */
async function initialDisplay(): Promise<{ mode: "day" | "night"; tone: "normal" | "dim" }> {
  const path = (await headers()).get(PATH_HEADER);
  return path === "/" ? displayOf(isNight(timeIn(new Date())), false) : { mode: "day", tone: "normal" };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { mode, tone } = await initialDisplay();
  return (
    <html lang="ko" data-skin={getSkinForLayout()} data-mode={mode} data-tone={tone}>
      <body>{children}</body>
    </html>
  );
}
