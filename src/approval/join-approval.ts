import type { JoinApplicant, JoinApprovalSettings } from "../types.js";

const dayMs = 24 * 60 * 60 * 1000;

// What a group holds when Zalo does not say.
export const defaultMaxMembers = 1000;
export const maxAccountAgeDays = 3650;

// Zalo gives an account without a picture of its own an address ending in "/default".
export function hasOwnAvatar(avatar: string): boolean {
  return avatar !== "" && !/\/default\/?(\?.*)?$/u.test(avatar);
}

// "45 ngày", "3 tháng", "2 năm": a number of days in the largest unit that divides it evenly.
export function formatAgeDays(days: number): string {
  if (days % 365 === 0) return `${days / 365} năm`;
  if (days % 30 === 0) return `${days / 30} tháng`;
  return `${days} ngày`;
}

// Why an applicant does not meet the group's criteria; empty when they meet all of them.
// An account whose age Zalo does not tell cannot pass an age requirement.
export function failedCriteria(applicant: JoinApplicant, settings: JoinApprovalSettings, at: number): string[] {
  const reasons: string[] = [];
  if (settings.requireAvatar && !hasOwnAvatar(applicant.avatar)) reasons.push("Chưa có ảnh đại diện");
  if (settings.minAccountAgeDays > 0) {
    if (applicant.accountCreatedAt === null) reasons.push("Không rõ ngày tham gia Zalo");
    else if (at - applicant.accountCreatedAt < settings.minAccountAgeDays * dayMs) reasons.push(`Tham gia Zalo chưa đủ ${formatAgeDays(settings.minAccountAgeDays)}`);
  }
  return reasons;
}

// How many more members the group can take.
export function freeSlots(memberCount: number, maxMembers: number): number {
  return Math.max(0, (maxMembers > 0 ? maxMembers : defaultMaxMembers) - memberCount);
}

// Who to let in now: the applicants that meet every criterion, in the order they asked, and no more
// of them than the group has room for. Everyone else stays in the waiting list for a person to decide.
export function pickApprovals(applicants: readonly JoinApplicant[], settings: JoinApprovalSettings, at: number, slots: number): JoinApplicant[] {
  return applicants.filter((applicant) => failedCriteria(applicant, settings, at).length === 0).slice(0, Math.max(0, slots));
}

// Checks the settings sent by the dashboard. Returns them, or undefined when they are not acceptable.
export function parseJoinApprovalSettings(body: unknown): JoinApprovalSettings | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { enabled, requireAvatar, minAccountAgeDays } = body as Record<string, unknown>;
  if (typeof enabled !== "boolean" || typeof requireAvatar !== "boolean") return undefined;
  if (typeof minAccountAgeDays !== "number" || !Number.isInteger(minAccountAgeDays) || minAccountAgeDays < 0 || minAccountAgeDays > maxAccountAgeDays) return undefined;
  return { enabled, requireAvatar, minAccountAgeDays };
}
