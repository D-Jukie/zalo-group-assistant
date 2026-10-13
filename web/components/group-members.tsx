"use client";

import { RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { errorText, fetcher, send } from "@/lib/api";
import { cn, formatAge, formatDate, formatNumber } from "@/lib/format";
import type { BlockedMember, Group, GroupMember, MemberActionResult, MemberAddition, MemberPage } from "@/lib/types";
import { ConfirmDialog } from "./confirm-dialog";
import { BulkFailures, RowCheckbox, RowNumber, SelectAllCheckbox, SelectionBar, useSelection } from "./selection";
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

// What can be done to the ticked members.
type MemberAction = "kick" | "block" | "clear" | "promote" | "demote" | "transfer";

const actionWords: Record<MemberAction, { title: string; confirm: string; done: string; body: string }> = {
  kick: { title: "Xóa khỏi nhóm", confirm: "Xóa khỏi nhóm", done: "Đã xóa khỏi nhóm", body: "Các thành viên đã chọn sẽ bị xóa khỏi nhóm trên Zalo. Họ vẫn có thể vào lại nếu được mời hoặc có link nhóm." },
  block: { title: "Xóa và chặn", confirm: "Xóa và chặn", done: "Đã xóa và chặn", body: "Các thành viên đã chọn sẽ bị xóa khỏi nhóm và không vào lại được, cho tới khi được bỏ chặn ở danh sách bên dưới." },
  promote: { title: "Đặt làm phó nhóm", confirm: "Đặt làm phó nhóm", done: "Đã đặt làm phó nhóm", body: "Các thành viên đã chọn sẽ thành phó nhóm: họ duyệt và xóa được thành viên, và đổi được cài đặt của nhóm trên Zalo." },
  demote: { title: "Gỡ phó nhóm", confirm: "Gỡ phó nhóm", done: "Đã gỡ phó nhóm", body: "Các thành viên đã chọn sẽ trở lại là thành viên thường. Họ vẫn ở trong nhóm." },
  transfer: { title: "Chuyển quyền trưởng nhóm", confirm: "Chuyển quyền trưởng nhóm", done: "Đã chuyển quyền trưởng nhóm cho", body: "Thành viên đã chọn sẽ thành trưởng nhóm, còn tài khoản bot trở thành thành viên thường: bot sẽ không xóa tin, kick hay đổi cài đặt nhóm được nữa cho tới khi được đặt làm phó nhóm. Việc này không hoàn tác được từ đây; chỉ trưởng nhóm mới chuyển lại được." },
  clear: { title: "Xóa vi phạm", confirm: "Xóa vi phạm", done: "Đã xóa vi phạm của", body: "Số lần vi phạm và các tin đã lưu của các thành viên đã chọn sẽ bị xóa và không khôi phục được. Họ vẫn ở trong nhóm." },
};

function memberIdOf(member: GroupMember): string {
  return member.userId;
}

// The bot itself and the group's owner cannot be removed, so they cannot be ticked either.
function selectable(member: GroupMember): boolean {
  return !member.isBot && member.role !== "owner";
}

// The picture of a member, or their initial when they have none or it fails to load.
export function Avatar({ member }: { member: Pick<GroupMember, "name" | "avatar"> }) {
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
  const { mutate: mutateGlobal } = useSWRConfig();
  // Ticked members stay ticked across pages and searches, until an action is done or they are cleared.
  const selection = useSelection<GroupMember>(memberIdOf);
  const [confirming, setConfirming] = useState<MemberAction>();
  const [actionPending, setActionPending] = useState(false);
  const [failures, setFailures] = useState<{ name: string; error: string }[]>([]);
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

  // One action for every ticked member. The bot answers with what happened to each of them.
  async function run(action: MemberAction, members: readonly GroupMember[]) {
    setActionPending(true);
    setFailures([]);
    try {
      const response = await send<{ results: MemberActionResult[] }>("POST", `${base}/bulk`, { action, userIds: members.map(memberIdOf) });
      const nameOf = (userId: string) => members.find((member) => member.userId === userId)?.name || userId;
      const failed = response.results.filter((item) => !item.ok);
      const warned = response.results.filter((item) => item.ok && item.warning !== undefined);
      setFailures([
        ...failed.map((item) => ({ name: nameOf(item.userId), error: item.error ?? "Không rõ lý do" })),
        ...warned.map((item) => ({ name: nameOf(item.userId), error: item.warning ?? "" })),
      ]);
      const done = response.results.length - failed.length;
      const summary = `${actionWords[action].done} ${formatNumber(done)}${failed.length > 0 ? `/${formatNumber(response.results.length)}` : ""} thành viên`;
      if (failed.length === 0 && warned.length === 0) toast.success(summary);
      else toast.error(summary);
      selection.clear();
      await mutate();
      // The group's figures, its statistics and its blocked list all follow from what was just done.
      void mutateGlobal((key) => typeof key === "string" && key.startsWith(`/groups/${encodeURIComponent(group.groupId)}`) && !key.startsWith(base));
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setActionPending(false);
      setConfirming(undefined);
    }
  }

  const rows = data?.items ?? [];
  const tickable = rows.filter(selectable);
  const total = data?.total ?? 0;
  const shownPage = data?.page ?? 1;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
    <BulkFailures title="Một số thành viên chưa xử lý được" failures={failures} onDismiss={() => setFailures([])} />
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
          <table className="w-full min-w-[56rem] table-fixed text-sm">
            <caption className="sr-only">Thành viên của nhóm</caption>
            <colgroup>
              <col className="w-12" />
              <col className="w-14" />
              <col />
              <col className="w-52" />
              <col className="w-52" />
              <col className="w-32" />
            </colgroup>
            <thead>
              <tr className="h-11 border-b border-border text-left text-muted">
                <th scope="col" className="pl-5"><SelectAllCheckbox items={tickable} selection={selection} getId={memberIdOf} label="Chọn mọi thành viên của trang này" /></th>
                <th scope="col" className="px-2 text-right font-medium">STT</th>
                <th scope="col" className="px-5 font-medium">Thành viên</th>
                <th scope="col" className="px-5 font-medium">ID</th>
                <th scope="col" className="px-5 font-medium">Ngày tham gia Zalo</th>
                <th scope="col" className="px-5 text-right font-medium">Vi phạm</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((member, index) => (
                <tr key={member.userId} className={cn(rowClass, selection.has(member.userId) && "bg-surface-hover")}>
                  <td className="pl-5">{selectable(member) ? <RowCheckbox checked={selection.has(member.userId)} onChange={(checked) => selection.toggle(member, checked)} label={`Chọn ${member.name || member.userId}`} /> : null}</td>
                  <td className="px-2 text-right"><RowNumber value={(shownPage - 1) * pageSize + index + 1} /></td>
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
                <tr key={`filler-${index}`} aria-hidden="true" className={rowClass}><td colSpan={6} /></tr>
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
    <AddMembers group={group} onAdded={() => void mutate()} />
    <BlockedMembers group={group} />
    <SelectionBar count={selection.count} noun="thành viên" onClear={selection.clear}>
      {group.botIsAdmin ? (
        <>
          <Button variant="danger" disabled={actionPending} onClick={() => setConfirming("kick")}>Xóa khỏi nhóm</Button>
          <Button variant="danger" disabled={actionPending} onClick={() => setConfirming("block")}>Xóa và chặn</Button>
        </>
      ) : null}
      {/* Deputies are the owner's to name; so is handing the group over, to one member at a time. */}
      {data?.botRole === "owner" ? (
        <>
          {selection.items.some((member) => member.role === "member") ? <Button disabled={actionPending} onClick={() => setConfirming("promote")}>Đặt làm phó nhóm</Button> : null}
          {selection.items.some((member) => member.role === "admin") ? <Button disabled={actionPending} onClick={() => setConfirming("demote")}>Gỡ phó nhóm</Button> : null}
          {selection.count === 1 ? <Button disabled={actionPending} onClick={() => setConfirming("transfer")}>Chuyển trưởng nhóm</Button> : null}
        </>
      ) : null}
      <Button disabled={actionPending} onClick={() => setConfirming("clear")}>Xóa vi phạm</Button>
    </SelectionBar>
    <ConfirmDialog
      open={confirming !== undefined}
      title={confirming === undefined ? "" : `${actionWords[confirming].title}: ${formatNumber(selection.count)} thành viên?`}
      confirmLabel={confirming === undefined ? "" : actionWords[confirming].confirm}
      pending={actionPending}
      onConfirm={() => { if (confirming !== undefined) void run(confirming, selection.items); }}
      onCancel={() => setConfirming(undefined)}
    >
      {confirming === undefined ? null : actionWords[confirming].body}
    </ConfirmDialog>
    </div>
  );
}

const maxPhonesPerAdd = 30;

// Adds members from a pasted list of phone numbers, a class list for instance. The bot looks each
// number up on Zalo and answers with what happened to every one of them.
function AddMembers({ group, onAdded }: { group: Group; onAdded: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<{ results: MemberAddition[]; invalid: string[] }>();
  const count = text.split(/[\n,;]+/u).filter((piece) => piece.trim() !== "").length;

  async function add() {
    setPending(true);
    setOutcome(undefined);
    try {
      const response = await send<{ results: MemberAddition[]; invalid: string[] }>("POST", `/groups/${encodeURIComponent(group.groupId)}/members/add`, { phones: text });
      setOutcome(response);
      const added = response.results.filter((item) => item.ok);
      // What went in is taken out of the box; what did not stays there to be corrected.
      setText([...response.results.filter((item) => !item.ok).map((item) => item.phone), ...response.invalid].join("\n"));
      if (added.length === response.results.length && response.invalid.length === 0) toast.success(`Đã thêm ${formatNumber(added.length)} thành viên`);
      else toast.error(`Đã thêm ${formatNumber(added.length)}/${formatNumber(response.results.length + response.invalid.length)} số`);
      if (added.length > 0) onAdded();
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setPending(false);
    }
  }

  const failed = outcome?.results.filter((item) => !item.ok) ?? [];
  const added = outcome?.results.filter((item) => item.ok) ?? [];
  return (
    <Card>
      <CardHeader title="Thêm thành viên bằng số điện thoại" description={`Dán danh sách số điện thoại, mỗi dòng một số; tối đa ${maxPhonesPerAdd} số mỗi lần. Bot tìm tài khoản Zalo của từng số rồi thêm vào nhóm.`} />
      <div className="space-y-3 px-5 py-4">
        <label htmlFor="add-member-phones" className="sr-only">Danh sách số điện thoại</label>
        <textarea
          id="add-member-phones"
          rows={4}
          autoComplete="off"
          spellCheck={false}
          inputMode="tel"
          placeholder={"0912345678\n0987654321…"}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="w-full min-w-0 resize-y rounded-md border border-border-strong bg-surface px-3 py-2 font-mono text-sm placeholder:text-subtle"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 basis-56 text-sm text-muted">
            {count > maxPhonesPerAdd ? <span className="text-danger">Đang có {formatNumber(count)} số; hãy thêm tối đa {maxPhonesPerAdd} số mỗi lần.</span> : "Chỉ tìm được những tài khoản cho phép tìm bằng số điện thoại. Thêm nhiều người liên tục có thể bị Zalo coi là spam, nên hãy thêm từng đợt."}
          </p>
          <Button variant="primary" pending={pending} disabled={count === 0 || count > maxPhonesPerAdd} onClick={add}>Thêm vào nhóm</Button>
        </div>
        {pending ? <p role="status" className="text-sm text-muted">Đang tìm từng số trên Zalo, việc này mất vài giây cho mỗi chục số…</p> : null}
        {outcome === undefined ? null : (
          <div role="status" className="space-y-2 rounded-md border border-border bg-background px-3 py-2.5 text-sm">
            {added.length > 0 ? <p><span className="font-medium text-success">Đã thêm {formatNumber(added.length)}:</span> {added.map((item) => item.name || item.phone).join(", ")}</p> : null}
            {failed.length > 0 || outcome.invalid.length > 0 ? (
              <ul className="space-y-1">
                {failed.map((item) => <li key={item.phone}><span className="font-mono">{item.phone}</span>{item.name ? ` (${item.name})` : ""}: <span className="text-danger">{item.error}</span></li>)}
                {outcome.invalid.map((entry) => <li key={entry}><span className="font-mono">{entry}</span>: <span className="text-danger">Không phải số điện thoại hợp lệ</span></li>)}
              </ul>
            ) : null}
          </div>
        )}
      </div>
    </Card>
  );
}

// The accounts this group has blocked from joining again, with a way to let them back in.
// It only shows once the group has blocked someone.
function BlockedMembers({ group }: { group: Group }) {
  const path = `/groups/${encodeURIComponent(group.groupId)}/blocked-members`;
  const { data: blocked, mutate } = useSWR<BlockedMember[]>(group.botIsAdmin ? path : null);
  const [unblocking, setUnblocking] = useState<string>();
  const toast = useToast();

  async function unblock(member: BlockedMember) {
    setUnblocking(member.userId);
    try {
      await mutate(send<BlockedMember[]>("POST", `${path}/remove`, { userIds: [member.userId] }), { revalidate: false });
      toast.success(`Đã bỏ chặn ${member.name || member.userId}`);
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setUnblocking(undefined);
    }
  }

  if (blocked === undefined || blocked.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Tài khoản bị chặn" description="Những tài khoản này không vào lại nhóm được cho tới khi được bỏ chặn." action={<Badge>{formatNumber(blocked.length)} tài khoản</Badge>} />
      <ul className="max-h-80 divide-y divide-border overflow-y-auto overscroll-contain">
        {blocked.map((member, index) => (
          <li key={member.userId} className="flex items-center gap-3 px-5 py-2.5">
            <RowNumber value={index + 1} className="w-6 shrink-0 text-right text-sm" />
            <Avatar member={member} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium" translate="no">{member.name || "Không rõ tên"}</span>
              <span className="block truncate font-mono text-xs text-muted" translate="no">{member.userId}</span>
            </span>
            <Button variant="ghost" pending={unblocking === member.userId} onClick={() => unblock(member)}>Bỏ chặn</Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
