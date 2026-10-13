import type { Metadata } from "next";
import { Suspense } from "react";
import { BroadcastView } from "@/components/broadcast-view";

export const metadata: Metadata = { title: "Gửi tin nhắn hàng loạt" };

export default function BroadcastPage() {
  // useSearchParams needs a Suspense boundary so the rest of the shell can render first.
  return (
    <Suspense>
      <BroadcastView />
    </Suspense>
  );
}
