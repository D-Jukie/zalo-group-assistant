import Link from "next/link";
import type { ReactNode } from "react";
import { formatDateTime, formatRelative } from "@/lib/format";
import { ruleLabels, type ViolationMessage, type ViolationMessageStatus } from "@/lib/types";
import { Badge } from "./ui";

const statusLabels: Record<ViolationMessageStatus, { label: string; tone: "success" | "danger" | "neutral" }> = {
  deleted: { label: "Đã xóa", tone: "success" },
  deleteFailed: { label: "Xóa thất bại", tone: "danger" },
  recorded: { label: "Chỉ ghi nhận", tone: "neutral" },
};

// One logged message: who sent it, which rules it broke, what happened to it and what it said.
export function ViolationItem({ message, context }: { message: ViolationMessage; context?: ReactNode }) {
  const status = statusLabels[message.status];
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="min-w-0 truncate font-medium" translate="no">{message.userName || message.userId}</span>
        {context}
        <time dateTime={new Date(message.at).toISOString()} title={formatDateTime(message.at)} className="text-muted">{formatRelative(message.at)}</time>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {message.matches.map((match, index) => <Badge key={`${match.rule}-${index}`} tone="warning">{ruleLabels[match.rule]}: {match.detail}</Badge>)}
          <Badge tone={status.tone}>{status.label}</Badge>
        </span>
      </div>
      {message.text ? (
        <p className="mt-2 line-clamp-4 whitespace-pre-wrap break-words text-sm">{message.text}</p>
      ) : (
        <p className="mt-2 text-sm text-subtle">Không có nội dung chữ</p>
      )}
      {message.link ? <p className="mt-1 truncate font-mono text-xs text-muted" translate="no">{message.link}</p> : null}
    </li>
  );
}

export function GroupLink({ groupId, name }: { groupId: string; name: string }) {
  return (
    <Link href={`/group/${encodeURIComponent(groupId)}`} className="min-w-0 truncate text-muted underline-offset-4 hover:text-foreground hover:underline">
      {name}
    </Link>
  );
}
