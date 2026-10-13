"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import useSWR, { useSWRConfig } from "swr";
import { errorText, send } from "@/lib/api";
import { cn, formatNumber } from "@/lib/format";
import type { ReminderCreateResult, ReminderGroup } from "@/lib/types";
import { ConfirmDialog } from "./confirm-dialog";
import { dataUrlPayload, MessageEditor, pickedPictureView, type PickedImage } from "./reminder-message-field";
import { GroupPickerCard, GroupResults, maxGroups, ScheduleFields, useSchedule } from "./schedule-fields";
import { useToast } from "./toast";
import { Button, Card, CardHeader, ErrorNote } from "./ui";

// The waiting messages are the other tab of the same page.
const waitingHref = "/broadcast?view=waiting";

const modes = [
  { value: "now", label: "Gửi ngay" },
  { value: "later", label: "Hẹn giờ" },
] as const;

type Mode = (typeof modes)[number]["value"];

// How Zalo marks the message in the group.
const urgencies = [
  { value: "normal", label: "Bình thường" },
  { value: "important", label: "Quan trọng" },
  { value: "urgent", label: "Khẩn cấp" },
] as const;

type Urgency = (typeof urgencies)[number]["value"];

// The sent messages are another tab of the same page.
const sentHref = "/broadcast?view=sent";

// What is about to go out, kept while the "send now" confirmation is open.
type Outgoing = { groupIds: string[]; body: Record<string, unknown> };

