"use client";

import { Bot, Search, UserCog, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWRInfinite from "swr/infinite";
import { errorText } from "@/lib/api";
import { cn, formatDateTime, formatNumber, toLocalInput } from "@/lib/format";
import { activityActors, activityCategories, type ActivityActor, type ActivityCategory, type ActivityEntry } from "@/lib/types";
import { RowNumber } from "./selection";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Skeleton } from "./ui";

const pageSize = 50;
const searchDebounceMs = 250;
// The period shown when none was chosen: this many days back, up to now.
const defaultDays = 30;
const dayMs = 24 * 60 * 60 * 1000;
// In the URL, an end of the period that was deliberately left open.
const openEnd = "none";
const fieldClass = "h-9 min-w-0 rounded-md border border-border-strong bg-surface px-3 text-sm";

const categoryLabels: Record<ActivityCategory, string> = {
  moderation: "Kiểm duyệt",
  approval: "Duyệt thành viên",
  replies: "Trả lời tự động",
  messages: "Tin nhắn và nhắc hẹn",
  settings: "Cài đặt",
  system: "Hệ thống",
};
const actorLabels: Record<ActivityActor, string> = { bot: "Bot tự làm", admin: "Quản trị viên" };
const results = [
  { value: "ok", label: "Thành công" },
  { value: "failed", label: "Thất bại" },
] as const;

// One page of the history. The first page also carries the number of entries that pass the filters.
type ActivityPage = { items: ActivityEntry[]; total?: number };

// A date and time typed into a field ("2026-10-13T08:30", in the viewer's time zone) as a timestamp.
function toTimestamp(local: string): number | undefined {
  const time = new Date(local).getTime();
  return local === "" || Number.isNaN(time) ? undefined : time;
}

