"use client";

import { LayoutDashboard, LogOut, ScrollText, Settings, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import useSWR, { SWRConfig } from "swr";
import { fetcher, send } from "@/lib/api";
import { cn } from "@/lib/format";
import { usePreferences } from "@/lib/preferences";
import type { BotStatus } from "@/lib/types";
import { ToastProvider } from "./toast";

type NavigationItem = { href: string; label: string; icon: LucideIcon; match: readonly string[] };

const navigation: readonly { title: string; items: readonly NavigationItem[] }[] = [
  {
    title: "Quản lý",
    items: [
      { href: "/dashboard", label: "Tổng quan", icon: LayoutDashboard, match: ["/dashboard"] },
      { href: "/groups", label: "Nhóm", icon: Users, match: ["/groups", "/group/"] },
      { href: "/features", label: "Tính năng", icon: ShieldCheck, match: ["/features"] },
      { href: "/violations", label: "Nhật ký vi phạm", icon: ScrollText, match: ["/violations"] },
    ],
  },
  {
    title: "Công cụ",
    items: [{ href: "/setting", label: "Cài đặt", icon: Settings, match: ["/setting"] }],
  },
];

function ConnectionDot({ status }: { status: BotStatus | undefined }) {
  const tone = status === undefined ? "bg-subtle" : status.connected ? "bg-success" : "bg-danger";
  return <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", tone)} />;
}

function BotIdentity() {
  const { data: status } = useSWR<BotStatus>("/status");
  const label = status === undefined ? "Đang tải…" : status.connected ? "Đang kết nối Zalo" : "Mất kết nối Zalo";
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <ConnectionDot status={status} />
      <span className="min-w-0">
        <span className="block truncate font-medium" translate="no">{status?.displayName || "Bot"}</span>
        <span className="block truncate text-xs text-muted">{label}</span>
      </span>
    </div>
  );
}

function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await send("POST", "/auth/logout").catch(() => undefined);
        router.replace("/login");
      }}
      className="flex h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
    >
      <LogOut aria-hidden="true" className="size-4" />
      <span className="max-md:sr-only">Đăng xuất</span>
    </button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { refreshSeconds } = usePreferences();
  return (
    // One refresh interval for every page, taken from the tool settings.
    <SWRConfig value={{ fetcher, revalidateOnFocus: true, shouldRetryOnError: false, refreshInterval: refreshSeconds * 1000 }}>
      <ToastProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm">
        Bỏ qua điều hướng
      </a>
      <div className="flex min-h-dvh flex-col md:flex-row">
        <aside className="sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b border-border bg-background/95 px-3 py-2 backdrop-blur md:h-dvh md:w-60 md:flex-col md:items-stretch md:gap-6 md:border-b-0 md:border-r md:px-4 md:py-6">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2 rounded-md px-1.5 py-1 text-sm font-semibold" translate="no">
            <span aria-hidden="true" className="grid size-6 place-items-center rounded-md bg-foreground text-xs font-bold text-background">Z</span>
            <span className="max-md:sr-only">Group Assistant</span>
          </Link>
          <nav aria-label="Điều hướng chính" className="flex min-w-0 flex-1 gap-1 overflow-x-auto md:flex-col md:gap-5 md:overflow-visible">
            {navigation.map((section) => (
              <div key={section.title} className="flex gap-1 md:flex-col">
                <p className="px-2.5 pb-1 text-xs font-medium text-subtle max-md:hidden">{section.title}</p>
                {section.items.map((item) => {
                  const active = item.match.some((prefix) => pathname.startsWith(prefix));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-sm transition-colors",
                        active ? "bg-surface-hover font-medium text-foreground" : "text-muted hover:bg-surface-hover hover:text-foreground",
                      )}
                    >
                      <item.icon aria-hidden="true" className="size-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="flex items-center gap-2 md:flex-col md:items-stretch md:gap-3 md:border-t md:border-border md:pt-4">
            <div className="max-md:hidden"><BotIdentity /></div>
            <LogoutButton />
          </div>
        </aside>
        <main id="main" className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">{children}</div>
        </main>
      </div>
      </ToastProvider>
    </SWRConfig>
  );
}
