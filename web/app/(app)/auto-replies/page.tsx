import type { Metadata } from "next";
import { Suspense } from "react";
import { AutoRepliesView } from "@/components/auto-replies-view";

export const metadata: Metadata = { title: "Trả lời tự động" };

export default function AutoRepliesPage() {
  // useSearchParams needs a Suspense boundary so the rest of the shell can render first.
  return (
    <Suspense>
      <AutoRepliesView />
    </Suspense>
  );
}
