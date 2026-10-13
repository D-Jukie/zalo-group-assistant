"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { cn, formatNumber } from "@/lib/format";
import type { PendingReminderMessage } from "@/lib/types";
import { MessageForm } from "./message-form";
import { PendingMessages } from "./pending-messages";
import { PageHeader } from "./ui";

const views = [
  { value: "compose", label: "Soạn tin" },
  { value: "waiting", label: "Tin nhắn chờ gửi" },
] as const;

// Bulk messaging: write a message for several groups, and look after the ones still waiting for
// their time. Which of the two is shown lives in the URL.
export function BroadcastView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = views.find((item) => item.value === searchParams.get("view"))?.value ?? "compose";
  const { data: waiting } = useSWR<PendingReminderMessage[]>("/reminder-messages");

  return (
    <>
      <PageHeader title="Gửi tin nhắn hàng loạt" description="Bot gửi một tin nhắn vào nhiều nhóm cùng lúc: gửi ngay, hoặc hẹn giờ để gửi sau." />
      <div role="group" aria-label="Chọn soạn tin hoặc tin nhắn chờ gửi" className="mb-4 inline-flex gap-1 rounded-md border border-border bg-surface p-1">
        {views.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={view === item.value}
            onClick={() => router.replace(item.value === "compose" ? pathname : `${pathname}?view=${item.value}`, { scroll: false })}
            className={cn(
              "h-7 rounded px-2.5 text-sm transition-colors",
              view === item.value ? "bg-surface-hover font-medium text-foreground" : "text-muted hover:text-foreground",
            )}
          >
            {item.label}
            {item.value === "waiting" && waiting !== undefined && waiting.length > 0 ? <span className="ml-1.5 tabular-nums text-muted">{formatNumber(waiting.length)}</span> : null}
          </button>
        ))}
      </div>
      {view === "waiting" ? <PendingMessages /> : <MessageForm />}
    </>
  );
}
