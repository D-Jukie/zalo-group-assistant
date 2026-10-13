"use client";

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/format";

export const pinLength = 6;

// Keeps the browser and the common password managers from filling a field in, or offering to.
export const noAutofill = { autoComplete: "off", autoCorrect: "off", autoCapitalize: "off", "data-1p-ignore": true, "data-lpignore": "true", "data-bwignore": true, "data-form-type": "other" } as const;

// A PIN typed one digit per box, like a two-factor code. Only digits get in; the whole PIN is
// handed to the form through a hidden field under `name`.
export function PinInput({ id, name, label, autoFocus = false, onComplete }: { id: string; name: string; label: string; autoFocus?: boolean; onComplete?: () => void }) {
  const [digits, setDigits] = useState<readonly string[]>(() => Array.from({ length: pinLength }, () => ""));
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  function focus(index: number) {
    const box = boxes.current[Math.max(0, Math.min(pinLength - 1, index))];
    box?.focus();
    box?.select();
  }

  // Writes the digits of `text` from box `index` on, then moves to the first box still to fill.
  function fill(index: number, text: string) {
    const typed = text.replace(/[^0-9]/gu, "").slice(0, pinLength - index);
    if (typed === "") return;
    const next = digits.map((digit, position) => (position >= index && position < index + typed.length ? typed.charAt(position - index) : digit));
    setDigits(next);
    if (index + typed.length >= pinLength) {
      focus(pinLength - 1);
      if (next.every((digit) => digit !== "")) onComplete?.();
    } else {
      focus(index + typed.length);
    }
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace") {
      event.preventDefault();
      // Clears this box, or the one before it when this one is already empty.
      const target = digits[index] !== "" ? index : index - 1;
      if (target < 0) return;
      setDigits(digits.map((digit, position) => (position === target ? "" : digit)));
      focus(target);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focus(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focus(index + 1);
    }
  }

  function onPaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    fill(index, event.clipboardData.getData("text"));
  }

  return (
    <div role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="mb-1.5 block text-sm font-medium">{label}</span>
      <input type="hidden" name={name} value={digits.join("")} />
      <div className="grid grid-cols-6 gap-2">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(element) => {
              boxes.current[index] = element;
            }}
            id={index === 0 ? id : undefined}
            // Not a password field: browsers and password managers offer to fill and to save those. The digits are hidden by the style below.
            type="text"
            inputMode="numeric"
            pattern="[0-9]"
            // No maxLength: text put in all at once (autofill, a paste the browser handles) is spread over the boxes by fill().
            {...noAutofill}
            autoFocus={autoFocus && index === 0}
            required
            aria-label={`${label}, số thứ ${index + 1}`}
            value={digit}
            onChange={(event) => fill(index, event.target.value)}
            onKeyDown={(event) => onKeyDown(index, event)}
            onPaste={(event) => onPaste(index, event)}
            onFocus={(event) => event.target.select()}
            className={cn(
              "h-12 w-full rounded-md border border-border-strong bg-surface text-center font-mono text-lg outline-none transition-colors [-webkit-text-security:disc]",
              "focus:border-foreground focus:ring-2 focus:ring-foreground/15",
            )}
          />
        ))}
      </div>
    </div>
  );
}
