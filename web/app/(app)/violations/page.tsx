import type { Metadata } from "next";
import { Suspense } from "react";
import { ViolationsView } from "@/components/violations-view";

export const metadata: Metadata = { title: "Nhật ký vi phạm" };

export default function Page() {
  // useSearchParams needs a Suspense boundary so the rest of the shell can render first.
  return (
    <Suspense>
      <ViolationsView />
    </Suspense>
  );
}
