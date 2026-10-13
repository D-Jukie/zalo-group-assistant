"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import useSWR, { useSWRConfig } from "swr";
import { ApiError, errorText, send } from "@/lib/api";
import { cn, formatDateTime, formatNumber, splitWindow, windowUnits } from "@/lib/format";
import { ruleLabels, totalViolations, violationRules, type Group, type GroupToggle, type KickRule, type MemberViolations, type RateRule, type SpamSettings, type AutoReplyRule, type PendingJoinList, type ViolationMessage, type ViolationRule } from "@/lib/types";
import { AutoReplyManager } from "./auto-replies-view";
import { ConfirmDialog } from "./confirm-dialog";
import { JoinApprovalCard, PendingMembers } from "./group-approvals";
import { GroupZaloSettings } from "./group-zalo-settings";
import { GroupCommands } from "./group-commands";
import { GroupWelcome } from "./group-welcome";
import { GroupMembers } from "./group-members";
import { ListManager } from "./list-manager";
import { RowCheckbox, RowNumber, SelectAllCheckbox, SelectionBar, useSelection } from "./selection";
import { useToast } from "./toast";
import { Badge, Button, Card, CardHeader, CompactSwitch, EmptyState, Input, Skeleton, StatTile, Switch } from "./ui";
import { ViolationItem } from "./violation-item";

const toggleNames: Record<GroupToggle, string> = { bot: "bot ở nhóm này", links: "chặn link", "bad-words": "lọc từ cấm", spam: "chống spam" };

// Saves one of the group's switches, hands back the updated group and says what happened.
function useToggle(group: Group, onChange: (group: Group) => void) {
  const toast = useToast();
  async function toggle(name: GroupToggle, enabled: boolean) {
    try {
      onChange(await send<Group>("PATCH", `/groups/${encodeURIComponent(group.groupId)}/${name}`, { enabled }));
      toast.success(`Đã ${enabled ? "bật" : "tắt"} ${toggleNames[name]}`);
    } catch (exception) {
      toast.error(errorText(exception));
    }
  }
  return { toggle };
}

// The master switch, in the page header. While it is off the bot ignores the group entirely.
function BotSwitch({ group, onChange }: { group: Group; onChange: (group: Group) => void }) {
  const { toggle } = useToggle(group, onChange);
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
      <span className="text-sm">
        <span className="block font-medium">{group.botEnabled ? "Bot đang bật" : "Bot đang tắt"}</span>
        <span className="block text-xs text-muted">{group.botIsAdmin ? "Bot là trưởng nhóm" : "Bot là thành viên"}</span>
      </span>
      <CompactSwitch checked={group.botEnabled} onChange={(value) => toggle("bot", value)} label="Bật bot ở nhóm này" />
    </div>
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
  const toast = useToast();
  const active = kickRule.enabled && group.botIsAdmin;
  const dirty = count !== String(kickRule.count) || Number(amount) * unitSeconds !== kickRule.windowSeconds;
  const fieldId = `kick-${rule}`;

  async function save(next: KickRule) {
    setPending(true);
    try {
      onSaved(await send<Group>("PATCH", `/groups/${encodeURIComponent(group.groupId)}/kick-rule`, { rule, ...next }));
      toast.success(next.enabled === kickRule.enabled ? "Đã lưu cài đặt kick" : `Đã ${next.enabled ? "bật" : "tắt"} kick`);
    } catch (exception) {
      toast.error(errorText(exception));
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
            <Input id={`${fieldId}-count`} name="count" type="number" inputMode="numeric" autoComplete="off" min={1} max={100} required value={count} onChange={(event) => setCount(event.target.value)} className="max-w-20 tabular-nums" />
            <label htmlFor={`${fieldId}-amount`}>lần trong</label>
            <Input id={`${fieldId}-amount`} name="amount" type="number" inputMode="numeric" autoComplete="off" min={1} required value={amount} onChange={(event) => setAmount(event.target.value)} className="max-w-20 tabular-nums" />
            <label htmlFor={`${fieldId}-unit`} className="sr-only">Đơn vị thời gian</label>
            <select id={`${fieldId}-unit`} name="unit" value={unitSeconds} onChange={(event) => setUnitSeconds(Number(event.target.value))} className="h-9 rounded-md border border-border-strong px-2 text-sm">
              {windowUnits.map((unit) => <option key={unit.seconds} value={unit.seconds}>{unit.label}</option>)}
            </select>
            {dirty ? <Button type="submit" variant="primary" pending={pending}>Lưu</Button> : null}
          </fieldset>
        </form>
      ) : null}
    </div>
  );
}

