"use client";

import { useState } from "react";
import { errorText, send } from "@/lib/api";
import type { Group, GroupCommandSettings } from "@/lib/types";
import { useToast } from "./toast";
import { Badge, Card, CardHeader, CompactSwitch } from "./ui";

// What "/random" understands, shown next to its switch.
const randomExamples: readonly { command: string; meaning: string }[] = [
  { command: "/random", meaning: "chọn ngẫu nhiên 1 thành viên của nhóm và tag người đó" },
  { command: "/random 3", meaning: "chọn 3 thành viên khác nhau (tối đa 20)" },
  { command: "/random 1-100", meaning: "chọn một số từ 1 đến 100" },
];

// The commands the bot knows by itself, as opposed to the answers an admin writes. Each is switched
// on per group, and can be kept for the group's admins.
export function GroupCommands({ group, onChange }: { group: Group; onChange: (group: Group) => void }) {
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const { random } = group.commands;

  async function save(commands: GroupCommandSettings, done: string) {
    setPending(true);
    try {
      onChange(await send<Group>("PATCH", `/groups/${encodeURIComponent(group.groupId)}/commands`, commands));
      toast.success(done);
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Lệnh có sẵn" description="Những lệnh bot tự xử lý, không cần soạn câu trả lời. Bật riêng cho từng nhóm." />
      <div className="grid divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <div className="min-w-0 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                <code className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-xs" translate="no">/random</code>
                Quay ngẫu nhiên
                {random.enabled ? <Badge tone="success">Đang bật</Badge> : <Badge>Tắt</Badge>}
              </p>
              <p className="mt-1 text-sm text-muted">Chọn ngẫu nhiên thành viên của nhóm hoặc một số trong khoảng. Bot không tự chọn chính nó.</p>
            </div>
            <CompactSwitch checked={random.enabled} disabled={pending} onChange={(enabled) => save({ random: { ...random, enabled } }, `Đã ${enabled ? "bật" : "tắt"} lệnh /random`)} label="Bật lệnh /random" />
          </div>
          <label className={`mt-3 flex items-start gap-2 text-sm ${random.enabled ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
            <input
              type="checkbox"
              name="randomAdminOnly"
              checked={random.adminOnly}
              disabled={!random.enabled || pending}
              onChange={(event) => save({ random: { ...random, adminOnly: event.target.checked } }, event.target.checked ? "Chỉ trưởng và phó nhóm dùng được /random" : "Mọi thành viên dùng được /random")}
              className="mt-0.5 size-4 accent-[var(--accent)]"
            />
            <span><span className="font-medium">Chỉ trưởng nhóm và phó nhóm dùng được</span><span className="block text-muted">Thành viên thường gõ lệnh sẽ không được trả lời.</span></span>
          </label>
        </div>
        <div className="min-w-0 px-5 py-4">
          <p className="text-sm font-medium">Cách dùng</p>
          <dl className="mt-2 space-y-1.5 text-sm">
            {randomExamples.map((example) => (
              <div key={example.command} className="flex flex-wrap gap-x-2">
                <dt><code className="font-mono text-xs" translate="no">{example.command}</code></dt>
                <dd className="text-muted">{example.meaning}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-sm text-muted">Kết quả ghi rõ chọn từ bao nhiêu thành viên. Lệnh nghỉ 3 giây giữa hai lần trả lời trong nhóm.</p>
        </div>
      </div>
    </Card>
  );
}
