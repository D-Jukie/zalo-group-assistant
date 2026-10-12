"use client";

import { RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import useSWR from "swr";
import { errorText, send } from "@/lib/api";
import { cn, formatDateTime, formatNumber } from "@/lib/format";
import { usePreferences } from "@/lib/preferences";
import type { Group } from "@/lib/types";
import { Badge, Button, Card, CompactSwitch, EmptyState, ErrorNote, Input, PageHeader, Skeleton } from "./ui";

// Every body row has the same height, whether it holds a group or pads out a short page.
const rowClass = "h-[3.25rem] border-b border-border last:border-0";

const filters = [
  { value: "all", label: "Tất cả" },
  { value: "enabled", label: "Đang bật bot" },
  { value: "admin", label: "Bot là QTV" },
  { value: "member", label: "Bot là thành viên" },
] as const;

type Filter = (typeof filters)[number]["value"];

function matchesFilter(group: Group, filter: Filter): boolean {
  if (filter === "enabled") return group.botEnabled;
  if (filter === "admin") return group.botIsAdmin;
  if (filter === "member") return !group.botIsAdmin;
  return true;
}

function RuleBadges({ group }: { group: Group }) {
  if (!group.botEnabled) return <span className="text-sm text-subtle">—</span>;
  if (!group.linkGuardEnabled && !group.badWordFilterEnabled) return <span className="block truncate text-sm text-subtle">Chưa bật tính năng nào</span>;
  return (
    <span className="flex gap-1.5 overflow-hidden">
      {group.linkGuardEnabled ? <Badge tone="success">Chặn link</Badge> : null}
      {group.badWordFilterEnabled ? <Badge tone="success">Lọc từ cấm</Badge> : null}
      {group.botIsAdmin && ((group.linkGuardEnabled && group.kickRules.link.enabled) || (group.badWordFilterEnabled && group.kickRules.badWord.enabled)) ? <Badge tone="warning">Kick</Badge> : null}
    </span>
  );
}

// The search text, filter and page live in the URL, so a view can be bookmarked, shared and restored with Back.
export function GroupsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const { pageSize } = usePreferences();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string>();
  const { data: groups, error, mutate } = useSWR<Group[]>("/groups");

  const query = searchParams.get("q") ?? "";
  const filter = filters.find((item) => item.value === searchParams.get("filter"))?.value ?? "all";
  const requestedPage = Number(searchParams.get("page") ?? "1");

  function setParams(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    const suffix = next.toString();
    startTransition(() => router.replace(suffix ? `${pathname}?${suffix}` : pathname, { scroll: false }));
  }

  // Switches the bot on or off for one group right from the list. The row updates at once and
  // falls back to the saved state if the bot refuses the change.
  async function setBotEnabled(group: Group, enabled: boolean) {
    setSyncError(undefined);
    try {
      await mutate(
        async (current) => {
          await send("PATCH", `/groups/${encodeURIComponent(group.groupId)}/bot`, { enabled });
          return current?.map((item) => item.groupId === group.groupId ? { ...item, botEnabled: enabled } : item);
        },
        {
          optimisticData: (current) => (current ?? []).map((item) => item.groupId === group.groupId ? { ...item, botEnabled: enabled } : item),
          rollbackOnError: true,
          revalidate: false,
        },
      );
    } catch (exception) {
      setSyncError(errorText(exception));
    }
  }

  async function syncFromZalo() {
    setSyncError(undefined);
    setSyncing(true);
    try {
      await mutate(send<Group[]>("POST", "/groups/sync"), { revalidate: false });
    } catch (exception) {
      setSyncError(errorText(exception));
    } finally {
      setSyncing(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const visible = (groups ?? []).filter((group) => matchesFilter(group, filter) && group.name.toLowerCase().includes(needle));
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const page = Number.isInteger(requestedPage) && requestedPage >= 1 ? Math.min(requestedPage, pageCount) : 1;
  const rows = visible.slice((page - 1) * pageSize, page * pageSize);

  return (
    <>
      <PageHeader
        title="Nhóm"
        description="Mọi nhóm tài khoản bot đang tham gia. Bot chỉ hoạt động ở nhóm đã bật; bật tắt ngay trong bảng, hoặc mở một nhóm để cài đặt tính năng và xem thống kê."
        action={
          <Button pending={syncing} onClick={syncFromZalo}>
            {syncing ? null : <RefreshCw aria-hidden="true" className="size-4" />}
            {syncing ? "Đang đồng bộ…" : "Đồng bộ từ Zalo"}
          </Button>
        }
      />
      <ErrorNote message={syncError} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <label htmlFor="group-search" className="sr-only">Tìm nhóm theo tên</label>
          <Input
            id="group-search"
            name="q"
            type="search"
            autoComplete="off"
            placeholder="Tìm nhóm theo tên…"
            defaultValue={query}
            onChange={(event) => setParams({ q: event.target.value, page: undefined })}
            className="pl-9"
          />
        </div>
        <div role="group" aria-label="Lọc nhóm" className="flex flex-wrap gap-1 rounded-md border border-border bg-surface p-1">
          {filters.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={filter === item.value}
              onClick={() => setParams({ filter: item.value === "all" ? undefined : item.value, page: undefined })}
              className={cn(
                "h-7 rounded px-2.5 text-sm transition-colors",
                filter === item.value ? "bg-surface-hover font-medium text-foreground" : "text-muted hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <Card>
        {groups === undefined ? (
          <div className="space-y-3 p-5">
            {error ? <p className="text-sm text-danger">{errorText(error)}</p> : Array.from({ length: 6 }, (_item, index) => <Skeleton key={index} className="h-10 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={groups.length === 0 ? "Chưa có nhóm nào" : "Không có nhóm nào khớp"}
            description={groups.length === 0 ? "Bấm “Đồng bộ từ Zalo” để lấy danh sách nhóm của tài khoản bot." : "Thử từ khóa khác hoặc bỏ bộ lọc."}
          />
        ) : (
          <div className="overflow-x-auto">
            {/* Fixed column widths and row heights: the table keeps its shape whatever the names, badges or page. */}
            <table className="w-full min-w-[58rem] table-fixed text-sm">
              <caption className="sr-only">Danh sách nhóm</caption>
              <colgroup>
                <col />
                <col className="w-28" />
                <col className="w-28" />
                <col className="w-36" />
                <col className="w-64" />
                <col className="w-40" />
              </colgroup>
              <thead>
                <tr className="h-11 border-b border-border text-left text-muted">
                  <th scope="col" className="px-5 font-medium">Nhóm</th>
                  <th scope="col" className="px-5 text-right font-medium">Thành viên</th>
                  <th scope="col" className="px-5 font-medium">Trạng thái</th>
                  <th scope="col" className="px-5 font-medium">Quyền của bot</th>
                  <th scope="col" className="px-5 font-medium">Tính năng</th>
                  <th scope="col" className="px-5 font-medium">Cập nhật</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((group) => (
                  <tr key={group.groupId} className={cn(rowClass, "transition-colors hover:bg-surface-hover")}>
                    <th scope="row" className="px-5 text-left font-medium">
                      {/* A long name is cut with an ellipsis; the full name shows on hover. */}
                      <Link href={`/group/${encodeURIComponent(group.groupId)}`} title={group.name || group.groupId} className="block truncate underline-offset-4 hover:underline">
                        {group.name || group.groupId}
                      </Link>
                    </th>
                    <td className="px-5 text-right tabular-nums">{formatNumber(group.memberCount)}</td>
                    <td className="px-5">
                      <CompactSwitch checked={group.botEnabled} onChange={(value) => setBotEnabled(group, value)} label={`Bật bot ở nhóm ${group.name || group.groupId}`} />
                    </td>
                    <td className="px-5">{group.botIsAdmin ? <Badge tone="success">QTV</Badge> : <Badge>Thành viên</Badge>}</td>
                    <td className="px-5"><RuleBadges group={group} /></td>
                    <td className="truncate px-5 tabular-nums text-muted">{formatDateTime(group.updatedAt)}</td>
                  </tr>
                ))}
                {/* A short last page is padded with empty rows so the pager below stays where it was. */}
                {pageCount > 1 ? Array.from({ length: pageSize - rows.length }, (_item, index) => (
                  <tr key={`filler-${index}`} aria-hidden="true" className={rowClass}><td colSpan={6} /></tr>
                )) : null}
              </tbody>
            </table>
          </div>
        )}
        {groups !== undefined && visible.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm text-muted">
            <p className="tabular-nums">
              {formatNumber((page - 1) * pageSize + 1)}–{formatNumber(Math.min(page * pageSize, visible.length))} trong {formatNumber(visible.length)} nhóm
            </p>
            <div className="flex gap-2">
              <Button disabled={page <= 1} onClick={() => setParams({ page: page <= 2 ? undefined : String(page - 1) })}>Trang trước</Button>
              <Button disabled={page >= pageCount} onClick={() => setParams({ page: String(page + 1) })}>Trang sau</Button>
            </div>
          </div>
        ) : null}
      </Card>
    </>
  );
}