// Everything the bot did by itself and everything admins did from the dashboard, by default for the
// last 30 days. The search text and every filter live in the URL, so a view can be bookmarked and
// restored with Back. The bot does the searching; older entries load on demand.
export function ActivityView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const category = activityCategories.find((item) => item === searchParams.get("category"));
  const actor = activityActors.find((item) => item === searchParams.get("actor"));
  const result = results.find((item) => item.value === searchParams.get("result"))?.value;
  const groupId = searchParams.get("groupId") ?? "";
  // Without a period in the URL the history shows the last 30 days, and the two fields are filled in
  // to say so. The start is fixed when the page opens, so the list does not reload as time passes;
  // the end is simply "now".
  const [openedAt, setOpenedAt] = useState<number>();
  const [now, setNow] = useState<number>();
  useEffect(() => {
    setOpenedAt(Date.now());
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const from = fromParam === null ? (openedAt === undefined ? "" : toLocalInput(openedAt - defaultDays * dayMs)) : fromParam === openEnd ? "" : fromParam;
  const to = toParam === null ? (now === undefined ? "" : toLocalInput(now)) : toParam === openEnd ? "" : toParam;
  const fromTime = toTimestamp(from);
  // "To 08:30" means up to the end of that minute. The default end is not sent at all.
  const toTime = toParam === null ? undefined : toTimestamp(to);
  const toEnd = toTime === undefined ? undefined : toTime + 59_999;
  const customPeriod = fromParam !== null || toParam !== null;
  const filtered = query.trim() !== "" || category !== undefined || actor !== undefined || result !== undefined || groupId !== "" || customPeriod;
  const periodReversed = fromTime !== undefined && toEnd !== undefined && fromTime > toEnd;
  // The default start is only known once the page is open in the browser; nothing is asked for before that.
  const ready = fromParam !== null || openedAt !== undefined;

  const { data: pages, error, size, setSize, isValidating } = useSWRInfinite<ActivityPage>((index, previous: ActivityPage | null) => {
    if (!ready || (previous !== null && previous.items.length < pageSize)) return null;
    const params = new URLSearchParams();
    if (query.trim() !== "") params.set("q", query.trim());
    if (category !== undefined) params.set("category", category);
    if (actor !== undefined) params.set("actor", actor);
    if (result !== undefined) params.set("result", result);
    if (groupId !== "") params.set("groupId", groupId);
    if (fromTime !== undefined) params.set("from", String(fromTime));
    if (toEnd !== undefined) params.set("to", String(toEnd));
    const last = previous?.items.at(-1);
    if (index > 0 && last !== undefined) params.set("before", `${last.at}_${last.id}`);
    const suffix = params.toString();
    return suffix ? `/activity?${suffix}` : "/activity";
  }, { keepPreviousData: true });

  // Changes the URL: an empty value takes its filter out.
  function setParams(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    const suffix = next.toString();
    router.replace(suffix ? `${pathname}?${suffix}` : pathname, { scroll: false });
  }

  // What is typed shows at once; the URL (and with it the request to the bot) follows once typing pauses.
  const [searchText, setSearchText] = useState(query);
  const appliedQuery = useRef(query);
  useEffect(() => {
    // The URL changed from outside this box (Back, "clear filters"): show what is actually being searched.
    if (query !== appliedQuery.current) {
      appliedQuery.current = query;
      setSearchText(query);
    }
  }, [query]);
  const latestSetParams = useRef(setParams);
  useEffect(() => {
    latestSetParams.current = setParams;
  });
  useEffect(() => {
    if (searchText === appliedQuery.current) return;
    const timer = setTimeout(() => {
      appliedQuery.current = searchText;
      latestSetParams.current({ q: searchText });
    }, searchDebounceMs);
    return () => clearTimeout(timer);
  }, [searchText]);

  const entries = pages?.flatMap((page) => page.items) ?? [];
  const total = pages?.[0]?.total;
  const hasMore = pages !== undefined && (pages.at(-1)?.items.length ?? 0) === pageSize;
  const loadingMore = isValidating && pages !== undefined && size > pages.length;
  const categoryFilters: readonly { value: ActivityCategory | undefined; label: string }[] = [
    { value: undefined, label: "Tất cả" },
    ...activityCategories.map((item) => ({ value: item, label: categoryLabels[item] })),
  ];
  // The group the history is narrowed to, by the name its entries carry.
  const groupName = groupId === "" ? "" : entries.find((entry) => entry.groupId === groupId)?.groupName || groupId;

  return (
    <>
      <PageHeader title="Lịch sử hoạt động" description="Những việc bot tự làm và những thao tác từ trang quản trị, mới nhất trước. Lịch sử được lưu 90 ngày." />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <label htmlFor="activity-search" className="sr-only">Tìm theo hoạt động, nội dung, tên nhóm hoặc tên thành viên</label>
          <Input
            id="activity-search"
            name="q"
            type="search"
            autoComplete="off"
            placeholder="Tìm theo hoạt động, nội dung, tên nhóm hoặc tên thành viên…"
            maxLength={100}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            className="pl-9"
          />
        </div>
        <div role="group" aria-label="Lọc theo loại hoạt động" className="inline-flex max-w-full flex-wrap gap-1 rounded-md border border-border bg-surface p-1">
          {categoryFilters.map((item) => (
            <button
              key={item.label}
              type="button"
              aria-pressed={category === item.value}
              onClick={() => setParams({ category: item.value })}
              className={cn("h-7 rounded px-2.5 text-sm transition-colors", category === item.value ? "bg-surface-hover font-medium text-foreground" : "text-muted hover:text-foreground")}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="activity-actor" className="mb-1 block text-xs text-muted">Người thực hiện</label>
          <select id="activity-actor" name="actor" value={actor ?? ""} onChange={(event) => setParams({ actor: event.target.value })} className={fieldClass}>
            <option value="">Tất cả</option>
            {activityActors.map((item) => <option key={item} value={item}>{actorLabels[item]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="activity-result" className="mb-1 block text-xs text-muted">Kết quả</label>
          <select id="activity-result" name="result" value={result ?? ""} onChange={(event) => setParams({ result: event.target.value })} className={fieldClass}>
            <option value="">Tất cả</option>
            {results.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="activity-from" className="mb-1 block text-xs text-muted">Từ lúc</label>
          <input id="activity-from" name="from" type="datetime-local" value={from} max={to || undefined} onChange={(event) => setParams({ from: event.target.value || openEnd })} className={fieldClass} />
        </div>
        <div>
          <label htmlFor="activity-to" className="mb-1 block text-xs text-muted">Đến lúc</label>
          <input id="activity-to" name="to" type="datetime-local" value={to} min={from || undefined} onChange={(event) => setParams({ to: event.target.value || openEnd })} className={fieldClass} />
        </div>
        {groupId === "" ? null : (
          <button type="button" onClick={() => setParams({ groupId: undefined })} className="inline-flex h-9 max-w-64 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-sm transition-colors hover:bg-surface-hover" aria-label={`Bỏ lọc theo nhóm ${groupName}`}>
            <span className="truncate">Nhóm: {groupName}</span>
            <X aria-hidden="true" className="size-4 shrink-0 text-muted" />
          </button>
        )}
        {filtered ? (
          <Button variant="ghost" onClick={() => router.replace(pathname, { scroll: false })}>
            <X aria-hidden="true" className="size-4" />
            Về mặc định
          </Button>
        ) : null}
        <p role="status" aria-live="polite" className="ml-auto pb-2 text-sm tabular-nums text-muted">
          {periodReversed ? <span className="text-danger">“Từ lúc” đang muộn hơn “Đến lúc”.</span> : total === undefined ? "" : `${formatNumber(total)} hoạt động${filtered ? " khớp" : ` trong ${defaultDays} ngày qua`}`}
        </p>
      </div>
      <Card>
        {pages === undefined ? (
          <div className="space-y-3 p-5">
            {error ? <p className="text-sm text-danger">{errorText(error)}</p> : Array.from({ length: 6 }, (_item, index) => <Skeleton key={index} className="h-12 w-full" />)}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            title={filtered ? "Không có hoạt động nào khớp" : `Chưa có hoạt động nào trong ${defaultDays} ngày qua`}
            description={filtered ? "Thử từ khóa khác, nới khoảng thời gian hoặc bỏ bớt bộ lọc." : "Lịch sử bắt đầu được ghi từ khi có tính năng này: bot xóa tin, mời thành viên ra, duyệt người vào nhóm, trả lời tự động, gửi tin, và mọi thay đổi cài đặt từ trang quản trị."}
            action={filtered ? <Button onClick={() => router.replace(pathname, { scroll: false })}>Về mặc định</Button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] table-fixed text-sm">
              <caption className="sr-only">Lịch sử hoạt động</caption>
              <colgroup>
                <col className="w-14" />
                <col className="w-44" />
                <col />
                <col className="w-56" />
                <col className="w-48" />
                <col className="w-36" />
                <col className="w-28" />
              </colgroup>
              <thead>
                <tr className="h-11 border-b border-border text-left text-muted">
                  <th scope="col" className="pl-5 pr-2 text-right font-medium">STT</th>
                  <th scope="col" className="px-5 font-medium">Thời gian, loại</th>
                  <th scope="col" className="px-5 font-medium">Hoạt động</th>
                  <th scope="col" className="px-5 font-medium">Nhóm</th>
                  <th scope="col" className="px-5 font-medium">Thành viên</th>
                  <th scope="col" className="px-5 font-medium">Người thực hiện</th>
                  <th scope="col" className="px-5 font-medium">Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => {
                  const ActorIcon = entry.actor === "bot" ? Bot : UserCog;
                  return (
                    <tr key={entry.id} className="border-b border-border align-top last:border-0">
                      <td className="py-3 pl-5 pr-2 text-right"><RowNumber value={index + 1} /></td>
                      <td className="px-5 py-3">
                        <span className="block whitespace-nowrap tabular-nums">{formatDateTime(entry.at)}</span>
                        <span className="block truncate text-xs text-muted">{categoryLabels[entry.category]}</span>
                      </td>
                      <th scope="row" className="px-5 py-3 text-left font-normal">
                        <span className="font-medium">{entry.title}</span>
                        {entry.detail ? <span className="mt-0.5 block break-words text-muted">{entry.detail}</span> : null}
                        {entry.error ? <span className="mt-0.5 block break-words text-danger">{entry.error}</span> : null}
                      </th>
                      <td className="px-5 py-3">
                        {entry.groupId === "" ? <span className="text-subtle">–</span> : (
                          <>
                            <Link href={`/group/${encodeURIComponent(entry.groupId)}`} className="block truncate hover:underline" title={entry.groupName || entry.groupId}>{entry.groupName || entry.groupId}</Link>
                            {groupId === entry.groupId ? null : <button type="button" onClick={() => setParams({ groupId: entry.groupId })} className="text-xs text-muted hover:text-foreground hover:underline">Chỉ xem nhóm này</button>}
                          </>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {entry.userId === "" ? <span className="text-subtle">–</span> : (
                          <>
                            <span className="block truncate" title={entry.userName || entry.userId}>{entry.userName || "Không rõ tên"}</span>
                            <span className="block truncate font-mono text-xs text-muted" translate="no">{entry.userId}</span>
                          </>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <ActorIcon aria-hidden="true" className="size-4 shrink-0 text-muted" />
                          {actorLabels[entry.actor]}
                        </span>
                      </td>
                      <td className="px-5 py-3">{entry.ok ? <Badge tone="success">Thành công</Badge> : <Badge tone="danger">Thất bại</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {hasMore ? (
          <div className="border-t border-border p-3 text-center">
            <Button pending={loadingMore} onClick={() => setSize(size + 1)}>{loadingMore ? "Đang tải…" : "Tải thêm"}</Button>
          </div>
        ) : null}
      </Card>
    </>
  );
}
