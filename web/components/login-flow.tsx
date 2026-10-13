"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, errorText, fetcher, send } from "@/lib/api";
import type { SessionInfo } from "@/lib/session";
import { LoginForm } from "./login-form";
import { noAutofill, PinInput, pinLength } from "./pin-input";
import { Button, ErrorNote, Input, Spinner } from "./ui";

type Step = "pin" | "bot" | "code";
type BotLogin = Readonly<{ status: "starting" } | { status: "qr"; image: string; scannedBy?: string } | { status: "ready" }>;

const botPollMs = 2000;

function Heading({ step, total, title, children }: { step: number; total: number; title: string; children: React.ReactNode }) {
  return (
    <>
      <p className="text-xs font-medium text-muted">Bước {step}/{total}</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted">{children}</p>
    </>
  );
}

// The admin's email and PIN. The first visit ever chooses the PIN; later ones enter it.
function PinStep({ creating, emailConfigured, onDone }: { creating: boolean; emailConfigured: boolean; onDone: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  // Counts failed tries: the PIN boxes are emptied, by being made anew, after each one.
  const [attempt, setAttempt] = useState(0);

  // The button need not be pressed: the form also goes off as soon as the last PIN box is filled.
  // It waits a frame so that the box's digit has reached the form.
  function submitSoon() {
    requestAnimationFrame(() => formRef.current?.requestSubmit());
  }

  function fail(message: string) {
    setError(message);
    setPending(false);
    setAttempt((count) => count + 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const pin = String(form.get("pin") ?? "");
    if (pending) return;
    if (pin.length !== pinLength) {
      setError(`Mã PIN phải gồm đủ ${pinLength} chữ số`);
      return;
    }
    if (creating && pin !== String(form.get("confirm") ?? "")) {
      fail("Hai lần nhập mã PIN không giống nhau");
      return;
    }
    setError(undefined);
    setPending(true);
    try {
      await send("POST", creating ? "/auth/pin/setup" : "/auth/pin/unlock", { email: String(form.get("email") ?? "").trim(), pin });
      onDone();
    } catch (exception) {
      fail(errorText(exception));
    }
  }

  return (
    <>
      <Heading step={1} total={3} title={creating ? "Đặt mã PIN quản trị" : "Nhập mã PIN quản trị"}>
        {creating
          ? "Đây là lần đầu mở bảng điều khiển. Nhập email quản trị đã cấu hình cho bot và chọn một mã PIN gồm 6 chữ số; mã này sẽ được hỏi mỗi lần đăng nhập."
          : "Nhập email quản trị và mã PIN đã đặt để tiếp tục."}
      </Heading>
      {emailConfigured ? null : (
        <p role="status" className="mt-4 rounded-md border border-warning/30 bg-warning-surface px-3 py-2 text-sm text-warning">
          Bot chưa có <code className="font-mono">ADMIN_EMAIL</code> trong file <code className="font-mono">.env</code>. Hãy đặt biến này rồi khởi động lại bot.
        </p>
      )}
      <form ref={formRef} onSubmit={submit} autoComplete="off" className="mt-5 space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium">Email quản trị</label>
          <Input id="email" name="email" type="email" {...noAutofill} spellCheck={false} placeholder="admin@example.com…" required autoFocus />
        </div>
        <PinInput key={`pin-${attempt}`} id="pin" name="pin" label="Mã PIN" autoFocus={attempt > 0} onComplete={creating ? () => document.getElementById("confirm")?.focus() : submitSoon} />
        {creating ? <PinInput key={`confirm-${attempt}`} id="confirm" name="confirm" label="Nhập lại mã PIN" onComplete={submitSoon} /> : null}
        <Button type="submit" variant="primary" pending={pending} className="w-full">{creating ? "Đặt mã PIN" : "Tiếp tục"}</Button>
      </form>
      <ErrorNote message={error} />
    </>
  );
}

// The bot's own sign-in to Zalo. The QR code is renewed by the bot whenever it expires, so this just keeps reading it.
function BotStep({ onReady, onLocked }: { onReady: () => void; onLocked: () => void }) {
  const [login, setLogin] = useState<BotLogin>({ status: "starting" });
  const [error, setError] = useState<string>();

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      try {
        const next = await fetcher<BotLogin>("/auth/bot");
        if (stopped) return;
        setError(undefined);
        setLogin(next);
        if (next.status === "ready") {
          onReady();
          return;
        }
      } catch (exception) {
        if (stopped) return;
        // The PIN step only lasts a while; when it has run out, start over from it.
        if (exception instanceof ApiError && exception.status === 401) {
          onLocked();
          return;
        }
        setError(errorText(exception));
      }
      timer = setTimeout(read, botPollMs);
    }
    void read();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [onReady, onLocked]);

  return (
    <>
      <Heading step={2} total={3} title="Đăng nhập Zalo cho bot">
        Bot chưa đăng nhập Zalo. Mở Zalo của tài khoản sẽ chạy bot, chọn quét mã QR và quét mã dưới đây, rồi xác nhận đăng nhập trên điện thoại.
      </Heading>
      <div className="mt-5 grid aspect-square w-full place-items-center rounded-md border border-border bg-white p-3">
        {login.status === "qr"
          ? <img src={login.image} alt="Mã QR đăng nhập Zalo cho bot" width={280} height={280} className="size-full object-contain" />
          : <span className="flex items-center gap-2 text-sm text-neutral-600"><Spinner />{login.status === "ready" ? "Bot đã đăng nhập…" : "Đang tạo mã QR…"}</span>}
      </div>
      <p role="status" className="mt-3 text-sm text-muted">
        {login.status === "qr" && login.scannedBy !== undefined
          ? <>Đã quét bằng tài khoản <span className="font-medium text-foreground">{login.scannedBy}</span>. Hãy xác nhận trên điện thoại.</>
          : "Mã tự đổi mới sau khoảng 100 giây. Tài khoản quét mã phải khác tài khoản Zalo quản trị nhận mã đăng nhập."}
      </p>
      <ErrorNote message={error} />
    </>
  );
}