// While being edited the numbers are plain text, so a field can be emptied and retyped; they
// become numbers again when sent to the bot.
type RateDraft = { enabled: boolean; count: string; windowSeconds: string };
type SpamDraft = { flood: RateDraft; repeat: RateDraft; contact: { enabled: boolean } };

function toDraft(settings: SpamSettings): SpamDraft {
  const rate = (rule: RateRule): RateDraft => ({ enabled: rule.enabled, count: String(rule.count), windowSeconds: String(rule.windowSeconds) });
  return { flood: rate(settings.flood), repeat: rate(settings.repeat), contact: { enabled: settings.contact.enabled } };
}

function fromDraft(draft: SpamDraft): SpamSettings {
  const rate = (rule: RateDraft): RateRule => ({ enabled: rule.enabled, count: Number(rule.count), windowSeconds: Number(rule.windowSeconds) });
  return { flood: rate(draft.flood), repeat: rate(draft.repeat), contact: { enabled: draft.contact.enabled } };
}

// The spam guard's own settings for this group. Nothing is saved until the form is submitted.
function SpamSettingsForm({ group, onSaved }: { group: Group; onSaved: (group: Group) => void }) {
  const saved = group.spamSettings;
  const [settings, setSettings] = useState<SpamDraft>(() => toDraft(saved));
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const dirty = JSON.stringify(settings) !== JSON.stringify(toDraft(saved));
  const disabled = !group.spamGuardEnabled;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      onSaved(await send<Group>("PATCH", `/groups/${encodeURIComponent(group.groupId)}/spam-settings`, fromDraft(settings)));
      toast.success("Đã lưu cài đặt chống spam");
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setPending(false);
    }
  }

  const rateRow = (key: "flood" | "repeat", label: string, unit: string) => {
    const rule = settings[key];
    const change = (changes: Partial<RateDraft>) => setSettings((current) => ({ ...current, [key]: { ...current[key], ...changes } }));
    return (
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2 font-medium">
          <input type="checkbox" name={`${key}-enabled`} checked={rule.enabled} onChange={(event) => change({ enabled: event.target.checked })} className="size-4 accent-[var(--accent)]" />
          {label}
        </label>
        <label htmlFor={`spam-${key}-count`} className="sr-only">Số {unit} của mục {label}</label>
        <Input id={`spam-${key}-count`} name={`${key}-count`} type="number" inputMode="numeric" autoComplete="off" min={2} max={50} required disabled={!rule.enabled} value={rule.count} onChange={(event) => change({ count: event.target.value })} className="max-w-20 tabular-nums" />
        <span>{unit} trong</span>
        <label htmlFor={`spam-${key}-window`} className="sr-only">Số giây của mục {label}</label>
        <Input id={`spam-${key}-window`} name={`${key}-window`} type="number" inputMode="numeric" autoComplete="off" min={1} max={3600} required disabled={!rule.enabled} value={rule.windowSeconds} onChange={(event) => change({ windowSeconds: event.target.value })} className="max-w-20 tabular-nums" />
        <span>giây</span>
      </div>
    );
  };

  return (
    <form onSubmit={save} className="py-3">
      <fieldset disabled={disabled} className="space-y-3 text-sm disabled:opacity-60">
        <legend className="mb-3 text-sm font-medium">Bị tính là spam khi</legend>
        {rateRow("flood", "Gửi dồn dập:", "tin")}
        {rateRow("repeat", "Lặp nội dung:", "lần")}
        <label className="flex cursor-pointer items-start gap-2">
          <input type="checkbox" name="contact-enabled" checked={settings.contact.enabled} onChange={(event) => setSettings((current) => ({ ...current, contact: { enabled: event.target.checked } }))} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span><span className="font-medium">Có số điện thoại hoặc số tài khoản</span><span className="block text-muted">Tắt sẵn vì thành viên cũng hay gửi số điện thoại cho việc bình thường.</span></span>
        </label>
        {dirty ? <Button type="submit" variant="primary" pending={pending}>Lưu cài đặt spam</Button> : null}
      </fieldset>
    </form>
  );
}

