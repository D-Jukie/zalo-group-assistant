"use client";

import { ImageIcon, Repeat } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { errorText, send } from "@/lib/api";
import { formatFriendlyDateTime, formatNumber } from "@/lib/format";
import { reminderRepeatLabels, type PendingReminderMessage, type ReminderList } from "@/lib/types";
import { ConfirmDialog } from "./confirm-dialog";
import { FormattedText } from "./formatted-text";
import { dataUrlPayload, MessageEditor, pickedPictureView, type PickedImage, type PictureView } from "./reminder-message-field";
import { RowCheckbox, RowNumber, SelectAllCheckbox, SelectionBar, useSelection } from "./selection";
import { useToast } from "./toast";
import { Badge, Button, Card, EmptyState, Skeleton } from "./ui";
import { GroupLink } from "./violation-item";

function messageId(message: PendingReminderMessage): string {
  return message.id;
}

function imageUrl(message: PendingReminderMessage, index: number): string {
  // The version makes the browser fetch the picture again after the message was changed.
  return `/api/reminder-messages/${encodeURIComponent(message.id)}/images/${index}?v=${message.updatedAt}`;
}

// One picture of a message being changed: one the bot already holds, by its position, or one just picked.
type EditedPicture = { kind: "stored"; index: number } | { kind: "new"; image: PickedImage };

