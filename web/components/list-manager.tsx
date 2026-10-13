"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import useSWR from "swr";
import { errorText, send } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { ConfirmDialog } from "./confirm-dialog";
import { RowCheckbox, RowNumber, SelectAllCheckbox, useSelection } from "./selection";
import { useToast } from "./toast";
import { Badge, Button, Card, CardHeader, EmptyState, Input, Skeleton } from "./ui";

function itself(item: string): string {
  return item;
}

// A list of strings the admin maintains (blocked links, banned words): add with the form, remove per item.
export function ListManager({ title, description, path, field, inputLabel, placeholder, maxLength, emptyTitle, emptyDescription, notice }: {
  title: string;
  description: ReactNode;
  path: string;
  field: string;
  inputLabel: string;
  placeholder: string;
  maxLength: number;
  emptyTitle: string;
  emptyDescription: string;
  notice?: (items: string[]) => ReactNode;
}) {
  const { data: items, error: loadError, mutate } = useSWR<string[]>(path);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const selection = useSelection<string>(itself);
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const toast = useToast();
  const inputId = `${field}-input`;

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const value = String(new FormData(form).get(field) ?? "");
    setAdding(true);
    try {
      await mutate(send<string[]>("POST", path, { [field]: value }), { revalidate: false });
      form.reset();
      toast.success(`Đã thêm “${value.trim()}”`);
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setAdding(false);
    }
  }

  async function remove(item: string) {
    setRemoving(item);
    try {
      await mutate(send<string[]>("DELETE", path, { [field]: item }), { revalidate: false });
      toast.success(`Đã xóa “${item}”`);
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setRemoving(undefined);
    }
  }

  async function removeSelected(values: readonly string[]) {
    setBulkPending(true);
    try {
      await mutate(send<string[]>("DELETE", path, { values }), { revalidate: false });
      selection.clear();
      toast.success(`Đã xóa ${formatNumber(values.length)} mục`);
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setBulkPending(false);
      setConfirmingBulk(false);
    }
  }

  // Entries that have since left the list (removed one by one, say) no longer count as ticked.
  const chosen = selection.items.filter((item) => items?.includes(item) ?? false);

  return (
    <Card>
      <CardHeader title={title} description={description} action={items ? <Badge>{items.length} mục</Badge> : undefined} />
      <div className="p-5">
        <form onSubmit={add} className="flex gap-2">
          <label htmlFor={inputId} className="sr-only">{inputLabel}</label>
          <Input id={inputId} name={field} autoComplete="off" spellCheck={false} maxLength={maxLength} placeholder={placeholder} required />
          <Button type="submit" variant="primary" pending={adding}>Thêm</Button>
        </form>
        {items && notice ? notice(items) : null}
      </div>
      {items === undefined ? (
        <div className="space-y-2 px-5 pb-5">{loadError ? <p className="text-sm text-danger">{errorText(loadError)}</p> : <><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></>}</div>
      ) : items.length === 0 ? (
        <div className="border-t border-border"><EmptyState title={emptyTitle} description={emptyDescription} /></div>
      ) : (
        <ul className="max-h-96 divide-y divide-border overflow-y-auto overscroll-contain border-t border-border">
          <li className="px-5 py-2">
            <label className="inline-flex cursor-pointer items-center gap-3 text-sm text-muted">
              <SelectAllCheckbox items={items} selection={selection} getId={itself} label={`Chọn mọi mục của ${title}`} />
              Chọn tất cả
            </label>
          </li>
          {items.map((item, index) => (
            <li key={item} className={`flex items-center gap-3 px-5 py-2 ${selection.has(item) ? "bg-surface-hover" : ""}`}>
              <RowCheckbox checked={selection.has(item)} onChange={(checked) => selection.toggle(item, checked)} label={`Chọn ${item}`} />
              <RowNumber value={index + 1} className="w-6 shrink-0 text-right text-sm" />
              <code className="min-w-0 flex-1 truncate font-mono text-sm" translate="no">{item}</code>
              <Button variant="ghost" pending={removing === item} aria-label={`Xóa ${item}`} onClick={() => remove(item)}>Xóa</Button>
            </li>
          ))}
        </ul>
      )}
      {chosen.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
          <span role="status" className="text-sm font-medium tabular-nums">Đã chọn {formatNumber(chosen.length)} mục</span>
          <span className="flex gap-2">
            <Button variant="ghost" onClick={selection.clear}>Bỏ chọn</Button>
            <Button variant="danger" disabled={bulkPending} onClick={() => setConfirmingBulk(true)}>Xóa mục đã chọn</Button>
          </span>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmingBulk}
        title={`Xóa ${formatNumber(chosen.length)} mục khỏi “${title}”?`}
        confirmLabel="Xóa"
        pending={bulkPending}
        onConfirm={() => void removeSelected(chosen)}
        onCancel={() => setConfirmingBulk(false)}
      >
        Các mục đã chọn sẽ không còn được áp dụng. Muốn dùng lại phải thêm lại từng mục.
      </ConfirmDialog>
    </Card>
  );
}