function firstStep(session: SessionInfo): Step {
  if (!session.unlocked && !session.authenticated) return "pin";
  return session.botReady ? "code" : "bot";
}

// The way in, one step at a time: PIN, the bot's sign-in to Zalo when it has none, then the code from Zalo.
export function LoginFlow({ session }: { session: SessionInfo }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(() => firstStep(session));
  const [pinSet, setPinSet] = useState(session.pinSet);
  const [botReady, setBotReady] = useState(session.botReady);
  const [signingOut, setSigningOut] = useState(false);

  // Stable identities: the QR step restarts its polling whenever these change.
  const [handlers] = useState(() => ({
    botReady: () => {
      setBotReady(true);
      // A browser that is already remembered has nothing left to prove once the bot is back.
      if (session.authenticated) {
        router.replace("/dashboard");
        router.refresh();
      } else {
        setStep("code");
      }
    },
    locked: () => setStep("pin"),
  }));

  if (step === "pin") {
    return (
      <PinStep
        creating={!pinSet}
        emailConfigured={session.emailConfigured}
        onDone={() => {
          setPinSet(true);
          setStep(botReady ? "code" : "bot");
        }}
      />
    );
  }
  // Signs the admin out of the dashboard: the PIN is asked for again. The bot's own sign-in to Zalo is left alone.
  const signOut = (
    <div className="fixed right-4 top-4">
      <Button
        variant="ghost"
        className="h-8 px-2.5 text-xs"
        pending={signingOut}
        onClick={async () => {
          setSigningOut(true);
          await send("POST", "/auth/logout").catch(() => undefined);
          setSigningOut(false);
          setStep("pin");
          router.refresh();
        }}
      >
        Đăng xuất
      </Button>
    </div>
  );
  if (step === "bot") {
    return (
      <>
        <BotStep onReady={handlers.botReady} onLocked={handlers.locked} />
        {signOut}
      </>
    );
  }
  return (
    <>
      <Heading step={3} total={3} title="Xác thực thiết bị">
        Bot nhắn một mã 8 chữ số tới tài khoản Zalo quản trị đã cấu hình. Nhập mã đó để trình duyệt này được vào bảng điều khiển.
      </Heading>
      <LoginForm />
      {signOut}
    </>
  );
}
