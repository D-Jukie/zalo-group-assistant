"use client";

import Link from "next/link";
import useSWR from "swr";
import { errorText } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { totalViolations, type BotStatus, type GroupSummary, type Overview } from "@/lib/types";
import { BotStatusCard } from "./bot-status-card";
import { Card, CardHeader, EmptyState, PageHeader, Skeleton, StatTile } from "./ui";
import { GroupLink, ViolationItem } from "./violation-item";
import { ViolationsChart } from "./violations-chart";

function Tiles() {
  const { data: groups } = useSWR<GroupSummary>("/groups/summary");
  const { data: overview } = useSWR<Overview>("/overview");
  const { data: status } = useSWR<BotStatus>("/status");
  const pending = <Skeleton className="h-9 w-16" />;
  const today = overview?.series.at(-1);
  const yesterday = overview?.series.at(-2);
  const todayTotal = today === undefined ? 0 : totalViolations(today);
  const yesterdayTotal = yesterday === undefined ? 0 : totalViolations(yesterday);
  const period = overview?.series.reduce((sum, day) => sum + totalViolations(day), 0);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label="Nhóm"
        value={groups ? formatNumber(groups.total) : pending}
        hint={groups ? `Bot là QTV ở ${formatNumber(groups.botAdmin)} nhóm` : undefined}
      />
      <StatTile
        label="Nhóm đang bật bot"
        value={groups ? formatNumber(groups.enabled) : pending}
        hint={groups ? `${formatNumber(groups.kicking)} nhóm có tính năng đang kick` : undefined}
      />
      <StatTile
        label="Vi phạm hôm nay"
        value={overview ? formatNumber(todayTotal) : pending}
        hint={overview ? `Hôm qua: ${formatNumber(yesterdayTotal)}` : undefined}
      />
      <StatTile
        label="Vi phạm 14 ngày"
        value={period === undefined ? pending : formatNumber(period)}
        hint={status ? `${formatNumber(status.groupMessagesSeen)} tin nhóm đã nhận từ lúc khởi động` : undefined}
      />
    </div>
  );
}

function Activity() {
  const { data: overview, error } = useSWR<Overview>("/overview");
  return (
    <div className="grid gap-4 xl:grid-cols-5">
      <Card className="xl:col-span-3">
        <CardHeader title="Vi phạm theo ngày" description="Số tin vi phạm trong 14 ngày gần nhất, theo quy tắc." />
        <div className="p-5">
          {overview ? <ViolationsChart series={overview.series} /> : error ? <p className="text-sm text-danger">{errorText(error)}</p> : <Skeleton className="h-56 w-full" />}
        </div>
      </Card>
      <Card className="flex flex-col xl:col-span-2">
        <CardHeader title="Vi phạm gần đây" description="20 tin mới nhất trên mọi nhóm." action={<Link href="/violations" className="text-sm font-medium text-accent underline-offset-4 hover:underline">Xem tất cả</Link>} />
        {overview === undefined ? (
          <div className="space-y-3 p-5">{error ? <p className="text-sm text-danger">{errorText(error)}</p> : <><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></>}</div>
        ) : overview.recent.length === 0 ? (
          <EmptyState
            title="Chưa có tin vi phạm nào"
            description="Bật bot ở một nhóm, rồi bật chặn link hoặc lọc từ cấm, để bot bắt đầu ghi nhận."
            action={<Link href="/groups" className="text-sm font-medium text-accent underline-offset-4 hover:underline">Mở danh sách nhóm</Link>}
          />
        ) : (
          // On wide screens the feed takes the chart card’s height and scrolls inside it, so the two cards stay level.
          <div className="relative min-h-64 flex-1">
          <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto overscroll-contain xl:absolute xl:inset-0 xl:max-h-none">
            {overview.recent.map((message) => (
              <ViolationItem
                key={`${message.groupId}-${message.messageId}`}
                message={message}
                context={<><span aria-hidden="true" className="text-subtle">·</span><GroupLink groupId={message.groupId} name={message.groupName} /><span aria-hidden="true" className="text-subtle">·</span></>}
              />
            ))}
          </ul>
          </div>
        )}
      </Card>
    </div>
  );
}

export function DashboardView() {
  return (
    <>
      <PageHeader title="Tổng quan" description="Tình trạng bot và hoạt động kiểm duyệt trên mọi nhóm." />
      <div className="space-y-4">
        <BotStatusCard />
        <Tiles />
        <Activity />
      </div>
    </>
  );
}
