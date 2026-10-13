"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { errorText, send } from "@/lib/api";
import type { Group } from "@/lib/types";
import { ConfirmDialog } from "./confirm-dialog";
import { useToast } from "./toast";
import { Badge, Button, Card, CardHeader, Skeleton, Switch } from "./ui";

// Zalo's own settings for a group, in the order they are shown. The bot reads and writes the same names.
const settings = [
  { key: "lockSendMsg", label: "Chỉ trưởng và phó nhóm được nhắn tin", description: "Thành viên thường chỉ đọc được, không gửi được tin vào nhóm." },
  { key: "joinAppr", label: "Duyệt thành viên mới", description: "Người vào bằng link hoặc được mời phải chờ trưởng hoặc phó nhóm duyệt." },
  { key: "enableMsgHistory", label: "Thành viên mới đọc được tin gần đây", description: "Người mới vào xem được các tin nhắn gần nhất của nhóm." },
  { key: "blockName", label: "Khóa đổi tên và ảnh nhóm", description: "Chỉ trưởng và phó nhóm đổi được tên và ảnh đại diện của nhóm." },
  { key: "signAdminMsg", label: "Đánh dấu tin của trưởng và phó nhóm", description: "Tin nhắn của trưởng và phó nhóm được làm nổi bật trong nhóm." },
  { key: "setTopicOnly", label: "Chỉ trưởng và phó nhóm được ghim", description: "Thành viên thường không ghim được tin nhắn, ghi chú hay bình chọn lên đầu nhóm." },
  { key: "lockCreatePost", label: "Khóa tạo ghi chú và nhắc hẹn", description: "Thành viên thường không tạo được ghi chú và nhắc hẹn." },
  { key: "lockCreatePoll", label: "Khóa tạo bình chọn", description: "Thành viên thường không tạo được bình chọn." },
] as const;

type SettingKey = (typeof settings)[number]["key"];
type InviteLink = Readonly<{ enabled: boolean; link?: string; expiresAt?: number }>;
// `link` is missing when the bot could not read it from Zalo; `linkError` then says why.
type ZaloState = Readonly<{ settings: Readonly<Record<SettingKey, boolean>>; canEdit: boolean; link?: InviteLink; linkError?: string }>;

const expiryFormat = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });

