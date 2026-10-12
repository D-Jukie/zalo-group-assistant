"use client";

import { useSyncExternalStore } from "react";

// Settings of the dashboard itself. They live in this browser only and never reach the bot.
export type Theme = "system" | "light" | "dark";

export type Preferences = {
  theme: Theme;
  // How often open pages re-fetch their data; 0 turns automatic refresh off.
  refreshSeconds: number;
  pageSize: number;
};

export const themeOptions: readonly { value: Theme; label: string }[] = [
  { value: "system", label: "Theo hệ thống" },
  { value: "light", label: "Sáng" },
  { value: "dark", label: "Tối" },
];
export const refreshOptions: readonly { value: number; label: string }[] = [
  { value: 0, label: "Tắt" },
  { value: 15, label: "15 giây" },
  { value: 30, label: "30 giây" },
  { value: 60, label: "1 phút" },
];
export const pageSizeOptions: readonly number[] = [25, 50, 100];

// The version in the key lets a future change of shape start clean instead of misreading old data.
export const preferencesKey = "zalo-group-assistant:preferences:v1";
const defaults: Preferences = { theme: "system", refreshSeconds: 30, pageSize: 25 };
const changeEvent = "preferences-change";

let cachedRaw: string | null | undefined;
let cachedValue: Preferences = defaults;

function parse(raw: string | null): Preferences {
  if (raw === null) return defaults;
  try {
    const stored = JSON.parse(raw) as Partial<Preferences>;
    return {
      theme: themeOptions.some((option) => option.value === stored.theme) ? stored.theme as Theme : defaults.theme,
      refreshSeconds: refreshOptions.some((option) => option.value === stored.refreshSeconds) ? stored.refreshSeconds as number : defaults.refreshSeconds,
      pageSize: pageSizeOptions.includes(stored.pageSize as number) ? stored.pageSize as number : defaults.pageSize,
    };
  } catch {
    return defaults;
  }
}

// Returns the same object until the stored text changes, as useSyncExternalStore requires.
function getSnapshot(): Preferences {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(preferencesKey);
  } catch {
    // Storage can be blocked; the defaults still work.
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parse(raw);
  }
  return cachedValue;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(changeEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(changeEvent, onChange);
  };
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, getSnapshot, () => defaults);
}

export function applyTheme(theme: Theme): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function setPreferences(changes: Partial<Preferences>): void {
  const next = { ...getSnapshot(), ...changes };
  try {
    window.localStorage.setItem(preferencesKey, JSON.stringify(next));
  } catch {
    // Without storage the change lasts until the page is reloaded.
  }
  applyTheme(next.theme);
  window.dispatchEvent(new Event(changeEvent));
}
