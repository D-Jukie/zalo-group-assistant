"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatNumber } from "@/lib/format";

// Ticking several rows of a list or table and then acting on all of them at once.

// The ticked rows, kept with their data so an action still knows about rows that are no longer on
// screen (another page of a table, say).
export type Selection<T> = {
  count: number;
  items: T[];
  has: (id: string) => boolean;
  toggle: (item: T, selected: boolean) => void;
  // Ticks or unticks several rows at once, for "select all".
  setMany: (items: readonly T[], selected: boolean) => void;
  clear: () => void;
};

export function useSelection<T>(getId: (item: T) => string): Selection<T> {
  const [selected, setSelected] = useState<ReadonlyMap<string, T>>(new Map());
  // The latest getId is used without making every helper below change with it.
  const idOf = useRef(getId);
  useEffect(() => {
    idOf.current = getId;
  });
  const setMany = useCallback((items: readonly T[], on: boolean) => {
    setSelected((current) => {
      const next = new Map(current);
      for (const item of items) {
        if (on) next.set(idOf.current(item), item);
        else next.delete(idOf.current(item));
      }
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Map()), []);
  return useMemo(() => ({
    count: selected.size,
    items: Array.from(selected.values()),
    has: (id: string) => selected.has(id),
    toggle: (item: T, on: boolean) => setMany([item], on),
    setMany,
    clear,
  }), [selected, setMany, clear]);
}

const boxClass = "size-4 shrink-0 cursor-pointer accent-[var(--accent)]";

// The checkbox of one row. The label is read out but not shown.
export function RowCheckbox({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <input type="checkbox" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} className={boxClass} />;
}

// "Select all" for the rows on show: ticked when all of them are, half-ticked when only some are.
export function SelectAllCheckbox<T>({ items, selection, getId, label }: { items: readonly T[]; selection: Selection<T>; getId: (item: T) => string; label: string }) {
  const box = useRef<HTMLInputElement>(null);
  const chosen = items.filter((item) => selection.has(getId(item))).length;
  const all = items.length > 0 && chosen === items.length;
  useEffect(() => {
    if (box.current !== null) box.current.indeterminate = chosen > 0 && !all;
  }, [chosen, all]);
  return <input ref={box} type="checkbox" aria-label={label} checked={all} disabled={items.length === 0} onChange={(event) => selection.setMany(items, event.target.checked)} className={boxClass} />;
}

// The actions for the ticked rows: a popup that floats at a fixed place near the bottom of the
// window, wherever the list ends and however far the page is scrolled. It is centred over the
// content, to the right of the sidebar on wide screens.
export function SelectionBar({ count, noun, onClear, children }: { count: number; noun: string; onClear: () => void; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <>
      {/* Room at the end of the page, so the last rows can be scrolled clear of the popup. */}
      <div aria-hidden="true" className="h-20" />
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 md:left-60">
        <div role="region" aria-label="Thao tác với các mục đã chọn" className="toast-in pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 py-2 shadow-xl">
          <span role="status" className="px-1 text-sm font-medium tabular-nums">Đã chọn {formatNumber(count)} {noun}</span>
          {children}
          <button type="button" aria-label="Bỏ chọn tất cả" onClick={onClear} className="grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-foreground">
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>
    </>
  );
}

// What went wrong for some rows of a bulk action, listed by name until dismissed.
export function BulkFailures({ title, failures, onDismiss }: { title: string; failures: readonly { name: string; error: string }[]; onDismiss: () => void }) {
  if (failures.length === 0) return null;
  return (
    <div role="alert" className="mb-4 rounded-md border border-danger/30 bg-danger-surface px-4 py-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-danger">{title}</p>
        <button type="button" aria-label="Đóng danh sách lỗi" onClick={onDismiss} className="-my-1 grid size-7 shrink-0 place-items-center rounded-md text-danger transition-colors hover:bg-danger/10">
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto overscroll-contain">
        {failures.map((failure, index) => (
          <li key={`${failure.name}-${index}`} className="flex flex-wrap gap-x-2"><span className="font-medium">{failure.name}</span><span className="text-muted">{failure.error}</span></li>
        ))}
      </ul>
    </div>
  );
}

// The running number of a row, for the "STT" column of a table or the start of a list item.
export function RowNumber({ value, className }: { value: number; className?: string }) {
  return <span className={`tabular-nums text-muted ${className ?? ""}`}>{formatNumber(value)}</span>;
}
