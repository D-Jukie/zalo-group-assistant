import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BotUnreachable } from "@/components/bot-unreachable";
import { LoginForm } from "@/components/login-form";
import { getSessionState } from "@/lib/session";

export const metadata: Metadata = { title: "Đăng nhập" };

export default async function LoginPage() {
  const session = await getSessionState();
  if (session === "signedIn") redirect("/dashboard");
  if (session === "botUnreachable") return <BotUnreachable />;
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2 text-sm font-semibold" translate="no">
          <span aria-hidden="true" className="grid size-7 place-items-center rounded-md bg-foreground text-xs font-bold text-background">Z</span>
          Zalo Group Assistant
        </div>
        <div className="rounded-lg border border-border bg-surface p-6">
          <h1 className="text-xl font-semibold tracking-tight">Đăng nhập quản trị</h1>
          <p className="mt-2 text-sm text-muted">
            Bot nhắn một mã 8 chữ số tới tài khoản Zalo quản trị đã cấu hình. Nhập mã đó để vào bảng điều khiển.
          </p>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
