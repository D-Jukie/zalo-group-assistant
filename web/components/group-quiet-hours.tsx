"use client";

import { useState, type FormEvent } from "react";
import { errorText, send } from "@/lib/api";
import type { Group } from "@/lib/types";
import { useToast } from "./toast";
import { Badge, Button, Card, CompactSwitch, Input } from "./ui";

// "23:00" for 1380 minutes after midnight, as a time field holds it.
function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// The hours as the page says them: "23:00 – 06:00 hôm sau".
function describe(start: string, end: string): string {
  return `${start} – ${end}${end < start ? " hôm sau" : ""}`;
}

// The hours when only the group's owner and deputies may write. The bot switches Zalo's own
// "chỉ trưởng và phó nhóm được nhắn tin" on when they begin and off when they end, every day.
export function GroupQuietHours({ group, onChange }: { group: Group; onChange: (group: Group) => void }) {
  const saved = group.quietHours;
  const [start, setStart] = useState(clock(saved.start));
  const [end, setEnd] = useState(clock(saved.end));
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const dirty = start !== clock(saved.start) || end !== clock(saved.end);
  const invalid = start === "" || end === "" ? "Hãy chọn đủ giờ bắt đầu và giờ kết thúc" : start === end ? "Giờ bắt đầu và giờ kết thúc phải khác nhau" : undefined;

  async function save(enabled: boolean, done: string) {
    if (invalid !== undefined) return toast.error(invalid);
    setPending(true);
    try {
      onChange(await send<Group>("PATCH", `/groups/${encodeURIComponent(group.groupId)}/quiet-hours`, { enabled, start, end }));
      toast.success(done);
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setPending(false);
    }
  }

  function saveHours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(saved.enabled, `Đã lưu giờ yên lặng ${describe(start, end)}`);
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 flex-1 basis-72">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            Giờ yên lặng
            {saved.enabled ? <Badge tone="success">Đang bật</Badge> : <Badge>Tắt</Badge>}
          </h2>
          <p className="mt-1 text-sm text-muted">Mỗi ngày, trong khung giờ này chỉ trưởng nhóm và phó nhóm được nhắn tin. Bot bật cài đặt “Chỉ trưởng và phó nhóm được nhắn tin” của Zalo khi tới giờ bắt đầu và tắt lại khi tới giờ kết thúc.</p>
        </div>
        <CompactSwitch checked={saved.enabled} disabled={pending} onChange={(enabled) => void save(enabled, `Đã ${enabled ? "bật" : "tắt"} giờ yên lặng`)} label="Bật giờ yên lặng" />
      </div>
      {!group.botIsAdmin || !group.botEnabled ? (
        <p role="status" className="border-b border-border bg-warning-surface px-5 py-3 text-sm text-warning">
          {!group.botIsAdmin ? "Bot đang là thành viên thường nên không đổi được cài đặt nhóm. Hãy cho tài khoản bot làm phó nhóm để giờ yên lặng hoạt động." : "Bot đang tắt ở nhóm này nên giờ yên lặng chưa chạy. Bật bot ở đầu trang để dùng."}
        </p>
      ) : null}
      <form onSubmit={saveHours} className="px-5 py-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="quiet-start" className="mb-1.5 block text-sm font-medium">Bắt đầu</label>
            <Input id="quiet-start" name="start" type="time" required value={start} onChange={(event) => setStart(event.target.value)} className="w-32 tabular-nums" />
          </div>
          <div>
            <label htmlFor="quiet-end" className="mb-1.5 block text-sm font-medium">Kết thúc</label>
            <Input id="quiet-end" name="end" type="time" required value={end} onChange={(event) => setEnd(event.target.value)} className="w-32 tabular-nums" />
          </div>
          {dirty ? <Button type="submit" variant="primary" pending={pending} disabled={invalid !== undefined}>Lưu giờ</Button> : null}
        </div>
        <p role="status" className={invalid === undefined ? "mt-2 text-sm text-muted" : "mt-2 text-sm text-danger"}>
          {invalid ?? `Hằng ngày ${describe(start, end)}, theo giờ của máy đang chạy bot.`}
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Nhóm đã được khóa sẵn lúc tới giờ thì bot để nguyên, và cũng không mở ra khi hết giờ.</li>
          <li>Bạn mở lại chat giữa chừng thì bot không khóa lại cho tới khung giờ hôm sau.</li>
          <li>Bot xem giờ nửa phút một lần. Bật giờ yên lặng khi đang trong khung giờ thì nhóm được khóa ngay sau đó; tắt giờ yên lặng hoặc tắt bot ở nhóm lúc bot đang khóa thì chat được mở lại.</li>
        </ul>
      </form>
    </Card>
  );
}
