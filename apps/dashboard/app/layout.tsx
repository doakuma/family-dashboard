import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "@fontsource/jua";
import "../skins/default/tokens.css";
import "../skins/paper/tokens.css"; // 스킨 CSS는 전부 번들에 넣는다(전환 때 지연 로드 없음). 새 스킨은 여기에 더하고 skins 테스트가 확인한다.
import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "HomeSweetHome",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#edf2ee",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" data-skin="default" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
