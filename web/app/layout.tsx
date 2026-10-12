import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Zalo Group Assistant", template: "%s · Zalo Group Assistant" },
  description: "Bảng điều khiển bot hỗ trợ nhóm Zalo",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

// Applies a saved light/dark choice before the first paint, so the page never flashes the other theme.
// It reads the same storage key as lib/preferences.ts.
const themeScript = `try{var t=JSON.parse(localStorage.getItem("zalo-group-assistant:preferences:v1")||"{}").theme;if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The script above may set data-theme before React hydrates, which is the one expected mismatch here.
    <html lang="vi" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
