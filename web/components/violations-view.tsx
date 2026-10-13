"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWRInfinite from "swr/infinite";
import { errorText } from "@/lib/api";
import { cn, formatNumber, toLocalInput } from "@/lib/format";
import { ruleLabels, violationRules, type RecentViolation, type ViolationMessageStatus, type ViolationRule } from "@/lib/types";
import { Button, Card, EmptyState, Input, PageHeader, Skeleton } from "./ui";
import { GroupLink, ViolationItem } from "./violation-item";

const pageSize = 30;
const searchDebounceMs = 250;
// The period shown when none was chosen: this many days back, up to now.
const defaultDays = 30;
const dayMs = 24 * 60 * 60 * 1000;
// In the URL, an end of the period that was deliberately left open.
const openEnd = "none";
const fieldClass = "h-9 min-w-0 rounded-md border border-border-strong bg-surface px-3 text-sm";

const statuses: readonly { value: ViolationMessageStatus; label: string }[] = [
  { value: "deleted", label: "Đã xóa" },
  { value: "deleteFailed", label: "Xóa thất bại" },
  { value: "recorded", label: "Chỉ ghi nhận" },
];

// One page of the log. The first page also carries the number of entries that pass the filters.
type ViolationPage = { items: RecentViolation[]; total?: number };

// A date and time typed into a field ("2026-10-13T08:30", in the viewer's time zone) as a timestamp.
function toTimestamp(local: string): number | undefined {
  const time = new Date(local).getTime();
  return local === "" || Number.isNaN(time) ? undefined : time;
}

// The violation log across every group, by default for the last 30 days. The search text and every
// filter live in the URL, so a view
// can be bookmarked and restored with Back. The bot does the searching; older entries load on demand.
export function ViolationsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const rule: ViolationRule | undefined = violationRules.find((item) => item === searchParams.get("rule"));
  const status = statuses.find((item) => item.value === searchParams.get("status"))?.value;
  // Without a period in the URL the log shows the last 30 days, and the two fields are filled in to
  // say so. The start is fixed when the page opens, so the list does not reload as time passes; the
  // end is simply "now": the field keeps up with the clock and newly logged messages still show.
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
  const filtered = query.trim() !== "" || rule !== undefined || status !== undefined || customPeriod;
  const periodReversed = fromTime !== undefined && toEnd !== undefined && fromTime > toEnd;
  // The default start is only known once the page is open in the browser; nothing is asked for before that.
  const ready = fromParam !== null || openedAt !== undefined;

  const { data: pages, error, size, setSize, isValidating } = useSWRInfinite<ViolationPage>((index, previous: ViolationPage | null) => {
    if (!ready || (previous !== null && previous.items.length < pageSize)) return null;
    const params = new URLSearchParams();
    if (query.trim() !== "") params.set("q", query.trim());
    if (rule !== undefined) params.set("rule", rule);
    if (status !== undefined) params.set("status", status);
    if (fromTime !== undefined) params.set("from", String(fromTime));
    if (toEnd !== undefined) params.set("to", String(toEnd));
    const last = previous?.items.at(-1);
    if (index > 0 && last !== undefined) params.set("before", String(last.at));
    const suffix = params.toString();
    return suffix ? `/violations?${suffix}` : "/violations";
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

  const messages = pages?.flatMap((page) => page.items) ?? [];
  const total = pages?.[0]?.total;
  const hasMore = pages !== undefined && (pages.at(-1)?.items.length ?? 0) === pageSize;
  const loadingMore = isValidating && pages !== undefined && size > pages.length;
  const ruleFilters: readonly { value: ViolationRule | undefined; label: string }[] = [
    { value: undefined, label: "Tất cả" },
    ...violationRules.map((item) => ({ value: item, label: ruleLabels[item] })),
  ];

  return (
    <>
      <PageHeader title="Nhật ký vi phạm" description="Tin vi phạm trên mọi nhóm đang bật bot, mới nhất trước. Nội dung được lưu 90 ngày." />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <label htmlFor="violation-search" className="sr-only">Tìm theo tên thành viên, nội dung tin, link hoặc tên nhóm</label>
          <Input
            id="violation-search"
            name="q"
            type="search"
            autoComplete="off"
            placeholder="Tìm theo tên, nội dung tin, link hoặc tên nhóm…"
            maxLength={100}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            className="pl-9"
          />
        </div>
        <div role="group" aria-label="Lọc theo quy tắc" className="inline-flex gap-1 rounded-md border border-border bg-surface p-1">
          {ruleFilters.map((item) => (
            <button
              key={item.label}
              type="button"
              aria-pressed={rule === item.value}
              onClick={() => setParams({ rule: item.value })}
              className={cn(
                "h-7 rounded px-2.5 text-sm transition-colors",
                rule === item.value ? "bg-surface-hover font-medium text-foreground" : "text-muted hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="violation-status" className="mb-1 block text-xs text-muted">Kết quả xử lý</label>
          <select id="violation-status" name="status" value={status ?? ""} onChange={(event) => setParams({ status: event.target.value })} className={fieldClass}>
            <option value="">Tất cả</option>
            {statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="violation-from" className="mb-1 block text-xs text-muted">Từ lúc</label>
          <input id="violation-from" name="from" type="datetime-local" value={from} max={to || undefined} onChange={(event) => setParams({ from: event.target.value || openEnd })} className={fieldClass} />
        </div>
        <div>
          <label htmlFor="violation-to" className="mb-1 block text-xs text-muted">Đến lúc</label>
          <input id="violation-to" name="to" type="datetime-local" value={to} min={from || undefined} onChange={(event) => setParams({ to: event.target.value || openEnd })} className={fieldClass} />
        </div>
        {filtered ? (
          <Button variant="ghost" onClick={() => router.replace(pathname, { scroll: false })}>
            <X aria-hidden="true" className="size-4" />
            Về mặc định
          </Button>
        ) : null}
        <p role="status" aria-live="polite" className="ml-auto pb-2 text-sm tabular-nums text-muted">
          {periodReversed ? <span className="text-danger">“Từ lúc” đang muộn hơn “Đến lúc”.</span> : total === undefined ? "" : `${formatNumber(total)} tin${filtered ? " khớp" : ` trong ${defaultDays} ngày qua`}`}
        </p>
      </div>
      <Card>
        {pages === undefined ? (
          <div className="space-y-3 p-5">
            {error ? <p className="text-sm text-danger">{errorText(error)}</p> : Array.from({ length: 5 }, (_item, index) => <Skeleton key={index} className="h-16 w-full" />)}
          </div>
        ) : messages.length === 0 ? (
          <EmptyState
            title={filtered ? "Không có tin vi phạm nào khớp" : `Không có tin vi phạm nào trong ${defaultDays} ngày qua`}
            description={filtered ? "Thử từ khóa khác, nới khoảng thời gian hoặc bỏ bớt bộ lọc." : "Bot chỉ ghi nhận ở những nhóm đã bật bot và bật quy tắc tương ứng. Xóa trống ô “Từ lúc” để xem cả những tin cũ hơn."}
            action={filtered ? <Button onClick={() => router.replace(pathname, { scroll: false })}>Về mặc định</Button> : undefined}
          />
        ) : (
          <ul className="divide-y divide-border">
            {messages.map((message, index) => (
              <ViolationItem
                key={`${message.groupId}-${message.messageId}`}
                message={message}
                number={index + 1}
                context={<><span aria-hidden="true" className="text-subtle">·</span><GroupLink groupId={message.groupId} name={message.groupName} /><span aria-hidden="true" className="text-subtle">·</span></>}
              />
            ))}
          </ul>
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
