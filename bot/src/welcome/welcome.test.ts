import assert from "node:assert/strict";
import { test } from "node:test";
import { TextStyle } from "zca-js";
import { defaultGroupWelcome, type GroupWelcomeSettings, type NewActivity, type StoredGroup } from "../types.js";
import { parseWelcomeSettings, welcomeMessage } from "./welcome.js";
import { Welcomer } from "./welcomer.js";

const an = { userId: "u1", name: "An" };
const binh = { userId: "u2", name: "Bình" };

await test("the welcome fills in the newcomer, tagged, and the group's name", () => {
  const message = welcomeMessage("Chào mừng {name} đến với cộng đồng {nameCom}!", [an], "Lập trình viên", 120);
  assert.equal(message.msg, "Chào mừng @An đến với cộng đồng Lập trình viên!");
  assert.deepEqual(message.mentions, [{ pos: 10, uid: "u1", len: 3 }]);
  assert.equal(message.styles, undefined);
});

await test("several newcomers are each tagged in one welcome, and a long list is cut with a count", () => {
  const message = welcomeMessage("Chào {name} nhé, nhóm đã có {count} thành viên", [an, binh], "Nhóm", 1200);
  assert.equal(message.msg, "Chào @An, @Bình nhé, nhóm đã có 1.200 thành viên");
  assert.deepEqual(message.mentions, [{ pos: 5, uid: "u1", len: 3 }, { pos: 10, uid: "u2", len: 5 }]);
  const crowd = Array.from({ length: 25 }, (_item, index) => ({ userId: `u${index}`, name: `N${index}` }));
  const many = welcomeMessage("{name}", crowd, "Nhóm", 0);
  assert.equal(many.mentions?.length, 20);
  assert.ok(many.msg.endsWith("@N19 và 5 thành viên khác"));
});

await test("formatting from the editor still lands on the right words once the variables are written out", () => {
  const message = welcomeMessage("[b]Chào {name}[/b] đến [red]{nameCom}[/red] [all]", [an], "Nhóm A", 0);
  assert.equal(message.msg, "Chào @An đến Nhóm A @All");
  assert.deepEqual(message.styles, [{ start: 0, len: 8, st: TextStyle.Bold }, { start: 13, len: 6, st: TextStyle.Red }]);
  assert.deepEqual(message.mentions, [{ pos: 5, uid: "u1", len: 3 }, { pos: 20, uid: "-1", len: 4 }]);
});

await test("a name or a group name that looks like a tag is written as it is, never read as formatting", () => {
  const message = welcomeMessage("Chào {name} đến {nameCom}", [{ userId: "u9", name: "[all]" }], "[b]Nhóm[/b]", 0);
  assert.equal(message.msg, "Chào @[all] đến [b]Nhóm[/b]");
  assert.deepEqual(message.mentions, [{ pos: 5, uid: "u9", len: 6 }]);
  assert.equal(message.styles, undefined);
  // Someone without a name is still greeted and tagged.
  assert.equal(welcomeMessage("Chào {name}", [{ userId: "u3", name: "" }], "", 0).msg, "Chào @bạn");
});

await test("the settings are checked: a welcome cannot be switched on with nothing to say", () => {
  assert.deepEqual(parseWelcomeSettings({ enabled: true, text: "  Chào {name}  " }), { enabled: true, text: "Chào {name}" });
  assert.deepEqual(parseWelcomeSettings({ enabled: false, text: "" }), { enabled: false, text: "" });
  assert.equal(parseWelcomeSettings({ enabled: true, text: " [b][/b] " }), "Hãy nhập lời chào trước khi bật");
  assert.equal(parseWelcomeSettings({ enabled: true, text: "x".repeat(2001) }), "Lời chào dài tối đa 2000 ký tự");
  assert.equal(parseWelcomeSettings({ enabled: "yes", text: "Chào" }), "Cài đặt lời chào không hợp lệ");
  assert.equal(parseWelcomeSettings({ enabled: true }), "Cài đặt lời chào không hợp lệ");
});

// A welcomer over one group and a fake Zalo that records what is sent.
function setup(welcome: GroupWelcomeSettings, options: Readonly<{ botEnabled?: boolean; refuse?: boolean }> = {}) {
  const sent: { msg: string; groupId: string; mentions: number }[] = [];
  const history: NewActivity[] = [];
  const api = {
    listener: { on: () => undefined },
    sendMessage: (content: { msg: string; mentions?: unknown[] }, groupId: string) => {
      if (options.refuse === true) return Promise.reject(new Error("Nhóm đã khóa gửi tin"));
      sent.push({ msg: content.msg, groupId, mentions: content.mentions?.length ?? 0 });
      return Promise.resolve({});
    },
  } as unknown as ConstructorParameters<typeof Welcomer>[0];
  const group = { groupId: "g1", name: "Nhóm bán hàng", memberCount: 50, botEnabled: options.botEnabled ?? true, welcome } as unknown as StoredGroup;
  const store = { getGroup: (groupId: string) => Promise.resolve(groupId === "g1" ? group : undefined) };
  // A long wait, so the tests decide when the welcome goes out.
  const welcomer = new Welcomer(api, store, "bot", { record: (entry) => history.push(entry) }, 60_000);
  return { welcomer, sent, history };
}

const on = { enabled: true, text: "Chào mừng {name} đến với {nameCom}" };

await test("people who join close together are welcomed in one message, each once, and never the bot itself", async () => {
  const { welcomer, sent, history } = setup(on);
  welcomer.noteJoin("g1", [an]);
  welcomer.noteJoin("g1", [binh, an, { userId: "bot", name: "Bot" }]);
  await welcomer.welcome("g1");
  assert.deepEqual(sent, [{ msg: "Chào mừng @An, @Bình đến với Nhóm bán hàng", groupId: "g1", mentions: 2 }]);
  assert.deepEqual(history, [{ category: "messages", actor: "bot", title: "Chào thành viên mới", detail: "An, Bình", groupId: "g1", groupName: "Nhóm bán hàng" }]);
  // Nobody is left waiting, so nothing more is said.
  await welcomer.welcome("g1");
  assert.equal(sent.length, 1);
  welcomer.stop();
});

await test("nothing is said where the welcome is off, the bot is off, or only the bot joined", async () => {
  for (const scenario of [setup(defaultGroupWelcome), setup({ enabled: false, text: "Chào {name}" }), setup(on, { botEnabled: false })]) {
    scenario.welcomer.noteJoin("g1", [an]);
    await scenario.welcomer.welcome("g1");
    assert.deepEqual(scenario.sent, []);
    assert.deepEqual(scenario.history, []);
  }
  const alone = setup(on);
  alone.welcomer.noteJoin("g1", [{ userId: "bot", name: "Bot" }]);
  await alone.welcomer.welcome("g1");
  assert.deepEqual(alone.sent, []);
});

await test("a welcome Zalo refuses is written into the history with the reason", async () => {
  const { welcomer, history } = setup(on, { refuse: true });
  welcomer.noteJoin("g1", [an]);
  await welcomer.welcome("g1");
  assert.deepEqual(history.map((entry) => [entry.title, entry.ok, entry.error, entry.userName]), [["Chào thành viên mới", false, "Nhóm đã khóa gửi tin", "An"]]);
});
