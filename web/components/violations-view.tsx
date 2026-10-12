"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWRInfinite from "swr/infinite";
import { errorText } from "@/lib/api";
import { cn } from "@/lib/format";
import { ruleLabels, violationRules, type RecentViolation, type ViolationRule } from "@/lib/types";
import { Button, Card, EmptyState, PageHeader, Skeleton } from "./ui";
import { GroupLink, ViolationItem } from "./violation-item";

const pageSize = 30;

// The violation log across every group. The rule filter lives in the URL; older entries load on demand.
export function ViolationsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rule: ViolationRule | undefined = violationRules.find((item) => item === searchParams.get("rule"));

  const { data: pages, error, size, setSize, isValidating } = useSWRInfinite<RecentViolation[]>((index, previous: RecentViolation[] | null) => {
    if (previous !== null && previous.length < pageSize) return null;
    const params = new URLSearchParams();
    if (rule !== undefined) params.set("rule", rule);
    const last = previous?.at(-1);
    if (index > 0 && last !== undefined) params.set("before", String(last.at));
    const query = params.toString();
    return query ? `/violations?${query}` : "/violations";
  });

  const messages = pages?.flat() ?? [];
  const hasMore = pages !== undefined && (pages.at(-1)?.length ?? 0) === pageSize;
  const loadingMore = isValidating && pages !== undefined && size > pages.length;
  const filters: readonly { value: ViolationRule | undefined; label: string }[] = [
    { value: undefined, label: "Tất cả" },
    ...violationRules.map((item) => ({ value: item, label: ruleLabels[item] })),
  ];

  return (
    <>
      <PageHeader title="Nhật ký vi phạm" description="Tin vi phạm trên mọi nhóm đang bật bot, mới nhất trước. Nội dung được lưu 90 ngày." />
      <div role="group" aria-label="Lọc theo quy tắc" className="mb-4 inline-flex gap-1 rounded-md border border-border bg-surface p-1">
        {filters.map((item) => (
          <button
            key={item.label}
            type="button"
            aria-pressed={rule === item.value}
            onClick={() => router.replace(item.value === undefined ? pathname : `${pathname}?rule=${item.value}`, { scroll: false })}
            className={cn(
              "h-7 rounded px-2.5 text-sm transition-colors",
              rule === item.value ? "bg-surface-hover font-medium text-foreground" : "text-muted hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <Card>
        {pages === undefined ? (
          <div className="space-y-3 p-5">
            {error ? <p className="text-sm text-danger">{errorText(error)}</p> : Array.from({ length: 5 }, (_item, index) => <Skeleton key={index} className="h-16 w-full" />)}
          </div>
        ) : messages.length === 0 ? (
          <EmptyState
            title={rule === undefined ? "Chưa có tin vi phạm nào" : `Chưa có vi phạm loại “${ruleLabels[rule]}”`}
            description="Bot chỉ ghi nhận ở những nhóm đã bật bot và bật quy tắc tương ứng."
          />
        ) : (
          <ul className="divide-y divide-border">
            {messages.map((message) => (
              <ViolationItem
                key={`${message.groupId}-${message.messageId}`}
                message={message}
                context={<><span aria-hidden="true" className="text-subtle">·</span><GroupLink groupId={message.groupId} name={message.groupName} /><span aria-hidden="true" className="text-subtle">·</span></>}
              />
            ))}
          </ul>
        )}
        {hasMore ? (
          <div className="border-t border-border p-3 text-center">
            <Button pending={loadingMore} onClick={() => setSize(size + 1)}>{loadingMore ? "Đang tải…" : "Tải thêm"}</Button>
          </div>
        ) : null}
      </Card>
    </>
  );
}
