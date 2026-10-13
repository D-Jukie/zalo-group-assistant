"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import useSWR, { useSWRConfig } from "swr";
import { errorText, send } from "@/lib/api";
import { cn, formatAge, formatDate, formatDateTime, formatNumber } from "@/lib/format";
import type { Group, JoinApprovalSettings, JoinReview, JoinReviewResult, PendingJoinList, PendingJoinMember } from "@/lib/types";
import { ConfirmDialog } from "./confirm-dialog";
import { Avatar } from "./group-members";
import { BulkFailures, RowCheckbox, RowNumber, SelectAllCheckbox, SelectionBar, useSelection } from "./selection";
import { useToast } from "./toast";
import { Badge, Button, Card, CardHeader, CompactSwitch, EmptyState, Input, Skeleton } from "./ui";

// The units an account's minimum age can be given in, as a number of days.
const ageUnits = [
  { days: 1, label: "ngày" },
  { days: 30, label: "tháng" },
  { days: 365, label: "năm" },
] as const;

// A number of days as an amount and the largest unit that divides it evenly: 90 → 3 tháng.
function splitAge(days: number): { amount: number; unitDays: number } {
  const unit = [...ageUnits].reverse().find((item) => days > 0 && days % item.days === 0) ?? ageUnits[1];
  return days > 0 ? { amount: days / unit.days, unitDays: unit.days } : { amount: 1, unitDays: unit.days };
}

function pendingPath(group: Group): string {
  return `/groups/${encodeURIComponent(group.groupId)}/pending-members`;
}

