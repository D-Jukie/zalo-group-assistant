"use client";

import { CircleAlert, CircleCheck, X } from "lucide-react";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/format";

type ToastTone = "success" | "error";

type Toast = { id: number; tone: ToastTone; message: string };

type ToastApi = { success: (message: string) => void; error: (message: string) => void };

// An error stays longer: it usually says what to do next.
const durations: Record<ToastTone, number> = { success: 4000, error: 8000 };
const maxToasts = 4;

const ToastContext = createContext<ToastApi | null>(null);

// Reports what an action did: toast.success("Đã lưu") or toast.error(message).
export function useToast(): ToastApi {
  const toast = use(ToastContext);
  if (toast === null) throw new Error("useToast must be used inside ToastProvider");
  return toast;
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  // The countdown waits while the pointer or the keyboard focus is on the toast.
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return;
    const timer = setTimeout(() => onDismiss(toast.id), durations[toast.tone]);
    return () => clearTimeout(timer);
  }, [held, onDismiss, toast.id, toast.tone]);
  const Icon = toast.tone === "success" ? CircleCheck : CircleAlert;
  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className="toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-border-strong bg-surface py-3 pl-4 pr-2 text-sm shadow-lg"
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", toast.tone === "success" ? "text-success" : "text-danger")} />
      <p className="min-w-0 flex-1 break-words">{toast.message}</p>
      <button
        type="button"
        aria-label="Đóng thông báo"
        onClick={() => onDismiss(toast.id)}
        className="-my-1 grid size-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

// Holds the toasts of every page and shows them in a corner, newest at the bottom.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const api = useMemo<ToastApi>(() => {
    const push = (tone: ToastTone, message: string) => {
      nextId.current += 1;
      const id = nextId.current;
      setToasts((current) => [...current, { id, tone, message }].slice(-maxToasts));
    };
    return { success: (message) => push("success", message), error: (message) => push("error", message) };
  }, []);
  return (
    <ToastContext value={api}>
      {children}
      <div role="region" aria-label="Thông báo" className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end">
        {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />)}
      </div>
    </ToastContext>
  );
}
