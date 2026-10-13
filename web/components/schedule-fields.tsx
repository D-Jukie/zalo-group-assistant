"use client";

import { CalendarDays, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { errorText } from "@/lib/api";
import { cn, foldText, formatFriendlyDateTime, formatNumber, toLocalInput } from "@/lib/format";
import { reminderRepeatLabels, reminderRepeats, type ReminderCreateResult, type ReminderGroup, type ReminderRepeat } from "@/lib/types";
import { Badge, Button, Card, CardHeader, EmptyState, Input, Skeleton } from "./ui";

// The pieces shared by the forms that send something to several groups at a chosen time:
// picking the groups, picking the time and repeat, and showing what happened in each group.

export const maxGroups = 100;
export const fieldClass = "w-full min-w-0 rounded-md border border-border-strong bg-surface px-3 text-sm placeholder:text-subtle";

// Quick choices for the time. With "custom" the date and time come from the field below them.
const timeChoices = [
  { value: "15m", label: "15 phút nữa" },
  { value: "30m", label: "30 phút nữa" },
  { value: "tomorrow9", label: "9:00 ngày mai" },
  { value: "custom", label: "Khác" },
] as const;

type TimeChoice = (typeof timeChoices)[number]["value"];

const defaultTimeChoice: TimeChoice = "30m";

// The moment a choice stands for, counted from `now`. NaN while the custom field is empty.
function resolveTime(choice: TimeChoice, custom: string, now: number): number {
  if (choice === "15m") return now + 15 * 60_000;
  if (choice === "30m") return now + 30 * 60_000;
  if (choice === "custom") return new Date(custom).getTime();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return tomorrow.getTime();
}

// The current time, kept fresh while the form is open. Undefined until the page has loaded in the browser.
function useNow(): number | undefined {
  const [now, setNow] = useState<number>();
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

// Opens the browser's own date and time picker for a field, where the browser has one to open.
function openPicker(input: HTMLInputElement | null) {
  try {
    input?.showPicker();
  } catch {
    // The browser shows its picker in its own way.
  }
}

// When something goes out and how often, as chosen in ScheduleFields.
export type Schedule = {
  timeChoice: TimeChoice;
  when: string;
  repeat: ReminderRepeat;
  setTimeChoice: (choice: TimeChoice) => void;
  setWhen: (when: string) => void;
  setRepeat: (repeat: ReminderRepeat) => void;
  // The chosen moment counted from `now`; NaN when no date was picked.
  startTime: (now: number) => number;
  reset: () => void;
};

export function useSchedule(): Schedule {
  const [timeChoice, setTimeChoice] = useState<TimeChoice>(defaultTimeChoice);
  const [when, setWhen] = useState("");
  const [repeat, setRepeat] = useState<ReminderRepeat>("none");
  return {
    timeChoice,
    when,
    repeat,
    setTimeChoice,
    setWhen,
    setRepeat,
    startTime: (now) => resolveTime(timeChoice, when, now),
    reset: () => {
      setTimeChoice(defaultTimeChoice);
      setWhen("");
      setRepeat("none");
    },
  };
}

// The time and repeat part of a form, laid out like Zalo's own reminder dialog: quick choices,
// a date field that always says when in words, and the repeat.
export function ScheduleFields({ schedule, dateLabel }: { schedule: Schedule; dateLabel: string }) {
  const now = useNow();
  const whenInput = useRef<HTMLInputElement>(null);
  const { timeChoice, repeat } = schedule;
  // What the date field shows: the moment the chosen quick option stands for, or the one picked by hand.
  const resolved = now === undefined ? Number.NaN : schedule.startTime(now);
  const shownTime = Number.isNaN(resolved) ? undefined : resolved;

  // "Khác" starts from the time already on show, so the field never goes blank, and goes straight
  // to the date field with its picker open.
  function chooseTime(choice: TimeChoice) {
    if (choice === "custom" && timeChoice !== "custom" && shownTime !== undefined) schedule.setWhen(toLocalInput(shownTime));
    schedule.setTimeChoice(choice);
    if (choice === "custom") {
      whenInput.current?.focus();
      openPicker(whenInput.current);
    }
  }

  return (
    <>
      <div>
        <p id="schedule-time-label" className="mb-1.5 text-sm font-medium">Chọn thời gian</p>
        <div role="radiogroup" aria-labelledby="schedule-time-label" className="flex flex-wrap gap-2">
          {timeChoices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={timeChoice === choice.value}
              onClick={() => chooseTime(choice.value)}
              className={cn(
                "h-8 rounded-full px-3 text-sm transition-colors",
                timeChoice === choice.value ? "bg-accent/15 font-medium text-accent" : "bg-surface-hover text-foreground hover:bg-border",
              )}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor="reminder-when" className="mb-1.5 block text-sm font-medium">{dateLabel}</label>
        {/* The field always shows the chosen moment in words. The real date and time input lies
            invisibly on top of it: a click opens its picker, and picking a time selects "Khác". */}
        <div className={`${fieldClass} relative flex h-9 items-center justify-between gap-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent`}>
          <span className={cn("truncate tabular-nums", shownTime === undefined && "text-subtle")}>
            {shownTime === undefined || now === undefined ? "Chọn ngày và giờ…" : formatFriendlyDateTime(shownTime, now)}
          </span>
          <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-muted" />
          <input
            ref={whenInput}
            id="reminder-when"
            name="when"
            type="datetime-local"
            value={shownTime === undefined ? "" : toLocalInput(shownTime)}
            onChange={(event) => {
              schedule.setWhen(event.target.value);
              schedule.setTimeChoice("custom");
            }}
            onClick={(event) => openPicker(event.currentTarget)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </div>
      </div>
      <div>
        <label htmlFor="reminder-repeat" className="mb-1.5 block text-sm font-medium">Chọn kiểu lặp lại <span className="font-normal text-muted">(vd: Lặp lại hằng tuần)</span></label>
        <select id="reminder-repeat" name="repeat" value={repeat} onChange={(event) => schedule.setRepeat(reminderRepeats.find((item) => item === event.target.value) ?? "none")} className={`${fieldClass} h-9`}>
          {reminderRepeats.map((item) => <option key={item} value={item}>{reminderRepeatLabels[item]}</option>)}
        </select>
      </div>
    </>
  );
}

// The groups something goes to. The whole list is loaded, so searching happens right here.
function GroupPicker({ groups, selected, onChange }: { groups: ReminderGroup[]; selected: ReadonlySet<string>; onChange: (selected: Set<string>) => void }) {
  const [search, setSearch] = useState("");
  const needle = foldText(search.trim());
  const visible = needle === "" ? groups : groups.filter((group) => foldText(group.name).includes(needle) || group.groupId.includes(needle));
  const allVisibleSelected = visible.length > 0 && visible.every((group) => selected.has(group.groupId));

  function toggle(groupId: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(groupId);
    else next.delete(groupId);
    onChange(next);
  }

  function toggleVisible() {
    const next = new Set(selected);
    for (const group of visible) {
      if (allVisibleSelected) next.delete(group.groupId);
      else next.add(group.groupId);
    }
    onChange(next);
  }

  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">Chọn nhóm nhận</legend>
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
        <div className="relative min-w-40 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <label htmlFor="reminder-group-search" className="sr-only">Tìm nhóm theo tên hoặc ID</label>
          <Input id="reminder-group-search" type="search" autoComplete="off" placeholder="Tìm nhóm…" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" />
        </div>
        <Button disabled={visible.length === 0} onClick={toggleVisible}>{allVisibleSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}</Button>
      </div>
      {visible.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">Không có nhóm nào khớp “{search}”.</p>
      ) : (
        <ul className="mt-3 max-h-[26rem] divide-y divide-border overflow-y-auto overscroll-contain border-t border-border">
          {visible.map((group) => (
            <li key={group.groupId}>
              <label className="flex cursor-pointer items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-hover">
                <input type="checkbox" name="groupIds" value={group.groupId} checked={selected.has(group.groupId)} onChange={(event) => toggle(group.groupId, event.target.checked)} className="size-4 shrink-0 accent-[var(--accent)]" />
                <span className="min-w-0 flex-1 truncate text-sm" title={group.name || group.groupId}>{group.name || group.groupId}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted">{formatNumber(group.memberCount)} thành viên</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

// Step 1 of a form: the card that picks the groups, with its loading and empty states.
export function GroupPickerCard({ groups, loadError, selected, onChange, emptyDescription }: {
  groups: ReminderGroup[] | undefined;
  loadError: unknown;
  selected: ReadonlySet<string>;
  onChange: (selected: Set<string>) => void;
  emptyDescription: string;
}) {
  const selectedCount = (groups ?? []).filter((group) => selected.has(group.groupId)).length;
  return (
    <Card>
      <CardHeader
        title="1. Chọn nhóm"
        description="Chỉ những nhóm đang bật bot. Chọn một hoặc nhiều nhóm."
        action={<Badge tone={selectedCount > 0 ? "success" : "neutral"}>Đã chọn {formatNumber(selectedCount)}</Badge>}
      />
      {groups === undefined ? (
        <div className="space-y-2 p-5">{loadError ? <p className="text-sm text-danger">{errorText(loadError)}</p> : Array.from({ length: 5 }, (_item, index) => <Skeleton key={index} className="h-9 w-full" />)}</div>
      ) : groups.length === 0 ? (
        <EmptyState
          title="Chưa có nhóm nào bật bot"
          description={emptyDescription}
          action={<Link href="/groups" className="text-sm font-medium underline underline-offset-4">Mở danh sách nhóm</Link>}
        />
      ) : (
        <GroupPicker groups={groups} selected={selected} onChange={onChange} />
      )}
    </Card>
  );
}

// What happened in each group, shown in place of the form once the bot has answered.
export function GroupResults({ results, title, description, doneLabel, againLabel, backHref, backLabel, onRetry, onAgain }: {
  results: ReminderCreateResult[];
  title: string;
  description: string;
  // The badge of a group where it worked.
  doneLabel: string;
  againLabel: string;
  backHref: string;
  backLabel: string;
  onRetry: (groupIds: string[]) => void;
  onAgain: () => void;
}) {
  const failed = results.filter((item) => !item.ok);
  const succeeded = results.filter((item) => item.ok);
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <ul role="status" className="max-h-[26rem] divide-y divide-border overflow-y-auto overscroll-contain">
        {[...failed, ...succeeded].map((item) => (
          <li key={item.groupId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
            <span className="min-w-0 flex-1 truncate">{item.groupName || item.groupId}</span>
            {item.ok ? <>{item.warning ? <span className="min-w-0 text-warning">{item.warning}</span> : null}<Badge tone={item.warning ? "warning" : "success"}>{doneLabel}</Badge></> : <><span className="min-w-0 text-danger">{item.error}</span><Badge tone="danger">Lỗi</Badge></>}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">
        {failed.length > 0 ? <Button onClick={() => onRetry(failed.map((item) => item.groupId))}>Thử lại {formatNumber(failed.length)} nhóm lỗi</Button> : null}
        <Button onClick={onAgain}>{againLabel}</Button>
        <Link href={backHref} className="inline-flex h-9 items-center rounded-md bg-foreground px-3 text-sm font-medium text-background transition-opacity hover:opacity-85">{backLabel}</Link>
      </div>
    </Card>
  );
}
