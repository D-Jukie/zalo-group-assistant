"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import useSWR, { useSWRConfig } from "swr";
import { errorText, send } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import type { ReminderCreateResult, ReminderGroup } from "@/lib/types";
import { emptyMessageDraft, MessageField, messageProblem, toMessagePayload, type MessageDraft } from "./reminder-message-field";
import { fieldClass, GroupPickerCard, GroupResults, maxGroups, ScheduleFields, useSchedule } from "./schedule-fields";
import { useToast } from "./toast";
import { Button, Card, CardHeader, ErrorNote, PageHeader } from "./ui";

const maxTitleLength = 200;

// Creates one Zalo reminder in several groups: pick the groups, then say what and when.
export function ReminderForm() {
  const { data: groups, error: loadError } = useSWR<ReminderGroup[]>("/reminders/groups");
  const { mutate } = useSWRConfig();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [title, setTitle] = useState("");
  const schedule = useSchedule();
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
    const startTime = schedule.startTime(Date.now());
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
      const response = await send<{ results: ReminderCreateResult[] }>("POST", "/reminders", { title: title.trim(), startTime, repeat: schedule.repeat, groupIds, onCreate: toMessagePayload(onCreate), onDue: toMessagePayload(onDue) });
      setResults(response.results);
      void mutate("/reminders");
      void mutate("/reminder-messages");
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
    const created = results.filter((item) => item.ok).length;
    return (
      <>
        {header}
        <GroupResults
          results={results}
          title={created === results.length ? `Đã tạo nhắc hẹn ở ${formatNumber(created)} nhóm` : `Đã tạo ở ${formatNumber(created)}/${formatNumber(results.length)} nhóm`}
          description={created === results.length ? "Thành viên các nhóm này đã thấy nhắc hẹn trên Zalo." : "Nhóm báo lỗi chưa có nhắc hẹn; lý do Zalo trả về nằm cạnh tên nhóm."}
          doneLabel="Đã tạo"
          againLabel="Tạo nhắc hẹn khác"
          backHref="/reminders"
          backLabel="Xem lịch nhắc hẹn"
          onRetry={(groupIds) => {
            setSelected(new Set(groupIds));
            setResults(undefined);
          }}
          onAgain={() => {
            setSelected(new Set());
            setTitle("");
            schedule.reset();
            setOnCreate(emptyMessageDraft);
            setOnDue(emptyMessageDraft);
            setResults(undefined);
          }}
        />
      </>
    );
  }

  const selectedCount = (groups ?? []).filter((group) => selected.has(group.groupId)).length;

  return (
    <>
      {header}
      <form onSubmit={submit} className="grid items-start gap-6 lg:grid-cols-2">
        <GroupPickerCard groups={groups} loadError={loadError} selected={selected} onChange={setSelected} emptyDescription="Bật bot ở nhóm cần nhắc hẹn rồi quay lại đây." />
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
            <ScheduleFields schedule={schedule} dateLabel="Chọn ngày nhắc hẹn" />
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
