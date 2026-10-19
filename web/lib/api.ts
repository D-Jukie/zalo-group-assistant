export class ApiError extends Error {
  public constructor(message: string, public readonly status: number) {
    super(message);
  }
}

// Calls the bot API through this app's /api proxy. An expired session sends the browser to the login
// page, and so does a bot that has been signed out of Zalo, where that page shows the QR code.
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    cache: "no-store",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body: unknown = (response.headers.get("content-type") ?? "").includes("json") ? await response.json() : undefined;
  const botSignedOut = response.status === 503 && typeof body === "object" && body !== null && "code" in body && body.code === "bot-signed-out";
  if ((response.status === 401 || botSignedOut) && typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
      ? body.error
      : response.status >= 500 ? "Không kết nối được tới bot. Hãy kiểm tra bot còn chạy không." : "Yêu cầu thất bại";
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export function fetcher<T>(path: string): Promise<T> {
  return api<T>(path);
}

export function send<T>(method: "POST" | "PATCH" | "DELETE", path: string, body: unknown = {}): Promise<T> {
  return api<T>(path, { method, body: JSON.stringify(body) });
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Yêu cầu thất bại";
}
