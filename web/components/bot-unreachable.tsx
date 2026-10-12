// Shown instead of a page when the dashboard cannot reach the bot's API at all.
export function BotUnreachable() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6">
        <h1 className="text-lg font-semibold">Không kết nối được tới bot</h1>
        <p className="mt-2 text-sm text-muted">
          Bảng điều khiển lấy dữ liệu từ bot đang chạy. Hãy khởi động bot bằng <code className="font-mono text-foreground">npm run dev</code> ở thư mục gốc,
          kiểm tra <code className="font-mono text-foreground">BOT_API_URL</code> trỏ đúng địa chỉ của bot, rồi tải lại trang.
        </p>
      </div>
    </main>
  );
}
