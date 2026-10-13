"use client";

import { RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { errorText, fetcher } from "@/lib/api";
import { cn, formatAge, formatDate, formatNumber } from "@/lib/format";
import type { Group, GroupMember, MemberPage } from "@/lib/types";
import { RowNumber } from "./selection";
import { useToast } from "./toast";
import { Badge, Button, Card, CardHeader, EmptyState, Input, Skeleton } from "./ui";

const pageSize = 20;
const searchDebounceMs = 250;
// Every body row has the same height, so the table keeps its shape from page to page.
const rowClass = "h-14 border-b border-border last:border-0";

const sorts = [
  { value: "name", label: "Theo tên" },
  { value: "violations", label: "Vi phạm nhiều nhất" },
  { value: "newest", label: "Tài khoản mới nhất" },
] as const;

type Sort = (typeof sorts)[number]["value"];

// The picture of a member, or their initial when they have none or it fails to load.
function Avatar({ member }: { member: GroupMember }) {
  const [failed, setFailed] = useState(false);
  if (member.avatar === "" || failed) {
    return <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-hover text-sm font-medium text-muted">{(member.name || "?").trim().charAt(0).toUpperCase()}</span>;
  }
  // The picture comes straight from Zalo; no address of this dashboard is sent along with the request.
  return <img src={member.avatar} alt="" width={36} height={36} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="size-9 shrink-0 rounded-full border border-border object-cover" />;
}

// Everyone in the group: who they are, when they joined Zalo and how often they broke a rule here.
// The bot searches, sorts and pages; this table only ever holds the rows it shows.
export function GroupMembers({ group }: { group: Group }) {
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const toast = useToast();
  // The ages are counted from now, which only the browser knows.
  const [now, setNow] = useState<number>();
  useEffect(() => setNow(Date.now()), []);

  // What is typed shows at once; the request to the bot follows once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(searchText.trim());
      setPage(1);
    }, searchDebounceMs);
    return () => clearTimeout(timer);
  }, [searchText]);

  const base = `/groups/${encodeURIComponent(group.groupId)}/members`;
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort });
  if (query !== "") params.set("q", query);
  const { data, error, mutate } = useSWR<MemberPage>(`${base}?${params.toString()}`, { keepPreviousData: true });

  // The bot remembers the profiles for a few minutes; this reads them from Zalo again.
  async function refresh() {
    setRefreshing(true);
    try {
      params.set("refresh", "1");
      await mutate(fetcher<MemberPage>(`${base}?${params.toString()}`), { revalidate: false });
      toast.success("Đã đọc lại danh sách thành viên từ Zalo");
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setRefreshing(false);
    }
  }

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const shownPage = data?.page ?? 1;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Card>
      <CardHeader
        title="Danh sách thành viên"
        description={data === undefined ? "Thành viên của nhóm, đọc từ Zalo." : `${formatNumber(data.memberCount)} thành viên. Ngày tham gia là ngày tài khoản Zalo được tạo.`}
        action={
          <Button disabled={refreshing} aria-busy={refreshing} onClick={refresh}>
            <RefreshCw aria-hidden="true" className={cn("size-4", refreshing && "animate-spin")} />
            Làm mới
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <div className="relative min-w-56 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <label htmlFor="member-search" className="sr-only">Tìm thành viên theo tên hoặc ID</label>
          <Input id="member-search" type="search" autoComplete="off" placeholder="Tìm thành viên theo tên hoặc ID…" maxLength={100} value={searchText} onChange={(event) => setSearchText(event.target.value)} className="pl-9" />
        </div>
        <label htmlFor="member-sort" className="sr-only">Sắp xếp</label>
        <select
          id="member-sort"
          value={sort}
          onChange={(event) => {
            setSort(sorts.find((item) => item.value === event.target.value)?.value ?? "name");
            setPage(1);
          }}
          className="h-9 rounded-md border border-border-strong bg-surface px-2 text-sm"
        >
          {sorts.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>
      {data !== undefined && !data.complete ? (
        <p role="status" className="mx-5 mb-4 rounded-md border border-warning/30 bg-warning-surface px-4 py-3 text-sm text-warning">
          Zalo chỉ trả về {formatNumber(data.memberCount)}/{formatNumber(group.memberCount)} thành viên của nhóm này, nên danh sách chưa đầy đủ.
        </p>
      ) : null}
      {data === undefined ? (
        <div className="space-y-3 border-t border-border p-5">
          {error ? <p className="text-sm text-danger">{errorText(error)}</p> : Array.from({ length: 5 }, (_item, index) => <Skeleton key={index} className="h-10 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="border-t border-border"><EmptyState title={query === "" ? "Chưa đọc được thành viên nào" : "Không có thành viên nào khớp"} description={query === "" ? "Bấm “Làm mới” để đọc lại từ Zalo." : "Thử tên khác hoặc một phần ID."} /></div>
      ) : (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full min-w-[52rem] table-fixed text-sm">
            <caption className="sr-only">Thành viên của nhóm</caption>
            <colgroup>
              <col className="w-14" />
              <col />
              <col className="w-52" />
              <col className="w-52" />
              <col className="w-32" />
            </colgroup>
            <thead>
              <tr className="h-11 border-b border-border text-left text-muted">
                <th scope="col" className="pl-5 pr-2 text-right font-medium">STT</th>
                <th scope="col" className="px-5 font-medium">Thành viên</th>
                <th scope="col" className="px-5 font-medium">ID</th>
                <th scope="col" className="px-5 font-medium">Ngày tham gia Zalo</th>
                <th scope="col" className="px-5 text-right font-medium">Vi phạm</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((member, index) => (
                <tr key={member.userId} className={rowClass}>
                  <td className="pl-5 pr-2 text-right"><RowNumber value={(shownPage - 1) * pageSize + index + 1} /></td>
                  <th scope="row" className="px-5 text-left font-normal">
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar member={member} />
                      <span className="min-w-0 truncate font-medium" title={member.name || undefined} translate="no">{member.name || "Không rõ tên"}</span>
                      {member.role === "owner" ? <Badge tone="success">Trưởng nhóm</Badge> : member.role === "admin" ? <Badge>Phó nhóm</Badge> : null}
                      {member.isBot ? <Badge>Bot</Badge> : null}
                    </span>
                  </th>
                  <td className="truncate px-5 font-mono text-xs text-muted" translate="no">{member.userId}</td>
                  <td className="truncate px-5">
                    {member.accountCreatedAt === null ? <span className="text-subtle">Không rõ</span> : (
                      <>
                        <span className="tabular-nums">{formatDate(member.accountCreatedAt)}</span>
                        {now === undefined ? null : <span className="ml-2 text-muted">{formatAge(member.accountCreatedAt, now)}</span>}
                      </>
                    )}
                  </td>
                  <td className="px-5 text-right tabular-nums">
                    {member.violations === 0 ? <span className="text-subtle">0</span> : (
                      // Opens the member's logged messages on the violations tab.
                      <Link href={`?tab=violations&member=${encodeURIComponent(member.userId)}`} scroll={false} className="font-medium text-danger underline-offset-4 hover:underline" title="Xem các tin vi phạm">
                        {formatNumber(member.violations)}
                      </Link>
                    )}
                    {member.kicks > 0 ? <span className="ml-2 text-xs text-muted">kick {formatNumber(member.kicks)}</span> : null}
                  </td>
                </tr>
              ))}
              {/* A short last page is padded with empty rows so the pager below stays where it was. */}
              {pageCount > 1 ? Array.from({ length: pageSize - rows.length }, (_item, index) => (
                <tr key={`filler-${index}`} aria-hidden="true" className={rowClass}><td colSpan={5} /></tr>
              )) : null}
            </tbody>
          </table>
        </div>
      )}
      {data !== undefined && total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm text-muted">
          <p className="tabular-nums">{formatNumber((shownPage - 1) * pageSize + 1)}–{formatNumber(Math.min(shownPage * pageSize, total))} trong {formatNumber(total)} thành viên</p>
          <div className="flex gap-2">
            <Button disabled={shownPage <= 1} onClick={() => setPage(shownPage - 1)}>Trang trước</Button>
            <Button disabled={shownPage >= pageCount} onClick={() => setPage(shownPage + 1)}>Trang sau</Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
