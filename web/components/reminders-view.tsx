"use client";

import { ChevronDown, Download, MessageSquare, Plus, RefreshCw, Repeat } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { errorText, fetcher, send } from "@/lib/api";
import { downloadExcel, slug } from "@/lib/excel";
import { cn, formatClock, formatDateTime, formatFullDay, formatNumber, localDayKey } from "@/lib/format";
import { reminderRepeatLabels, type GroupReminder, type ReminderList, type ReminderMember, type ReminderResponses } from "@/lib/types";
import { ConfirmDialog } from "./confirm-dialog";
import { useToast } from "./toast";
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton, StatTile } from "./ui";
import { GroupLink } from "./violation-item";

const views = [
  { value: "upcoming", label: "Sắp tới" },
  { value: "past", label: "Đã qua" },
] as const;

const primaryLink = "inline-flex h-9 items-center justify-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background transition-opacity hover:opacity-85";

function MemberList({ title, members, tone }: { title: string; members: ReminderMember[]; tone: "success" | "danger" }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-2 text-sm font-medium">
        {title}
        <Badge tone={members.length > 0 ? tone : "neutral"}>{formatNumber(members.length)}</Badge>
      </p>
      {members.length === 0 ? (
        <p className="mt-2 text-sm text-subtle">Chưa có ai</p>
      ) : (
        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto overscroll-contain text-sm">
          {members.map((member) => (
            <li key={member.userId} className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 truncate" translate="no">{member.name || member.userId}</span>
              {member.name ? <span className="shrink-0 font-mono text-xs text-subtle" translate="no">{member.userId}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const exportHeader = ["Nhóm", "ID nhóm", "Nội dung nhắc hẹn", "Thời gian nhắc", "Lặp lại", "Thành viên", "ID thành viên", "Phản hồi"] as const;

// One row per member who answered a reminder.
function exportRows(reminder: GroupReminder, responses: ReminderResponses): string[][] {
  const about = [reminder.groupName || reminder.groupId, reminder.groupId, reminder.title, formatDateTime(reminder.nextTime ?? reminder.startTime), reminderRepeatLabels[reminder.repeat]];
  return [
    ...responses.accepted.map((member) => [...about, member.name, member.userId, "Tham gia"]),
    ...responses.rejected.map((member) => [...about, member.name, member.userId, "Từ chối"]),
  ];
}

// Who answered one reminder. Only asked for once the panel is opened.
function Responses({ reminder }: { reminder: GroupReminder }) {
  const { data, error } = useSWR<ReminderResponses>(`/groups/${encodeURIComponent(reminder.groupId)}/reminders/${encodeURIComponent(reminder.reminderId)}/responses`);
  const toast = useToast();
  if (data === undefined) {
    return error ? <p className="text-sm text-danger">{errorText(error)}</p> : <Skeleton className="h-16 w-full" />;
  }
  const answered = data.accepted.length + data.rejected.length;
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <MemberList title="Tham gia" members={data.accepted} tone="success" />
        <MemberList title="Từ chối" members={data.rejected} tone="danger" />
      </div>
      {answered > 0 ? (
        <div className="mt-4 flex justify-end border-t border-border pt-3">
          <Button
            onClick={async () => {
              try {
                await downloadExcel(`nhac-hen-${slug(reminder.title) || reminder.reminderId}-${localDayKey(Date.now())}.xlsx`, exportHeader, exportRows(reminder, data));
                toast.success(`Đã xuất ${formatNumber(answered)} phản hồi`);
              } catch (exception) {
                toast.error(errorText(exception));
              }
            }}
          >
            <Download aria-hidden="true" className="size-4" />
            Xuất danh sách
          </Button>
        </div>
      ) : null}
    </>
  );
}

// One reminder: when it goes off, what it says, where, and how members answered.
function ReminderItem({ reminder, onRemove }: { reminder: GroupReminder; onRemove: (reminder: GroupReminder) => void }) {
  const [open, setOpen] = useState(false);
  const panelId = `responses-${reminder.groupId}-${reminder.reminderId}`;
  const shownTime = reminder.nextTime ?? reminder.startTime;
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <time dateTime={new Date(shownTime).toISOString()} className="w-14 shrink-0 pt-0.5 text-lg font-semibold tabular-nums">{formatClock(shownTime)}</time>
        <div className="min-w-0 flex-1 basis-64">
          <p className="whitespace-pre-wrap break-words text-sm font-medium">
            {reminder.emoji ? <span aria-hidden="true" className="mr-1.5">{reminder.emoji}</span> : null}
            {reminder.title || "Nhắc hẹn không có nội dung"}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <GroupLink groupId={reminder.groupId} name={reminder.groupName || reminder.groupId} />
            {reminder.repeat !== "none" ? <Badge><Repeat aria-hidden="true" className="size-3" />{reminderRepeatLabels[reminder.repeat]}</Badge> : null}
            {reminder.createdByBot ? <Badge>Bot tạo</Badge> : null}
            {reminder.dueMessage ? <Badge><MessageSquare aria-hidden="true" className="size-3" />Có tin nhắn khi đến giờ</Badge> : null}
          </div>
          <p className="mt-2 text-sm text-muted">Bắt đầu: <span className="tabular-nums text-foreground">{formatDateTime(reminder.startTime)}</span></p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Badge tone={reminder.accepted > 0 ? "success" : "neutral"}>{formatNumber(reminder.accepted)} tham gia</Badge>
          <Badge tone={reminder.rejected > 0 ? "danger" : "neutral"}>{formatNumber(reminder.rejected)} từ chối</Badge>
          <Button variant="ghost" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
            Thành viên
            <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", open && "rotate-180")} />
          </Button>
          <Button variant="ghost" aria-label={`Xóa nhắc hẹn ${reminder.title}`} onClick={() => onRemove(reminder)}>Xóa</Button>
        </div>
      </div>
      {open ? <div id={panelId} className="mt-4 rounded-md border border-border bg-background p-4 md:ml-[4.5rem]"><Responses reminder={reminder} /></div> : null}
    </li>
  );
}

// Zalo's own reminders in every group the bot is switched on for, as a day-by-day agenda.
// Which half is shown (upcoming or past) lives in the URL.
export function RemindersView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = views.find((item) => item.value === searchParams.get("view"))?.value ?? "upcoming";
  const { data, error, mutate } = useSWR<ReminderList>("/reminders");
  const [refreshing, setRefreshing] = useState(false);
  const toast = useToast();
  const [removing, setRemoving] = useState<GroupReminder>();
  const [removePending, setRemovePending] = useState(false);

  // The bot remembers each group's reminders for a few minutes; this reads every group again.
  async function refresh() {
    setRefreshing(true);
    try {
      await mutate(fetcher<ReminderList>("/reminders?refresh=1"), { revalidate: false });
      toast.success("Đã đọc lại nhắc hẹn từ Zalo");
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setRefreshing(false);
    }
  }

  async function remove(reminder: GroupReminder) {
    setRemovePending(true);
    try {
      await send("DELETE", `/groups/${encodeURIComponent(reminder.groupId)}/reminders/${encodeURIComponent(reminder.reminderId)}`);
      await mutate();
      toast.success(`Đã xóa nhắc hẹn khỏi “${reminder.groupName || reminder.groupId}”`);
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setRemovePending(false);
      setRemoving(undefined);
    }
  }

  const all = data?.items ?? [];
  const upcoming = all.filter((item) => item.nextTime !== null);
  const past = all.filter((item) => item.nextTime === null);
  const shown = view === "upcoming" ? upcoming : past;
  // The bot already sorted them, so reminders of one day sit next to each other.
  const days: { key: string; time: number; items: GroupReminder[] }[] = [];
  for (const item of shown) {
    const time = item.nextTime ?? item.startTime;
    const key = localDayKey(time);
    const last = days.at(-1);
    if (last !== undefined && last.key === key) last.items.push(item);
    else days.push({ key, time, items: [item] });
  }
  const pending = <Skeleton className="h-9 w-16" />;
  const groupsWithReminders = new Set(all.map((item) => item.groupId)).size;

  return (
    <>
      <PageHeader
        title="Lịch nhắc hẹn"
        description="Nhắc hẹn của Zalo ở mọi nhóm đang bật bot, kể cả nhắc hẹn do thành viên tạo."
        action={
          <div className="flex flex-wrap gap-2">
            {/* While reading, the button keeps its size: it is only disabled and its arrow turns. */}
            <Button disabled={refreshing} aria-busy={refreshing} onClick={refresh}>
              <RefreshCw aria-hidden="true" className={cn("size-4", refreshing && "animate-spin")} />
              Làm mới
            </Button>
            <Link href="/reminders/new" className={primaryLink}>
              <Plus aria-hidden="true" className="size-4" />
              Tạo nhắc hẹn
            </Link>
          </div>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Sắp tới" value={data ? formatNumber(upcoming.length) : pending} hint={data ? `${formatNumber(past.length)} nhắc hẹn đã qua` : undefined} />
        <StatTile label="Lượt tham gia" value={data ? formatNumber(all.reduce((sum, item) => sum + item.accepted, 0)) : pending} hint="Trên mọi nhắc hẹn" />
        <StatTile label="Lượt từ chối" value={data ? formatNumber(all.reduce((sum, item) => sum + item.rejected, 0)) : pending} hint="Trên mọi nhắc hẹn" />
        <StatTile label="Nhóm có nhắc hẹn" value={data ? formatNumber(groupsWithReminders) : pending} hint={data ? `Đã đọc ${formatNumber(data.groupCount - data.failed.length)}/${formatNumber(data.groupCount)} nhóm đang bật bot` : undefined} />
      </div>
      {data !== undefined && data.failed.length > 0 ? (
        <p role="status" className="mb-4 rounded-md border border-warning/30 bg-warning-surface px-4 py-3 text-sm text-warning">
          Không đọc được nhắc hẹn của {formatNumber(data.failed.length)} nhóm: {data.failed.slice(0, 3).map((item) => item.groupName || item.groupId).join(", ")}{data.failed.length > 3 ? "…" : ""} ({data.failed[0]?.error})
        </p>
      ) : null}
      <div role="group" aria-label="Chọn nhắc hẹn sắp tới hoặc đã qua" className="mb-4 inline-flex gap-1 rounded-md border border-border bg-surface p-1">
        {views.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={view === item.value}
            onClick={() => router.replace(item.value === "upcoming" ? pathname : `${pathname}?view=${item.value}`, { scroll: false })}
            className={cn(
              "h-7 rounded px-2.5 text-sm transition-colors",
              view === item.value ? "bg-surface-hover font-medium text-foreground" : "text-muted hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {data === undefined ? (
        <Card>
          <div className="space-y-3 p-5">
            {error ? <p className="text-sm text-danger">{errorText(error)}</p> : Array.from({ length: 4 }, (_item, index) => <Skeleton key={index} className="h-16 w-full" />)}
          </div>
        </Card>
      ) : data.groupCount === 0 ? (
        <Card>
          <EmptyState
            title="Chưa có nhóm nào bật bot"
            description="Nhắc hẹn chỉ được đọc và tạo ở những nhóm đã bật bot."
            action={<Link href="/groups" className="text-sm font-medium underline underline-offset-4">Mở danh sách nhóm</Link>}
          />
        </Card>
      ) : days.length === 0 ? (
        <Card>
          <EmptyState
            title={view === "upcoming" ? "Không có nhắc hẹn nào sắp tới" : "Chưa có nhắc hẹn nào đã qua"}
            description={view === "upcoming" ? "Tạo một nhắc hẹn cho một hoặc nhiều nhóm cùng lúc." : "Nhắc hẹn không lặp lại sẽ chuyển sang đây khi đã qua giờ."}
            action={view === "upcoming" ? <Link href="/reminders/new" className="text-sm font-medium underline underline-offset-4">Tạo nhắc hẹn</Link> : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {days.map((day) => (
            <section key={day.key} aria-label={formatFullDay(day.time)}>
              <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
                <span className="first-letter:uppercase">{formatFullDay(day.time)}</span>
                <span className="font-normal text-muted">{formatNumber(day.items.length)} nhắc hẹn</span>
              </h2>
              <Card>
                <ul className="divide-y divide-border">
                  {day.items.map((item) => <ReminderItem key={`${item.groupId}-${item.reminderId}`} reminder={item} onRemove={setRemoving} />)}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={removing !== undefined}
        title="Xóa nhắc hẹn này?"
        confirmLabel="Xóa nhắc hẹn"
        pending={removePending}
        onConfirm={() => { if (removing !== undefined) void remove(removing); }}
        onCancel={() => setRemoving(undefined)}
      >
        Nhắc hẹn “{removing?.title}” sẽ bị xóa khỏi “{removing?.groupName}” trên Zalo. Không hoàn tác được.
      </ConfirmDialog>
    </>
  );
}
