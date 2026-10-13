"use client";

import { useRef, useState, type FormEvent } from "react";
import { errorText, send } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import type { Group, GroupWelcomeSettings } from "@/lib/types";
import { FormattedText } from "./formatted-text";
import { maxMessageLength } from "./reminder-message-field";
import { useToast } from "./toast";
import { Badge, Button, Card, CompactSwitch } from "./ui";

// What a group starts from when it has no welcome of its own yet.
const suggestedText = "Chào mừng {name} đến với cộng đồng {nameCom}!";
// Who the preview welcomes.
const sampleName = "Nguyễn Văn A";

// What can be written into the welcome, and what the bot puts in its place.
const variables = [
  { token: "{name}", meaning: "tên người mới vào, có tag" },
  { token: "{nameCom}", meaning: "tên nhóm" },
  { token: "{count}", meaning: "số thành viên của nhóm" },
] as const;

// The welcome as the group will read it, for one newcomer.
function previewOf(text: string, group: Group): string {
  return text.replaceAll("{nameCom}", group.name || "nhóm").replaceAll("{name}", `@${sampleName}`).replaceAll("{count}", formatNumber(group.memberCount));
}

// What the bot says when someone joins the group: switched on per group, with words of the group's own.
export function GroupWelcome({ group, onChange }: { group: Group; onChange: (group: Group) => void }) {
  const saved = group.welcome;
  const [text, setText] = useState(saved.text === "" ? suggestedText : saved.text);
  const [pending, setPending] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();
  const dirty = text.trim() !== saved.text;

  async function save(settings: GroupWelcomeSettings, done: string) {
    setPending(true);
    try {
      onChange(await send<Group>("PATCH", `/groups/${encodeURIComponent(group.groupId)}/welcome`, settings));
      toast.success(done);
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setPending(false);
    }
  }

  function saveText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (text.trim() === "" && saved.enabled) return toast.error("Lời chào đang bật nên không để trống được; hãy tắt trước nếu muốn xóa");
    void save({ enabled: saved.enabled, text }, "Đã lưu lời chào");
  }

  // Writes a variable where the caret is, and puts the caret after it.
  function insert(token: string) {
    const start = field.current?.selectionStart ?? text.length;
    const end = field.current?.selectionEnd ?? text.length;
    const next = `${text.slice(0, start)}${token}${text.slice(end)}`;
    if (next.length > maxMessageLength) return;
    setText(next);
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 flex-1 basis-72">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            Chào thành viên mới
            {saved.enabled ? <Badge tone="success">Đang bật</Badge> : <Badge>Tắt</Badge>}
          </h2>
          <p className="mt-1 text-sm text-muted">Khi có người vào nhóm, bot gửi lời chào bên dưới và tag người đó. Nhiều người vào cùng lúc được chào chung trong một tin.</p>
        </div>
        <CompactSwitch
          checked={saved.enabled}
          disabled={pending}
          onChange={(enabled) => {
            if (enabled && text.trim() === "") return toast.error("Hãy nhập lời chào trước khi bật");
            void save({ enabled, text }, `Đã ${enabled ? "bật" : "tắt"} chào thành viên mới`);
          }}
          label="Bật chào thành viên mới"
        />
      </div>
      <div className="grid divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <form onSubmit={saveText} className="min-w-0 px-5 py-4">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label htmlFor="welcome-text" className="text-sm font-medium">Lời chào</label>
            <span className="text-xs tabular-nums text-muted">{formatNumber(text.length)}/{formatNumber(maxMessageLength)}</span>
          </div>
          <textarea
            ref={field}
            id="welcome-text"
            name="text"
            rows={4}
            maxLength={maxMessageLength}
            autoComplete="off"
            placeholder={`${suggestedText}…`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="w-full min-w-0 resize-y rounded-md border border-border-strong bg-surface px-3 py-2 text-sm placeholder:text-subtle"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Chèn:</span>
            {variables.map((variable) => (
              <button key={variable.token} type="button" title={variable.meaning} onClick={() => insert(variable.token)} className="h-7 rounded-md border border-border-strong bg-surface px-2 font-mono text-xs transition-colors hover:bg-surface-hover" translate="no">
                {variable.token}
              </button>
            ))}
          </div>
          {dirty ? <Button type="submit" variant="primary" pending={pending} className="mt-3">Lưu lời chào</Button> : null}
        </form>
        <div className="min-w-0 px-5 py-4 text-sm">
          <p className="font-medium">Xem trước</p>
          <p className="mt-2 min-h-10 whitespace-pre-wrap break-words rounded-md border border-border bg-background px-3 py-2">
            {text.trim() === "" ? <span className="text-subtle">Chưa có lời chào.</span> : <FormattedText text={previewOf(text.trim(), group)} />}
          </p>
          <dl className="mt-3 space-y-1">
            {variables.map((variable) => (
              <div key={variable.token} className="flex flex-wrap gap-x-2">
                <dt><code className="font-mono text-xs" translate="no">{variable.token}</code></dt>
                <dd className="text-muted">{variable.meaning}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-muted">Dùng được các thẻ định dạng của trình soạn tin như <code className="font-mono text-xs" translate="no">[b]…[/b]</code>. Bot không gửi lời tạm biệt khi có người rời nhóm.</p>
        </div>
      </div>
    </Card>
  );
}
