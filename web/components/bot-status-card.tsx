"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { errorText } from "@/lib/api";
import { formatDateTime, formatDuration } from "@/lib/format";
import type { BotStatus } from "@/lib/types";
import { Badge, Card, Skeleton } from "./ui";

// Counts the uptime forward every second from the value the server last reported.
function Uptime({ status }: { status: BotStatus }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const receivedAt = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed((Date.now() - receivedAt) / 1000), 1000);
    return () => clearInterval(timer);
  }, [status.uptimeSeconds]);
  return <span className="tabular-nums">{formatDuration(status.uptimeSeconds + elapsed)}</span>;
}

export function BotStatusCard() {
  const { data: status, error } = useSWR<BotStatus>("/status");

  if (status === undefined) {
    return (
      <Card className="flex items-center gap-4 p-5">
        <Skeleton className="size-14 rounded-full" />
        <div className="flex-1 space-y-2">
          {error ? <p className="text-sm text-danger">{errorText(error)}</p> : <><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-64" /></>}
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-wrap items-center gap-x-6 gap-y-4 p-5">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        {status.avatar ? (
          // The avatar lives on Zalo's CDN, so it is a plain image with fixed dimensions rather than next/image.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={status.avatar} alt="" width={56} height={56} className="size-14 shrink-0 rounded-full border border-border object-cover" />
        ) : (
          <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-full border border-border bg-surface-hover text-lg font-semibold">Z</span>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold" translate="no">{status.displayName || "Bot"}</h2>
            <Badge tone={status.connected ? "success" : "danger"}>{status.connected ? "Đang kết nối Zalo" : "Mất kết nối Zalo"}</Badge>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted">
            ID <span className="font-mono" translate="no">{status.userId}</span> · {status.connected ? "kết nối" : "mất kết nối"} từ {formatDateTime(status.connectionChangedAt)}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
        <dt className="text-muted">Đã chạy</dt>
        <dd className="font-medium"><Uptime status={status} /></dd>
        <dt className="text-muted">Khởi động lúc</dt>
        <dd className="tabular-nums">{formatDateTime(status.startedAt)}</dd>
      </dl>
    </Card>
  );
}
