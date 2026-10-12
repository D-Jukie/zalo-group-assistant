"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { errorText, send } from "@/lib/api";
import { cn } from "@/lib/format";
import type { Group } from "@/lib/types";
import { ListManager } from "./list-manager";
import { Badge, Button, Card, CardHeader, ErrorNote, Input, PageHeader } from "./ui";

const tabs = [
  { value: "links", label: "Chặn link" },
  { value: "words", label: "Lọc từ cấm" },
] as const;

type Tab = (typeof tabs)[number]["value"];

// How many groups currently use a feature. Switching it on or off for a group is done on that group's page.
function useGroupCount(isOn: (group: Group) => boolean): string {
  const { data: groups } = useSWR<Group[]>("/groups");
  if (groups === undefined) return "";
  return ` Đang bật ở ${groups.filter((group) => group.botEnabled && isOn(group)).length} nhóm.`;
}

function SentenceCheck() {
  const [result, setResult] = useState<{ match: string | null }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = String(new FormData(event.currentTarget).get("text") ?? "");
    setError(undefined);
    setPending(true);
    try {
      setResult(await send<{ match: string | null }>("POST", "/banned-words/check", { text }));
    } catch (exception) {
      setError(errorText(exception));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Thử một câu" description="Kiểm tra một câu có bị tính là chứa từ cấm trong danh sách chung không, và vì từ nào." />
      <div className="p-5">
        <form onSubmit={check} className="flex gap-2">
          <label htmlFor="check-text" className="sr-only">Câu cần kiểm tra</label>
          <Input id="check-text" name="text" autoComplete="off" maxLength={500} placeholder="Nhập một câu…" required />
          <Button type="submit" pending={pending}>Kiểm tra</Button>
        </form>
        <ErrorNote message={error} />
        <p role="status" aria-live="polite" className="mt-3 text-sm">
          {result === undefined ? <span className="text-muted">Kết quả hiện ở đây.</span> : result.match === null ? (
            <Badge tone="success">Không vi phạm</Badge>
          ) : (
            <span className="flex flex-wrap items-center gap-2"><Badge tone="danger">Vi phạm</Badge> vì có <code className="font-mono" translate="no">{result.match}</code></span>
          )}
        </p>
      </div>
    </Card>
  );
}

function LinksTab() {
  const usage = useGroupCount((group) => group.linkGuardEnabled);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <ListManager
        title="Link bị chặn chung"
        description={<>Thêm tên miền (<code className="font-mono">shopee.vn</code>) hoặc tên miền kèm đường dẫn (<code className="font-mono">facebook.com/groups</code>) để chặn link của trang đó ở mọi nhóm bật chặn link.{usage}</>}
        path="/blocked-links"
        field="link"
        inputLabel="Tên miền hoặc link cần chặn"
        placeholder="example.com…"
        maxLength={200}
        emptyTitle="Chưa chặn thêm trang nào"
        emptyDescription="Hiện chỉ link mời nhóm Zalo bị chặn."
      />
      <Card>
        <CardHeader title="Tính năng này làm gì" />
        <ul className="list-disc space-y-2 px-5 py-4 pl-9 text-sm text-muted">
          <li>Link mời nhóm Zalo luôn bị chặn, kể cả khi bị viết lách hoặc nằm trong mã QR của ảnh.</li>
          <li>Danh sách bên cạnh chặn thêm link của các trang khác, cho mọi nhóm.</li>
          <li>Mỗi nhóm có thể có thêm danh sách link chặn riêng.</li>
          <li>Bật hay tắt chặn link cho một nhóm, và việc có kick hay không, đặt ở trang của nhóm đó.</li>
        </ul>
      </Card>
    </div>
  );
}

function WordsTab() {
  const usage = useGroupCount((group) => group.badWordFilterEnabled);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <ListManager
        title="Từ cấm chung"
        description={<>Từ chỉ bị bắt khi đứng riêng, không bắt khi nằm trong một từ khác, và có phân biệt dấu tiếng Việt: muốn chặn cả dạng không dấu thì thêm cả hai.{usage}</>}
        path="/banned-words"
        field="word"
        inputLabel="Từ hoặc cụm từ cần chặn"
        placeholder="Từ hoặc cụm từ…"
        maxLength={50}
        emptyTitle="Chưa có từ cấm nào"
        emptyDescription="Bot không có sẵn từ cấm; danh sách do bạn tự thêm."
      />
      <div className="space-y-4">
        <SentenceCheck />
        <Card>
          <CardHeader title="Tính năng này làm gì" />
          <ul className="list-disc space-y-2 px-5 py-4 pl-9 text-sm text-muted">
            <li>Tin chứa từ hoặc cụm từ trong danh sách bị tính là vi phạm ở mọi nhóm bật lọc từ cấm.</li>
            <li>Bot nhận ra chữ hoa, dấu câu bao quanh, từ bị đánh vần từng chữ và chữ kéo dài.</li>
            <li>Mỗi nhóm có thể có thêm danh sách từ cấm riêng.</li>
            <li>Bật hay tắt lọc từ cấm cho một nhóm, và việc có kick hay không, đặt ở trang của nhóm đó.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

// The open tab is part of the URL, so each feature has its own link and Back moves between tabs.
export function FeaturesView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab: Tab = tabs.find((item) => item.value === searchParams.get("tab"))?.value ?? "links";

  return (
    <>
      <PageHeader title="Tính năng" description="Cài đặt dùng chung của từng tính năng. Bật tắt tính năng cho một nhóm thì làm ở trang của nhóm đó." />
      <div role="tablist" aria-label="Tính năng" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={`tab-${item.value}`}
            aria-selected={tab === item.value}
            aria-controls="feature-panel"
            onClick={() => router.push(item.value === "links" ? pathname : `${pathname}?tab=${item.value}`, { scroll: false })}
            className={cn(
              "-mb-px h-10 shrink-0 border-b-2 px-3 text-sm transition-colors",
              tab === item.value ? "border-foreground font-medium text-foreground" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="feature-panel" aria-labelledby={`tab-${tab}`}>
        {tab === "links" ? <LinksTab /> : <WordsTab />}
      </div>
    </>
  );
}
