import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { BotUnreachable } from "@/components/bot-unreachable";
import { getSessionState } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSessionState();
  if (session === "signedOut") redirect("/login");
  if (session === "botUnreachable") return <BotUnreachable />;
  return <AppShell>{children}</AppShell>;
}
