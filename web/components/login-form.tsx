"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { errorText, send } from "@/lib/api";
import { noAutofill } from "./pin-input";
import { Button, ErrorNote, Input } from "./ui";

// The last step of signing in: ask the bot to send a code over Zalo, then enter it.
export function LoginForm() {
  const router = useRouter();
  const codeRef = useRef<HTMLInputElement>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string>();

  async function requestCode() {
    setError(undefined);
    setSending(true);
    try {
      await send("POST", "/auth/code");
      setCodeSent(true);
      // The field only exists after the state update above has rendered.
      requestAnimationFrame(() => codeRef.current?.focus());
    } catch (exception) {
      setError(errorText(exception));
    } finally {
      setSending(false);
    }
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(undefined);
    setSigningIn(true);
    try {
      await send("POST", "/auth/login", { code: String(form.get("code") ?? "").trim(), remember: form.get("remember") === "on" });
      router.replace("/dashboard");
      router.refresh();
    } catch (exception) {
      setError(errorText(exception));
      setSigningIn(false);
      codeRef.current?.focus();
    }
  }

  return (
    <div className="mt-5">
      <Button variant={codeSent ? "secondary" : "primary"} pending={sending} onClick={requestCode} className="w-full">
        {codeSent ? "Gửi lại mã" : "Gửi mã đăng nhập"}
      </Button>
      {codeSent ? (
        <form onSubmit={signIn} autoComplete="off" className="mt-5 space-y-4">
          <p className="text-sm text-muted">Đã gửi mã. Mở Zalo của tài khoản quản trị và xem tin nhắn từ bot; mã có hiệu lực 5 phút.</p>
          <div>
            <label htmlFor="code" className="mb-1.5 block text-sm font-medium">Mã đăng nhập</label>
            <Input
              ref={codeRef}
              id="code"
              name="code"
              inputMode="numeric"
              {...noAutofill}
              spellCheck={false}
              maxLength={8}
              pattern="[0-9]{8}"
              placeholder="12345678…"
              required
              className="font-mono tracking-widest"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" name="remember" className="size-4 accent-[var(--accent)]" />
            Ghi nhớ thiết bị này 30 ngày
          </label>
          <Button type="submit" variant="primary" pending={signingIn} className="w-full">Đăng nhập</Button>
        </form>
      ) : null}
      <ErrorNote message={error} />
    </div>
  );
}
