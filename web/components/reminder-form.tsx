"use client";

import { ArrowLeft, CalendarDays, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import useSWR, { useSWRConfig } from "swr";
import { errorText, send } from "@/lib/api";
import { cn, foldText, formatFriendlyDateTime, formatNumber, toLocalInput } from "@/lib/format";
import { reminderRepeatLabels, reminderRepeats, type ReminderCreateResult, type ReminderGroup, type ReminderRepeat } from "@/lib/types";
import { emptyMessageDraft, MessageField, messageProblem, toMessagePayload, type MessageDraft } from "./reminder-message-field";
import { useToast } from "./toast";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Input, PageHeader, Skeleton } from "./ui";

const maxTitleLength = 200;
const maxGroups = 100;
const fieldClass = "w-full min-w-0 rounded-md border border-border-strong bg-surface px-3 text-sm placeholder:text-subtle";

// Quick choices for when the reminder goes off. With "custom" the date and time come from the field below them.
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

// Step 1: the groups the reminder goes to. The whole list is loaded, so searching happens right here.
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
      <legend className="sr-only">Chọn nhóm nhận nhắc hẹn</legend>
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

// What happened in each group, shown in place of the form once the bot has answered.
function Results({ results, onRetry, onAgain }: { results: ReminderCreateResult[]; onRetry: (groupIds: string[]) => void; onAgain: () => void }) {
  const failed = results.filter((item) => !item.ok);
  const succeeded = results.filter((item) => item.ok);
  return (
    <Card>
      <CardHeader
        title={failed.length === 0 ? `Đã tạo nhắc hẹn ở ${formatNumber(succeeded.length)} nhóm` : `Đã tạo ở ${formatNumber(succeeded.length)}/${formatNumber(results.length)} nhóm`}
        description={failed.length === 0 ? "Thành viên các nhóm này đã thấy nhắc hẹn trên Zalo." : "Nhóm báo lỗi chưa có nhắc hẹn; lý do Zalo trả về nằm cạnh tên nhóm."}
      />
      <ul role="status" className="max-h-[26rem] divide-y divide-border overflow-y-auto overscroll-contain">
        {[...failed, ...succeeded].map((item) => (
          <li key={item.groupId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
            <span className="min-w-0 flex-1 truncate">{item.groupName || item.groupId}</span>
            {item.ok ? <>{item.warning ? <span className="min-w-0 text-warning">{item.warning}</span> : null}<Badge tone={item.warning ? "warning" : "success"}>Đã tạo</Badge></> : <><span className="min-w-0 text-danger">{item.error}</span><Badge tone="danger">Lỗi</Badge></>}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">
        {failed.length > 0 ? <Button onClick={() => onRetry(failed.map((item) => item.groupId))}>Thử lại {formatNumber(failed.length)} nhóm lỗi</Button> : null}
        <Button onClick={onAgain}>Tạo nhắc hẹn khác</Button>
        <Link href="/reminders" className="inline-flex h-9 items-center rounded-md bg-foreground px-3 text-sm font-medium text-background transition-opacity hover:opacity-85">Xem lịch nhắc hẹn</Link>
      </div>
    </Card>
  );
}

// Creates one Zalo reminder in several groups: pick the groups, then say what and when.
export function ReminderForm() {
  const { data: groups, error: loadError } = useSWR<ReminderGroup[]>("/reminders/groups");
  const { mutate } = useSWRConfig();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [title, setTitle] = useState("");
  const [timeChoice, setTimeChoice] = useState<TimeChoice>(defaultTimeChoice);
  const [when, setWhen] = useState("");
  const now = useNow();
  const whenInput = useRef<HTMLInputElement>(null);
  const [repeat, setRepeat] = useState<ReminderRepeat>("none");
  const [onCreate, setOnCreate] = useState<MessageDraft>(emptyMessageDraft);
  const [onDue, setOnDue] = useState<MessageDraft>(emptyMessageDraft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [results, setResults] = useState<ReminderCreateResult[]>();
  const toast = useToast();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    // A group that was switched off or left since it was ticked is no longer in the list.
    const groupIds = (groups ?? []).filter((group) => selected.has(group.groupId)).map((group) => group.groupId);
    // "15 phút nữa" counts from the moment the form is sent, not from when the page was opened.
    const startTime = resolveTime(timeChoice, when, Date.now());
    if (groupIds.length === 0) return setError("Hãy chọn ít nhất một nhóm.");
    if (groupIds.length > maxGroups) return setError(`Mỗi lần chỉ tạo được cho tối đa ${maxGroups} nhóm; hãy bỏ bớt ${formatNumber(groupIds.length - maxGroups)} nhóm.`);
    if (title.trim() === "") return setError("Hãy nhập nội dung nhắc hẹn.");
    if (Number.isNaN(startTime)) return setError("Hãy chọn ngày nhắc hẹn.");
    if (startTime <= Date.now()) return setError("Thời gian nhắc phải ở tương lai.");
    const createProblem = messageProblem(onCreate);
    if (createProblem !== undefined) return setError(`Tin nhắn khi tạo nhắc hẹn: ${createProblem}.`);
    const dueProblem = messageProblem(onDue);
    if (dueProblem !== undefined) return setError(`Tin nhắn khi đến giờ nhắc: ${dueProblem}.`);
    setPending(true);
    try {
      const response = await send<{ results: ReminderCreateResult[] }>("POST", "/reminders", { title: title.trim(), startTime, repeat, groupIds, onCreate: toMessagePayload(onCreate), onDue: toMessagePayload(onDue) });
      setResults(response.results);
      void mutate("/reminders");
      const created = response.results.filter((item) => item.ok).length;
      const warned = response.results.filter((item) => item.warning !== undefined).length;
      if (created === response.results.length && warned > 0) toast.error(`Đã tạo nhắc hẹn, nhưng tin nhắn kèm theo gặp lỗi ở ${formatNumber(warned)} nhóm`);
      else if (created === response.results.length) toast.success(`Đã tạo nhắc hẹn ở ${formatNumber(created)} nhóm`);
      else toast.error(`Chỉ tạo được nhắc hẹn ở ${formatNumber(created)}/${formatNumber(response.results.length)} nhóm`);
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setPending(false);
    }
  }

  const header = (
    <PageHeader
      title="Tạo nhắc hẹn"
      description="Một nhắc hẹn của Zalo, tạo cùng lúc ở nhiều nhóm. Thành viên thấy và trả lời nó như nhắc hẹn tạo bằng tay."
      action={<Link href="/reminders" className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-foreground"><ArrowLeft aria-hidden="true" className="size-4" />Lịch nhắc hẹn</Link>}
    />
  );

  if (results !== undefined) {
    return (
      <>
        {header}
        <Results
          results={results}
          onRetry={(groupIds) => {
            setSelected(new Set(groupIds));
            setResults(undefined);
          }}
          onAgain={() => {
            setSelected(new Set());
            setTitle("");
            setWhen("");
            setTimeChoice(defaultTimeChoice);
            setRepeat("none");
            setOnCreate(emptyMessageDraft);
            setOnDue(emptyMessageDraft);
            setResults(undefined);
          }}
        />
      </>
    );
  }

  // What the date field shows: the moment the chosen quick option stands for, or the one picked by hand.
  const resolved = now === undefined ? Number.NaN : resolveTime(timeChoice, when, now);
  const shownTime = Number.isNaN(resolved) ? undefined : resolved;

  // "Khác" starts from the time already on show, so the field never goes blank, and goes straight
  // to the date field with its picker open.
  function chooseTime(choice: TimeChoice) {
    if (choice === "custom" && timeChoice !== "custom" && shownTime !== undefined) setWhen(toLocalInput(shownTime));
    setTimeChoice(choice);
    if (choice === "custom") {
      whenInput.current?.focus();
      openPicker(whenInput.current);
    }
  }

  const selectedCount = (groups ?? []).filter((group) => selected.has(group.groupId)).length;

  return (
    <>
      {header}
      <form onSubmit={submit} className="grid items-start gap-6 lg:grid-cols-2">
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
              description="Bật bot ở nhóm cần nhắc hẹn rồi quay lại đây."
              action={<Link href="/groups" className="text-sm font-medium underline underline-offset-4">Mở danh sách nhóm</Link>}
            />
          ) : (
            <GroupPicker groups={groups} selected={selected} onChange={setSelected} />
          )}
        </Card>
        <Card>
          <CardHeader title="2. Nội dung nhắc hẹn" description="Zalo nhắc cả nhóm vào đúng giờ đã chọn." />
          <div className="space-y-4 p-5">
            <div>
              <label htmlFor="reminder-title" className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-medium">
                Nhập nội dung
                <span className="text-xs font-normal tabular-nums text-muted">{title.length}/{maxTitleLength}</span>
              </label>
              <textarea id="reminder-title" name="title" rows={3} maxLength={maxTitleLength} autoComplete="off" placeholder="Ví dụ: Họp nhóm lúc 20 giờ tối nay…" value={title} onChange={(event) => setTitle(event.target.value)} className={`${fieldClass} resize-y py-2`} />
            </div>
            <div>
              <p id="reminder-time-label" className="mb-1.5 text-sm font-medium">Chọn thời gian</p>
              <div role="radiogroup" aria-labelledby="reminder-time-label" className="flex flex-wrap gap-2">
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
              <label htmlFor="reminder-when" className="mb-1.5 block text-sm font-medium">Chọn ngày nhắc hẹn</label>
              {/* The field always shows the moment the reminder will go off, in words. The real date and time
                  input lies invisibly on top of it: a click opens its picker, and picking a time selects "Khác". */}
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
                    setWhen(event.target.value);
                    setTimeChoice("custom");
                  }}
                  onClick={(event) => openPicker(event.currentTarget)}
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                />
              </div>
            </div>
            <div>
              <label htmlFor="reminder-repeat" className="mb-1.5 block text-sm font-medium">Chọn kiểu lặp lại <span className="font-normal text-muted">(vd: Lặp lại hằng tuần)</span></label>
              <select id="reminder-repeat" name="repeat" value={repeat} onChange={(event) => setRepeat(reminderRepeats.find((item) => item === event.target.value) ?? "none")} className={`${fieldClass} h-9`}>
                {reminderRepeats.map((item) => <option key={item} value={item}>{reminderRepeatLabels[item]}</option>)}
              </select>
            </div>
            <fieldset className="space-y-2">
              <legend className="mb-1.5 text-sm font-medium">Tin nhắn kèm theo <span className="font-normal text-muted">(không bắt buộc)</span></legend>
              <MessageField
                label="Gửi tin nhắn khi tạo nhắc hẹn"
                hint="Bot gửi vào nhóm ngay sau khi nhắc hẹn được tạo."
                placeholder="Ví dụ: Mọi người bấm tham gia nhắc hẹn bên trên nhé…"
                value={onCreate}
                onChange={setOnCreate}
              />
              <MessageField
                label="Gửi tin nhắn khi đến giờ nhắc"
                hint="Bot gửi vào nhóm đúng giờ nhắc, và mỗi lần nhắc nếu nhắc hẹn lặp lại. Bot phải đang chạy vào lúc đó."
                placeholder="Ví dụ: Đến giờ họp rồi, mọi người vào phòng nhé…"
                value={onDue}
                onChange={setOnDue}
              />
            </fieldset>
            <p className="text-sm text-muted">Nhóm tắt quyền tạo nhắc hẹn của thành viên sẽ báo lỗi nếu bot không phải trưởng/phó nhóm.</p>
            <ErrorNote message={error} />
            <div className="flex justify-end">
              <Button type="submit" variant="primary" pending={pending}>
                {pending ? "Đang tạo…" : selectedCount > 0 ? `Tạo nhắc hẹn cho ${formatNumber(selectedCount)} nhóm` : "Tạo nhắc hẹn"}
              </Button>
            </div>
          </div>
        </Card>
      </form>
    </>
  );
}
