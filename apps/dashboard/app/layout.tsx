import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "HomeSweetHome",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, minHeight: "100dvh", fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
