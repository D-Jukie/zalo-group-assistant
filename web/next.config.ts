import type { NextConfig } from "next";

// The dashboard has no backend of its own: every /api request is passed on to the bot's API.
// The browser only ever talks to this origin, so the bot's session cookie works unchanged.
const botApiUrl = process.env.BOT_API_URL ?? "http://127.0.0.1:3400";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // A new reminder may carry two pictures; the default limit for passed-on requests is 10 MB.
    proxyClientMaxBodySize: "16mb",
    // Creating a reminder in many groups, or reading every group's reminders again, takes the bot well over
    // the default 30 seconds. Cut off early, the dashboard would report a failure while the bot carries on.
    proxyTimeout: 10 * 60 * 1000,
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${botApiUrl}/api/:path*` }];
  },
};

export default nextConfig;
