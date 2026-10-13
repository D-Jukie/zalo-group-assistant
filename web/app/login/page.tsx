import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BotUnreachable } from "@/components/bot-unreachable";
import { LoginFlow } from "@/components/login-flow";
import { getSessionInfo } from "@/lib/session";

export const metadata: Metadata = { title: "Đăng nhập" };

export default async function LoginPage() {
  const session = await getSessionInfo();
  if (session === undefined) return <BotUnreachable />;
  if (session.authenticated && session.botReady) redirect("/dashboard");
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2 text-sm font-semibold" translate="no">
          <span aria-hidden="true" className="grid size-7 place-items-center rounded-md bg-foreground text-xs font-bold text-background">Z</span>
          Zalo Group Assistant
        </div>
        <div className="rounded-lg border border-border bg-surface p-6">
          <LoginFlow session={session} />
        </div>
      </div>
    </main>
  );
}
