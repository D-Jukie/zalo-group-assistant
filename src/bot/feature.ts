import type { Message } from "zca-js";
import type { LiveGroupInfo, StoredGroup, ViolationRule } from "../types.js";

export type GroupMessageContext = Readonly<{
  message: Message;
  groupId: string;
  userId: string;
  info: LiveGroupInfo;
  group: StoredGroup;
  senderIsAdmin: boolean;
  botIsAdmin: boolean;
  // Records that the sender broke a rule. The bot then deletes the message and, once the group's
  // threshold is reached, removes the sender; without admin rights it only keeps the record.
  // detail is what was found (the link or the word) and is only used in the log.
  reportViolation: (rule: ViolationRule, detail: string) => Promise<void>;
}>;

export interface BotFeature {
  // Shown in the log when the feature throws.
  readonly name: string;
  // Called for every group message from another member; features run concurrently and check their own switches in context.group.
  onGroupMessage?(context: GroupMessageContext): Promise<void>;
}
