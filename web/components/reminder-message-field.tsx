"use client";

import { ImagePlus, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cn, formatNumber } from "@/lib/format";

export const maxMessageLength = 2000;
// What the bot accepts for one picture, and the largest file worth trying to shrink to that.
const maxImageBytes = 5 * 1024 * 1024;
const maxOriginalBytes = 25 * 1024 * 1024;
// A picture heavier or larger than this is scaled down and saved as JPEG before it is sent.
const keepAsIsBytes = 1024 * 1024;
const maxImageSide = 2048;
const imageTypes = ["image/jpeg", "image/png", "image/webp"];

// A message the bot posts alongside a reminder, as it is being written. The picture is kept as a
// data URL, which serves both as its preview and as what is sent to the bot.
export type MessageDraft = { enabled: boolean; text: string; image?: { name: string; size: number; dataUrl: string } };

// The base64 part of a data URL ("data:image/png;base64,<data>"), which is what the bot takes.
export function dataUrlPayload(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

export const emptyMessageDraft: MessageDraft = { enabled: false, text: "" };

// What is wrong with a message that has been switched on, if anything.
export function messageProblem(draft: MessageDraft): string | undefined {
  if (!draft.enabled) return undefined;
  return draft.text.trim() === "" && draft.image === undefined ? "hãy nhập nội dung hoặc chọn một ảnh" : undefined;
}

// The message as the bot's API takes it; undefined when it is switched off.
export function toMessagePayload(draft: MessageDraft): { text: string; image?: { data: string } } | undefined {
  if (!draft.enabled) return undefined;
  const text = draft.text.trim();
  return draft.image === undefined ? { text } : { text, image: { data: dataUrlPayload(draft.image.dataUrl) } };
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Không đọc được file ảnh"));
    reader.readAsDataURL(file);
  });
}

// The picture as it will be sent. A phone photo is far larger than a chat needs, so anything heavy
// or huge is scaled down to fit maxImageSide and saved as JPEG; a small picture goes as it is.
async function prepareImage(file: File): Promise<{ size: number; dataUrl: string }> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Không đọc được file ảnh");
  });
  try {
    const scale = Math.min(1, maxImageSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= keepAsIsBytes) return { size: file.size, dataUrl: await readAsDataUrl(file) };
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Trình duyệt không thu nhỏ được ảnh");
    // JPEG has no transparency; see-through areas become white rather than black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (blob === null) throw new Error("Trình duyệt không thu nhỏ được ảnh");
    return { size: blob.size, dataUrl: await readAsDataUrl(blob) };
  } finally {
    bitmap.close();
  }
}

// A picture picked from the visitor's device, ready to send.
export type PickedImage = { name: string; size: number; dataUrl: string };

// What the editor shows for the picture a message has: one just picked, or one the bot already holds.
export type PictureView = { src: string; name: string; detail?: string };

// The text of a message and its optional picture. Used while creating a reminder and when changing
// a message that is waiting to be sent.
export function MessageEditor({ text, onTextChange, picture, onPick, onRemovePicture, placeholder, pictureLabel }: {
  text: string;
  onTextChange: (text: string) => void;
  picture: PictureView | undefined;
  onPick: (image: PickedImage) => void;
  onRemovePicture: () => void;
  placeholder: string;
  pictureLabel: string;
}) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string>();

  async function pickImage(file: File | undefined) {
    if (file === undefined) return;
    setImageError(undefined);
    if (!imageTypes.includes(file.type)) return setImageError("Ảnh phải là JPEG, PNG hoặc WebP.");
    if (file.size > maxOriginalBytes) return setImageError("Ảnh lớn tối đa 25 MB.");
    try {
      const prepared = await prepareImage(file);
      if (prepared.size > maxImageBytes) return setImageError("Ảnh vẫn lớn hơn 5 MB sau khi thu nhỏ; hãy chọn ảnh khác.");
      onPick({ name: file.name, ...prepared });
    } catch (exception) {
      setImageError(exception instanceof Error ? exception.message : "Không đọc được file ảnh");
    }
  }

  return (
    <div className="space-y-2">
      <label htmlFor={`${id}-text`} className="flex items-baseline justify-between gap-2 text-sm text-muted">
        Nội dung tin nhắn
        <span className="text-xs tabular-nums">{formatNumber(text.length)}/{formatNumber(maxMessageLength)}</span>
      </label>
      <textarea
        id={`${id}-text`}
        rows={3}
        maxLength={maxMessageLength}
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        className="w-full min-w-0 resize-y rounded-md border border-border-strong bg-surface px-3 py-2 text-sm placeholder:text-subtle"
      />
      {/* The file field itself stays out of sight; the button and the preview stand in for it. */}
      <input
        ref={fileInput}
        type="file"
        accept={imageTypes.join(",")}
        aria-label={pictureLabel}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          void pickImage(event.target.files?.[0]);
          // Lets the same file be picked again after it was removed.
          event.target.value = "";
        }}
      />
      {picture === undefined ? (
        <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex h-8 items-center gap-2 rounded-md border border-border-strong px-2.5 text-sm transition-colors hover:bg-surface-hover">
          <ImagePlus aria-hidden="true" className="size-4" />
          Thêm ảnh
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <img src={picture.src} alt="Ảnh sẽ gửi kèm" width={56} height={56} className="size-14 shrink-0 rounded-md border border-border object-cover" />
          <span className="min-w-0 flex-1 text-sm">
            <span className="block truncate" translate="no">{picture.name}</span>
            {picture.detail ? <span className="block text-xs tabular-nums text-muted">{picture.detail}</span> : null}
          </span>
          <button type="button" onClick={() => fileInput.current?.click()} className="h-8 shrink-0 rounded-md px-2.5 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-foreground">Đổi ảnh</button>
          <button type="button" aria-label="Bỏ ảnh" onClick={onRemovePicture} className="grid size-8 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-foreground">
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      )}
      <p role="status" aria-live="polite" className={cn("text-sm text-danger", imageError === undefined && "sr-only")}>{imageError ?? ""}</p>
    </div>
  );
}

export function imageDetail(image: PickedImage): string {
  return `${formatNumber(Math.max(1, Math.round(image.size / 1024)))} KB`;
}

// One optional message: a switch, and once it is on, the text and an optional picture.
export function MessageField({ label, hint, placeholder, value, onChange }: { label: string; hint: string; placeholder: string; value: MessageDraft; onChange: (value: MessageDraft) => void }) {
  return (
    <div className="rounded-md border border-border">
      <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
        <input type="checkbox" checked={value.enabled} onChange={(event) => onChange({ ...value, enabled: event.target.checked })} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
        <span className="min-w-0 text-sm">
          <span className="block font-medium">{label}</span>
          <span className="block text-muted">{hint}</span>
        </span>
      </label>
      {value.enabled ? (
        <div className="border-t border-border p-3">
          <MessageEditor
            text={value.text}
            onTextChange={(text) => onChange({ ...value, text })}
            picture={value.image === undefined ? undefined : { src: value.image.dataUrl, name: value.image.name, detail: imageDetail(value.image) }}
            onPick={(image) => onChange({ ...value, image })}
            onRemovePicture={() => onChange({ enabled: value.enabled, text: value.text })}
            placeholder={placeholder}
            pictureLabel={`Ảnh kèm theo: ${label}`}
          />
        </div>
      ) : null}
    </div>
  );
}
