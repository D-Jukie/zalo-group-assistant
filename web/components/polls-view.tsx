"use client";

import { Download, Plus, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import useSWR, { useSWRConfig } from "swr";
import { errorText, send } from "@/lib/api";
import { downloadExcel, slug } from "@/lib/excel";
import { cn, formatDateTime, formatNumber, localDayKey } from "@/lib/format";
import type { Poll, PollGroupResults, ReminderGroup } from "@/lib/types";
import { ConfirmDialog } from "./confirm-dialog";
import { fieldClass, GroupPickerCard, GroupResults, maxGroups } from "./schedule-fields";
import { useToast } from "./toast";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNote, PageHeader, Skeleton } from "./ui";

const maxQuestionLength = 200;
const maxOptions = 30;
const maxOptionLength = 200;

const views = [
  { value: "create", label: "Tạo bình chọn" },
  { value: "list", label: "Bình chọn đã tạo" },
] as const;

const listHref = "/polls?view=list";

// What a poll lets its voters do; the names are the ones the bot takes.
const switches = [
  { key: "allowMultiChoices", label: "Cho chọn nhiều lựa chọn", hint: "Mỗi người chọn được hơn một lựa chọn." },
  { key: "allowAddNewOption", label: "Cho thành viên thêm lựa chọn", hint: "Thành viên tự thêm được lựa chọn mới vào bình chọn." },
  { key: "hideVotePreview", label: "Ẩn kết quả khi chưa bình chọn", hint: "Chỉ người đã bình chọn mới xem được kết quả." },
  { key: "isAnonymous", label: "Bình chọn ẩn danh", hint: "Không ai xem được ai đã chọn gì; file xuất ra chỉ có số phiếu." },
] as const;

type SwitchKey = (typeof switches)[number]["key"];

