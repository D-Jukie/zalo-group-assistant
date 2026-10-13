"use client";

import { useState } from "react";
import useSWR from "swr";
import { errorText, send } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { SentBatch, SentBatchGroup } from "@/lib/types";
import { ConfirmDialog } from "./confirm-dialog";
import { FormattedText } from "./formatted-text";
import { useToast } from "./toast";
import { Badge, Button, Card, CardHeader, EmptyState, Skeleton } from "./ui";

const urgencyLabels = { important: "Quan trọng", urgent: "Khẩn cấp" } as const;

// Whether a group's messages can still be asked back: they went out, and have not been taken back yet.
function recallable(group: SentBatchGroup): boolean {
  return group.ok && group.recalledAt === undefined && group.messages.length > 0;
}

function groupStatus(group: SentBatchGroup) {
  if (!group.ok) return <span className="text-danger">Gửi lỗi{group.error ? `: ${group.error}` : ""}</span>;
  if (group.recalledAt !== undefined) return <span className="text-muted">Đã thu hồi lúc {formatDateTime(group.recalledAt)}</span>;
  if (group.recallError !== undefined) return <span className="text-danger">Chưa thu hồi được: {group.recallError}</span>;
  return <span className="text-success">Đã gửi</span>;
}

// The rounds of sending from this page, newest first. A round is one message sent to several groups;
// taking it back takes it back in every group it reached.
export function SentBatches() {
  const { data: batches, error, mutate } = useSWR<SentBatch[]>("/sent-batches");
  const [confirming, setConfirming] = useState<SentBatch>();
  const [pending, setPending] = useState(false);
  const toast = useToast();

  async function recall(batch: SentBatch) {
    setPending(true);
    try {
      const updated = await send<SentBatch>("POST", `/sent-batches/${encodeURIComponent(batch.id)}/recall`);
      void mutate((current) => current?.map((item) => (item.id === updated.id ? updated : item)), { revalidate: false });
      const left = updated.groups.filter(recallable).length;
      const done = updated.groups.filter((group) => group.recalledAt !== undefined).length;
      if (left === 0) toast.success(`Đã thu hồi tin nhắn ở ${formatNumber(done)} nhóm`);
      else toast.error(`Còn ${formatNumber(left)} nhóm chưa thu hồi được; lý do nằm cạnh tên nhóm`);
    } catch (exception) {
      toast.error(errorText(exception));
    } finally {
      setPending(false);
      setConfirming(undefined);
    }
  }

  return (
    <>
      <Card>
        <CardHeader title="Tin nhắn đã gửi" description="Mỗi dòng là một đợt gửi: một tin nhắn cho nhiều nhóm. Thu hồi một đợt là thu hồi tin đó ở mọi nhóm đã nhận. Các đợt được giữ 30 ngày." />
        {batches === undefined ? (
          <div className="space-y-3 p-5">
            {error ? <p className="text-sm text-danger">{errorText(error)}</p> : Array.from({ length: 3 }, (_item, index) => <Skeleton key={index} className="h-16 w-full" />)}
          </div>
        ) : batches.length === 0 ? (
          <EmptyState title="Chưa có đợt gửi nào" description="Tin nhắn gửi từ tab “Soạn tin”, gửi ngay hoặc hẹn giờ, sẽ hiện ở đây sau khi gửi." />
        ) : (
          <ul className="divide-y divide-border">
            {batches.map((batch) => {
              const sent = batch.groups.filter((group) => group.ok);
              const recalled = sent.filter((group) => group.recalledAt !== undefined);
              const open = batch.groups.filter(recallable);
              return (
                <li key={batch.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 basis-64">
                      <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
                        <span className="tabular-nums">{formatDateTime(batch.createdAt)}</span>
                        {batch.scheduled ? <Badge>Hẹn giờ</Badge> : null}
                        {batch.urgency === undefined ? null : <Badge tone="warning">{urgencyLabels[batch.urgency]}</Badge>}
                        {sent.length > 0 && recalled.length === sent.length ? <Badge>Đã thu hồi</Badge> : recalled.length > 0 ? <Badge>Đã thu hồi {formatNumber(recalled.length)}/{formatNumber(sent.length)} nhóm</Badge> : null}
                      </p>
                      <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap break-words text-sm">
                        {batch.text ? <FormattedText text={batch.text} /> : <span className="text-subtle">Chỉ có ảnh, không có chữ</span>}
                      </p>
                      <p className="mt-1.5 text-sm text-muted">
                        Đã gửi {formatNumber(sent.length)}/{formatNumber(batch.groups.length)} nhóm{batch.imageCount > 0 ? ` · ${formatNumber(batch.imageCount)} ảnh` : ""}
                      </p>
                    </div>
                    <Button variant="danger" disabled={open.length === 0 || pending} onClick={() => setConfirming(batch)}>Thu hồi</Button>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm text-muted hover:text-foreground">Xem từng nhóm</summary>
                    <ul className="mt-2 space-y-1 text-sm">
                      {batch.groups.map((group) => (
                        <li key={group.groupId} className="flex flex-wrap gap-x-2">
                          <span className="font-medium" translate="no">{group.groupName || group.groupId}</span>
                          {groupStatus(group)}
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <ConfirmDialog
        open={confirming !== undefined}
        title={`Thu hồi tin nhắn ở ${formatNumber(confirming?.groups.filter(recallable).length ?? 0)} nhóm?`}
        confirmLabel="Thu hồi"
        pending={pending}
        onConfirm={() => { if (confirming !== undefined) void recall(confirming); }}
        onCancel={() => setConfirming(undefined)}
      >
        Tin nhắn của đợt này sẽ bị thu hồi ở mọi nhóm đã nhận và không gửi lại được. Zalo chỉ cho thu hồi trong một khoảng thời gian sau khi gửi; nhóm nào quá hạn sẽ báo lỗi và giữ nguyên tin.
      </ConfirmDialog>
    </>
  );
}
