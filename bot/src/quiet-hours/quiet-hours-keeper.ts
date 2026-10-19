import { noActivity, type ActivityRecorder } from "../activity/activity-log.js";
import { writeLog } from "../logger.js";
import type { QuietHoursState, StoredGroup } from "../types.js";
import { describeQuietHours, formatClock, quietWindow } from "./quiet-hours.js";

// How often the bot looks at the clock. Quiet hours start and end within this much of their time.
const tickMs = 30_000;

type KeeperGroups = Readonly<{
  isInGroup(groupId: string): Promise<boolean>;
  zaloSettings(groupId: string): Promise<Readonly<{ settings: Readonly<{ lockSendMsg: boolean }> }>>;
  updateZaloSettings(groupId: string, change: Readonly<{ lockSendMsg: boolean }>): Promise<unknown>;
}>;

type KeeperStore = Readonly<{
  listGroups(): Promise<readonly StoredGroup[]>;
  setQuietHoursState(groupId: string, state: QuietHoursState): Promise<void>;
}>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Locks a group's chat for its quiet hours, through Zalo's own "chỉ trưởng và phó nhóm được nhắn
// tin", and unlocks it when they are over. It only undoes what it did itself: a chat an admin had
// already locked stays locked, and a chat an admin unlocks in the middle of the night is not locked
// again until the next quiet hours. Each start and end is tried once, so a group where the bot may
// not change settings is written into the history once a night, not every minute.
export class QuietHoursKeeper {
  private timer: NodeJS.Timeout | undefined;
  private busy = false;
  // Groups whose chat could not be unlocked yet; tried again on every look, written down once.
  private readonly unlockFailing = new Set<string>();

  public constructor(
    private readonly groups: KeeperGroups,
    private readonly store: KeeperStore,
    private readonly activity: ActivityRecorder = noActivity,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public start(): void {
    this.timer = setInterval(() => void this.tick(), tickMs);
    void this.tick();
  }

  public stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  // Looks at every group once. A look that is still going when the next one is due is not doubled.
  public async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const at = this.clock();
      for (const group of await this.store.listGroups()) {
        try {
          await this.keep(group, at);
        } catch (error: unknown) {
          writeLog("[QUIET HOURS FAILED]", "red", { group: group.groupId, error: errorMessage(error) }, "error");
        }
      }
    } catch (error: unknown) {
      writeLog("[QUIET HOURS FAILED]", "red", { error: errorMessage(error) }, "error");
    } finally {
      this.busy = false;
    }
  }

  private async keep(group: StoredGroup, at: Date): Promise<void> {
    const settings = group.quietHours;
    const state = group.quietHoursState;
    // Switched off, or the bot is off in the group: no quiet hours, but a chat the bot locked is given back.
    const window = settings.enabled && group.botEnabled ? quietWindow(settings, at) : undefined;
    const identity = { groupId: group.groupId, groupName: group.name };
    if (window !== undefined) {
      if (state?.window === window) return;
      if (!await this.groups.isInGroup(group.groupId)) {
        await this.store.setQuietHoursState(group.groupId, { window, locked: false });
        return;
      }
      try {
        const { settings: zalo } = await this.groups.zaloSettings(group.groupId);
        if (zalo.lockSendMsg) {
          // Already locked by an admin: theirs to unlock.
          await this.store.setQuietHoursState(group.groupId, { window, locked: false });
          return;
        }
        await this.groups.updateZaloSettings(group.groupId, { lockSendMsg: true });
        await this.store.setQuietHoursState(group.groupId, { window, locked: true });
        this.activity.record({ category: "settings", actor: "bot", title: "Bắt đầu giờ yên lặng", detail: `Chỉ trưởng và phó nhóm được nhắn tin tới ${formatClock(settings.end)} (${describeQuietHours(settings)})`, ...identity });
      } catch (error: unknown) {
        await this.store.setQuietHoursState(group.groupId, { window, locked: false });
        this.activity.record({ category: "settings", actor: "bot", title: "Bắt đầu giờ yên lặng", ok: false, error: errorMessage(error), ...identity });
      }
      return;
    }
    if (state?.locked !== true) return;
    try {
      // A group the bot has left cannot be unlocked by it any more.
      if (await this.groups.isInGroup(group.groupId)) {
        const { settings: zalo } = await this.groups.zaloSettings(group.groupId);
        // An admin may have unlocked it already.
        if (zalo.lockSendMsg) await this.groups.updateZaloSettings(group.groupId, { lockSendMsg: false });
        this.activity.record({ category: "settings", actor: "bot", title: "Kết thúc giờ yên lặng", detail: "Mọi thành viên được nhắn tin lại", ...identity });
      }
      this.unlockFailing.delete(group.groupId);
      await this.store.setQuietHoursState(group.groupId, { window: state.window, locked: false });
    } catch (error: unknown) {
      // The chat stays locked until it works: a group must not be left silent for the day by one failed request.
      if (!this.unlockFailing.has(group.groupId)) this.activity.record({ category: "settings", actor: "bot", title: "Kết thúc giờ yên lặng", ok: false, error: `${errorMessage(error)}. Bot sẽ thử lại.`, ...identity });
      this.unlockFailing.add(group.groupId);
    }
  }
}