// The group's invite link: see it, copy it, switch it on or off.
function InviteLinkCard({ group, link, linkError, canEdit, onChange }: { group: Group; link: InviteLink | undefined; linkError: string | undefined; canEdit: boolean; onChange: (link: InviteLink) => void }) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  async function set(enabled: boolean) {
    setPending(true);
    try {
      onChange(await send<InviteLink>("POST", `/groups/${encodeURIComponent(group.groupId)}/invite-link`, { enabled }));
      toast.success(enabled ? "Đã bật link mời nhóm" : "Đã tắt link mời nhóm");
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Không sao chép được, hãy bôi đen link và sao chép bằng tay");
    }
  }

  return (
    <Card>
      <CardHeader
        title="Link mời nhóm"
        description="Ai có link này đều xin vào nhóm được. Tắt link thì link đang dùng mất hiệu lực."
        action={link === undefined ? undefined : link.enabled ? <Badge tone="success">Đang bật</Badge> : <Badge>Đang tắt</Badge>}
      />
      <div className="px-5 py-4">
        {link === undefined && !canEdit ? (
          <p className="text-sm text-muted">Zalo chỉ cho trưởng và phó nhóm xem link mời; bot chưa có quyền đó ở nhóm này.</p>
        ) : link === undefined ? (
          // The bot may manage the link but could not read it. Switching it on still works, and answers with the link.
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 basis-56 text-sm text-muted">Chưa đọc được link mời từ Zalo{linkError === undefined ? "" : `: ${linkError}`}. Bấm “Bật link mời” để tạo hoặc lấy lại link.</p>
            <Button variant="primary" pending={pending} onClick={() => set(true)}>Bật link mời</Button>
          </div>
        ) : link.enabled && link.link !== undefined ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 basis-56 truncate rounded-md border border-border bg-background px-3 py-2 font-mono text-sm" translate="no">{link.link}</code>
              <Button onClick={() => copy(link.link ?? "")}>
                {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
                {copied ? "Đã sao chép" : "Sao chép"}
              </Button>
              <Button variant="danger" disabled={!canEdit} onClick={() => setConfirming(true)}>Tắt link</Button>
            </div>
            {link.expiresAt === undefined ? null : <p className="text-sm text-muted">Link hết hạn lúc {expiryFormat.format(link.expiresAt)}.</p>}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">Nhóm chưa có link mời đang hoạt động.</p>
            <Button variant="primary" pending={pending} disabled={!canEdit} onClick={() => set(true)}>Bật link mời</Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        title="Tắt link mời nhóm?"
        confirmLabel="Tắt link"
        pending={pending}
        onConfirm={() => void set(false)}
        onCancel={() => setConfirming(false)}
      >
        Link đang dùng sẽ mất hiệu lực ngay; ai còn giữ link đó không vào nhóm được nữa. Bật lại sau này có thể cho ra một link khác.
      </ConfirmDialog>
    </Card>
  );
}

// What Zalo itself lets a group's admins set, as opposed to the bot's own features for the group.
// It is read from Zalo when the tab opens, and each switch is saved to Zalo as it is flipped.
export function GroupZaloSettings({ group }: { group: Group }) {
  const toast = useToast();
  const path = `/groups/${encodeURIComponent(group.groupId)}/zalo-settings`;
  // Read once when the tab opens. The dashboard's regular refresh is left out here: every read asks Zalo itself.
  const { data, error, mutate } = useSWR<ZaloState>(path, { revalidateOnFocus: false, refreshInterval: 0 });
  const [saving, setSaving] = useState<SettingKey>();

  async function save(key: SettingKey, label: string, value: boolean) {
    if (data === undefined) return;
    setSaving(key);
    try {
      const next = await send<ZaloState>("PATCH", path, { [key]: value });
      // The answer carries the settings as Zalo now has them; the link is not part of it.
      void mutate({ ...next, link: data.link, linkError: data.linkError }, { revalidate: false });
      toast.success(`Đã ${value ? "bật" : "tắt"}: ${label}`);
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setSaving(undefined);
    }
  }

  if (data === undefined) {
    return (
      <Card>
        <CardHeader title="Cài đặt nhóm trên Zalo" description="Đọc trực tiếp từ Zalo." />
        <div className="space-y-3 p-5">
          {error ? <p className="text-sm text-danger">{errorText(error)}</p> : Array.from({ length: 4 }, (_item, index) => <Skeleton key={index} className="h-10 w-full" />)}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {data.canEdit ? null : (
        <p role="status" className="rounded-md border border-warning/30 bg-warning-surface px-4 py-3 text-sm text-warning">
          Bot là thành viên thường của nhóm này nên chỉ xem được, không đổi được cài đặt. Hãy cho tài khoản bot làm phó nhóm trên Zalo.
        </p>
      )}
      <Card>
        <CardHeader title="Cài đặt nhóm trên Zalo" description="Những cài đặt của chính Zalo cho nhóm, giống mục quản lý nhóm trong ứng dụng. Mỗi công tắc được lưu lên Zalo ngay khi gạt." />
        <div className="grid divide-y divide-border">
          {settings.map((item) => (
            <div key={item.key} className="px-5 py-3.5">
              <Switch
                checked={data.settings[item.key]}
                disabled={!data.canEdit || saving !== undefined}
                onChange={(value) => save(item.key, item.label, value)}
                label={item.label}
                description={item.description}
              />
            </div>
          ))}
        </div>
      </Card>
      <InviteLinkCard group={group} link={data.link} linkError={data.linkError} canEdit={data.canEdit} onChange={(link) => void mutate({ settings: data.settings, canEdit: data.canEdit, link }, { revalidate: false })} />
    </div>
  );
}
