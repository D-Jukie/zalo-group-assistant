import type { Metadata } from "next";
import { Suspense } from "react";
import { GroupsView } from "@/components/groups-view";

export const metadata: Metadata = { title: "Nhóm" };

export default function GroupsPage() {
  // useSearchParams needs a Suspense boundary so the rest of the shell can render first.
  return (
    <Suspense>
      <GroupsView />
    </Suspense>
  );
}
