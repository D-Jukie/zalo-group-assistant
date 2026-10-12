import { cookies } from "next/headers";

const botApiUrl = process.env.BOT_API_URL ?? "http://127.0.0.1:3400";

export type SessionState = "signedIn" | "signedOut" | "botUnreachable";

// Asks the bot whether the visitor's cookie is a live admin session. Runs on the server before a page renders.
export async function getSessionState(): Promise<SessionState> {
  const cookieHeader = (await cookies()).toString();
  try {
    const response = await fetch(`${botApiUrl}/api/auth/session`, { headers: { cookie: cookieHeader }, cache: "no-store" });
    if (!response.ok) return "botUnreachable";
    const body = (await response.json()) as { authenticated?: boolean };
    return body.authenticated === true ? "signedIn" : "signedOut";
  } catch {
    return "botUnreachable";
  }
}