// The feature card for letting people into the group by the bot's own decision: its switch in the
// header, the criteria on the left and what happens to everyone on the right.
export function JoinApprovalCard({ group, onChange }: { group: Group; onChange: (group: Group) => void }) {
  const saved = group.joinApproval;
  const initialAge = splitAge(saved.minAccountAgeDays);
  const [requireAvatar, setRequireAvatar] = useState(saved.requireAvatar);
  const [ageRequired, setAgeRequired] = useState(saved.minAccountAgeDays > 0);
  // The amount stays text while being edited, so the field can be emptied and retyped.
  const [amount, setAmount] = useState(String(initialAge.amount));
  const [unitDays, setUnitDays] = useState<number>(initialAge.unitDays);
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const { mutate } = useSWRConfig();
  const { data: waiting } = useSWR<PendingJoinList>(group.botIsAdmin ? pendingPath(group) : null);
  const minAccountAgeDays = ageRequired ? Number(amount) * unitDays : 0;
  const dirty = requireAvatar !== saved.requireAvatar || minAccountAgeDays !== saved.minAccountAgeDays;

  async function save(settings: JoinApprovalSettings, done: string) {
    setPending(true);
    try {
      onChange(await send<Group>("PATCH", `/groups/${encodeURIComponent(group.groupId)}/join-approval`, settings));
      // Saving makes the bot go through the waiting list, so the list and its history may have changed.
      void mutate((key) => typeof key === "string" && (key === pendingPath(group) || key.endsWith("/join-reviews")));
      toast.success(done);
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setPending(false);
    }
  }

  function saveCriteria(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ageRequired && !(Number.isInteger(Number(amount)) && Number(amount) >= 1)) return toast.error("Tuổi tài khoản tối thiểu phải là số nguyên từ 1 trở lên");
    void save({ enabled: saved.enabled, requireAvatar, minAccountAgeDays }, "Đã lưu tiêu chí duyệt");
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 flex-1 basis-72">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            Duyệt thành viên tự động
            {saved.enabled ? <Badge tone="success">Đang bật</Badge> : <Badge>Tắt</Badge>}
          </h2>
          <p className="mt-1 text-sm text-muted">Với nhóm bật phê duyệt thành viên, bot tự duyệt người xin vào nếu họ đạt mọi tiêu chí bên dưới.</p>
        </div>
        <CompactSwitch
          checked={saved.enabled && group.botIsAdmin}
          disabled={!group.botIsAdmin || pending}
          onChange={(enabled) => save({ ...saved, enabled }, `Đã ${enabled ? "bật" : "tắt"} duyệt thành viên tự động`)}
          label="Bật duyệt thành viên tự động"
        />
      </div>
      <div className="grid divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <form onSubmit={saveCriteria} className="min-w-0 px-5 py-4">
          <fieldset className="space-y-3 text-sm">
            <legend className="mb-3 text-sm font-medium">Được duyệt khi</legend>
            <label className="flex cursor-pointer items-start gap-2">
              <input type="checkbox" name="requireAvatar" checked={requireAvatar} onChange={(event) => setRequireAvatar(event.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
              <span><span className="font-medium">Có ảnh đại diện</span><span className="block text-muted">Tài khoản đang dùng ảnh mặc định của Zalo thì không đạt.</span></span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 font-medium">
                <input type="checkbox" name="ageRequired" checked={ageRequired} onChange={(event) => setAgeRequired(event.target.checked)} className="size-4 accent-[var(--accent)]" />
                Tham gia Zalo ít nhất
              </label>
              <label htmlFor="join-age-amount" className="sr-only">Số ngày, tháng hoặc năm tối thiểu</label>
              <Input id="join-age-amount" name="amount" type="number" inputMode="numeric" autoComplete="off" min={1} max={3650} required={ageRequired} disabled={!ageRequired} value={amount} onChange={(event) => setAmount(event.target.value)} className="max-w-20 tabular-nums" />
              <label htmlFor="join-age-unit" className="sr-only">Đơn vị thời gian</label>
              <select id="join-age-unit" name="unit" disabled={!ageRequired} value={unitDays} onChange={(event) => setUnitDays(Number(event.target.value))} className="h-9 rounded-md border border-border-strong px-2 text-sm disabled:opacity-50">
                {ageUnits.map((unit) => <option key={unit.days} value={unit.days}>{unit.label}</option>)}
              </select>
            </div>
            {!requireAvatar && !ageRequired ? <p className="text-warning">Không chọn tiêu chí nào thì bot duyệt mọi người xin vào.</p> : null}
            {dirty ? <Button type="submit" variant="primary" pending={pending}>Lưu tiêu chí</Button> : null}
          </fieldset>
        </form>
        <div className="min-w-0 space-y-2 px-5 py-4 text-sm">
          <p className="font-medium">Khi có người xin vào</p>
          <p className="text-muted">Người đạt mọi tiêu chí được duyệt ngay. Người không đạt không bị từ chối: họ nằm lại ở tab <Link href="?tab=pending" scroll={false} className="text-foreground underline underline-offset-4 hover:text-accent">Chờ duyệt</Link> để bạn tự quyết định.</p>
          <p className="text-muted">Nhóm chỉ chứa tối đa {formatNumber(waiting?.maxMembers ?? 1000)} thành viên, nên bot ngừng duyệt khi nhóm đã đầy.</p>
          {!group.botIsAdmin ? <p className="text-warning">Chỉ bật được khi bot là trưởng hoặc phó nhóm.</p> : null}
          {waiting !== undefined && !waiting.approvalRequired ? <p className="text-warning">Nhóm này chưa bật phê duyệt thành viên trên Zalo, nên hiện không ai phải chờ duyệt.</p> : null}
          {waiting !== undefined && waiting.freeSlots === 0 ? <p className="text-warning">Nhóm đã đầy: bot không duyệt thêm ai cho tới khi có chỗ trống.</p> : null}
        </div>
      </div>
    </Card>
  );
}

function applicantId(member: PendingJoinMember): string {
  return member.userId;
}

// The latest decisions on requests to join, the bot's and an admin's alike.
function ReviewHistory({ group }: { group: Group }) {
  const { data: reviews } = useSWR<JoinReview[]>(`/groups/${encodeURIComponent(group.groupId)}/join-reviews`);
  if (reviews === undefined || reviews.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Lịch sử duyệt" description="50 quyết định gần nhất, của bot lẫn của bạn. Được lưu 90 ngày." />
      <ul className="max-h-96 divide-y divide-border overflow-y-auto overscroll-contain">
        {reviews.map((review, index) => (
          <li key={`${review.userId}-${review.at}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
            <RowNumber value={index + 1} className="w-6 shrink-0 text-right" />
            <span className="min-w-0 flex-1 basis-40">
              <span className="block truncate font-medium" translate="no">{review.userName || review.userId}</span>
              <span className="block truncate font-mono text-xs text-muted" translate="no">{review.userId}</span>
            </span>
            <Badge tone={review.decision === "approved" ? "success" : "danger"}>{review.decision === "approved" ? "Đã duyệt" : "Đã từ chối"}</Badge>
            <Badge>{review.by === "auto" ? "Bot tự động" : "Thủ công"}</Badge>
            <time dateTime={new Date(review.at).toISOString()} className="shrink-0 tabular-nums text-muted">{formatDateTime(review.at)}</time>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// Everyone waiting to be let into the group, for an admin to decide: tick some, then approve or reject.
// Each row says whether the applicant meets the group's criteria, so the bot's leftovers explain themselves.
export function PendingMembers({ group }: { group: Group }) {
  const path = pendingPath(group);
  const { data, error, mutate } = useSWR<PendingJoinList>(path);
  const { mutate: mutateGlobal } = useSWRConfig();
  const selection = useSelection<PendingJoinMember>(applicantId);
  const [acting, setActing] = useState<"approve" | "reject">();
  const [confirmingReject, setConfirmingReject] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [failures, setFailures] = useState<{ name: string; error: string }[]>([]);
  const toast = useToast();
  // The ages are counted from now, which only the browser knows.
  const [now, setNow] = useState<number>();
  useEffect(() => setNow(Date.now()), [data]);

  async function refresh() {
    setRefreshing(true);
    try {
      await mutate();
    } finally {
      setRefreshing(false);
    }
  }

  // An admin's decision on every ticked applicant. The bot answers with what happened to each.
  async function review(approve: boolean, members: readonly PendingJoinMember[]) {
    setActing(approve ? "approve" : "reject");
    setFailures([]);
    try {
      const response = await send<{ results: JoinReviewResult[] }>("POST", `${path}/review`, { userIds: members.map(applicantId), approve });
      const failed = response.results.filter((item) => !item.ok);
      setFailures(failed.map((item) => ({ name: item.name || item.userId, error: item.error ?? "Không rõ lý do" })));
      const done = response.results.length - failed.length;
      const summary = `${approve ? "Đã duyệt" : "Đã từ chối"} ${formatNumber(done)}${failed.length > 0 ? `/${formatNumber(response.results.length)}` : ""} người`;
      if (failed.length === 0) toast.success(summary);
      else toast.error(summary);
      selection.clear();
      await mutate();
      // The group's member count, its member list and the history all follow from the decision.
      void mutateGlobal((key) => typeof key === "string" && key.startsWith(`/groups/${encodeURIComponent(group.groupId)}`) && key !== path);
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setActing(undefined);
      setConfirmingReject(false);
    }
  }

  const rows = data?.items ?? [];
  const full = data !== undefined && data.freeSlots === 0;

  return (
    <div className="space-y-4">
      <BulkFailures title="Một số người chưa xử lý được" failures={failures} onDismiss={() => setFailures([])} />
      <Card>
        <CardHeader
          title="Chờ phê duyệt"
          description={data === undefined ? "Những người đang xin vào nhóm, đọc từ Zalo." : `${formatNumber(rows.length)} người đang chờ · nhóm có ${formatNumber(data.memberCount)}/${formatNumber(data.maxMembers)} thành viên, còn ${formatNumber(data.freeSlots)} chỗ.`}
          action={
            <Button disabled={refreshing} aria-busy={refreshing} onClick={refresh}>
              <RefreshCw aria-hidden="true" className={cn("size-4", refreshing && "animate-spin")} />
              Làm mới
            </Button>
          }
        />
        {data !== undefined && !data.botIsAdmin ? (
          <p role="status" className="m-5 rounded-md border border-warning/30 bg-warning-surface px-4 py-3 text-sm text-warning">Bot phải là trưởng hoặc phó nhóm thì mới đọc và duyệt được danh sách chờ.</p>
        ) : data !== undefined && full ? (
          <p role="status" className="mx-5 mt-4 rounded-md border border-warning/30 bg-warning-surface px-4 py-3 text-sm text-warning">Nhóm đã đủ {formatNumber(data.maxMembers)} thành viên, nên chưa duyệt thêm được ai. Vẫn từ chối được.</p>
        ) : null}
        {data === undefined ? (
          <div className="space-y-3 p-5">{error ? <p className="text-sm text-danger">{errorText(error)}</p> : Array.from({ length: 3 }, (_item, index) => <Skeleton key={index} className="h-10 w-full" />)}</div>
        ) : !data.botIsAdmin ? null : rows.length === 0 ? (
          <EmptyState
            title="Không có ai đang chờ duyệt"
            description={data.approvalRequired ? "Người xin vào nhóm mà chưa đạt tiêu chí của bot, hoặc xin vào khi bot tắt duyệt tự động, sẽ hiện ở đây." : "Nhóm này chưa bật phê duyệt thành viên trên Zalo, nên ai có link cũng vào thẳng được."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] table-fixed text-sm">
              <caption className="sr-only">Người đang chờ duyệt vào nhóm</caption>
              <colgroup>
                <col className="w-12" />
                <col className="w-14" />
                <col />
                <col className="w-48" />
                <col className="w-48" />
                <col className="w-72" />
              </colgroup>
              <thead>
                <tr className="h-11 border-b border-border text-left text-muted">
                  <th scope="col" className="pl-5"><SelectAllCheckbox items={rows} selection={selection} getId={applicantId} label="Chọn mọi người đang chờ" /></th>
                  <th scope="col" className="px-2 text-right font-medium">STT</th>
                  <th scope="col" className="px-5 font-medium">Người xin vào</th>
                  <th scope="col" className="px-5 font-medium">ID</th>
                  <th scope="col" className="px-5 font-medium">Ngày tham gia Zalo</th>
                  <th scope="col" className="px-5 font-medium">Theo tiêu chí của nhóm</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((member, index) => (
                  <tr key={member.userId} className={cn("h-14 border-b border-border last:border-0", selection.has(member.userId) && "bg-surface-hover")}>
                    <td className="pl-5"><RowCheckbox checked={selection.has(member.userId)} onChange={(checked) => selection.toggle(member, checked)} label={`Chọn ${member.name || member.userId}`} /></td>
                    <td className="px-2 text-right"><RowNumber value={index + 1} /></td>
                    <th scope="row" className="px-5 text-left font-normal">
                      <span className="flex min-w-0 items-center gap-3">
                        <Avatar member={member} />
                        <span className="min-w-0 truncate font-medium" title={member.name || undefined} translate="no">{member.name || "Không rõ tên"}</span>
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
                    <td className="px-5">
                      <span className="flex flex-wrap gap-1.5">
                        {member.reasons.length === 0 ? <Badge tone="success">Đạt</Badge> : member.reasons.map((reason) => <Badge key={reason} tone="warning">{reason}</Badge>)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ReviewHistory group={group} />
      <SelectionBar count={selection.count} noun="người" onClear={selection.clear}>
        <Button variant="primary" pending={acting === "approve"} disabled={acting !== undefined || full} onClick={() => review(true, selection.items)}>Duyệt</Button>
        <Button variant="danger" disabled={acting !== undefined} onClick={() => setConfirmingReject(true)}>Từ chối</Button>
      </SelectionBar>
      <ConfirmDialog
        open={confirmingReject}
        title={`Từ chối ${formatNumber(selection.count)} người?`}
        confirmLabel="Từ chối"
        pending={acting === "reject"}
        onConfirm={() => void review(false, selection.items)}
        onCancel={() => setConfirmingReject(false)}
      >
        Yêu cầu vào nhóm của những người đã chọn sẽ bị từ chối. Muốn vào, họ phải xin lại.
      </ConfirmDialog>
    </div>
  );
}