// Changes the text and picture of one waiting message. A native modal dialog: it traps focus and closes on Escape.
function EditDialog({ message, onClose, onSaved }: { message: PendingReminderMessage; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(message.text);
  const [pictures, setPictures] = useState<EditedPicture[]>(() => Array.from({ length: message.imageCount }, (_item, index) => ({ kind: "stored", index })));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const toast = useToast();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);

  const shownPictures = pictures.map((picture, position): PictureView => picture.kind === "new"
    ? pickedPictureView(picture.image, position)
    : { key: `stored-${picture.index}`, src: imageUrl(message, picture.index), name: `Ảnh đang lưu ${picture.index + 1}` });

  async function save() {
    setError(undefined);
    if (text.trim() === "" && pictures.length === 0) return setError("Tin nhắn cần có nội dung hoặc ảnh.");
    setPending(true);
    try {
      // The whole list goes along, in order: pictures to keep by their position, new ones with their data.
      const images = pictures.map((picture) => picture.kind === "stored" ? { keep: picture.index } : { data: dataUrlPayload(picture.image.dataUrl) });
      await send("PATCH", `/reminder-messages/${encodeURIComponent(message.id)}`, { text: text.trim(), images });
      await onSaved();
      toast.success("Đã lưu tin nhắn");
      onClose();
    } catch (exception) {
      setError(errorText(exception));
    } finally {
      setPending(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="edit-message-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] overscroll-contain rounded-lg border border-border bg-surface p-0 text-foreground shadow-xl"
    >
      <div className="p-5">
        <h2 id="edit-message-title" className="text-base font-semibold">Sửa tin nhắn chờ gửi</h2>
        <p className="mt-1 text-sm text-muted">Gửi vào “{message.groupName || message.groupId}”{message.reminderId === "" ? " theo giờ đã hẹn." : ` khi đến giờ nhắc hẹn “${message.title || message.reminderId}”.`}</p>
        <div className="mt-4">
          <MessageEditor
            text={text}
            onTextChange={setText}
            pictures={shownPictures}
            onPick={(images) => setPictures((current) => [...current, ...images.map((image): EditedPicture => ({ kind: "new", image }))])}
            onRemovePicture={(index) => setPictures((current) => current.filter((_picture, position) => position !== index))}
            placeholder="Nội dung bot sẽ gửi vào nhóm…"
            pictureLabel="Ảnh kèm theo tin nhắn"
          />
        </div>
        <p role="status" aria-live="polite" className={error ? "mt-2 text-sm text-danger" : "sr-only"}>{error ?? ""}</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
        <Button onClick={onClose}>Hủy</Button>
        <Button variant="primary" pending={pending} onClick={save}>Lưu</Button>
      </div>
    </dialog>
  );
}

// Every message the bot still has to send when a reminder's time comes, soonest first. They are listed
// apart from the reminders, so one whose reminder was removed in Zalo itself can still be changed or cancelled.
export function PendingMessages() {
  // The calendar tells which of these messages still have their reminder.
  const { data: reminders } = useSWR<ReminderList>("/reminders");
  const { data: messages, error, mutate } = useSWR<PendingReminderMessage[]>("/reminder-messages");
  const { mutate: mutateGlobal } = useSWRConfig();
  const [editing, setEditing] = useState<PendingReminderMessage>();
  const [removing, setRemoving] = useState<PendingReminderMessage>();
  const [removePending, setRemovePending] = useState(false);
  const toast = useToast();
  const selection = useSelection<PendingReminderMessage>(messageId);
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  // The dates are worded relative to now, which only the browser knows.
  const [now, setNow] = useState<number>();
  useEffect(() => setNow(Date.now()), [messages]);

  // Whether a message's reminder is missing from the calendar. Only judged for groups that were actually read.
  function isOrphan(message: PendingReminderMessage): boolean {
    // A message scheduled on its own has no reminder to look for.
    if (message.reminderId === "") return false;
    if (reminders === undefined || reminders.failed.some((group) => group.groupId === message.groupId)) return false;
    return !reminders.items.some((item) => item.groupId === message.groupId && item.reminderId === message.reminderId);
  }

  async function remove(message: PendingReminderMessage) {
    setRemovePending(true);
    try {
      await send("DELETE", `/reminder-messages/${encodeURIComponent(message.id)}`);
      await mutate();
      // The calendar marks reminders that have a message waiting.
      void mutateGlobal("/reminders");
      toast.success("Đã hủy tin nhắn chờ gửi");
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setRemovePending(false);
      setRemoving(undefined);
    }
  }

  async function removeSelected(chosen: readonly PendingReminderMessage[]) {
    setBulkPending(true);
    try {
      const { deleted } = await send<{ deleted: number }>("POST", "/reminder-messages/delete", { ids: chosen.map(messageId) });
      selection.clear();
      await mutate();
      void mutateGlobal("/reminders");
      toast.success(`Đã hủy ${formatNumber(deleted)} tin nhắn chờ gửi`);
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setBulkPending(false);
      setConfirmingBulk(false);
    }
  }

  if (messages === undefined) {
    return (
      <Card>
        <div className="space-y-3 p-5">
          {error ? <p className="text-sm text-danger">{errorText(error)}</p> : Array.from({ length: 3 }, (_item, index) => <Skeleton key={index} className="h-16 w-full" />)}
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card>
        {messages.length === 0 ? (
          <EmptyState title="Không có tin nhắn nào đang chờ gửi" description="Hẹn giờ một tin ở tab Soạn tin, hoặc bật “Gửi tin nhắn khi đến giờ nhắc” khi tạo nhắc hẹn." action={<Link href="/broadcast" className="text-sm font-medium underline underline-offset-4">Soạn tin</Link>} />
        ) : (
          <ul className="divide-y divide-border">
            <li className="px-5 py-2.5">
              <label className="inline-flex cursor-pointer items-center gap-3 text-sm text-muted">
                <SelectAllCheckbox items={messages} selection={selection} getId={messageId} label="Chọn mọi tin nhắn chờ gửi" />
                Chọn tất cả
              </label>
            </li>
            {messages.map((message, index) => (
              <li key={message.id} className={`flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-4 ${selection.has(message.id) ? "bg-surface-hover" : ""}`}>
                <span className="flex shrink-0 items-center gap-3 pt-5">
                  <RowCheckbox checked={selection.has(message.id)} onChange={(checked) => selection.toggle(message, checked)} label={`Chọn tin nhắn gửi ${message.groupName || message.groupId}`} />
                  <RowNumber value={index + 1} className="w-6 text-right text-sm" />
                </span>
                {message.imageCount > 0 ? (
                  <span className="relative shrink-0">
                    <img src={imageUrl(message, 0)} alt={`Ảnh gửi kèm, ${message.imageCount} ảnh`} width={56} height={56} loading="lazy" className="size-14 rounded-md border border-border object-cover" />
                    {message.imageCount > 1 ? <span aria-hidden="true" className="absolute -bottom-1.5 -right-1.5 rounded-full border border-border-strong bg-surface px-1.5 text-xs font-medium tabular-nums shadow-sm">+{message.imageCount - 1}</span> : null}
                  </span>
                ) : (
                  <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-md border border-dashed border-border text-subtle"><ImageIcon className="size-5" /></span>
                )}
                <div className="min-w-0 flex-1 basis-64">
                  {message.text ? <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm"><FormattedText text={message.text} /></p> : <p className="text-sm text-subtle">Chỉ có ảnh, không có chữ</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="tabular-nums font-medium">{now === undefined ? "…" : formatFriendlyDateTime(message.dueAt, now)}</span>
                    <span aria-hidden="true" className="text-subtle">·</span>
                    <GroupLink groupId={message.groupId} name={message.groupName || message.groupId} />
                    {message.repeat !== "none" ? <Badge><Repeat aria-hidden="true" className="size-3" />{reminderRepeatLabels[message.repeat]}</Badge> : null}
                    {isOrphan(message) ? <Badge tone="warning">Không thấy nhắc hẹn trong lịch</Badge> : null}
                  </div>
                  <p className="mt-1 truncate text-sm text-muted">{message.reminderId === "" ? "Tin nhắn hẹn giờ, không kèm nhắc hẹn" : `Nhắc hẹn: ${message.title || message.reminderId}`}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="ghost" aria-label={`Sửa tin nhắn gửi ${message.groupName || message.groupId}`} onClick={() => setEditing(message)}>Sửa</Button>
                  <Button variant="ghost" aria-label={`Hủy tin nhắn gửi ${message.groupName || message.groupId}`} onClick={() => setRemoving(message)}>Xóa</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <SelectionBar count={selection.count} noun="tin nhắn" onClear={selection.clear}>
        <Button variant="danger" disabled={bulkPending} onClick={() => setConfirmingBulk(true)}>Hủy tin nhắn</Button>
      </SelectionBar>
      <ConfirmDialog
        open={confirmingBulk}
        title={`Hủy ${formatNumber(selection.count)} tin nhắn?`}
        confirmLabel="Hủy tin nhắn"
        pending={bulkPending}
        onConfirm={() => void removeSelected(selection.items)}
        onCancel={() => setConfirmingBulk(false)}
      >
        Bot sẽ không gửi các tin nhắn đã chọn nữa. Nhắc hẹn trên Zalo vẫn giữ nguyên.
      </ConfirmDialog>
      {/* Mounted per message, so the dialog always opens with that message's own text and picture. */}
      {editing !== undefined ? <EditDialog key={editing.id} message={editing} onClose={() => setEditing(undefined)} onSaved={() => mutate()} /> : null}
      <ConfirmDialog
        open={removing !== undefined}
        title="Hủy tin nhắn này?"
        confirmLabel="Hủy tin nhắn"
        pending={removePending}
        onConfirm={() => { if (removing !== undefined) void remove(removing); }}
        onCancel={() => setRemoving(undefined)}
      >
        Bot sẽ không gửi tin nhắn này vào “{removing?.groupName || removing?.groupId}” nữa. Nhắc hẹn trên Zalo vẫn giữ nguyên.
      </ConfirmDialog>
    </>
  );
}
