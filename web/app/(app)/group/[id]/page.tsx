import type { Metadata } from "next";
import { Suspense } from "react";
import { GroupView } from "@/components/group-view";

export const metadata: Metadata = { title: "Nhóm" };

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <GroupView groupId={decodeURIComponent(id)} />
    </Suspense>
  );
}
