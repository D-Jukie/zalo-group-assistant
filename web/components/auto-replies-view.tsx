"use client";

import { ImageIcon, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { errorText, send } from "@/lib/api";
import { cn, formatDateTime, formatNumber } from "@/lib/format";
import type { AutoReplyKind, AutoReplyMatch, AutoReplyRule, Group, ReminderGroup } from "@/lib/types";
import { ConfirmDialog } from "./confirm-dialog";
import { dataUrlPayload, MessageEditor, pickedPictureView, type PickedImage, type PictureView } from "./reminder-message-field";
import { GroupPicker } from "./schedule-fields";
import { RowCheckbox, RowNumber, SelectAllCheckbox, SelectionBar, useSelection } from "./selection";
import { useToast } from "./toast";
import { Badge, Button, Card, CardHeader, CompactSwitch, EmptyState, Input, PageHeader, Skeleton } from "./ui";

const kindLabels: Record<AutoReplyKind, string> = { keyword: "Từ khóa", command: "Lệnh" };
const matchLabels: Record<AutoReplyMatch, string> = { exact: "Chính xác", contains: "Có chứa" };
const maxTriggers = 10;
const rowClass = "border-b border-border last:border-0";

function ruleId(rule: AutoReplyRule): string {
  return rule.id;
}

function imageUrl(rule: AutoReplyRule, index: number): string {
  // The version makes the browser fetch the picture again after the answer was changed.
  return `/api/auto-replies/${encodeURIComponent(rule.id)}/images/${index}?v=${rule.updatedAt}`;
}

// One picture of an answer being edited: one the bot already holds, by its position, or one just picked.
type EditedPicture = { kind: "stored"; index: number } | { kind: "new"; image: PickedImage };

const choiceClass = (active: boolean) => cn("h-7 rounded px-2.5 text-sm transition-colors", active ? "bg-surface-hover font-medium text-foreground" : "text-muted hover:text-foreground");

// Creates an answer or changes one. A native modal dialog: it traps focus and closes on Escape.
// Opened from a group's page (`fixedGroupId`), a new answer belongs to that group and the scope is not asked.
function Editor({ rule, groups, fixedGroupId, onClose, onSaved }: { rule: AutoReplyRule | undefined; groups: ReminderGroup[] | undefined; fixedGroupId?: string; onClose: () => void; onSaved: (rules: AutoReplyRule[]) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<AutoReplyKind>(rule?.kind ?? "keyword");
  const [match, setMatch] = useState<AutoReplyMatch>(rule?.match ?? "contains");
  // One trigger per line while editing.
  const [triggers, setTriggers] = useState((rule?.triggers ?? []).join("\n"));
  const [text, setText] = useState(rule?.text ?? "");
  const [pictures, setPictures] = useState<EditedPicture[]>(() => Array.from({ length: rule?.imageCount ?? 0 }, (_item, index) => ({ kind: "stored", index })));
  const [scoped, setScoped] = useState(rule === undefined ? fixedGroupId !== undefined : rule.groupIds.length > 0);
  const [groupIds, setGroupIds] = useState<ReadonlySet<string>>(new Set(rule?.groupIds ?? (fixedGroupId === undefined ? [] : [fixedGroupId])));
  const [cooldown, setCooldown] = useState(String(rule?.cooldownSeconds ?? 10));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const toast = useToast();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);

  const shownPictures = pictures.map((picture, position): PictureView => picture.kind === "new"
    ? pickedPictureView(picture.image, position)
    : { key: `stored-${picture.index}`, src: rule === undefined ? "" : imageUrl(rule, picture.index), name: `Ảnh đang lưu ${picture.index + 1}` });

  async function save() {
    setError(undefined);
    const lines = triggers.split("\n").map((line) => line.trim()).filter((line) => line !== "");
    if (lines.length === 0) return setError(kind === "command" ? "Hãy nhập ít nhất một lệnh." : "Hãy nhập ít nhất một từ khóa.");
    if (lines.length > maxTriggers) return setError(`Tối đa ${maxTriggers} ${kind === "command" ? "lệnh" : "từ khóa"} cho một câu trả lời.`);
    if (text.trim() === "" && pictures.length === 0) return setError("Câu trả lời cần có nội dung hoặc ảnh.");
    if (scoped && groupIds.size === 0) return setError("Hãy chọn ít nhất một nhóm, hoặc chọn “Mọi nhóm đang bật bot”.");
    const cooldownSeconds = Number(cooldown);
    if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 3600) return setError("Thời gian nghỉ phải là số nguyên từ 0 đến 3600 giây.");
    setPending(true);
    try {
      const body = {
        kind,
        match,
        triggers: lines,
        text: text.trim(),
        // The whole list goes along, in order: pictures to keep by their position, new ones with their data.
        images: pictures.map((picture) => picture.kind === "stored" ? { keep: picture.index } : { data: dataUrlPayload(picture.image.dataUrl) }),
        groupIds: scoped ? Array.from(groupIds) : [],
        cooldownSeconds,
        enabled: rule?.enabled ?? true,
      };
      const rules = rule === undefined ? await send<AutoReplyRule[]>("POST", "/auto-replies", body) : await send<AutoReplyRule[]>("PATCH", `/auto-replies/${encodeURIComponent(rule.id)}`, body);
      onSaved(rules);
      toast.success(rule === undefined ? "Đã thêm câu trả lời" : "Đã lưu câu trả lời");
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
      aria-labelledby="auto-reply-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface p-0 text-foreground shadow-xl"
    >
      <div className="space-y-5 p-5">
        <h2 id="auto-reply-editor-title" className="text-base font-semibold">{rule === undefined ? "Thêm câu trả lời tự động" : "Sửa câu trả lời tự động"}</h2>
        <div>
          <p id="auto-reply-kind-label" className="mb-1.5 text-sm font-medium">Trả lời khi thành viên</p>
          <div role="radiogroup" aria-labelledby="auto-reply-kind-label" className="inline-flex gap-1 rounded-md border border-border bg-background p-1">
            <button type="button" role="radio" aria-checked={kind === "keyword"} onClick={() => setKind("keyword")} className={choiceClass(kind === "keyword")}>Nhắn từ khóa</button>
            <button type="button" role="radio" aria-checked={kind === "command"} onClick={() => setKind("command")} className={choiceClass(kind === "command")}>Gõ lệnh</button>
          </div>
        </div>
        <div>
          <label htmlFor="auto-reply-triggers" className="mb-1.5 block text-sm font-medium">{kind === "command" ? "Lệnh" : "Từ khóa"} <span className="font-normal text-muted">(mỗi dòng một {kind === "command" ? "lệnh" : "từ khóa"}, tối đa {maxTriggers})</span></label>
          <textarea
            id="auto-reply-triggers"
            name="triggers"
            rows={3}
            autoComplete="off"
            spellCheck={false}
            placeholder={kind === "command" ? "/huongdan…" : "bảng giá…"}
            value={triggers}
            onChange={(event) => setTriggers(event.target.value)}
            className="w-full min-w-0 resize-y rounded-md border border-border-strong bg-surface px-3 py-2 font-mono text-sm placeholder:text-subtle"
          />
          <p className="mt-1 text-sm text-muted">
            {kind === "command"
              ? "Lệnh bắt đầu bằng “/” và viết liền (chữ, số, gạch dưới, gạch ngang). Bot trả lời khi lệnh là từ đầu tiên của tin nhắn."
              : "Không phân biệt hoa thường. Từ khóa gõ không dấu cũng khớp với chữ có dấu; gõ có dấu thì chỉ khớp đúng dấu đó."}
          </p>
        </div>
        {kind === "keyword" ? (
          <div>
            <p id="auto-reply-match-label" className="mb-1.5 text-sm font-medium">Cách so khớp</p>
            <div role="radiogroup" aria-labelledby="auto-reply-match-label" className="inline-flex gap-1 rounded-md border border-border bg-background p-1">
              <button type="button" role="radio" aria-checked={match === "exact"} onClick={() => setMatch("exact")} className={choiceClass(match === "exact")}>Chính xác</button>
              <button type="button" role="radio" aria-checked={match === "contains"} onClick={() => setMatch("contains")} className={choiceClass(match === "contains")}>Có chứa</button>
            </div>
            <p className="mt-1 text-sm text-muted">{match === "exact" ? "Cả tin nhắn phải đúng bằng từ khóa." : "Từ khóa nằm ở đâu trong tin nhắn cũng được, miễn là đứng thành từ riêng (“giá” không khớp “giám đốc”)."}</p>
          </div>
        ) : null}
        <div>
          <p className="mb-1.5 text-sm font-medium">Câu trả lời</p>
          <MessageEditor
            text={text}
            onTextChange={setText}
            pictures={shownPictures}
            onPick={(images) => setPictures((current) => [...current, ...images.map((image): EditedPicture => ({ kind: "new", image }))])}
            onRemovePicture={(index) => setPictures((current) => current.filter((_picture, position) => position !== index))}
            placeholder="Nội dung bot sẽ trả lời…"
            pictureLabel="Ảnh kèm theo câu trả lời"
          />
        </div>
        {fixedGroupId !== undefined ? (
          <p className="rounded-md border border-border bg-background px-3 py-2 text-sm text-muted">
            {groupIds.size > 1
              ? `Câu trả lời này đang áp dụng cho ${formatNumber(groupIds.size)} nhóm. Thay đổi ở đây có hiệu lực ở tất cả các nhóm đó.`
              : "Câu trả lời này chỉ áp dụng cho nhóm này."}
          </p>
        ) : (
        <div>
          <p id="auto-reply-scope-label" className="mb-1.5 text-sm font-medium">Áp dụng cho</p>
          <div role="radiogroup" aria-labelledby="auto-reply-scope-label" className="inline-flex gap-1 rounded-md border border-border bg-background p-1">
            <button type="button" role="radio" aria-checked={!scoped} onClick={() => setScoped(false)} className={choiceClass(!scoped)}>Mọi nhóm đang bật bot</button>
            <button type="button" role="radio" aria-checked={scoped} onClick={() => setScoped(true)} className={choiceClass(scoped)}>Chỉ một số nhóm</button>
          </div>
          {scoped ? (
            <div className="mt-2 rounded-md border border-border">
              {groups === undefined ? <div className="p-4"><Skeleton className="h-9 w-full" /></div> : groups.length === 0 ? <p className="p-4 text-sm text-muted">Chưa có nhóm nào bật bot.</p> : <GroupPicker groups={groups} selected={groupIds} onChange={setGroupIds} />}
            </div>
          ) : null}
        </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="auto-reply-cooldown" className="font-medium">Nghỉ giữa hai lần trả lời trong cùng một nhóm</label>
          <Input id="auto-reply-cooldown" name="cooldown" type="number" inputMode="numeric" autoComplete="off" min={0} max={3600} value={cooldown} onChange={(event) => setCooldown(event.target.value)} className="max-w-24 tabular-nums" />
          <span>giây</span>
        </div>
        <p role="status" aria-live="polite" className={error ? "text-sm text-danger" : "sr-only"}>{error ?? ""}</p>
      </div>
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface px-5 py-3">
        <Button onClick={onClose}>Hủy</Button>
        <Button variant="primary" pending={pending} onClick={save}>{rule === undefined ? "Thêm" : "Lưu"}</Button>
      </div>
    </dialog>
  );
}

type BulkAction = "enable" | "disable" | "delete";

// The page of automatic answers: all of them, for every group.
export function AutoRepliesView() {
  return <AutoReplyManager />;
}

// The answers the bot gives by itself: what sets each one off, what it says, where it applies and how
// often it has answered. Tick several to switch them on or off or to remove them together.
// With `group` it is that group's own part of the list, shown on the group's page: answers made here
// belong to the group, and the answers shared by every group are listed underneath for reference.
export function AutoReplyManager({ group }: { group?: Group }) {
  const { data: allRules, error, mutate } = useSWR<AutoReplyRule[]>("/auto-replies");
  const rules = group === undefined ? allRules : allRules?.filter((rule) => rule.groupIds.includes(group.groupId));
  const shared = group === undefined ? [] : (allRules ?? []).filter((rule) => rule.groupIds.length === 0);
  const { data: groups } = useSWR<ReminderGroup[]>("/reminders/groups");
  const [editing, setEditing] = useState<AutoReplyRule | "new">();
  const selection = useSelection<AutoReplyRule>(ruleId);
  const [bulkPending, setBulkPending] = useState<BulkAction>();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const toast = useToast();
  const groupNames = new Map((groups ?? []).map((group) => [group.groupId, group.name || group.groupId]));

  async function runBulk(action: BulkAction, chosen: readonly AutoReplyRule[], done: string) {
    setBulkPending(action);
    try {
      await mutate(send<AutoReplyRule[]>("POST", "/auto-replies/bulk", { action, ids: chosen.map(ruleId) }), { revalidate: false });
      selection.clear();
      toast.success(done);
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setBulkPending(undefined);
      setConfirmingDelete(false);
    }
  }

  const scopeLabel = (rule: AutoReplyRule): string => {
    if (rule.groupIds.length === 0) return "Mọi nhóm đang bật bot";
    if (rule.groupIds.length === 1) return groupNames.get(rule.groupIds[0] ?? "") ?? "1 nhóm";
    return `${formatNumber(rule.groupIds.length)} nhóm`;
  };

  return (
    <>
      {group === undefined ? (
        <PageHeader
          title="Trả lời tự động"
          description="Bot trả lời khi thành viên nhắn đúng từ khóa hoặc gõ một lệnh như /huongdan. Chỉ áp dụng ở nhóm đang bật bot."
          action={
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus aria-hidden="true" className="size-4" />
              Thêm câu trả lời
            </Button>
          }
        />
      ) : null}
      <Card>
        {group === undefined ? null : (
          <CardHeader
            title="Trả lời tự động của nhóm"
            description="Những câu trả lời chỉ dùng ở nhóm này: từ khóa hoặc lệnh như /huongdan, kèm nội dung và ảnh riêng của nhóm."
            action={
              <Button variant="primary" onClick={() => setEditing("new")}>
                <Plus aria-hidden="true" className="size-4" />
                Thêm câu trả lời
              </Button>
            }
          />
        )}
        {rules === undefined ? (
          <div className="space-y-3 p-5">{error ? <p className="text-sm text-danger">{errorText(error)}</p> : Array.from({ length: 4 }, (_item, index) => <Skeleton key={index} className="h-12 w-full" />)}</div>
        ) : rules.length === 0 ? (
          <EmptyState
            title={group === undefined ? "Chưa có câu trả lời tự động nào" : "Nhóm này chưa có câu trả lời riêng"}
            description="Ví dụ: thành viên gõ /huongdan thì bot gửi hướng dẫn kèm ảnh; ai nhắn “bảng giá” thì bot trả lời bảng giá."
            action={<Button onClick={() => setEditing("new")}>Thêm câu trả lời</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[68rem] table-fixed text-sm">
              <caption className="sr-only">Các câu trả lời tự động</caption>
              <colgroup>
                <col className="w-12" />
                <col className="w-14" />
                <col className="w-64" />
                <col />
                <col className="w-48" />
                <col className="w-36" />
                <col className="w-20" />
                <col className="w-20" />
              </colgroup>
              <thead>
                <tr className="h-11 border-b border-border text-left text-muted">
                  <th scope="col" className="pl-5"><SelectAllCheckbox items={rules} selection={selection} getId={ruleId} label="Chọn mọi câu trả lời" /></th>
                  <th scope="col" className="px-2 text-right font-medium">STT</th>
                  <th scope="col" className="px-5 font-medium">Khi thành viên nhắn</th>
                  <th scope="col" className="px-5 font-medium">Bot trả lời</th>
                  <th scope="col" className="px-5 font-medium">Áp dụng cho</th>
                  <th scope="col" className="px-5 text-right font-medium">Đã trả lời</th>
                  <th scope="col" className="px-5 font-medium">Bật</th>
                  <th scope="col" className="px-5"><span className="sr-only">Thao tác</span></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule, index) => (
                  <tr key={rule.id} className={cn(rowClass, selection.has(rule.id) && "bg-surface-hover", !rule.enabled && "text-muted")}>
                    <td className="py-3 pl-5 align-top"><RowCheckbox checked={selection.has(rule.id)} onChange={(checked) => selection.toggle(rule, checked)} label={`Chọn câu trả lời cho ${rule.triggers[0] ?? ""}`} /></td>
                    <td className="px-2 py-3 text-right align-top"><RowNumber value={index + 1} /></td>
                    <th scope="row" className="px-5 py-3 text-left align-top font-normal">
                      <span className="flex flex-wrap gap-1.5">
                        {rule.triggers.map((trigger) => <code key={trigger} className="max-w-full truncate rounded border border-border bg-background px-1.5 py-0.5 font-mono text-xs" translate="no">{trigger}</code>)}
                      </span>
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        <Badge>{kindLabels[rule.kind]}</Badge>
                        {rule.kind === "keyword" ? <Badge>{matchLabels[rule.match]}</Badge> : null}
                      </span>
                    </th>
                    <td className="px-5 py-3 align-top">
                      <span className="flex min-w-0 items-start gap-3">
                        {rule.imageCount > 0 ? (
                          <span className="relative shrink-0">
                            <img src={imageUrl(rule, 0)} alt={`Ảnh kèm theo, ${rule.imageCount} ảnh`} width={40} height={40} loading="lazy" className="size-10 rounded-md border border-border object-cover" />
                            {rule.imageCount > 1 ? <span aria-hidden="true" className="absolute -bottom-1.5 -right-1.5 rounded-full border border-border-strong bg-surface px-1 text-xs font-medium tabular-nums shadow-sm">+{rule.imageCount - 1}</span> : null}
                          </span>
                        ) : null}
                        {rule.text ? <span className="line-clamp-3 min-w-0 whitespace-pre-wrap break-words">{rule.text}</span> : <span className="flex items-center gap-1.5 text-subtle"><ImageIcon aria-hidden="true" className="size-4" />Chỉ có ảnh</span>}
                      </span>
                    </td>
                    <td className="truncate px-5 py-3 align-top" title={rule.groupIds.map((groupId) => groupNames.get(groupId) ?? groupId).join(", ") || undefined}>{scopeLabel(rule)}</td>
                    <td className="px-5 py-3 text-right align-top tabular-nums">
                      {formatNumber(rule.sentCount)} lần
                      {rule.lastSentAt === null ? null : <span className="block text-xs text-muted">{formatDateTime(rule.lastSentAt)}</span>}
                    </td>
                    <td className="px-5 py-3 align-top">
                      <CompactSwitch checked={rule.enabled} disabled={bulkPending !== undefined} onChange={(enabled) => runBulk(enabled ? "enable" : "disable", [rule], `Đã ${enabled ? "bật" : "tắt"} câu trả lời cho “${rule.triggers[0] ?? ""}”`)} label={`Bật câu trả lời cho ${rule.triggers[0] ?? ""}`} />
                    </td>
                    <td className="px-5 py-2 text-right align-top"><Button variant="ghost" onClick={() => setEditing(rule)}>Sửa</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {/* The answers shared by every group also answer here; they are changed on their own page. */}
      {group !== undefined && shared.length > 0 ? (
        <Card className="mt-4">
          <CardHeader
            title="Câu trả lời chung"
            description="Áp dụng cho mọi nhóm đang bật bot, nên cũng trả lời ở nhóm này. Khi một tin khớp cả câu riêng lẫn câu chung cùng loại, câu riêng của nhóm được dùng."
            action={<Link href="/auto-replies" className="inline-flex h-9 items-center rounded-md border border-border-strong bg-surface px-3 text-sm font-medium transition-colors hover:bg-surface-hover">Mở trang Trả lời tự động</Link>}
          />
          <ul className="divide-y divide-border">
            {shared.map((rule, index) => (
              <li key={rule.id} className={cn("flex flex-wrap items-start gap-x-3 gap-y-1.5 px-5 py-3 text-sm", !rule.enabled && "text-muted")}>
                <RowNumber value={index + 1} className="w-6 shrink-0 text-right" />
                <span className="flex min-w-0 flex-1 basis-48 flex-wrap gap-1.5">
                  {rule.triggers.map((trigger) => <code key={trigger} className="max-w-full truncate rounded border border-border bg-background px-1.5 py-0.5 font-mono text-xs" translate="no">{trigger}</code>)}
                </span>
                <span className="line-clamp-2 min-w-0 flex-[2] basis-64 whitespace-pre-wrap break-words">{rule.text || `${formatNumber(rule.imageCount)} ảnh`}</span>
                <span className="flex shrink-0 gap-1.5">
                  <Badge>{rule.kind === "command" ? kindLabels.command : matchLabels[rule.match]}</Badge>
                  {rule.enabled ? null : <Badge>Đang tắt</Badge>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <SelectionBar count={selection.count} noun="câu trả lời" onClear={selection.clear}>
        <Button pending={bulkPending === "enable"} disabled={bulkPending !== undefined} onClick={() => runBulk("enable", selection.items, `Đã bật ${formatNumber(selection.count)} câu trả lời`)}>Bật</Button>
        <Button pending={bulkPending === "disable"} disabled={bulkPending !== undefined} onClick={() => runBulk("disable", selection.items, `Đã tắt ${formatNumber(selection.count)} câu trả lời`)}>Tắt</Button>
        <Button variant="danger" disabled={bulkPending !== undefined} onClick={() => setConfirmingDelete(true)}>Xóa</Button>
      </SelectionBar>
      <ConfirmDialog
        open={confirmingDelete}
        title={`Xóa ${formatNumber(selection.count)} câu trả lời?`}
        confirmLabel="Xóa"
        pending={bulkPending === "delete"}
        onConfirm={() => void runBulk("delete", selection.items, `Đã xóa ${formatNumber(selection.count)} câu trả lời`)}
        onCancel={() => setConfirmingDelete(false)}
      >
        Bot sẽ không trả lời các từ khóa và lệnh đã chọn nữa. Không hoàn tác được.
        {selection.items.some((rule) => rule.groupIds.length > 1) ? " Có câu trả lời đang áp dụng cho nhiều nhóm: xóa ở đây là xóa ở mọi nhóm đó." : ""}
      </ConfirmDialog>
      {/* Mounted per answer, so the dialog always opens with that answer's own content. */}
      {editing !== undefined ? (
        <Editor key={editing === "new" ? "new" : editing.id} rule={editing === "new" ? undefined : editing} groups={groups} {...(group === undefined ? {} : { fixedGroupId: group.groupId })} onClose={() => setEditing(undefined)} onSaved={(saved) => void mutate(saved, { revalidate: false })} />
      ) : null}
    </>
  );
}
