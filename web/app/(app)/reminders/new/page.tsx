import type { Metadata } from "next";
import { ReminderForm } from "@/components/reminder-form";

export const metadata: Metadata = { title: "Tạo nhắc hẹn" };

export default function NewReminderPage() {
  return <ReminderForm />;
}
