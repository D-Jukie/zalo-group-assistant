"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./ui";

// A native modal dialog for destructive actions: it traps focus, closes on Escape and restores focus on close.
export function ConfirmDialog({ open, title, children, confirmLabel, pending = false, onConfirm, onCancel }: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] overscroll-contain rounded-lg border border-border bg-surface p-0 text-foreground shadow-xl"
    >
      <div className="p-5">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="mt-2 text-sm text-muted">{children}</div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
        <Button onClick={onCancel}>Hủy</Button>
        <Button variant="danger" pending={pending} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </dialog>
  );
}
