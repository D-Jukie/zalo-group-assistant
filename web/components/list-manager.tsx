"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import useSWR from "swr";
import { errorText, send } from "@/lib/api";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Input, Skeleton } from "./ui";

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
  const [error, setError] = useState<string>();
  const inputId = `${field}-input`;

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const value = String(new FormData(form).get(field) ?? "");
    setError(undefined);
    setAdding(true);
    try {
      await mutate(send<string[]>("POST", path, { [field]: value }), { revalidate: false });
      form.reset();
    } catch (exception) {
      setError(errorText(exception));
    } finally {
      setAdding(false);
    }
  }

  async function remove(item: string) {
    setError(undefined);
    setRemoving(item);
    try {
      await mutate(send<string[]>("DELETE", path, { [field]: item }), { revalidate: false });
    } catch (exception) {
      setError(errorText(exception));
    } finally {
      setRemoving(undefined);
    }
  }

  return (
    <Card>
      <CardHeader title={title} description={description} action={items ? <Badge>{items.length} mục</Badge> : undefined} />
      <div className="p-5">
        <form onSubmit={add} className="flex gap-2">
          <label htmlFor={inputId} className="sr-only">{inputLabel}</label>
          <Input id={inputId} name={field} autoComplete="off" spellCheck={false} maxLength={maxLength} placeholder={placeholder} required />
          <Button type="submit" variant="primary" pending={adding}>Thêm</Button>
        </form>
        <ErrorNote message={error} />
        {items && notice ? notice(items) : null}
      </div>
      {items === undefined ? (
        <div className="space-y-2 px-5 pb-5">{loadError ? <p className="text-sm text-danger">{errorText(loadError)}</p> : <><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></>}</div>
      ) : items.length === 0 ? (
        <div className="border-t border-border"><EmptyState title={emptyTitle} description={emptyDescription} /></div>
      ) : (
        <ul className="max-h-96 divide-y divide-border overflow-y-auto overscroll-contain border-t border-border">
          {items.map((item) => (
            <li key={item} className="flex items-center justify-between gap-3 px-5 py-2">
              <code className="min-w-0 truncate font-mono text-sm" translate="no">{item}</code>
              <Button variant="ghost" pending={removing === item} aria-label={`Xóa ${item}`} onClick={() => remove(item)}>Xóa</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