// One feature of the bot in this group, as a card as wide as the page: its on/off switch in the
// header and, underneath, two columns that always fill the card: what the feature looks for on the
// left, what happens to a member who keeps breaking it on the right.
function FeatureCard({ group, rule, toggleName, enabled, title, description, onChange, children }: {
  group: Group;
  rule: ViolationRule;
  toggleName: GroupToggle;
  enabled: boolean;
  title: string;
  description: string;
  onChange: (group: Group) => void;
  // What the feature looks for: its own list or settings.
  children: ReactNode;
}) {
  const { toggle } = useToggle(group, onChange);
  const kickRule = group.kickRules[rule];
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 flex-1 basis-72">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {title}
            {enabled ? <Badge tone="success">Đang bật</Badge> : <Badge>Tắt</Badge>}
          </h2>
          <p className="mt-1 text-sm text-muted">{description}</p>
        </div>
        <CompactSwitch checked={enabled} onChange={(value) => toggle(toggleName, value)} label={`Bật ${title.toLowerCase()}`} />
      </div>
      <div className="grid divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <div className="min-w-0">{children}</div>
        <div className="min-w-0 px-5 py-1">
          <p className="pt-3 text-sm font-medium">Khi có vi phạm</p>
          <p className="mt-1 text-sm text-muted">{group.botIsAdmin ? "Tin vi phạm bị xóa và được ghi vào thống kê." : "Bot không phải trưởng nhóm nên chỉ ghi nhận vi phạm, không xóa được tin."}</p>
          <KickSetting
            // Saved numbers remount the form so its fields show the stored values again.
            key={`${kickRule.enabled}-${kickRule.count}-${kickRule.windowSeconds}`}
            group={group}
            rule={rule}
            featureOn={enabled}
            onSaved={onChange}
          />
        </div>
      </div>
    </Card>
  );
}

