"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import useSWR, { useSWRConfig } from "swr";
import { ApiError, errorText, send } from "@/lib/api";
import { formatDateTime, formatKickRule, formatNumber, splitWindow, windowUnits } from "@/lib/format";
import { ruleLabels, violationRules, type Group, type GroupToggle, type KickRule, type MemberViolations, type ViolationMessage, type ViolationRule } from "@/lib/types";
import { ConfirmDialog } from "./confirm-dialog";
import { ListManager } from "./list-manager";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Input, PageHeader, Skeleton, Switch } from "./ui";
import { ViolationItem } from "./violation-item";

// Saves one of the group's switches and hands back the updated group, or an error message to show.
function useToggle(group: Group, onChange: (group: Group) => void) {
  const [error, setError] = useState<string>();
  async function toggle(name: GroupToggle, enabled: boolean) {
    setError(undefined);
    try {
      onChange(await send<Group>("PATCH", `/groups/${encodeURIComponent(group.groupId)}/${name}`, { enabled }));
    } catch (exception) {
      setError(errorText(exception));
    }
  }
  return { toggle, error };
}

// The master switch. While it is off the bot ignores the group entirely, so everything below is inactive.
function BotSwitch({ group, onChange }: { group: Group; onChange: (group: Group) => void }) {
  const { toggle, error } = useToggle(group, onChange);
  return (
    <Card className="px-5">
      <Switch
        checked={group.botEnabled}
        onChange={(value) => toggle("bot", value)}
        label="Bật bot ở nhóm này"
        description={group.botEnabled ? "Bot đang theo dõi tin nhắn của nhóm theo các tính năng bên dưới." : "Bot đang bỏ qua hoàn toàn nhóm này: không kiểm tra, không ghi nhận, không xóa tin, không kick."}
      />
      {error ? <div className="pb-3"><ErrorNote message={error} /></div> : null}
    </Card>
  );
}

// Kicking for one feature: a switch, plus the count and time window that apply while it is on.
function KickSetting({ group, rule, featureOn, onSaved }: { group: Group; rule: ViolationRule; featureOn: boolean; onSaved: (group: Group) => void }) {
  const kickRule = group.kickRules[rule];
  const initial = splitWindow(kickRule.windowSeconds);
  const [count, setCount] = useState(String(kickRule.count));
  const [amount, setAmount] = useState(String(initial.amount));
  const [unitSeconds, setUnitSeconds] = useState(initial.unitSeconds);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const active = kickRule.enabled && group.botIsAdmin;
  const dirty = count !== String(kickRule.count) || Number(amount) * unitSeconds !== kickRule.windowSeconds;
  const fieldId = `kick-${rule}`;

  async function save(next: KickRule) {
    setError(undefined);
    setPending(true);
    try {
      onSaved(await send<Group>("PATCH", `/groups/${encodeURIComponent(group.groupId)}/kick-rule`, { rule, ...next }));
    } catch (exception) {
      setError(errorText(exception));
    } finally {
      setPending(false);
    }
  }

  function saveNumbers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save({ enabled: true, count: Number(count), windowSeconds: Number(amount) * unitSeconds });
  }

  return (
    <div>
      <Switch
        checked={active}
        disabled={!group.botIsAdmin || !featureOn}
        onChange={(enabled) => save({ enabled, count: kickRule.count, windowSeconds: kickRule.windowSeconds })}
        label="Kick khi vi phạm nhiều lần"
        description={!group.botIsAdmin ? "Chỉ bật được khi bot là trưởng hoặc phó nhóm." : !featureOn ? "Bật tính năng này trước." : active ? "Chỉ tính vi phạm của riêng tính năng này, trong khoảng thời gian bên dưới." : "Đang tắt: vi phạm chỉ bị xóa tin và ghi nhận."}
      />
      {active && featureOn ? (
        <form onSubmit={saveNumbers} className="pb-3">
          <fieldset className="flex flex-wrap items-center gap-2 text-sm">
            <legend className="sr-only">Ngưỡng kick của {ruleLabels[rule]}</legend>
            <label htmlFor={`${fieldId}-count`}>Kick khi đủ</label>
            <Input id={`${fieldId}-count`} name="count" type="number" inputMode="numeric" autoComplete="off" min={1} max={100} required value={count} onChange={(event) => setCount(event.target.value)} className="w-20 tabular-nums" />
            <label htmlFor={`${fieldId}-amount`}>lần trong</label>
            <Input id={`${fieldId}-amount`} name="amount" type="number" inputMode="numeric" autoComplete="off" min={1} required value={amount} onChange={(event) => setAmount(event.target.value)} className="w-20 tabular-nums" />
            <label htmlFor={`${fieldId}-unit`} className="sr-only">Đơn vị thời gian</label>
            <select id={`${fieldId}-unit`} name="unit" value={unitSeconds} onChange={(event) => setUnitSeconds(Number(event.target.value))} className="h-9 rounded-md border border-border-strong px-2 text-sm">
              {windowUnits.map((unit) => <option key={unit.seconds} value={unit.seconds}>{unit.label}</option>)}
            </select>
            {dirty ? <Button type="submit" variant="primary" pending={pending}>Lưu</Button> : null}
          </fieldset>
        </form>
      ) : null}
      <ErrorNote message={error} />
    </div>
  );
}