// The create tab: pick the groups, write the question and its options, and create the poll in each group.
function PollForm() {
  const { data: groups, error: loadError } = useSWR<ReminderGroup[]>("/reminders/groups");
  const { mutate } = useSWRConfig();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [flags, setFlags] = useState<Record<SwitchKey, boolean>>({ allowMultiChoices: false, allowAddNewOption: false, hideVotePreview: false, isAnonymous: false });
  // The deadline as the date-and-time field holds it ("2026-10-15T20:00"); empty for a poll that stays open.
  const [deadline, setDeadline] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<Poll>();
  const toast = useToast();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    // A group that was switched off or left since it was ticked is no longer in the list.
    const groupIds = (groups ?? []).filter((group) => selected.has(group.groupId)).map((group) => group.groupId);
    const filled = options.map((option) => option.trim()).filter((option) => option !== "");
    if (groupIds.length === 0) return setError("Hãy chọn ít nhất một nhóm.");
    if (groupIds.length > maxGroups) return setError(`Mỗi lần chỉ tạo được cho tối đa ${maxGroups} nhóm.`);
    if (question.trim() === "") return setError("Hãy nhập câu hỏi.");
    if (filled.length < 2) return setError("Hãy nhập ít nhất hai lựa chọn.");
    if (new Set(filled).size !== filled.length) return setError("Các lựa chọn không được trùng nhau.");
    // The field's value has no time zone: it is read in the browser's own.
    const expiresAt = deadline === "" ? undefined : new Date(deadline).getTime();
    if (expiresAt !== undefined && (Number.isNaN(expiresAt) || expiresAt < Date.now() + 60_000)) return setError("Thời hạn phải ở tương lai, ít nhất một phút nữa.");
    setPending(true);
    try {
      const poll = await send<Poll>("POST", "/polls", { question: question.trim(), options: filled, groupIds, ...flags, ...(expiresAt === undefined ? {} : { expiresAt }) });
      setCreated(poll);
      void mutate("/polls");
      const done = poll.groups.filter((group) => group.ok).length;
      if (done === poll.groups.length) toast.success(`Đã tạo bình chọn ở ${formatNumber(done)} nhóm`);
      else toast.error(`Chỉ tạo được bình chọn ở ${formatNumber(done)}/${formatNumber(poll.groups.length)} nhóm`);
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setPending(false);
    }
  }

  if (created !== undefined) {
    const done = created.groups.filter((group) => group.ok).length;
    const total = created.groups.length;
    return (
      <GroupResults
        results={created.groups}
        title={done === total ? `Đã tạo bình chọn ở ${formatNumber(done)} nhóm` : `Đã tạo ở ${formatNumber(done)}/${formatNumber(total)} nhóm`}
        description={done < total ? "Nhóm báo lỗi chưa có bình chọn; lý do nằm cạnh tên nhóm." : "Bình chọn đã có trong các nhóm này. Kết quả xem ở tab “Bình chọn đã tạo”."}
        doneLabel="Đã tạo"
        againLabel="Tạo bình chọn khác"
        backHref={listHref}
        backLabel="Xem bình chọn đã tạo"
        onRetry={(groupIds) => {
          setSelected(new Set(groupIds));
          setCreated(undefined);
        }}
        onAgain={() => {
          setSelected(new Set());
          setQuestion("");
          setOptions(["", ""]);
          setDeadline("");
          setCreated(undefined);
        }}
      />
    );
  }

  const selectedCount = (groups ?? []).filter((group) => selected.has(group.groupId)).length;
  return (
    <form onSubmit={submit} className="grid items-start gap-6 lg:grid-cols-2">
      <GroupPickerCard groups={groups} loadError={loadError} selected={selected} onChange={setSelected} emptyDescription="Bật bot ở nhóm cần tạo bình chọn rồi quay lại đây." />
      <Card>
        <CardHeader title="2. Bình chọn" description="Một câu hỏi và các lựa chọn. Bot tạo một bình chọn giống nhau ở từng nhóm đã chọn." />
        <div className="space-y-4 p-5">
          <div>
            <label htmlFor="poll-question" className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-medium">
              Câu hỏi
              <span className="text-xs font-normal tabular-nums text-muted">{formatNumber(question.length)}/{maxQuestionLength}</span>
            </label>
            <textarea id="poll-question" rows={2} maxLength={maxQuestionLength} autoComplete="off" placeholder="Ví dụ: Lớp mình đi dã ngoại ngày nào?…" value={question} onChange={(event) => setQuestion(event.target.value)} className={cn(fieldClass, "resize-y py-2")} />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Lựa chọn <span className="font-normal text-muted">(ít nhất 2, tối đa {maxOptions})</span></legend>
            <ul className="space-y-2">
              {options.map((option, index) => (
                <li key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    aria-label={`Lựa chọn ${index + 1}`}
                    maxLength={maxOptionLength}
                    autoComplete="off"
                    placeholder={`Lựa chọn ${index + 1}…`}
                    value={option}
                    onChange={(event) => setOptions(options.map((item, position) => (position === index ? event.target.value : item)))}
                    className={cn(fieldClass, "h-9")}
                  />
                  <button type="button" aria-label={`Bỏ lựa chọn ${index + 1}`} disabled={options.length <= 2} onClick={() => setOptions(options.filter((_item, position) => position !== index))} className="grid size-9 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40">
                    <X aria-hidden="true" className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
            <Button className="mt-2" disabled={options.length >= maxOptions} onClick={() => setOptions([...options, ""])}>
              <Plus aria-hidden="true" className="size-4" />
              Thêm lựa chọn
            </Button>
          </fieldset>
          <div>
            <label htmlFor="poll-deadline" className="mb-1.5 block text-sm font-medium">Thời hạn <span className="font-normal text-muted">(không bắt buộc)</span></label>
            <div className="flex flex-wrap items-center gap-2">
              <input id="poll-deadline" type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} className={cn(fieldClass, "h-9 w-auto")} />
              {deadline === "" ? null : <Button variant="ghost" onClick={() => setDeadline("")}>Bỏ thời hạn</Button>}
            </div>
            <p className="mt-1.5 text-sm text-muted">{deadline === "" ? "Để trống thì bình chọn mở cho tới khi bị khóa." : "Tới giờ này Zalo tự đóng bình chọn ở mọi nhóm."}</p>
          </div>
          <fieldset className="space-y-2.5">
            <legend className="mb-1.5 text-sm font-medium">Tùy chọn</legend>
            {switches.map((item) => (
              <label key={item.key} className="flex cursor-pointer items-start gap-2 text-sm">
                <input type="checkbox" checked={flags[item.key]} onChange={(event) => setFlags({ ...flags, [item.key]: event.target.checked })} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
                <span><span className="font-medium">{item.label}</span><span className="block text-muted">{item.hint}</span></span>
              </label>
            ))}
          </fieldset>
          <ErrorNote message={error} />
          <div className="flex justify-end">
            <Button type="submit" variant="primary" pending={pending}>
              {pending ? "Đang tạo…" : selectedCount > 0 ? `Tạo bình chọn cho ${formatNumber(selectedCount)} nhóm` : "Tạo bình chọn"}
            </Button>
          </div>
        </div>
      </Card>
    </form>
  );
}

const detailHeader = ["Nhóm", "Thành viên", "ID Zalo", "Lựa chọn"] as const;
const summaryHeader = ["Nhóm", "Lựa chọn", "Số phiếu", "Tỉ lệ trên người đã bình chọn"] as const;

// One row per vote, then one per member who has not voted. An anonymous poll has no names to list.
function detailRows(groups: readonly PollGroupResults[]): string[][] {
  return groups.flatMap((group) => [
    ...group.options.flatMap((option) => option.voters.map((voter) => [group.groupName || group.groupId, voter.name, voter.userId, option.content])),
    ...group.notVoted.map((member) => [group.groupName || group.groupId, member.name, member.userId, "Chưa bình chọn"]),
  ]);
}

function share(votes: number, voters: number): string {
  return voters === 0 ? "0%" : `${Math.round((votes / voters) * 100)}%`;
}

function summaryRows(groups: readonly PollGroupResults[]): string[][] {
  return groups.flatMap((group) => [
    ...group.options.map((option) => [group.groupName || group.groupId, option.content, String(option.votes), share(option.votes, group.voterCount)]),
    ...(group.anonymous ? [] : [[group.groupName || group.groupId, "Chưa bình chọn", String(group.notVoted.length), ""]]),
  ]);
}

// The votes of one poll, read from Zalo when the row is opened.
function PollResults({ poll }: { poll: Poll }) {
  const toast = useToast();
  // Asked for once per opening: every read goes to Zalo, for each group of the poll.
  const { data, error, mutate, isValidating } = useSWR<{ groups: PollGroupResults[] }>(`/polls/${encodeURIComponent(poll.id)}/results`, { revalidateOnFocus: false, refreshInterval: 0 });

  async function exportFile(kind: "detail" | "summary") {
    if (data === undefined) return;
    const readable = data.groups.filter((group) => group.error === undefined);
    const rows = kind === "detail" ? detailRows(readable) : summaryRows(readable);
    if (rows.length === 0) return toast.error(kind === "detail" ? "Chưa có ai bình chọn, hoặc bình chọn ẩn danh nên không có danh sách" : "Chưa có dữ liệu để xuất");
    try {
      await downloadExcel(`binh-chon-${slug(poll.question) || poll.id}-${kind === "detail" ? "chi-tiet" : "tong-hop"}-${localDayKey(Date.now())}.xlsx`, kind === "detail" ? detailHeader : summaryHeader, rows);
      toast.success(`Đã xuất ${formatNumber(rows.length)} dòng`);
    } catch (exception) {
      toast.error(errorText(exception));
    }
  }

  if (data === undefined) {
    return <div className="mt-3 space-y-2">{error ? <p className="text-sm text-danger">{errorText(error)}</p> : <><p className="text-sm text-muted">Đang đọc kết quả từ Zalo…</p><Skeleton className="h-16 w-full" /></>}</div>;
  }
  return (
    <div className="mt-3 space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => exportFile("detail")}><Download aria-hidden="true" className="size-4" />Xuất chi tiết</Button>
        <Button onClick={() => exportFile("summary")}><Download aria-hidden="true" className="size-4" />Xuất tổng hợp</Button>
        <Button variant="ghost" pending={isValidating} onClick={() => void mutate()}>Đọc lại</Button>
      </div>
      {data.groups.map((group) => (
        <section key={group.groupId} className="rounded-md border border-border bg-background px-4 py-3">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <span translate="no">{group.groupName || group.groupId}</span>
            {group.closed ? <Badge>Đã khóa</Badge> : null}
            {group.anonymous ? <Badge>Ẩn danh</Badge> : null}
          </h3>
          {group.error !== undefined ? <p className="mt-1 text-sm text-danger">Không đọc được kết quả: {group.error}</p> : (
            <>
              <p className="mt-1 text-sm text-muted">
                {formatNumber(group.voterCount)} người đã bình chọn{group.anonymous ? "" : ` · ${formatNumber(group.notVoted.length)}/${formatNumber(group.memberCount)} thành viên chưa bình chọn`}
              </p>
              <ul className="mt-3 space-y-2.5">
                {group.options.map((option) => (
                  <li key={option.content}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 break-words font-medium">{option.content}</span>
                      <span className="shrink-0 tabular-nums text-muted">{formatNumber(option.votes)} phiếu · {share(option.votes, group.voterCount)}</span>
                    </div>
                    <div aria-hidden="true" className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-hover">
                      <div className="h-full rounded-full bg-accent" style={{ width: share(option.votes, group.voterCount) }} />
                    </div>
                    {option.voters.length > 0 ? <p className="mt-1 text-sm text-muted">{option.voters.map((voter) => voter.name).join(", ")}</p> : null}
                  </li>
                ))}
              </ul>
              {group.notVoted.length > 0 ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-muted hover:text-foreground">Chưa bình chọn ({formatNumber(group.notVoted.length)})</summary>
                  <p className="mt-1 text-sm text-muted">{group.notVoted.map((member) => member.name || member.userId).join(", ")}</p>
                </details>
              ) : null}
            </>
          )}
        </section>
      ))}
    </div>
  );
}