// The three features, one under the other. Each carries the list or settings that belong to it,
// so nothing about a feature has to be looked for elsewhere on the page.
function FeatureCards({ group, onChange }: { group: Group; onChange: (group: Group) => void }) {
  const base = `/groups/${encodeURIComponent(group.groupId)}`;
  const sharedLists = <Link href="/features" className="text-foreground underline underline-offset-4 hover:text-accent">Tính năng</Link>;
  return (
    <div className="space-y-4">
      <FeatureCard
        group={group}
        rule="link"
        toggleName="links"
        enabled={group.linkGuardEnabled}
        title="Chặn link"
        description="Link mời nhóm Zalo và các trang trong danh sách chung lẫn danh sách riêng của nhóm, kể cả trong mã QR."
        onChange={onChange}
      >
        <ListManager
          embedded
          title="Link bị chặn riêng"
          description={<>Chỉ áp dụng cho nhóm này, cộng thêm vào danh sách chung ở trang {sharedLists}.</>}
          path={`${base}/blocked-links`}
          field="link"
          inputLabel="Tên miền hoặc link cần chặn trong nhóm này"
          placeholder="example.com…"
          maxLength={200}
          emptyTitle="Nhóm này chưa có link chặn riêng"
          emptyDescription="Nhóm đang dùng link mời nhóm Zalo và danh sách chung."
        />
      </FeatureCard>
      <FeatureCard
        group={group}
        rule="badWord"
        toggleName="bad-words"
        enabled={group.badWordFilterEnabled}
        title="Lọc từ cấm"
        description="Tin chứa từ hoặc cụm từ trong danh sách chung hoặc danh sách riêng của nhóm."
        onChange={onChange}
      >
        <ListManager
          embedded
          title="Từ cấm riêng"
          description={<>Chỉ áp dụng cho nhóm này, cộng thêm vào danh sách chung ở trang {sharedLists}.</>}
          path={`${base}/banned-words`}
          field="word"
          inputLabel="Từ hoặc cụm từ cần chặn trong nhóm này"
          placeholder="Từ hoặc cụm từ…"
          maxLength={50}
          emptyTitle="Nhóm này chưa có từ cấm riêng"
          emptyDescription="Nhóm đang dùng danh sách từ cấm chung."
        />
      </FeatureCard>
      <FeatureCard
        group={group}
        rule="spam"
        toggleName="spam"
        enabled={group.spamGuardEnabled}
        title="Chống spam"
        description="Bắt theo cách thành viên gửi tin: gửi dồn dập, lặp một nội dung, hoặc tin có số điện thoại, số tài khoản."
        onChange={onChange}
      >
        <div className="px-5 py-1">
          {/* Saved settings remount the form so its fields show the stored values again. */}
          <SpamSettingsForm key={JSON.stringify(group.spamSettings)} group={group} onSaved={onChange} />
        </div>
      </FeatureCard>
      {/* Saved criteria remount the card so its fields show the stored values again. */}
      <JoinApprovalCard key={JSON.stringify(group.joinApproval)} group={group} onChange={onChange} />
      {/* A saved welcome remounts the card so its field shows the stored words again. */}
      <GroupWelcome key={group.welcome.text} group={group} onChange={onChange} />
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

// What is about to be cleared: one member, several ticked members, or with neither the whole group.
type PendingClear = { userId?: string; userIds?: string[]; label: string };

function memberIdOf(member: MemberViolations): string {
  return member.userId;
}

function Statistics({ group }: { group: Group }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { mutate: mutateGlobal } = useSWRConfig();
  const path = `/groups/${encodeURIComponent(group.groupId)}/violations`;
  const { data: members, error, mutate } = useSWR<MemberViolations[]>(path);
  const [pendingClear, setPendingClear] = useState<PendingClear>();
  const [clearing, setClearing] = useState(false);
  const selection = useSelection<MemberViolations>(memberIdOf);
  const toast = useToast();
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
    setClearing(true);
    try {
      const scope = pendingClear.userIds !== undefined ? { userIds: pendingClear.userIds } : pendingClear.userId === undefined ? {} : { userId: pendingClear.userId };
      await mutate(send<MemberViolations[]>("DELETE", path, scope), { revalidate: false });
      selection.clear();
      await mutateGlobal("/overview");
      const cleared = pendingClear.userIds ?? (pendingClear.userId === undefined ? undefined : [pendingClear.userId]);
      if (cleared === undefined || (selectedId !== null && cleared.includes(selectedId))) selectMember(undefined);
      toast.success(`Đã xóa thống kê của ${pendingClear.label}`);
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setClearing(false);
      setPendingClear(undefined);
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
                  <th scope="col" className="w-10 py-3 pl-5"><SelectAllCheckbox items={members} selection={selection} getId={memberIdOf} label="Chọn mọi thành viên" /></th>
                  <th scope="col" className="w-12 px-2 py-3 text-right font-medium">STT</th>
                  <th scope="col" className="px-5 py-3 font-medium">Thành viên</th>
                  {violationRules.map((rule) => <th key={rule} scope="col" className="px-5 py-3 text-right font-medium">{ruleLabels[rule]}</th>)}
                  <th scope="col" className="px-5 py-3 text-right font-medium">Tổng</th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">Đã bị kick</th>
                  <th scope="col" className="px-5 py-3 font-medium">Lần gần nhất</th>
                  <th scope="col" className="px-5 py-3"><span className="sr-only">Thao tác</span></th>
                </tr>
              </thead>
              <tbody>
                {members.map((member, index) => (
                  <tr key={member.userId} className={`border-b border-border last:border-0 ${selection.has(member.userId) ? "bg-surface-hover" : ""}`} aria-selected={member.userId === selectedId}>
                    <td className="py-3 pl-5"><RowCheckbox checked={selection.has(member.userId)} onChange={(checked) => selection.toggle(member, checked)} label={`Chọn ${member.userName || member.userId}`} /></td>
                    <td className="px-2 py-3 text-right"><RowNumber value={index + 1} /></td>
                    <th scope="row" className="max-w-56 px-5 py-3 text-left font-normal">
                      <span className="block truncate font-medium" translate="no">{member.userName || "Không rõ tên"}</span>
                      <span className="block truncate font-mono text-xs text-muted" translate="no">{member.userId}</span>
                    </th>
                    {violationRules.map((rule) => <td key={rule} className="px-5 py-3 text-right tabular-nums">{formatNumber(member.counts[rule])}</td>)}
                    <td className="px-5 py-3 text-right font-medium tabular-nums">{formatNumber(totalViolations(member.counts))}</td>
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
      <SelectionBar count={selection.count} noun="thành viên" onClear={selection.clear}>
        <Button variant="danger" onClick={() => setPendingClear({ userIds: selection.items.map(memberIdOf), label: `${formatNumber(selection.count)} thành viên đã chọn` })}>Xóa thống kê</Button>
      </SelectionBar>
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
    void mutateGlobal((key) => typeof key === "string" && (key.startsWith("/groups?") || key === "/groups/summary"));
  }

  return <GroupPage group={group} backLink={backLink} onChange={applyChange} />;
}

const tabs = [
  { value: "features", label: "Tính năng" },
  { value: "replies", label: "Trả lời tự động" },
  { value: "members", label: "Thành viên" },
  { value: "pending", label: "Chờ duyệt" },
  { value: "zalo", label: "Cài đặt nhóm" },
  { value: "violations", label: "Vi phạm" },
] as const;

type Tab = (typeof tabs)[number]["value"];

// One group: who it is and whether the bot is on, the numbers at a glance, and then one part at a
// time (the features, the members or the violations) so no part leaves a hole beside another.
// Which part is open lives in the URL.
function GroupPage({ group, backLink, onChange }: { group: Group; backLink: ReactNode; onChange: (group: Group) => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: records } = useSWR<MemberViolations[]>(`/groups/${encodeURIComponent(group.groupId)}/violations`);
  const { data: replies } = useSWR<AutoReplyRule[]>("/auto-replies");
  const ownReplies = replies?.filter((rule) => rule.groupIds.includes(group.groupId)).length ?? 0;
  // Only an admin account can read the waiting list.
  const { data: waiting } = useSWR<PendingJoinList>(group.botIsAdmin ? `/groups/${encodeURIComponent(group.groupId)}/pending-members` : null);
  // A link to a member's messages opens the violations tab, whether or not it names the tab.
  const tab: Tab = tabs.find((item) => item.value === searchParams.get("tab"))?.value ?? (searchParams.get("member") === null ? "features" : "violations");

  function openTab(value: Tab) {
    // The open member belongs to the violations tab and does not follow to another one.
    router.replace(value === "features" ? pathname : `${pathname}?tab=${value}`, { scroll: false });
  }

  const features = [
    { on: group.linkGuardEnabled, name: "Chặn link", kick: group.kickRules.link.enabled },
    { on: group.badWordFilterEnabled, name: "Lọc từ cấm", kick: group.kickRules.badWord.enabled },
    { on: group.spamGuardEnabled, name: "Chống spam", kick: group.kickRules.spam.enabled },
    // Letting people in is not something a member can break, so it never kicks.
    { on: group.joinApproval.enabled && group.botIsAdmin, name: "Duyệt tự động", kick: false },
  ];
  const active = group.botEnabled ? features.filter((feature) => feature.on) : [];
  const kicking = group.botIsAdmin ? active.filter((feature) => feature.kick) : [];
  const violationTotal = records?.reduce((sum, record) => sum + totalViolations(record.counts), 0);
  const kickTotal = records?.reduce((sum, record) => sum + record.kicks, 0);
  const pending = <Skeleton className="h-9 w-16" />;

  return (
    <>
      {backLink}
      <header className="flex flex-wrap items-start justify-between gap-4 pb-6">
        <div className="min-w-0 flex-1 basis-80">
          <h1 className="truncate text-2xl font-semibold tracking-tight" title={group.name || group.groupId}>{group.name || group.groupId}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <span>ID <span className="font-mono" translate="no">{group.groupId}</span></span>
            <span aria-hidden="true" className="text-subtle">·</span>
            <Link href={`/activity?groupId=${encodeURIComponent(group.groupId)}`} className="hover:text-foreground hover:underline">Lịch sử hoạt động</Link>
          </p>
        </div>
        <BotSwitch group={group} onChange={onChange} />
      </header>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Thành viên" value={formatNumber(group.memberCount)} hint={group.botIsAdmin ? "Bot là trưởng hoặc phó nhóm" : "Bot là thành viên: chỉ ghi nhận"} />
        <StatTile label="Tính năng đang bật" value={`${active.length}/${features.length}`} hint={active.length === 0 ? (group.botEnabled ? "Chưa bật tính năng nào" : "Bot đang tắt") : active.map((feature) => feature.name).join(", ")} />
        <StatTile label="Vi phạm" value={violationTotal === undefined ? pending : formatNumber(violationTotal)} hint={records === undefined ? undefined : `${formatNumber(records.length)} thành viên từng vi phạm`} />
        <StatTile label="Đã kick" value={kickTotal === undefined ? pending : formatNumber(kickTotal)} hint={kicking.length === 0 ? "Chưa tính năng nào bật kick" : `Đang kick: ${kicking.map((feature) => feature.name).join(", ")}`} />
      </div>
      <div role="group" aria-label="Chọn phần của nhóm" className="mb-4 inline-flex max-w-full flex-wrap gap-1 rounded-md border border-border bg-surface p-1">
        {tabs.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={tab === item.value}
            onClick={() => openTab(item.value)}
            className={cn(
              "h-7 rounded px-2.5 text-sm transition-colors",
              tab === item.value ? "bg-surface-hover font-medium text-foreground" : "text-muted hover:text-foreground",
            )}
          >
            {item.label}
            {item.value === "replies" && ownReplies > 0 ? <span className="ml-1.5 tabular-nums text-muted">{formatNumber(ownReplies)}</span> : null}
            {item.value === "members" ? <span className="ml-1.5 tabular-nums text-muted">{formatNumber(group.memberCount)}</span> : null}
            {item.value === "pending" && waiting !== undefined && waiting.items.length > 0 ? <span className="ml-1.5 tabular-nums text-muted">{formatNumber(waiting.items.length)}</span> : null}
            {item.value === "violations" && records !== undefined && records.length > 0 ? <span className="ml-1.5 tabular-nums text-muted">{formatNumber(records.length)}</span> : null}
          </button>
        ))}
      </div>
      {tab === "features" ? (
        // With the bot off, the settings stay visible for reference but cannot be changed or focused.
        <div inert={!group.botEnabled} className={group.botEnabled ? undefined : "opacity-50"}>
          <FeatureCards group={group} onChange={onChange} />
        </div>
      ) : tab === "replies" ? (
        // Like the features, answers do nothing while the bot is off, but they can still be prepared.
        <div className="space-y-4">
          <GroupCommands group={group} onChange={onChange} />
          <div><AutoReplyManager group={group} /></div>
        </div>
      ) : tab === "members" ? (
        <GroupMembers group={group} />
      ) : tab === "pending" ? (
        <PendingMembers group={group} />
      ) : tab === "zalo" ? (
        <GroupZaloSettings group={group} />
      ) : (
        <div className="space-y-4"><Statistics group={group} /></div>
      )}
    </>
  );
}
