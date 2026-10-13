import { cookies } from "next/headers";

const botApiUrl = process.env.BOT_API_URL ?? "http://127.0.0.1:3400";

export type SessionState = "signedIn" | "signedOut" | "botUnreachable";

// Where the visitor stands on the way in: PIN, the bot's own sign-in to Zalo, then the code from Zalo.
export type SessionInfo = Readonly<{
  authenticated: boolean;
  unlocked: boolean;
  pinSet: boolean;
  emailConfigured: boolean;
  botReady: boolean;
}>;

// Asks the bot about the visitor's cookies. Runs on the server before a page renders; undefined when the bot cannot be reached.
export async function getSessionInfo(): Promise<SessionInfo | undefined> {
  const cookieHeader = (await cookies()).toString();
  try {
    const response = await fetch(`${botApiUrl}/api/auth/session`, { headers: { cookie: cookieHeader }, cache: "no-store" });
    if (!response.ok) return undefined;
    const body = (await response.json()) as Partial<SessionInfo>;
    return {
      authenticated: body.authenticated === true,
      unlocked: body.unlocked === true,
      pinSet: body.pinSet === true,
      emailConfigured: body.emailConfigured === true,
      botReady: body.botReady === true,
    };
  } catch {
    return undefined;
  }
}

// The dashboard only opens for a signed-in visitor while the bot itself is signed in to Zalo.
export async function getSessionState(): Promise<SessionState> {
  const info = await getSessionInfo();
  if (info === undefined) return "botUnreachable";
  return info.authenticated && info.botReady ? "signedIn" : "signedOut";
}
