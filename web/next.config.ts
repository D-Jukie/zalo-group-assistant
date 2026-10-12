import type { NextConfig } from "next";

// The dashboard has no backend of its own: every /api request is passed on to the bot's API.
// The browser only ever talks to this origin, so the bot's session cookie works unchanged.
const botApiUrl = process.env.BOT_API_URL ?? "http://127.0.0.1:3400";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${botApiUrl}/api/:path*` }];
  },
};

export default nextConfig;