// The compose tab of the bulk messaging page. Sends one message from the bot to several groups: pick the groups, write the message, then send it
// at once or set a time. No Zalo reminder is involved; a scheduled message waits in the bot's queue.
export function MessageForm() {
  const { data: groups, error: loadError } = useSWR<ReminderGroup[]>("/reminders/groups");
  const { mutate } = useSWRConfig();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [text, setText] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]);
  const [mode, setMode] = useState<Mode>("now");
  const [urgency, setUrgency] = useState<Urgency>("normal");
  const schedule = useSchedule();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState<Outgoing>();
  // The mode the shown results came from, so they keep their wording if the mode is changed afterwards.
  const [results, setResults] = useState<{ mode: Mode; items: ReminderCreateResult[] }>();
  const toast = useToast();

  async function deliver(outgoing: Outgoing, sentMode: Mode) {
    setPending(true);
    try {
      const response = await send<{ results: ReminderCreateResult[] }>("POST", "/reminder-messages", outgoing.body);
      setResults({ mode: sentMode, items: response.results });
      void mutate("/reminder-messages");
      void mutate("/sent-batches");
      const done = response.results.filter((item) => item.ok).length;
      const verb = sentMode === "now" ? "gửi tin nhắn" : "hẹn giờ tin nhắn";
      if (done === response.results.length) toast.success(`Đã ${verb} cho ${formatNumber(done)} nhóm`);
      else toast.error(`Chỉ ${verb} được cho ${formatNumber(done)}/${formatNumber(response.results.length)} nhóm`);
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setPending(false);
      setConfirming(undefined);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    // A group that was switched off or left since it was ticked is no longer in the list.
    const groupIds = (groups ?? []).filter((group) => selected.has(group.groupId)).map((group) => group.groupId);
    if (groupIds.length === 0) return setError("Hãy chọn ít nhất một nhóm.");
    if (groupIds.length > maxGroups) return setError(`Mỗi lần chỉ gửi được cho tối đa ${maxGroups} nhóm; hãy bỏ bớt ${formatNumber(groupIds.length - maxGroups)} nhóm.`);
    if (text.trim() === "" && images.length === 0) return setError("Hãy nhập nội dung tin nhắn hoặc chọn ảnh.");
    const message = { text: text.trim(), images: images.map((image) => ({ data: dataUrlPayload(image.dataUrl) })), urgency };
    if (mode === "now") {
      // A message that has gone out has been read by then, even if it is taken back, so sending at once asks first.
      setConfirming({ groupIds, body: { message, groupIds, sendNow: true } });
      return;
    }
    // "15 phút nữa" counts from the moment the form is sent, not from when the page was opened.
    const startTime = schedule.startTime(Date.now());
    if (Number.isNaN(startTime)) return setError("Hãy chọn ngày gửi.");
    if (startTime <= Date.now()) return setError("Thời gian gửi phải ở tương lai.");
    void deliver({ groupIds, body: { message, groupIds, startTime, repeat: schedule.repeat } }, "later");
  }

  if (results !== undefined) {
    const done = results.items.filter((item) => item.ok).length;
    const total = results.items.length;
    const now = results.mode === "now";
    return (
      <>
        <GroupResults
          results={results.items}
          title={now
            ? done === total ? `Đã gửi tin nhắn cho ${formatNumber(done)} nhóm` : `Đã gửi cho ${formatNumber(done)}/${formatNumber(total)} nhóm`
            : done === total ? `Đã hẹn giờ tin nhắn cho ${formatNumber(done)} nhóm` : `Đã hẹn giờ cho ${formatNumber(done)}/${formatNumber(total)} nhóm`}
          description={done < total
            ? `Nhóm báo lỗi chưa ${now ? "nhận được tin" : "được hẹn giờ"}; lý do nằm cạnh tên nhóm.`
            : now ? "Tin nhắn đã có trong các nhóm này." : "Tin nhắn nằm trong danh sách chờ gửi; sửa hoặc hủy được cho tới giờ gửi."}
          doneLabel={now ? "Đã gửi" : "Đã hẹn giờ"}
          againLabel="Soạn tin nhắn khác"
          backHref={now ? sentHref : waitingHref}
          backLabel={now ? "Xem tin nhắn đã gửi" : "Xem tin nhắn chờ gửi"}
          onRetry={(groupIds) => {
            setSelected(new Set(groupIds));
            setResults(undefined);
          }}
          onAgain={() => {
            setSelected(new Set());
            setText("");
            setUrgency("normal");
            setImages([]);
            schedule.reset();
            setResults(undefined);
          }}
        />
      </>
    );
  }

  const selectedCount = (groups ?? []).filter((group) => selected.has(group.groupId)).length;
  const idle = mode === "now"
    ? selectedCount > 0 ? `Gửi ngay cho ${formatNumber(selectedCount)} nhóm` : "Gửi ngay"
    : selectedCount > 0 ? `Hẹn giờ cho ${formatNumber(selectedCount)} nhóm` : "Hẹn giờ gửi";

  return (
    <>
      <form onSubmit={submit} className="grid items-start gap-6 lg:grid-cols-2">
        <GroupPickerCard groups={groups} loadError={loadError} selected={selected} onChange={setSelected} emptyDescription="Bật bot ở nhóm cần gửi tin rồi quay lại đây." />
        <Card>
          <CardHeader title="2. Tin nhắn" description="Chữ, tối đa 6 ảnh, hoặc cả hai. Nhiều ảnh được gửi thành một album." />
          <div className="space-y-4 p-5">
            <MessageEditor
              text={text}
              onTextChange={setText}
              pictures={images.map(pickedPictureView)}
              onPick={(picked) => setImages((current) => [...current, ...picked])}
              onRemovePicture={(index) => setImages((current) => current.filter((_image, position) => position !== index))}
              placeholder="Ví dụ: Thông báo lịch nghỉ lễ, nhóm tạm ngưng nhận đơn từ…"
              pictureLabel="Ảnh kèm theo tin nhắn"
            />
            <div>
              <p id="urgency-label" className="mb-1.5 text-sm font-medium">Mức độ</p>
              <div role="radiogroup" aria-labelledby="urgency-label" className="inline-flex gap-1 rounded-md border border-border bg-background p-1">
                {urgencies.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="radio"
                    aria-checked={urgency === item.value}
                    onClick={() => setUrgency(item.value)}
                    className={cn(
                      "h-7 rounded px-3 text-sm transition-colors",
                      urgency === item.value ? "bg-surface-hover font-medium text-foreground" : "text-muted hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {urgency === "normal" ? null : <p className="mt-1.5 text-sm text-muted">Zalo đánh dấu tin này là {urgency === "urgent" ? "khẩn cấp" : "quan trọng"} trong nhóm.</p>}
            </div>
            <div>
              <p id="send-mode-label" className="mb-1.5 text-sm font-medium">Thời điểm gửi</p>
              <div role="radiogroup" aria-labelledby="send-mode-label" className="inline-flex gap-1 rounded-md border border-border bg-background p-1">
                {modes.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="radio"
                    aria-checked={mode === item.value}
                    onClick={() => setMode(item.value)}
                    className={cn(
                      "h-7 rounded px-3 text-sm transition-colors",
                      mode === item.value ? "bg-surface-hover font-medium text-foreground" : "text-muted hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            {mode === "later" ? (
              <>
                <ScheduleFields schedule={schedule} dateLabel="Chọn ngày gửi" />
                <p className="text-sm text-muted">Bot phải đang chạy vào giờ gửi. Với kiểu lặp lại, bot gửi lại tin này mỗi ngày, mỗi tuần hoặc mỗi tháng cho tới khi bạn hủy ở danh sách chờ gửi.</p>
              </>
            ) : (
              <p className="text-sm text-muted">Bot gửi lần lượt từng nhóm ngay khi bạn xác nhận. Tin đã gửi nằm ở tab “Tin nhắn đã gửi”, nơi thu hồi được cả đợt.</p>
            )}
            <ErrorNote message={error} />
            <div className="flex justify-end">
              <Button type="submit" variant="primary" pending={pending}>
                {pending ? (mode === "now" ? "Đang gửi…" : "Đang hẹn giờ…") : idle}
              </Button>
            </div>
          </div>
        </Card>
      </form>
      <ConfirmDialog
        open={confirming !== undefined}
        title="Gửi tin nhắn ngay bây giờ?"
        confirmLabel="Gửi ngay"
        pending={pending}
        onConfirm={() => { if (confirming !== undefined) void deliver(confirming, "now"); }}
        onCancel={() => setConfirming(undefined)}
      >
        Bot sẽ gửi tin này vào {formatNumber(confirming?.groupIds.length ?? 0)} nhóm ngay lập tức. Sau khi gửi, đợt này thu hồi được ở tab “Tin nhắn đã gửi” trong thời gian Zalo cho phép.
      </ConfirmDialog>
    </>
  );
}
