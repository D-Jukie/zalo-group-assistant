import type { Metadata } from "next";
import { Suspense } from "react";
import { RemindersView } from "@/components/reminders-view";

export const metadata: Metadata = { title: "Lịch nhắc hẹn" };

export default function RemindersPage() {
  // useSearchParams needs a Suspense boundary so the rest of the shell can render first.
  return (
    <Suspense>
      <RemindersView />
    </Suspense>
  );
}
