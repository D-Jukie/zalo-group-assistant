import type { Metadata } from "next";
import { Suspense } from "react";
import { FeaturesView } from "@/components/features-view";

export const metadata: Metadata = { title: "Tính năng" };

export default function Page() {
  // useSearchParams needs a Suspense boundary so the rest of the shell can render first.
  return (
    <Suspense>
      <FeaturesView />
    </Suspense>
  );
}