// One feature of the bot in this group: its on/off switch and, underneath, its own kick setting.
function FeatureCard({ group, rule, toggleName, enabled, title, description, onChange }: {
  group: Group;
  rule: ViolationRule;
  toggleName: GroupToggle;
  enabled: boolean;
  title: string;
  description: string;
  onChange: (group: Group) => void;
}) {
  const { toggle, error } = useToggle(group, onChange);
  const kickRule = group.kickRules[rule];
  return (
    <Card>
      <CardHeader title={title} description={description} action={enabled ? <Badge tone="success">Đang bật</Badge> : <Badge>Tắt</Badge>} />
      <div className="divide-y divide-border px-5">
        <div>
          <Switch
            checked={enabled}
            onChange={(value) => toggle(toggleName, value)}
            label={`Bật ${title.toLowerCase()}`}
            description={group.botIsAdmin ? "Tin vi phạm bị xóa và được ghi vào thống kê." : "Bot không phải QTV nên chỉ ghi nhận vi phạm, không xóa được tin."}
          />
          <ErrorNote message={error} />
        </div>
        <KickSetting
          // Saved numbers remount the form so its fields show the stored values again.
          key={`${kickRule.enabled}-${kickRule.count}-${kickRule.windowSeconds}`}
          group={group}
          rule={rule}
          featureOn={enabled}
          onSaved={onChange}
        />
      </div>
    </Card>
  );
}

function SettingsCards({ group, onChange }: { group: Group; onChange: (group: Group) => void }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <FeatureCard
        group={group}
        rule="link"
        toggleName="links"
        enabled={group.linkGuardEnabled}
        title="Chặn link"
        description="Link mời nhóm Zalo và các trang trong danh sách chung lẫn danh sách riêng của nhóm, kể cả trong mã QR."
        onChange={onChange}
      />
      <FeatureCard
        group={group}
        rule="badWord"
        toggleName="bad-words"
        enabled={group.badWordFilterEnabled}
        title="Lọc từ cấm"
        description="Tin chứa từ hoặc cụm từ trong danh sách chung hoặc danh sách riêng của nhóm."
        onChange={onChange}
      />
    </div>
  );
}

// Links and words blocked in this group only, on top of the shared lists on the settings page.
function GroupLists({ group }: { group: Group }) {
  const base = `/groups/${encodeURIComponent(group.groupId)}`;
  const settingLink = <Link href="/setting" className="text-foreground underline underline-offset-4 hover:text-accent">Cài đặt</Link>;
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <ListManager
        title="Link bị chặn riêng"
        description={<>Chỉ áp dụng cho nhóm này, cộng thêm vào danh sách chung ở {settingLink}.{group.linkGuardEnabled ? "" : " Nhóm đang tắt “Chặn link” nên danh sách chưa có tác dụng."}</>}
        path={`${base}/blocked-links`}
        field="link"
        inputLabel="Tên miền hoặc link cần chặn trong nhóm này"
        placeholder="example.com…"
        maxLength={200}
        emptyTitle="Nhóm này chưa có link chặn riêng"
        emptyDescription="Nhóm đang dùng link mời nhóm Zalo và danh sách chung."
      />
      <ListManager
        title="Từ cấm riêng"
        description={<>Chỉ áp dụng cho nhóm này, cộng thêm vào danh sách chung ở {settingLink}.{group.badWordFilterEnabled ? "" : " Nhóm đang tắt “Lọc từ cấm” nên danh sách chưa có tác dụng."}</>}
        path={`${base}/banned-words`}
        field="word"
        inputLabel="Từ hoặc cụm từ cần chặn trong nhóm này"
        placeholder="Từ hoặc cụm từ…"
        maxLength={50}
        emptyTitle="Nhóm này chưa có từ cấm riêng"
        emptyDescription="Nhóm đang dùng danh sách từ cấm chung."
      />
    </div>
  );
}