// The polls made from here, newest first. Opening one reads its votes from Zalo.
function PollList() {
  const { data: polls, error, mutate } = useSWR<Poll[]>("/polls");
  const [open, setOpen] = useState<string>();
  const [confirming, setConfirming] = useState<{ poll: Poll; action: "lock" | "remove" }>();
  const [pending, setPending] = useState(false);
  const { mutate: mutateGlobal } = useSWRConfig();
  const toast = useToast();

  async function run(poll: Poll, action: "lock" | "remove") {
    setPending(true);
    try {
      if (action === "remove") {
        await send("DELETE", `/polls/${encodeURIComponent(poll.id)}`);
        void mutate((current) => current?.filter((item) => item.id !== poll.id), { revalidate: false });
        toast.success("Đã bỏ bình chọn khỏi danh sách");
      } else {
        const response = await send<{ results: { ok: boolean }[] }>("POST", `/polls/${encodeURIComponent(poll.id)}/lock`);
        const done = response.results.filter((item) => item.ok).length;
        if (done === response.results.length) toast.success(`Đã khóa bình chọn ở ${formatNumber(done)} nhóm`);
        else toast.error(`Chỉ khóa được ở ${formatNumber(done)}/${formatNumber(response.results.length)} nhóm`);
        void mutateGlobal(`/polls/${encodeURIComponent(poll.id)}/results`);
      }
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setPending(false);
      setConfirming(undefined);
    }
  }

  return (
    <>
      <Card>
        <CardHeader title="Bình chọn đã tạo" description="Những bình chọn tạo từ trang này. Mở một bình chọn để đọc kết quả từ Zalo và xuất ra file Excel." />
        {polls === undefined ? (
          <div className="space-y-3 p-5">{error ? <p className="text-sm text-danger">{errorText(error)}</p> : Array.from({ length: 3 }, (_item, index) => <Skeleton key={index} className="h-14 w-full" />)}</div>
        ) : polls.length === 0 ? (
          <EmptyState title="Chưa có bình chọn nào" description="Bình chọn tạo ở tab “Tạo bình chọn” sẽ hiện ở đây." />
        ) : (
          <ul className="divide-y divide-border">
            {polls.map((poll) => {
              const done = poll.groups.filter((group) => group.ok).length;
              return (
                <li key={poll.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 basis-64">
                      <p className="break-words text-sm font-medium">{poll.question}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                        <span className="tabular-nums">{formatDateTime(poll.createdAt)}</span>
                        <span>{formatNumber(poll.options.length)} lựa chọn · {formatNumber(done)}/{formatNumber(poll.groups.length)} nhóm</span>
                        {poll.expiresAt === undefined ? null : <span>Hạn {formatDateTime(poll.expiresAt)}</span>}
                        {poll.isAnonymous ? <Badge>Ẩn danh</Badge> : null}
                        {poll.allowMultiChoices ? <Badge>Chọn nhiều</Badge> : null}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant={open === poll.id ? "secondary" : "primary"} aria-expanded={open === poll.id} onClick={() => setOpen(open === poll.id ? undefined : poll.id)}>{open === poll.id ? "Ẩn kết quả" : "Xem kết quả"}</Button>
                      <Button disabled={pending} onClick={() => setConfirming({ poll, action: "lock" })}>Khóa</Button>
                      <Button variant="ghost" disabled={pending} onClick={() => setConfirming({ poll, action: "remove" })}>Bỏ khỏi danh sách</Button>
                    </div>
                  </div>
                  {open === poll.id ? <PollResults poll={poll} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <ConfirmDialog
        open={confirming !== undefined}
        title={confirming?.action === "remove" ? "Bỏ bình chọn khỏi danh sách?" : "Khóa bình chọn?"}
        confirmLabel={confirming?.action === "remove" ? "Bỏ khỏi danh sách" : "Khóa bình chọn"}
        pending={pending}
        onConfirm={() => { if (confirming !== undefined) void run(confirming.poll, confirming.action); }}
        onCancel={() => setConfirming(undefined)}
      >
        {confirming?.action === "remove"
          ? "Bình chọn vẫn còn trong các nhóm trên Zalo, nhưng trang này sẽ không đọc được kết quả của nó nữa."
          : "Bình chọn sẽ bị khóa ở mọi nhóm đã tạo: không ai bình chọn thêm được nữa. Việc này không mở lại được từ đây."}
      </ConfirmDialog>
    </>
  );
}

// Zalo's polls: put one question to several groups, then read who chose what and export it.
// Which of the two tabs is shown lives in the URL.
export function PollsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = views.find((item) => item.value === searchParams.get("view"))?.value ?? "create";
  const { data: polls } = useSWR<Poll[]>("/polls");

  return (
    <>
      <PageHeader title="Bình chọn" description="Bot tạo một bình chọn ở nhiều nhóm cùng lúc, đọc lại ai đã chọn gì, và xuất kết quả ra file Excel." />
      <div role="group" aria-label="Chọn tạo bình chọn hoặc bình chọn đã tạo" className="mb-4 inline-flex gap-1 rounded-md border border-border bg-surface p-1">
        {views.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={view === item.value}
            onClick={() => router.replace(item.value === "create" ? pathname : `${pathname}?view=${item.value}`, { scroll: false })}
            className={cn("h-7 rounded px-2.5 text-sm transition-colors", view === item.value ? "bg-surface-hover font-medium text-foreground" : "text-muted hover:text-foreground")}
          >
            {item.label}
            {item.value === "list" && polls !== undefined && polls.length > 0 ? <span className="ml-1.5 tabular-nums text-muted">{formatNumber(polls.length)}</span> : null}
          </button>
        ))}
      </div>
      {view === "list" ? <PollList /> : <PollForm />}
    </>
  );
}
