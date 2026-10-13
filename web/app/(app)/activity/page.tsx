import type { Metadata } from "next";
import { Suspense } from "react";
import { ActivityView } from "@/components/activity-view";

export const metadata: Metadata = { title: "Lịch sử hoạt động" };

export default function Page() {
  // useSearchParams needs a Suspense boundary so the rest of the shell can render first.
  return (
    <Suspense>
      <ActivityView />
    </Suspense>
  );
}
