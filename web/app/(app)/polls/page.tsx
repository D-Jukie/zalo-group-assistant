import type { Metadata } from "next";
import { Suspense } from "react";
import { PollsView } from "@/components/polls-view";

export const metadata: Metadata = { title: "Bình chọn" };

export default function PollsPage() {
  // useSearchParams needs a Suspense boundary so the rest of the shell can render first.
  return (
    <Suspense>
      <PollsView />
    </Suspense>
  );
}
