"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { errorText, send } from "@/lib/api";
import { cn, foldText, formatNumber } from "@/lib/format";
import type { GroupCommandRow } from "@/lib/types";
import { RowCheckbox, RowNumber, SelectAllCheckbox, SelectionBar, useSelection } from "./selection";
import { useToast } from "./toast";
import { Button, Card, CardHeader, CompactSwitch, EmptyState, Input, Skeleton } from "./ui";

function rowId(row: GroupCommandRow): string {
  return row.groupId;
}

// What is changed about "/random": either field alone, the other stays as each group has it.
type RandomChange = { enabled: boolean } | { adminOnly: boolean };

// The bot's own commands in one table, for the groups the bot is on in: which of them have "/random"
// on, and whether it is kept for the group's admins. Tick several groups to change them together.
export function CommandGroups() {
  const { data: rows, error, mutate } = useSWR<GroupCommandRow[]>("/group-commands");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(false);
  const selection = useSelection<GroupCommandRow>(rowId);
  const toast = useToast();
  const needle = foldText(search.trim());
  const visible = rows === undefined || needle === "" ? rows : rows.filter((row) => foldText(row.name).includes(needle) || row.groupId.includes(needle));
  const enabledCount = (rows ?? []).filter((row) => row.commands.random.enabled).length;

  async function change(chosen: readonly GroupCommandRow[], random: RandomChange, done: string) {
    setPending(true);
    try {
      await mutate(send<GroupCommandRow[]>("POST", "/group-commands", { groupIds: chosen.map(rowId), random }), { revalidate: false });
      selection.clear();
      toast.success(done);
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setPending(false);
    }
  }

  const name = (row: GroupCommandRow) => row.name || row.groupId;
  const many = `${formatNumber(selection.count)} nhóm`;

  return (
    <>
      <Card>
        <CardHeader
          title="Lệnh /random"
          description={
            <>
              Bot tự chọn ngẫu nhiên: <code className="font-mono text-xs" translate="no">/random</code> chọn 1 thành viên, <code className="font-mono text-xs" translate="no">/random 3</code> chọn 3 thành viên (tối đa 20), <code className="font-mono text-xs" translate="no">/random 1-100</code> chọn một số. Bật riêng cho từng nhóm; chỉ hiện các nhóm đang bật bot.
              {rows === undefined ? null : <span className="mt-1 block tabular-nums">Đang bật ở {formatNumber(enabledCount)}/{formatNumber(rows.length)} nhóm đang bật bot.</span>}
            </>
          }
        />
        {visible === undefined || rows === undefined ? (
          <div className="space-y-3 p-5">{error ? <p className="text-sm text-danger">{errorText(error)}</p> : Array.from({ length: 4 }, (_item, index) => <Skeleton key={index} className="h-10 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState title="Chưa có nhóm nào đang bật bot" description="Lệnh chỉ trả lời ở nhóm đang bật bot. Bật bot cho nhóm, nhóm sẽ hiện ở đây." action={<Link href="/groups" className="inline-flex h-9 items-center rounded-md border border-border-strong bg-surface px-3 text-sm font-medium transition-colors hover:bg-surface-hover">Mở trang Nhóm</Link>} />
        ) : (
          <>
            <div className="relative px-5 py-3">
              <Search aria-hidden="true" className="pointer-events-none absolute left-8 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              <label htmlFor="command-group-search" className="sr-only">Tìm nhóm theo tên hoặc ID</label>
              <Input id="command-group-search" type="search" autoComplete="off" placeholder="Tìm nhóm…" value={search} onChange={(event) => setSearch(event.target.value)} className="max-w-sm pl-9" />
            </div>
            {visible.length === 0 ? (
              <p className="border-t border-border px-5 py-8 text-center text-sm text-muted">Không có nhóm nào khớp “{search}”.</p>
            ) : (
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full min-w-[44rem] table-fixed text-sm">
                  <caption className="sr-only">Lệnh /random ở từng nhóm</caption>
                  <colgroup>
                    <col className="w-12" />
                    <col className="w-14" />
                    <col />
                    <col className="w-32" />
                    <col className="w-52" />
                    <col className="w-20" />
                  </colgroup>
                  <thead>
                    <tr className="h-11 border-b border-border text-left text-muted">
                      <th scope="col" className="pl-5"><SelectAllCheckbox items={visible} selection={selection} getId={rowId} label="Chọn mọi nhóm" /></th>
                      <th scope="col" className="px-2 text-right font-medium">STT</th>
                      <th scope="col" className="px-5 font-medium">Nhóm</th>
                      <th scope="col" className="px-5 text-right font-medium">Thành viên</th>
                      <th scope="col" className="px-5 font-medium">Ai dùng được</th>
                      <th scope="col" className="px-5 font-medium">Bật</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row, index) => {
                      const { random } = row.commands;
                      return (
                        <tr key={row.groupId} className={cn("h-12 border-b border-border last:border-0", selection.has(row.groupId) && "bg-surface-hover")}>
                          <td className="pl-5"><RowCheckbox checked={selection.has(row.groupId)} onChange={(checked) => selection.toggle(row, checked)} label={`Chọn nhóm ${name(row)}`} /></td>
                          <td className="px-2 text-right"><RowNumber value={index + 1} /></td>
                          <th scope="row" className="px-5 text-left font-normal">
                            <Link href={`/group/${encodeURIComponent(row.groupId)}?tab=replies`} className="block truncate font-medium hover:underline" title={name(row)}>{name(row)}</Link>
                          </th>
                          <td className="px-5 text-right tabular-nums">{formatNumber(row.memberCount)}</td>
                          <td className="px-5">
                            <label className={cn("flex items-center gap-2", random.enabled ? "cursor-pointer" : "cursor-not-allowed opacity-60")}>
                              <input
                                type="checkbox"
                                checked={random.adminOnly}
                                disabled={!random.enabled || pending}
                                onChange={(event) => change([row], { adminOnly: event.target.checked }, event.target.checked ? `Chỉ trưởng và phó nhóm dùng được /random ở “${name(row)}”` : `Mọi thành viên dùng được /random ở “${name(row)}”`)}
                                className="size-4 shrink-0 accent-[var(--accent)]"
                              />
                              <span className="truncate">Chỉ trưởng, phó nhóm</span>
                            </label>
                          </td>
                          <td className="px-5">
                            <CompactSwitch checked={random.enabled} disabled={pending} onChange={(enabled) => change([row], { enabled }, `Đã ${enabled ? "bật" : "tắt"} /random ở “${name(row)}”`)} label={`Bật lệnh /random ở ${name(row)}`} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>
      <SelectionBar count={selection.count} noun="nhóm" onClear={selection.clear}>
        <Button disabled={pending} onClick={() => change(selection.items, { enabled: true }, `Đã bật /random ở ${many}`)}>Bật</Button>
        <Button disabled={pending} onClick={() => change(selection.items, { enabled: false }, `Đã tắt /random ở ${many}`)}>Tắt</Button>
        <Button disabled={pending} onClick={() => change(selection.items, { adminOnly: true }, `Chỉ trưởng và phó nhóm dùng được /random ở ${many}`)}>Chỉ trưởng, phó nhóm</Button>
        <Button disabled={pending} onClick={() => change(selection.items, { adminOnly: false }, `Mọi thành viên dùng được /random ở ${many}`)}>Mọi thành viên</Button>
      </SelectionBar>
    </>
  );
}
