"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { send } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/format";
import { pageSizeOptions, refreshOptions, setPreferences, themeOptions, usePreferences } from "@/lib/preferences";
import type { BotStatus } from "@/lib/types";
import { Badge, Button, Card, CardHeader, PageHeader, Skeleton } from "./ui";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint ? <p className="mt-0.5 text-sm text-muted">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

function Appearance() {
  const preferences = usePreferences();
  return (
    <Card>
      <CardHeader title="Giao diện" />
      <div className="px-5">
        <Row label="Chế độ màu" hint="“Theo hệ thống” đổi sáng hoặc tối theo cài đặt của máy.">
          <div role="radiogroup" aria-label="Chế độ màu" className="flex gap-1 rounded-md border border-border bg-background p-1">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={preferences.theme === option.value}
                onClick={() => setPreferences({ theme: option.value })}
                className={cn(
                  "h-7 rounded px-2.5 text-sm transition-colors",
                  preferences.theme === option.value ? "bg-surface-hover font-medium text-foreground" : "text-muted hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Row>
      </div>
    </Card>
  );
}

function DataDisplay() {
  const preferences = usePreferences();
  const selectClass = "h-9 rounded-md border border-border-strong px-2 text-sm";
  return (
    <Card>
      <CardHeader title="Hiển thị dữ liệu" />
      <div className="divide-y divide-border px-5">
        <Row label="Tự làm mới" hint="Các trang đang mở tự tải lại số liệu sau mỗi khoảng thời gian này.">
          <label htmlFor="refresh" className="sr-only">Tự làm mới</label>
          <select id="refresh" name="refresh" value={preferences.refreshSeconds} onChange={(event) => setPreferences({ refreshSeconds: Number(event.target.value) })} className={selectClass}>
            {refreshOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Row>
        <Row label="Số nhóm mỗi trang" hint="Áp dụng cho bảng ở trang Nhóm.">
          <label htmlFor="page-size" className="sr-only">Số nhóm mỗi trang</label>
          <select id="page-size" name="pageSize" value={preferences.pageSize} onChange={(event) => setPreferences({ pageSize: Number(event.target.value) })} className={selectClass}>
            {pageSizeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </Row>
      </div>
    </Card>
  );
}

function Connection() {
  const { data: status, error } = useSWR<BotStatus>("/status");
  return (
    <Card>
      <CardHeader title="Kết nối tới bot" description="Bảng điều khiển lấy mọi dữ liệu từ API của bot. Địa chỉ API đặt bằng biến BOT_API_URL khi chạy bảng điều khiển." />
      <div className="divide-y divide-border px-5">
        <Row label="API của bot">
          {status ? <Badge tone="success">Hoạt động</Badge> : error ? <Badge tone="danger">Không phản hồi</Badge> : <Skeleton className="h-5 w-20" />}
        </Row>
        <Row label="Tài khoản Zalo của bot">
          {status ? <span className="text-sm" translate="no">{status.displayName || "Bot"} · <span className="font-mono text-muted">{status.userId}</span></span> : <Skeleton className="h-5 w-40" />}
        </Row>
        <Row label="Kết nối Zalo">
          {status ? (
            <span className="flex items-center gap-2 text-sm text-muted">
              <Badge tone={status.connected ? "success" : "danger"}>{status.connected ? "Đang kết nối" : "Mất kết nối"}</Badge>
              từ {formatDateTime(status.connectionChangedAt)}
            </span>
          ) : <Skeleton className="h-5 w-40" />}
        </Row>
      </div>
    </Card>
  );
}

function Session() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Card>
      <CardHeader title="Phiên đăng nhập" />
      <div className="px-5">
        <Row label="Đăng xuất khỏi trình duyệt này" hint="Phiên bị hủy ngay; lần sau cần mã mới gửi qua Zalo.">
          <Button
            variant="danger"
            pending={pending}
            onClick={async () => {
              setPending(true);
              await send("POST", "/auth/logout").catch(() => undefined);
              router.replace("/login");
            }}
          >
            Đăng xuất
          </Button>
        </Row>
      </div>
    </Card>
  );
}

export function SettingView() {
  return (
    <>
      <PageHeader title="Cài đặt" description="Cài đặt của bảng điều khiển này, lưu trên trình duyệt đang dùng. Quy tắc và danh sách của bot nằm ở trang Tính năng và trang của từng nhóm." />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Appearance />
          <DataDisplay />
        </div>
        <div className="space-y-4">
          <Connection />
          <Session />
        </div>
      </div>
    </>
  );
}
