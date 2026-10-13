"use client";

import { AtSign, Bold, ImagePlus, Italic, Strikethrough, Underline, X } from "lucide-react";
import { useId, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { cn, formatNumber } from "@/lib/format";
import { allMembersTag, hasFormatting, tagColors, type FormatTag } from "@/lib/message-format";
import { FormattedText } from "./formatted-text";

export const maxMessageLength = 2000;
// How many pictures one message may carry, and how heavy they may be together.
export const maxMessageImages = 6;
export const maxMessageImagesBytes = 12 * 1024 * 1024;
// What the bot accepts for one picture, and the largest file worth trying to shrink to that.
const maxImageBytes = 5 * 1024 * 1024;
const maxOriginalBytes = 25 * 1024 * 1024;
// A picture heavier or larger than this is scaled down and saved as JPEG before it is sent.
const keepAsIsBytes = 1024 * 1024;
const maxImageSide = 2048;
const imageTypes = ["image/jpeg", "image/png", "image/webp"];

// A picture picked from the visitor's device, ready to send. It is kept as a data URL, which serves
// both as its preview and as what is sent to the bot.
export type PickedImage = { name: string; size: number; dataUrl: string };

// A message the bot posts alongside a reminder, as it is being written.
export type MessageDraft = { enabled: boolean; text: string; images: PickedImage[] };

// The base64 part of a data URL ("data:image/png;base64,<data>"), which is what the bot takes.
export function dataUrlPayload(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

export const emptyMessageDraft: MessageDraft = { enabled: false, text: "", images: [] };

// What is wrong with a message that has been switched on, if anything.
export function messageProblem(draft: MessageDraft): string | undefined {
  if (!draft.enabled) return undefined;
  return draft.text.trim() === "" && draft.images.length === 0 ? "hãy nhập nội dung hoặc chọn ảnh" : undefined;
}

// The message as the bot's API takes it; undefined when it is switched off.
export function toMessagePayload(draft: MessageDraft): { text: string; images: { data: string }[] } | undefined {
  if (!draft.enabled) return undefined;
  return { text: draft.text.trim(), images: draft.images.map((image) => ({ data: dataUrlPayload(image.dataUrl) })) };
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

// What the editor shows for one picture of a message: one just picked, or one the bot already holds.
// `size` is only known for a picture picked here.
export type PictureView = { key: string; src: string; name: string; size?: number };

// The text of a message and its pictures. Used while creating a reminder, when sending a message to
// several groups, and when changing a message that is waiting to be sent.
export function MessageEditor({ text, onTextChange, pictures, onPick, onRemovePicture, placeholder, pictureLabel }: {
  text: string;
  onTextChange: (text: string) => void;
  pictures: PictureView[];
  // Called once with every picture taken from one visit to the file dialog.
  onPick: (images: PickedImage[]) => void;
  onRemovePicture: (index: number) => void;
  placeholder: string;
  pictureLabel: string;
}) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string>();
  const [reading, setReading] = useState(false);
  const room = maxMessageImages - pictures.length;
  // Whether files are being dragged over the editor. Entering a child fires another "enter" before the
  // parent's "leave", so the two are counted rather than switched.
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const textArea = useRef<HTMLTextAreaElement>(null);

  // Puts `before` and `after` around what is selected in the text, or around the caret, and then
  // selects what is between them again. Nothing happens when the result would be too long.
  function surround(before: string, after: string) {
    const field = textArea.current;
    const start = field?.selectionStart ?? text.length;
    const end = field?.selectionEnd ?? text.length;
    const next = `${text.slice(0, start)}${before}${text.slice(start, end)}${after}${text.slice(end)}`;
    if (next.length > maxMessageLength) return;
    onTextChange(next);
    // The field only holds the new text after the change above has rendered.
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + before.length, end + before.length);
    });
  }

  function wrap(tag: FormatTag) {
    surround(`[${tag}]`, `[/${tag}]`);
  }

  function insert(piece: string) {
    surround(piece, "");
  }

  // Only a drag that carries files is of interest; dragged text is left to the browser.
  function carriesFiles(event: DragEvent): boolean {
    return event.dataTransfer.types.includes("Files");
  }

  function dragEnter(event: DragEvent) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }

  function dragLeave(event: DragEvent) {
    if (!carriesFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function drop(event: DragEvent) {
    if (!carriesFiles(event)) return;
    // Without this the browser would open the dropped picture in place of the page.
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    void pickImages(Array.from(event.dataTransfer.files));
  }

  async function pickImages(files: File[]) {
    if (files.length === 0) return;
    setImageError(undefined);
    // Pictures that do not fit are left out, and the note below says so.
    const problems: string[] = [];
    if (files.length > room) problems.push(`Mỗi tin tối đa ${maxMessageImages} ảnh; đã bỏ ${formatNumber(files.length - room)} ảnh.`);
    const picked: PickedImage[] = [];
    let weight = pictures.reduce((sum, picture) => sum + (picture.size ?? 0), 0);
    setReading(true);
    try {
      for (const file of files.slice(0, Math.max(0, room))) {
        if (!imageTypes.includes(file.type)) {
          problems.push(`${file.name}: ảnh phải là JPEG, PNG hoặc WebP.`);
          continue;
        }
        if (file.size > maxOriginalBytes) {
          problems.push(`${file.name}: ảnh lớn tối đa 25 MB.`);
          continue;
        }
        try {
          const prepared = await prepareImage(file);
          if (prepared.size > maxImageBytes) problems.push(`${file.name}: vẫn lớn hơn 5 MB sau khi thu nhỏ.`);
          else if (weight + prepared.size > maxMessageImagesBytes) problems.push(`${file.name}: các ảnh của một tin tối đa 12 MB.`);
          else {
            weight += prepared.size;
            picked.push({ name: file.name, ...prepared });
          }
        } catch (exception) {
          problems.push(`${file.name}: ${exception instanceof Error ? exception.message : "không đọc được file ảnh"}`);
        }
      }
    } finally {
      setReading(false);
    }
    if (picked.length > 0) onPick(picked);
    if (problems.length > 0) setImageError(problems.join(" "));
  }

  return (
    // Pictures can be dropped anywhere on the editor, not only on the marked area.
    <div className="space-y-2" onDragEnter={dragEnter} onDragOver={(event) => { if (carriesFiles(event)) event.preventDefault(); }} onDragLeave={dragLeave} onDrop={drop}>
      <label htmlFor={`${id}-text`} className="flex items-baseline justify-between gap-2 text-sm text-muted">
        Nội dung tin nhắn
        <span className="text-xs tabular-nums">{formatNumber(text.length)}/{formatNumber(maxMessageLength)}</span>
      </label>
      <FormatToolbar onWrap={wrap} onInsert={insert} />
      <textarea
        ref={textArea}
        id={`${id}-text`}
        rows={3}
        maxLength={maxMessageLength}
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        onPaste={(event) => {
          // A copied picture (a screenshot, say) is added to the message; pasted text goes in as usual.
          const pasted = Array.from(event.clipboardData.files);
          if (pasted.length === 0) return;
          event.preventDefault();
          void pickImages(pasted);
        }}
        className="w-full min-w-0 resize-y rounded-md border border-border-strong bg-surface px-3 py-2 text-sm placeholder:text-subtle"
      />
      {hasFormatting(text) ? (
        <div className="rounded-md border border-border bg-background px-3 py-2">
          <p className="mb-1 text-xs text-muted">Xem trước</p>
          <p className="whitespace-pre-wrap break-words text-sm"><FormattedText text={text} /></p>
        </div>
      ) : null}
      {/* The file field itself stays out of sight; the button and the previews stand in for it. */}
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={imageTypes.join(",")}
        aria-label={pictureLabel}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          void pickImages(Array.from(event.target.files ?? []));
          // Lets the same file be picked again after it was removed.
          event.target.value = "";
        }}
      />
      {pictures.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {pictures.map((picture, index) => (
            <li key={picture.key} className="relative">
              <img src={picture.src} alt={`Ảnh ${index + 1}: ${picture.name}`} title={picture.name} width={72} height={72} className="size-[4.5rem] rounded-md border border-border object-cover" />
              <button
                type="button"
                aria-label={`Bỏ ảnh ${index + 1}`}
                onClick={() => onRemovePicture(index)}
                className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-border-strong bg-surface text-muted shadow-sm transition-colors hover:text-foreground"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {/* The marked area for pictures: drop them here, or use the button to pick them from the device. */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-dashed px-3 py-3 text-sm transition-colors",
          dragging ? (room > 0 ? "border-accent bg-accent/10" : "border-danger bg-danger-surface") : "border-border-strong",
        )}
      >
        <ImagePlus aria-hidden="true" className={cn("size-5 shrink-0", dragging && room > 0 ? "text-accent" : "text-muted")} />
        <span className="min-w-0 flex-1 basis-40 text-muted">
          {dragging
            ? room > 0 ? "Thả ảnh vào đây" : `Tin đã đủ ${maxMessageImages} ảnh`
            : room > 0 ? "Kéo ảnh vào đây, dán ảnh vào ô nội dung, hoặc" : `Tin đã đủ ${maxMessageImages} ảnh`}
        </span>
        <button type="button" disabled={room <= 0 || reading} onClick={() => fileInput.current?.click()} className="inline-flex h-8 shrink-0 items-center rounded-md border border-border-strong bg-surface px-2.5 text-sm font-medium transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50">
          Chọn ảnh
        </button>
        <span className="shrink-0 text-xs tabular-nums text-muted">{reading ? "Đang xử lý ảnh…" : `${formatNumber(pictures.length)}/${maxMessageImages} ảnh`}</span>
      </div>
      <p role="status" aria-live="polite" className={cn("text-sm text-danger", imageError === undefined && "sr-only")}>{imageError ?? ""}</p>
    </div>
  );
}

const toolButton = "inline-flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-foreground";
const colorNames: Readonly<Record<string, string>> = { red: "đỏ", orange: "cam", yellow: "vàng", green: "xanh lá" };

// The formatting Zalo has for a message: select some text and press a button, or press it first and type between the tags.
function FormatToolbar({ onWrap, onInsert }: { onWrap: (tag: FormatTag) => void; onInsert: (piece: string) => void }) {
  // The buttons must not take the selection away from the text before they have read it.
  const keepSelection = { onMouseDown: (event: MouseEvent) => event.preventDefault() };
  return (
    <div role="toolbar" aria-label="Định dạng tin nhắn" className="flex flex-wrap items-center gap-0.5 rounded-md border border-border bg-background p-1">
      <button type="button" {...keepSelection} onClick={() => onWrap("b")} aria-label="In đậm" title="In đậm" className={toolButton}><Bold aria-hidden="true" className="size-4" /></button>
      <button type="button" {...keepSelection} onClick={() => onWrap("i")} aria-label="In nghiêng" title="In nghiêng" className={toolButton}><Italic aria-hidden="true" className="size-4" /></button>
      <button type="button" {...keepSelection} onClick={() => onWrap("u")} aria-label="Gạch chân" title="Gạch chân" className={toolButton}><Underline aria-hidden="true" className="size-4" /></button>
      <button type="button" {...keepSelection} onClick={() => onWrap("s")} aria-label="Gạch ngang" title="Gạch ngang" className={toolButton}><Strikethrough aria-hidden="true" className="size-4" /></button>
      <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
      <button type="button" {...keepSelection} onClick={() => onWrap("small")} aria-label="Chữ nhỏ" title="Chữ nhỏ" className={cn(toolButton, "text-xs font-medium")}>A</button>
      <button type="button" {...keepSelection} onClick={() => onWrap("big")} aria-label="Chữ lớn" title="Chữ lớn" className={cn(toolButton, "text-base font-medium")}>A</button>
      <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
      {(["red", "orange", "yellow", "green"] as const).map((tag) => (
        <button key={tag} type="button" {...keepSelection} onClick={() => onWrap(tag)} aria-label={`Chữ màu ${colorNames[tag]}`} title={`Chữ màu ${colorNames[tag]}`} className={toolButton}>
          <span aria-hidden="true" className="size-3.5 rounded-full" style={{ backgroundColor: tagColors[tag] }} />
        </button>
      ))}
      <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
      <button type="button" {...keepSelection} onClick={() => onInsert(`${allMembersTag} `)} title="Nhắc tất cả thành viên của nhóm" className={cn(toolButton, "gap-1 font-medium")}>
        <AtSign aria-hidden="true" className="size-4" />All
      </button>
    </div>
  );
}

// How a picture that was just picked shows in the editor.
export function pickedPictureView(image: PickedImage, index: number): PictureView {
  return { key: `${index}-${image.name}-${image.size}`, src: image.dataUrl, name: image.name, size: image.size };
}

// One optional message: a switch, and once it is on, the text and its pictures.
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
            pictures={value.images.map(pickedPictureView)}
            onPick={(images) => onChange({ ...value, images: [...value.images, ...images] })}
            onRemovePicture={(index) => onChange({ ...value, images: value.images.filter((_image, position) => position !== index) })}
            placeholder={placeholder}
            pictureLabel={`Ảnh kèm theo: ${label}`}
          />
        </div>
      ) : null}
    </div>
  );
}
