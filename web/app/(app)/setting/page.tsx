import type { Metadata } from "next";
import { SettingView } from "@/components/setting-view";

export const metadata: Metadata = { title: "Cài đặt" };

export default function SettingPage() {
  return <SettingView />;
}