function MemberMessages({ groupId, member, onClose }: { groupId: string; member: MemberViolations | undefined; onClose: () => void }) {
  const userId = member?.userId;
  const { data: messages, error } = useSWR<ViolationMessage[]>(userId === undefined ? null : `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/messages`);
  if (member === undefined) return null;
  return (
    <Card>
      <CardHeader
        title={`Tin vi phạm của ${member.userName || member.userId}`}
        description="50 tin gần nhất. Bot lưu phần chữ và link trong 90 ngày; ảnh và tệp không được lưu."
        action={<Button onClick={onClose}>Đóng</Button>}
      />
      {messages === undefined ? (
        <div className="space-y-3 p-5">{error ? <p className="text-sm text-danger">{errorText(error)}</p> : <><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></>}</div>
      ) : messages.length === 0 ? (
        <EmptyState title="Chưa lưu tin nào của thành viên này" description="Nội dung tin chỉ được lưu từ khi tính năng này được bật, và tự xóa sau 90 ngày." />
      ) : (
        <ul className="divide-y divide-border">{messages.map((message) => <ViolationItem key={message.messageId} message={message} />)}</ul>
      )}
    </Card>
  );
}

type PendingClear = { userId?: string; label: string };

function Statistics({ group }: { group: Group }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { mutate: mutateGlobal } = useSWRConfig();
  const path = `/groups/${encodeURIComponent(group.groupId)}/violations`;
  const { data: members, error, mutate } = useSWR<MemberViolations[]>(path);
  const [pendingClear, setPendingClear] = useState<PendingClear>();
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string>();
  const selectedId = searchParams.get("member");
  const selected = members?.find((member) => member.userId === selectedId);

  // The open member is part of the URL so the panel survives a reload and the Back button closes it.
  function selectMember(userId: string | undefined) {
    const next = new URLSearchParams(searchParams);
    if (userId === undefined) next.delete("member");
    else next.set("member", userId);
    const suffix = next.toString();
    router.push(suffix ? `${pathname}?${suffix}` : pathname, { scroll: false });
  }

  async function clear() {
    if (pendingClear === undefined) return;
    setClearError(undefined);
    setClearing(true);
    try {
      await mutate(send<MemberViolations[]>("DELETE", path, pendingClear.userId === undefined ? {} : { userId: pendingClear.userId }), { revalidate: false });
      await mutateGlobal("/overview");
      if (pendingClear.userId === undefined || pendingClear.userId === selectedId) selectMember(undefined);
      setPendingClear(undefined);
    } catch (exception) {
      setClearError(errorText(exception));
    } finally {
      setClearing(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Thống kê vi phạm"
          description="Tổng số lần từ trước tới nay. Thống kê không quyết định việc kick; kick chỉ tính vi phạm trong khoảng thời gian đã đặt."
          action={members && members.length > 0 ? <Button variant="danger" onClick={() => setPendingClear({ label: "toàn bộ nhóm này" })}>Xóa thống kê nhóm</Button> : undefined}
        />
        {members === undefined ? (
          <div className="space-y-3 p-5">{error ? <p className="text-sm text-danger">{errorText(error)}</p> : <><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></>}</div>
        ) : members.length === 0 ? (
          <EmptyState title="Nhóm này chưa có vi phạm nào" description="Khi một thành viên gửi link bị chặn hoặc từ cấm, họ sẽ xuất hiện ở đây." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Vi phạm theo thành viên</caption>
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th scope="col" className="px-5 py-3 font-medium">Thành viên</th>
                  {violationRules.map((rule) => <th key={rule} scope="col" className="px-5 py-3 text-right font-medium">{ruleLabels[rule]}</th>)}
                  <th scope="col" className="px-5 py-3 text-right font-medium">Tổng</th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">Đã bị kick</th>
                  <th scope="col" className="px-5 py-3 font-medium">Lần gần nhất</th>
                  <th scope="col" className="px-5 py-3"><span className="sr-only">Thao tác</span></th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.userId} className="border-b border-border last:border-0" aria-selected={member.userId === selectedId}>
                    <th scope="row" className="max-w-56 px-5 py-3 text-left font-normal">
                      <span className="block truncate font-medium" translate="no">{member.userName || "Không rõ tên"}</span>
                      <span className="block truncate font-mono text-xs text-muted" translate="no">{member.userId}</span>
                    </th>
                    {violationRules.map((rule) => <td key={rule} className="px-5 py-3 text-right tabular-nums">{formatNumber(member.counts[rule])}</td>)}
                    <td className="px-5 py-3 text-right font-medium tabular-nums">{formatNumber(member.counts.link + member.counts.badWord)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatNumber(member.kicks)}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-muted"><span className="tabular-nums">{formatDateTime(member.lastAt)}</span> · {ruleLabels[member.lastRule]}</td>
                    <td className="px-5 py-3">
                      <span className="flex justify-end gap-2">
                        <Button onClick={() => selectMember(member.userId)}>Xem tin</Button>
                        <Button variant="ghost" onClick={() => setPendingClear({ userId: member.userId, label: member.userName || member.userId })}>Xóa</Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <MemberMessages groupId={group.groupId} member={selected} onClose={() => selectMember(undefined)} />
      <ConfirmDialog
        open={pendingClear !== undefined}
        title="Xóa thống kê?"
        confirmLabel="Xóa thống kê"
        pending={clearing}
        onConfirm={clear}
        onCancel={() => setPendingClear(undefined)}
      >
        <p>Số lần vi phạm và các tin đã lưu của <strong className="text-foreground">{pendingClear?.label}</strong> sẽ bị xóa và không khôi phục được. Số đếm dùng để kick cũng được đặt lại.</p>
        <ErrorNote message={clearError} />
      </ConfirmDialog>
    </>
  );
}

export function GroupView({ groupId }: { groupId: string }) {
  const path = `/groups/${encodeURIComponent(groupId)}`;
  const { mutate: mutateGlobal } = useSWRConfig();
  const { data: group, error, mutate } = useSWR<Group>(path);
  const backLink = (
    <Link href="/groups" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted underline-offset-4 hover:text-foreground hover:underline">
      <ArrowLeft aria-hidden="true" className="size-4" />
      Nhóm
    </Link>
  );

  if (group === undefined) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <>
        {backLink}
        {error ? (
          <Card><EmptyState title={notFound ? "Không tìm thấy nhóm" : "Không tải được nhóm"} description={notFound ? "Nhóm này không còn trong danh sách của bot. Thử đồng bộ lại từ Zalo ở trang Nhóm." : errorText(error)} /></Card>
        ) : (
          <div className="space-y-4"><Skeleton className="h-9 w-72" /><Skeleton className="h-48 w-full" /><Skeleton className="h-48 w-full" /></div>
        )}
      </>
    );
  }

  function applyChange(updated: Group) {
    void mutate(updated, { revalidate: false });
    void mutateGlobal("/groups");
  }

  const featureSummary = !group.botEnabled ? "Bot đang tắt" : [
    group.linkGuardEnabled ? `Chặn link (${formatKickRule(group.kickRules.link, group.botIsAdmin)})` : undefined,
    group.badWordFilterEnabled ? `Lọc từ cấm (${formatKickRule(group.kickRules.badWord, group.botIsAdmin)})` : undefined,
  ].filter(Boolean).join(" · ") || "Chưa bật tính năng nào";

  return (
    <>
      {backLink}
      <PageHeader
        title={group.name || group.groupId}
        description={<><span className="tabular-nums">{formatNumber(group.memberCount)}</span> thành viên · ID <span className="font-mono" translate="no">{group.groupId}</span> · {featureSummary}</>}
        action={group.botIsAdmin ? <Badge tone="success">Bot là QTV</Badge> : <Badge tone="warning">Bot là thành viên: chỉ ghi nhận</Badge>}
      />
      <div className="space-y-4">
        <BotSwitch group={group} onChange={applyChange} />
        {/* With the bot off, the settings stay visible for reference but cannot be changed or focused. */}
        <div inert={!group.botEnabled} className={group.botEnabled ? "space-y-4" : "space-y-4 opacity-50"}>
          <SettingsCards group={group} onChange={applyChange} />
          <GroupLists group={group} />
        </div>
        <Statistics group={group} />
      </div>
    </>
  );
}
