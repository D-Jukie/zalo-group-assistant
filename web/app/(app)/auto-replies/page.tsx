import type { Metadata } from "next";
import { AutoRepliesView } from "@/components/auto-replies-view";

export const metadata: Metadata = { title: "Trả lời tự động" };

export default function AutoRepliesPage() {
  return <AutoRepliesView />;
}
