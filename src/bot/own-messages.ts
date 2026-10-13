import type { SentMessageRef } from "../types.js";
import { now } from "../utils.js";

// How long a message of the bot's own is remembered here, and how many of them at most.
const keepMs = 60 * 60 * 1000;
const maxKept = 5000;
// How long to wait for Zalo to echo a message that was just sent.
const defaultWaitMs = 2000;

// Zalo only takes a message back when it is given both of the message's ids, and sending a message
// answers with just one of them. The other comes with the copy of the message Zalo sends back to the
// account that wrote it, so those copies are noted here and matched to what was sent.
export class OwnMessages {
  private readonly clientIds = new Map<string, Readonly<{ cliMsgId: string; at: number }>>();
  private readonly waiting = new Map<string, ((cliMsgId: string) => void)[]>();

  // Called for every message of the bot's own that Zalo echoes.
  public note(msgId: string, cliMsgId: string): void {
    if (msgId === "" || cliMsgId === "") return;
    this.clientIds.set(msgId, { cliMsgId, at: now() });
    for (const resolve of this.waiting.get(msgId) ?? []) resolve(cliMsgId);
    this.waiting.delete(msgId);
    if (this.clientIds.size <= maxKept) return;
    const cutoff = now() - keepMs;
    for (const [id, entry] of this.clientIds) if (entry.at < cutoff || this.clientIds.size > maxKept) this.clientIds.delete(id);
  }

  public clientIdOf(msgId: string): string | undefined {
    return this.clientIds.get(msgId)?.cliMsgId;
  }

  private wait(msgId: string, waitMs: number): Promise<string | undefined> {
    const known = this.clientIdOf(msgId);
    if (known !== undefined || waitMs <= 0) return Promise.resolve(known);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(undefined), waitMs);
      const waiters = this.waiting.get(msgId) ?? [];
      waiters.push((cliMsgId) => {
        clearTimeout(timer);
        resolve(cliMsgId);
      });
      this.waiting.set(msgId, waiters);
    });
  }

  // The messages just sent, each with its second id when the echo arrived in time. One that did not
  // is kept without it; it may still be found here later, when the message is to be taken back.
  public async resolve(msgIds: readonly string[], waitMs = defaultWaitMs): Promise<SentMessageRef[]> {
    const deadline = now() + waitMs;
    const refs: SentMessageRef[] = [];
    for (const msgId of msgIds) {
      const cliMsgId = await this.wait(msgId, Math.max(0, deadline - now()));
      refs.push(cliMsgId === undefined ? { msgId } : { msgId, cliMsgId });
    }
    return refs;
  }
}
