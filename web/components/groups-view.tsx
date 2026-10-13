"use client";

import { RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import useSWR from "swr";
import { errorText, send } from "@/lib/api";
import { cn, formatDateTime, formatNumber } from "@/lib/format";
import { usePreferences, usePreferencesReady } from "@/lib/preferences";
import type { BotStatus, Group, GroupActionResult, GroupPage } from "@/lib/types";
import { ConfirmDialog } from "./confirm-dialog";
import { BulkFailures, RowCheckbox, RowNumber, SelectAllCheckbox, SelectionBar, useSelection } from "./selection";
import { useToast } from "./toast";
import { Badge, Button, Card, CompactSwitch, EmptyState, Input, PageHeader, Skeleton } from "./ui";

const searchDebounceMs = 250;

// Every body row has the same height, whether it holds a group or pads out a short page.
const rowClass = "h-[3.25rem] border-b border-border last:border-0";

const filters = [
  { value: "all", label: "Tất cả" },
  { value: "enabled", label: "Đang bật bot" },
  { value: "admin", label: "Bot là trưởng nhóm" },
  { value: "member", label: "Bot là thành viên" },
] as const;
// What the page shows when the address names no filter: the groups the bot is at work in.
const defaultFilter = "enabled";

function RuleBadges({ group }: { group: Group }) {
  if (!group.botEnabled) return <span className="text-sm text-subtle">—</span>;
  if (!group.linkGuardEnabled && !group.badWordFilterEnabled && !group.spamGuardEnabled) return <span className="block truncate text-sm text-subtle">Chưa bật tính năng nào</span>;
  return (
    <span className="flex gap-1.5 overflow-hidden">
      {group.linkGuardEnabled ? <Badge tone="success">Chặn link</Badge> : null}
      {group.badWordFilterEnabled ? <Badge tone="success">Lọc từ cấm</Badge> : null}
      {group.spamGuardEnabled ? <Badge tone="success">Chống spam</Badge> : null}
      {group.botIsAdmin && ((group.linkGuardEnabled && group.kickRules.link.enabled) || (group.badWordFilterEnabled && group.kickRules.badWord.enabled) || (group.spamGuardEnabled && group.kickRules.spam.enabled)) ? <Badge tone="warning">Kick</Badge> : null}
    </span>
  );
}

type BulkAction = "enable" | "disable" | "leave";

const bulkDone: Record<BulkAction, string> = { enable: "Đã bật bot ở", disable: "Đã tắt bot ở", leave: "Đã rời" };

function groupIdOf(group: Group): string {
  return group.groupId;
}

// The search text, filter and page live in the URL, so a view can be bookmarked, shared and restored with Back.
// The bot does the searching, filtering and paging; this page only ever holds the rows it shows.
export function GroupsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const { pageSize } = usePreferences();
  const preferencesReady = usePreferencesReady();
  const [syncing, setSyncing] = useState(false);
  const toast = useToast();
  // Ticked groups stay ticked across pages and searches, until an action is done or they are cleared.
  const selection = useSelection<Group>(groupIdOf);
  const [bulkPending, setBulkPending] = useState<BulkAction>();
  const [failures, setFailures] = useState<{ name: string; error: string }[]>([]);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const { data: status } = useSWR<BotStatus>("/status");

  const query = searchParams.get("q") ?? "";
  const filter = filters.find((item) => item.value === searchParams.get("filter"))?.value ?? defaultFilter;
  const requestedPage = Number(searchParams.get("page") ?? "1");

  const request = new URLSearchParams({ page: String(Number.isInteger(requestedPage) && requestedPage >= 1 ? requestedPage : 1), pageSize: String(pageSize) });
  if (query.trim() !== "") request.set("q", query.trim());
  if (filter !== "all") request.set("filter", filter);
  // The previous page stays on screen while the next one loads, so the table never collapses between requests.
  const { data, error, mutate } = useSWR<GroupPage>(preferencesReady ? `/groups?${request.toString()}` : null, { keepPreviousData: true });

  // What is typed shows at once; the URL (and with it the request to the bot) follows once typing pauses.
  const [searchText, setSearchText] = useState(query);
  const appliedQuery = useRef(query);
  useEffect(() => {
    // The URL changed from outside this box (Back, a link): show what is actually being searched.
    if (query !== appliedQuery.current) {
      appliedQuery.current = query;
      setSearchText(query);
    }
  }, [query]);
  // Changes the URL. Text still waiting out the debounce goes along with whatever else changes, so a
  // filter or pager click during the wait cannot be undone by the pending search, or the other way round.
  function setParams(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    if (searchText !== query) {
      appliedQuery.current = searchText;
      next.set("q", searchText);
      next.delete("page");
    }
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (next.get("q") === "") next.delete("q");
    const suffix = next.toString();
    startTransition(() => router.replace(suffix ? `${pathname}?${suffix}` : pathname, { scroll: false }));
  }

  // The timer always calls the newest setParams, which sees the newest URL and text.
  const latestSetParams = useRef(setParams);
  useEffect(() => {
    latestSetParams.current = setParams;
  });
  useEffect(() => {
    if (searchText === appliedQuery.current) return;
    const timer = setTimeout(() => {
      // Another change may already have carried this text into the URL.
      if (searchText !== appliedQuery.current) latestSetParams.current({});
    }, searchDebounceMs);
    return () => clearTimeout(timer);
  }, [searchText]);

  // Switches the bot on or off for one group right from the list. The row updates at once and
  // falls back to the saved state if the bot refuses the change.
  async function setBotEnabled(group: Group, enabled: boolean) {
    const withBot = (current: GroupPage): GroupPage => ({ ...current, items: current.items.map((item) => item.groupId === group.groupId ? { ...item, botEnabled: enabled } : item) });
    try {
      await mutate(
        async (current) => {
          await send("PATCH", `/groups/${encodeURIComponent(group.groupId)}/bot`, { enabled });
          return current === undefined ? current : withBot(current);
        },
        {
          optimisticData: (current) => current === undefined ? { items: [], total: 0, page: 1, pageSize } : withBot(current),
          rollbackOnError: true,
          // The saved change can move the group out of a filtered view and alter the total.
          revalidate: true,
        },
      );
      toast.success(`Đã ${enabled ? "bật" : "tắt"} bot ở “${group.name || group.groupId}”`);
    } catch (exception) {
      toast.error(errorText(exception));
    }
  }

  // One action for every ticked group. The bot answers with what happened in each of them.
  async function runBulk(action: BulkAction, groups: readonly Group[]) {
    setBulkPending(action);
    setFailures([]);
    try {
      const response = await send<{ results: GroupActionResult[] }>("POST", "/groups/bulk", { action, groupIds: groups.map(groupIdOf) });
      const failed = response.results.filter((item) => !item.ok);
      const done = response.results.length - failed.length;
      setFailures(failed.map((item) => ({ name: item.groupName || item.groupId, error: item.error ?? "Không rõ lý do" })));
      if (failed.length === 0) toast.success(`${bulkDone[action]} ${formatNumber(done)} nhóm`);
      else toast.error(`${bulkDone[action]} ${formatNumber(done)}/${formatNumber(response.results.length)} nhóm`);
      selection.clear();
      await mutate();
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setBulkPending(undefined);
      setConfirmingLeave(false);
    }
  }

  // The owner of a group cannot leave it until ownership has been handed to someone else in Zalo.
  const owned = status === undefined ? [] : selection.items.filter((group) => group.creatorId === status.userId);
  const leavable = selection.items.filter((group) => !owned.includes(group));

  async function syncFromZalo() {
    setSyncing(true);
    try {
      await send("POST", "/groups/sync");
      await mutate();
      toast.success("Đã đồng bộ danh sách nhóm từ Zalo");
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setSyncing(false);
    }
  }

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const page = data?.page ?? 1;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const unfiltered = query.trim() === "" && filter === "all";
  // The view the page opens on, with nothing in it: say where the groups are instead of "nothing matches".
  const noneEnabled = query.trim() === "" && filter === defaultFilter;

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
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <label htmlFor="group-search" className="sr-only">Tìm nhóm theo tên hoặc ID</label>
          <Input
            id="group-search"
            name="q"
            type="search"
            autoComplete="off"
            placeholder="Tìm nhóm theo tên hoặc ID…"
            maxLength={100}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            className="pl-9"
          />
        </div>
        <div role="group" aria-label="Lọc nhóm" className="flex flex-wrap gap-1 rounded-md border border-border bg-surface p-1">
          {filters.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={filter === item.value}
              onClick={() => setParams({ filter: item.value === defaultFilter ? undefined : item.value, page: undefined })}
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

      <BulkFailures title="Một số nhóm chưa xử lý được" failures={failures} onDismiss={() => setFailures([])} />
      <Card>
        {data === undefined ? (
          <div className="space-y-3 p-5">
            {error ? <p className="text-sm text-danger">{errorText(error)}</p> : Array.from({ length: 6 }, (_item, index) => <Skeleton key={index} className="h-10 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={unfiltered ? "Chưa có nhóm nào" : noneEnabled ? "Chưa bật bot ở nhóm nào" : "Không có nhóm nào khớp"}
            description={unfiltered ? "Bấm “Đồng bộ từ Zalo” để lấy danh sách nhóm của tài khoản bot." : noneEnabled ? "Chọn “Tất cả” để xem mọi nhóm của tài khoản bot và bật bot cho nhóm cần dùng." : "Thử từ khóa khác hoặc bỏ bộ lọc."}
          />
        ) : (
          <div className="overflow-x-auto">
            {/* Fixed column widths and row heights: the table keeps its shape whatever the names, badges or page. */}
            <table className="w-full min-w-[72rem] table-fixed text-sm">
              <caption className="sr-only">Danh sách nhóm</caption>
              <colgroup>
                <col className="w-12" />
                <col className="w-14" />
                <col />
                <col className="w-28" />
                <col className="w-28" />
                <col className="w-36" />
                <col className="w-[22rem]" />
                <col className="w-40" />
              </colgroup>
              <thead>
                <tr className="h-11 border-b border-border text-left text-muted">
                  <th scope="col" className="pl-5"><SelectAllCheckbox items={rows} selection={selection} getId={groupIdOf} label="Chọn mọi nhóm của trang này" /></th>
                  <th scope="col" className="px-2 text-right font-medium">STT</th>
                  <th scope="col" className="px-5 font-medium">Nhóm</th>
                  <th scope="col" className="px-5 text-right font-medium">Thành viên</th>
                  <th scope="col" className="px-5 font-medium">Trạng thái</th>
                  <th scope="col" className="px-5 font-medium">Quyền của bot</th>
                  <th scope="col" className="px-5 font-medium">Tính năng</th>
                  <th scope="col" className="px-5 font-medium">Cập nhật</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((group, index) => (
                  <tr key={group.groupId} className={cn(rowClass, "transition-colors hover:bg-surface-hover", selection.has(group.groupId) && "bg-surface-hover")}>
                    <td className="pl-5"><RowCheckbox checked={selection.has(group.groupId)} onChange={(checked) => selection.toggle(group, checked)} label={`Chọn nhóm ${group.name || group.groupId}`} /></td>
                    <td className="px-2 text-right"><RowNumber value={(page - 1) * pageSize + index + 1} /></td>
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
                    <td className="px-5">{group.botIsAdmin ? <Badge tone="success">Trưởng nhóm</Badge> : <Badge>Thành viên</Badge>}</td>
                    <td className="px-5"><RuleBadges group={group} /></td>
                    <td className="truncate px-5 tabular-nums text-muted">{formatDateTime(group.updatedAt)}</td>
                  </tr>
                ))}
                {/* A short last page is padded with empty rows so the pager below stays where it was. */}
                {pageCount > 1 ? Array.from({ length: pageSize - rows.length }, (_item, index) => (
                  <tr key={`filler-${index}`} aria-hidden="true" className={rowClass}><td colSpan={8} /></tr>
                )) : null}
              </tbody>
            </table>
          </div>
        )}
        {data !== undefined && total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm text-muted">
            <p className="tabular-nums">
              {formatNumber((page - 1) * pageSize + 1)}–{formatNumber(Math.min(page * pageSize, total))} trong {formatNumber(total)} nhóm
            </p>
            <div className="flex gap-2">
              <Button disabled={page <= 1} onClick={() => setParams({ page: page <= 2 ? undefined : String(page - 1) })}>Trang trước</Button>
              <Button disabled={page >= pageCount} onClick={() => setParams({ page: String(page + 1) })}>Trang sau</Button>
            </div>
          </div>
        ) : null}
      </Card>
      <SelectionBar count={selection.count} noun="nhóm" onClear={selection.clear}>
        <Button pending={bulkPending === "enable"} disabled={bulkPending !== undefined} onClick={() => runBulk("enable", selection.items)}>Bật bot</Button>
        <Button pending={bulkPending === "disable"} disabled={bulkPending !== undefined} onClick={() => runBulk("disable", selection.items)}>Tắt bot</Button>
        <Button variant="danger" disabled={bulkPending !== undefined} onClick={() => setConfirmingLeave(true)}>Rời nhóm</Button>
      </SelectionBar>
      <ConfirmDialog
        open={confirmingLeave}
        title={leavable.length > 0 ? `Rời ${formatNumber(leavable.length)} nhóm?` : "Không rời được nhóm nào"}
        confirmLabel={leavable.length > 0 ? "Rời nhóm" : "Đã hiểu"}
        pending={bulkPending === "leave"}
        onConfirm={() => {
          if (leavable.length > 0) void runBulk("leave", leavable);
          else setConfirmingLeave(false);
        }}
        onCancel={() => setConfirmingLeave(false)}
      >
        {leavable.length > 0 ? <p>Tài khoản bot sẽ rời khỏi các nhóm này trên Zalo. Muốn vào lại phải được mời hoặc duyệt lại; cài đặt của nhóm vẫn được giữ, còn tin nhắn đang chờ gửi vào nhóm sẽ bị hủy.</p> : null}
        {owned.length > 0 ? (
          <p className={leavable.length > 0 ? "mt-2" : undefined}>
            Bot đang là trưởng nhóm của {formatNumber(owned.length)} nhóm đã chọn ({owned.slice(0, 3).map((group) => group.name || group.groupId).join(", ")}{owned.length > 3 ? "…" : ""}) nên {leavable.length > 0 ? "các nhóm đó được bỏ qua" : "chưa rời được"}. Hãy chuyển quyền trưởng nhóm cho người khác trên Zalo trước.
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
