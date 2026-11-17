/**
 * A watch is what it follows, never what it is called (DESIGN.md "Watches"): its agent, the connection it reads
 * through, the object as that connection canonically names it, and the account it looks with. An agent's own watches
 * are in its folder, `agents/<agent>/watches/`, each named by its connection and kind and a hash of that identity
 * (nothing a label or a card says), so the same object again is the same file and any other is another, whatever
 * their words, in effect or waiting for the owner. Found when one agent followed
 * three Slack channels, each "a channel in Slack": each write landed on `watches/a-channel-in-slack.md`, the last over
 * the others, and their cards and approvals folded into one.
 */
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	createRegistry,
	type Harness,
	type JsonObject,
	type ToolExecutionApi,
	type ToolRegistration,
} from "@earendil-works/pi-durable";
import { describe, expect, it } from "vitest";
import { openBox } from "../src/box/box.ts";
import { Accepted, ChatAgent, shaOf } from "../src/core/agents.ts";
import { accountKey, Connected } from "../src/core/connections.ts";
import { agentMainThread, OWNER } from "../src/core/gateway.ts";
import { Readings } from "../src/core/objects.ts";
import { context, openStore } from "../src/core/store.ts";
import { defineCore } from "../src/core/turn.ts";
import {
	identityName,
	type Looked,
	MAX_WATCH_BYTES,
	Watches,
	type WatchReceipt,
	watchAgent,
	watchOfPath,
	watchPath,
	watchRef,
} from "../src/core/watches.ts";
import type { Workspace } from "../src/server/agents.ts";
import type { WatchView } from "../src/server/api.ts";
import { accept, changeWatch, createWatch, pause, remove, watches } from "../src/server/watches.ts";
import { watchState } from "../web/src/lib/segments/watches.ts";
import { watchRows } from "../web/src/lib/watches.ts";
import { byMethod, GITHUB, world } from "./fault/watch-scenario.ts";
import { hostBox } from "./fixtures/host-box.ts";
import { echoModels, FAUX_MODEL } from "./fixtures/models.ts";
import { added, definition, shipping } from "./fixtures/shipped.ts";
import { blobStore, FakeGateway, tempHome } from "./helpers.ts";

const NOW = new Date(2026, 10, 17, 9, 0).getTime();
/** Three channels, which Slack's kind names alike (made up: the ids of the home where it was found are not here). */
const CHANNELS = ["C0TESTAAA01", "C0TESTBBB02", "C0TESTCCC03"] as const;
const WORK = "U0WORK";
const HOME = "U0HOME";
const agentText = (name: string) =>
	`---\nname: ${name}\ndescription: Follows things\nconnections: [slack, github]\n---\nFollow things for the owner.`;

/** A store and a box: Sancho (one Slack account), Curro and Otto (two), all on GitHub as bandarra, and no watch yet. */
async function setUp(home: string) {
	const box = openBox(hostBox(home), () => {});
	const answer = byMethod(world);
	const core = defineCore({
		blobs: blobStore(),
		gateway: () => new FakeGateway(),
		model: () => FAUX_MODEL,
		now: () => NOW,
		workspace: () => box.workspace,
		// GitHub as the pull request's life has it, at its first step, whichever pull request is asked
		read: async (_connection, account, tool, args) => {
			if (account !== accountKey(GITHUB.account)) return { failed: "not that account" };
			const got = await answer(tool, args, 0);
			return got !== null && typeof got === "object" && "failed" in got && typeof got.failed === "string"
				? { failed: got.failed }
				: { text: JSON.stringify(got) };
		},
	});
	const registry = createRegistry();
	registry.install(core.extension);
	const harness = await openStore(home, { models: echoModels().models, registry });
	const workspace: Workspace = { env: () => box.env(), root: box.workspace, tools: () => [], known: () => true };
	const github = definition("github", GITHUB.file);
	shipping(definition("slack"), github);
	await harness.commit(async (tx) => {
		const connected = await tx.doc(Connected);
		if (connected.added.slack !== undefined) return;
		await added(tx, "slack", NOW);
		await added(tx, "github", NOW);
		const files = (await tx.doc(Accepted)).files;
		for (const [id, name] of [
			["curro", "Curro"],
			["otto", "Otto"],
		])
			files[`agents/${id}.md`] = { sha: shaOf(agentText(name)), text: agentText(name), at: NOW };
		connected.connections.github = {
			version: github.version,
			at: NOW,
			tools: Object.fromEntries(
				GITHUB.tools.map((tool) => [
					tool.name,
					{ generation: ++connected.versions, description: tool.description, schema: tool.inputSchema as JsonObject },
				]),
			),
		};
		connected.accounts.slack = {
			[accountKey(WORK)]: { id: WORK, at: NOW },
			[accountKey(HOME)]: { id: HOME, at: NOW },
		};
		connected.accounts.github = { [accountKey(GITHUB.account)]: { id: GITHUB.account, at: NOW } };
		const both = { slack: [accountKey(WORK), accountKey(HOME)], github: [accountKey(GITHUB.account)] };
		connected.on.sancho = { slack: [accountKey(WORK)], github: [accountKey(GITHUB.account)] };
		connected.on.curro = both;
		connected.on.otto = both;
	}, context);
	/** Agent `agent`'s `watch` call, from its own chat. */
	const watchAs = async (agent: string, args: JsonObject) => {
		const got = await core.receive(harness, {
			id: randomUUID(),
			origin: { gateway: "web", peer: OWNER, thread: agentMainThread(agent) },
			text: "keep an eye on it",
		});
		if (!("chat" in got)) throw new Error("no chat");
		const runs = (await harness.snapshot(ChatAgent, got.chat as never, context))?.agent?.id;
		expect(runs).toBe(agent);
		const tool = (core.extension.tools as readonly ToolRegistration[]).find((one) => one.name === "watch");
		const api = { conversationId: got.chat, commit: harness.commit.bind(harness), env: box.env() };
		const result = (await tool?.execute(args, api as unknown as ToolExecutionApi, context)) as {
			details?: { receipt?: WatchReceipt };
			isError?: true;
			output: { text: string }[];
		};
		return result;
	};
	const receipt = async (agent: string, args: JsonObject): Promise<WatchReceipt> => {
		const result = await watchAs(agent, args);
		if (result.details?.receipt === undefined) throw new Error(result.output[0]?.text ?? "refused");
		return result.details.receipt;
	};
	const boxed = (path: string) => readFile(join(box.workspace, path), "utf8");
	const views = () => watches(harness, workspace, context);
	const look = (h: Harness, id: string) => core.lookWatch(h, id, context);
	const close = async () => {
		await harness.close(context);
		await box.close();
	};
	return { box, core, harness, workspace, watchAs, receipt, boxed, views, look, close };
}

const reconcile = async () => {};
const baseline = async (): Promise<Looked> => ({ outcome: "baseline" });
const ask = "Tell me what is asked of me there.";

describe("a watch's id", () => {
	it("is its agent's folder and its name, a shared one's its name alone; nothing else names one", () => {
		expect(watchPath("curro/general-0123456789ab")).toBe("agents/curro/watches/general-0123456789ab.md");
		expect(watchPath("banda-142")).toBe("watches/banda-142.md");
		expect(watchOfPath("agents/curro/watches/general.md")).toBe("curro/general");
		expect(watchOfPath("watches/banda-142.md")).toBe("banda-142");
		for (const path of ["agents/curro.md", "agents/curro/routines/x.md", "watches/a/b.md", "agents/../watches/x.md"])
			expect(watchOfPath(path), path).toBeUndefined();
		for (const id of ["../x", "a/b/c", "Curro/x", "/x", "x/", "curro/../x"]) expect(watchRef(id), id).toBeUndefined();
		// its folder says whose it is, whatever a record says; a shared one is its record's, else the lead's
		expect(watchAgent("curro/x", { agent: "sancho" })).toBe("curro");
		expect(watchAgent("x", { agent: "curro" })).toBe("curro");
		expect(watchAgent("x", {})).toBe("sancho");
	});

	it("names the identity, not the words: another connection, account or object is another name", () => {
		const one = identityName("slack/u0work/channel:slack/C0TESTAAA01");
		// its connection and kind, then 96 bits of the whole identity: nothing a label or a card says
		expect(one).toMatch(/^slack-channel-[0-9a-f]{24}$/);
		expect(identityName("slack/u0work/channel:slack/C0TESTAAA01")).toBe(one);
		expect(identityName("github/bandarra/pull_request:acme/banda#142")).toMatch(/^github-pull-request-[0-9a-f]{24}$/);
		expect(identityName("drive/a-1f2e/file:drive/1e0DrWx78")).toMatch(/^drive-file-[0-9a-f]{24}$/);
		for (const key of [
			"slack/u0home/channel:slack/C0TESTAAA01",
			"slack/u0work/channel:slack/C0TESTBBB02",
			"other/u0work/channel:slack/C0TESTAAA01",
		])
			expect(identityName(key), key).not.toBe(one);
	});
});

describe("an agent's watch call", () => {
	it("three Slack channels named alike are three watches: three files, records, cards and approvals", async () => {
		const { receipt, boxed, views, harness, workspace, close } = await setUp(await tempHome());
		try {
			const wrote = [];
			for (const channel of CHANNELS)
				wrote.push(await receipt("curro", { object: `slack/${channel}`, account: WORK, ask }));
			const ids = wrote.map((each) => each.id);
			expect(new Set(ids).size).toBe(3);
			for (const [i, id] of ids.entries()) {
				expect(id).toMatch(/^curro\/slack-channel-[0-9a-f]{24}$/);
				expect(wrote[i]?.change).toBe("added");
				// each file follows its own channel, none written over by another
				expect(await boxed(watchPath(id))).toContain(`object: slack/${CHANNELS[i]}`);
			}
			const shown = (await views()).filter((each) => ids.includes(each.id));
			expect(shown).toHaveLength(3);
			for (const view of shown) {
				expect(view).toMatchObject({ agent: "curro", state: "allow", change: { kind: "added", asked: true } });
				expect(view.shared).toBeUndefined();
			}
			// each card answers its own: allowing the second leaves the first and third waiting, each by its own hash
			const [first, second, third] = wrote as [WatchReceipt, WatchReceipt, WatchReceipt];
			await accept(harness, workspace, reconcile, baseline, second.id, second.sha, NOW, context);
			const after = await views();
			expect(watchState(after, first.id, undefined, 0, first.sha).state).toBe("pending");
			expect(watchState(after, second.id, undefined, 0, second.sha).state).toBe("done");
			expect(watchState(after, third.id, undefined, 0, third.sha).state).toBe("pending");
			// a stale card cannot allow another's bytes: a hash it did not show is refused
			await expect(
				accept(harness, workspace, reconcile, baseline, first.id, third.sha, NOW, context),
			).rejects.toMatchObject({ status: 409 });
			await accept(harness, workspace, reconcile, baseline, first.id, first.sha, NOW, context);
			await accept(harness, workspace, reconcile, baseline, third.id, third.sha, NOW, context);
			const files = (await harness.snapshot(Accepted, context))?.files ?? {};
			expect(ids.map((id) => files[watchPath(id)]?.text.match(/object: (.*)/)?.[1])).toEqual(
				CHANNELS.map((channel) => `slack/${channel}`),
			);
			const records = (await harness.snapshot(Watches, context))?.watches ?? {};
			for (const [i, id] of ids.entries()) expect(records[id]?.allowed).toEqual([wrote[i]?.sha]);
		} finally {
			await close();
		}
	});

	it("the same channel by link, id or canonical words, the account said or left to its one, is one watch", async () => {
		const { receipt, boxed, close } = await setUp(await tempHome());
		try {
			const [channel] = CHANNELS;
			const forms = [
				{ object: `https://acme.slack.com/archives/${channel}` },
				{ object: `slack/${channel}` },
				{ object: `slack:channel:slack/${channel}` },
				{ object: `slack/${channel}`, account: WORK },
				{ object: `  slack/${channel}  `, account: WORK.toLowerCase() },
			];
			const ids = [];
			for (const [i, form] of forms.entries())
				ids.push((await receipt("sancho", { ...form, ask: `${ask} (${i})` } as JsonObject)).id);
			expect(new Set(ids).size).toBe(1);
			expect(ids[0]).toMatch(/^sancho\/slack-channel-[0-9a-f]{24}$/);
			// the newest write is the definition, the account always written as the service names it
			const text = await boxed(watchPath(ids[0] as string));
			expect(text).toContain(`account: ${WORK}`);
			expect(text).toContain(`${ask} (4)`);
		} finally {
			await close();
		}
	});

	it("one object for other agents, or as another account, is another watch; none writes another's file", async () => {
		const { receipt, watchAs, boxed, box, close } = await setUp(await tempHome());
		try {
			const object = `slack/${CHANNELS[0]}`;
			const sancho = await receipt("sancho", { object, ask });
			const before = await boxed(watchPath(sancho.id));
			const curroWork = await receipt("curro", { object, account: WORK, ask });
			const curroHome = await receipt("curro", { object, account: HOME, ask });
			const otto = await receipt("otto", { object, account: WORK, ask });
			const ids = [sancho.id, curroWork.id, curroHome.id, otto.id];
			expect(new Set(ids).size).toBe(4);
			expect(ids.map((id) => watchRef(id)?.agent)).toEqual(["sancho", "curro", "curro", "otto"]);
			// the same words and account, two agents: the same name, each in its own folder
			expect(watchRef(curroWork.id)?.name).toBe(watchRef(otto.id)?.name);
			expect(watchRef(curroWork.id)?.name).not.toBe(watchRef(curroHome.id)?.name);
			expect(await boxed(watchPath(sancho.id))).toBe(before);
			// two accounts and none said: refused, nothing written, never a guess
			const refused = await watchAs("curro", { object: `slack/${CHANNELS[1]}`, ask });
			expect(refused.isError).toBe(true);
			expect(refused.output[0]?.text).toContain("say which Slack account");
			const { readdir } = await import("node:fs/promises");
			expect((await readdir(join(box.workspace, "agents/curro/watches"))).sort()).toHaveLength(2);
		} finally {
			await close();
		}
	});

	it("calls at once on several objects, some the same, make one watch per object and lose none", async () => {
		const { receipt, boxed, harness, close } = await setUp(await tempHome());
		try {
			const calls = [...CHANNELS, CHANNELS[0], CHANNELS[1], CHANNELS[0]].map((channel) =>
				receipt("curro", { object: `slack/${channel}`, account: WORK, ask }),
			);
			const wrote = await Promise.all(calls);
			const ids = [...new Set(wrote.map((each) => each.id))];
			expect(ids).toHaveLength(3);
			for (const id of ids) expect(await boxed(watchPath(id))).toContain("object: slack/");
			const records = (await harness.snapshot(Watches, context))?.watches ?? {};
			for (const id of ids) expect(records[id]?.asked?.length).toBeGreaterThan(0);
		} finally {
			await close();
		}
	});
});

describe("a change in an agent's folder its own tool did not write", () => {
	it("is never said to be its agent's ask, and never answers the card of what its tool wrote", async () => {
		const { receipt, box, views, close } = await setUp(await tempHome());
		try {
			const own = await receipt("curro", { object: `slack/${CHANNELS[0]}`, account: WORK, ask });
			// another agent's command writes over it, and writes a new one in Curro's folder: the box is shared
			const over = `---\nobject: slack/${CHANNELS[1]}\naccount: ${HOME}\n---\nSomething else.\n`;
			await writeFile(join(box.workspace, watchPath(own.id)), over);
			await writeFile(join(box.workspace, "agents/curro/watches/probe.md"), over);
			const all = await views();
			const written = all.find((each) => each.id === own.id) as WatchView;
			const probe = all.find((each) => each.id === "curro/probe") as WatchView;
			// it would still wake Curro, its folder's agent, and says nobody asked
			for (const view of [written, probe]) {
				expect(view.agent).toBe("curro");
				expect(view.change).toMatchObject({ kind: "added", sha: shaOf(over) });
				expect(view.change && "asked" in view.change ? view.change.asked : undefined).toBeUndefined();
			}
			const rows = watchRows(all, "curro", NOW);
			expect(rows.filter((row) => row.unasked === true).map((row) => row.id)).toEqual(
				expect.arrayContaining([own.id, "curro/probe"]),
			);
			// the line of Curro's own call no longer offers to allow: what waits is not what it wrote
			expect(watchState(all, own.id, undefined, 0, own.sha).state).not.toBe("pending");
		} finally {
			await close();
		}
	});
});

describe("watches of one agent", () => {
	it("pause, remove, edit and the cursor are each watch's own; a retargeted watch starts from a baseline", async () => {
		const { receipt, harness, workspace, look, box, views, close } = await setUp(await tempHome());
		try {
			const a = await receipt("curro", { object: "https://github.com/acme/banda/pull/142", ask });
			const b = await receipt("curro", { object: "acme/banda#143", ask });
			expect(a.id).not.toBe(b.id);
			await accept(harness, workspace, reconcile, look, a.id, a.sha, NOW, context);
			await accept(harness, workspace, reconcile, look, b.id, b.sha, NOW, context);
			const record = async (id: string) => (await harness.snapshot(Watches, context))?.watches[id];
			const [ra, rb] = [await record(a.id), await record(b.id)];
			expect(ra?.key).toBe("github/bandarra/pull_request:acme/banda#142");
			expect(rb?.key).toBe("github/bandarra/pull_request:acme/banda#143");
			expect(ra?.seen).toBeDefined();
			expect(rb?.seen).toBeDefined();
			await pause(harness, reconcile, a.id, true, NOW, context);
			expect((await record(a.id))?.paused).toBe("owner");
			expect((await record(b.id))?.paused).toBeUndefined();
			const aText = (await harness.snapshot(Accepted, context))?.files[watchPath(a.id)]?.text;
			const bSha = (await harness.snapshot(Accepted, context))?.files[watchPath(b.id)]?.sha as string;
			await changeWatch(harness, workspace, reconcile, b.id, { until: "merged" }, bSha, NOW, context);
			expect((await harness.snapshot(Accepted, context))?.files[watchPath(a.id)]?.text).toBe(aText);
			// B's file now follows another pull request: allowed, its cursor on #143's readings is not #144's
			const retarget = `---\nobject: https://github.com/acme/banda/pull/144\naccount: bandarra\n---\n${ask}\n`;
			await writeFile(join(box.workspace, watchPath(b.id)), retarget);
			await accept(harness, workspace, reconcile, look, b.id, shaOf(retarget), NOW, context);
			const first = await look(harness, b.id);
			expect(first.outcome).toBe("baseline");
			expect((await record(b.id))?.key).toBe("github/bandarra/pull_request:acme/banda#144");
			expect((await record(b.id))?.wakes ?? []).toEqual([]);
			// removing A leaves B whole
			await remove(harness, workspace, reconcile, a.id, NOW, context);
			const files = (await harness.snapshot(Accepted, context))?.files ?? {};
			expect(files[watchPath(a.id)]).toBeUndefined();
			expect(files[watchPath(b.id)]?.text).toBe(retarget);
			expect((await views()).map((each) => each.id)).toEqual([b.id]);
		} finally {
			await close();
		}
	});
});

describe("a watch from before agents had folders", () => {
	it("keeps its owner, object and cursor across a restart; the same object again changes it, never a second", async () => {
		const home = await tempHome();
		const LEGACY = `---\nobject: https://github.com/acme/banda/pull/142\naccount: bandarra\n---\n${ask}\n`;
		let seen: number | undefined;
		{
			const { harness, look, close } = await setUp(home);
			try {
				await harness.commit(async (tx) => {
					(await tx.doc(Accepted)).files[watchPath("banda-142")] = { sha: shaOf(LEGACY), text: LEGACY, at: NOW };
					(await tx.doc(Watches)).watches["banda-142"] = { agent: "curro", since: NOW, sha: shaOf(LEGACY) };
				}, context);
				expect((await look(harness, "banda-142")).outcome).toBe("baseline");
				seen = (await harness.snapshot(Watches, context))?.watches["banda-142"]?.seen;
				expect(seen).toBeDefined();
			} finally {
				await close();
			}
		}
		const { receipt, harness, workspace, look, box, views, core, close } = await setUp(home);
		try {
			await mkdir(join(box.workspace, "watches"), { recursive: true });
			await writeFile(join(box.workspace, watchPath("banda-142")), LEGACY);
			await core.reconcile(harness, context);
			const kept = (await harness.snapshot(Watches, context))?.watches["banda-142"];
			expect(kept).toMatchObject({ agent: "curro", key: "github/bandarra/pull_request:acme/banda#142", seen });
			// Curro asks for it again, by another form of its link: the shared one changes, no folder file is made
			const again = await receipt("curro", { object: "acme/banda#142", ask: "Now only merges." });
			expect(again.id).toBe("banda-142");
			const { readdir } = await import("node:fs/promises");
			await expect(readdir(join(box.workspace, "agents/curro/watches"))).rejects.toMatchObject({ code: "ENOENT" });
			const legacy = (await views()).find((each) => each.id === "banda-142");
			expect(legacy).toMatchObject({ shared: true, agent: "curro", change: { kind: "changed", asked: true } });
			// the owner following it for Curro is told it is followed
			await expect(
				createWatch(
					harness,
					workspace,
					reconcile,
					look,
					{ agent: "curro", object: "https://github.com/acme/banda/pull/142" },
					NOW,
					context,
				),
			).rejects.toMatchObject({ status: 409 });
			// Otto following it is Otto's own, beside it
			const otto = await receipt("otto", { object: "acme/banda#142", ask });
			expect(otto.id).toMatch(/^otto\//);
			// a second of Curro's written some other way and allowed is said to follow the same: each wakes alone
			const twin = "agents/curro/watches/dup.md";
			await mkdir(join(box.workspace, "agents/curro/watches"), { recursive: true });
			await writeFile(join(box.workspace, twin), LEGACY);
			await accept(harness, workspace, reconcile, look, "curro/dup", shaOf(LEGACY), NOW, context);
			const all = await views();
			expect(all.find((each) => each.id === "banda-142")?.twins).toEqual(["curro/dup"]);
			expect(all.find((each) => each.id === "curro/dup")?.twins).toEqual(["banda-142"]);
			expect(all.find((each) => each.id === otto.id)?.twins).toBeUndefined();
		} finally {
			await close();
		}
	});
});

describe("whom a watch file wakes", () => {
	const FILE = `---\nobject: https://github.com/acme/banda/pull/150\naccount: bandarra\n---\n${ask}\n`;

	it("a folder that names no agent, or an archived one, wakes nobody: allowing it is refused", async () => {
		const { box, harness, workspace, views, close } = await setUp(await tempHome());
		try {
			await mkdir(join(box.workspace, "agents/ghost/watches"), { recursive: true });
			await writeFile(join(box.workspace, "agents/ghost/watches/probe.md"), FILE);
			expect((await views()).find((each) => each.id === "ghost/probe")?.agent).toBe("ghost");
			await expect(
				accept(harness, workspace, reconcile, baseline, "ghost/probe", shaOf(FILE), NOW, context),
			).rejects.toMatchObject({ status: 409, message: expect.stringContaining("agents/ghost.md is no agent") });
			// Otto archived: his folder's watch, and a shared one recorded as his, wait for him to be restored
			const archived = agentText("Otto").replace("description:", "state: archived\ndescription:");
			await harness.commit(async (tx) => {
				(await tx.doc(Accepted)).files["agents/otto.md"] = { sha: shaOf(archived), text: archived, at: NOW };
				(await tx.doc(Watches)).watches["otto-shared"] = { agent: "otto" };
			}, context);
			await mkdir(join(box.workspace, "agents/otto/watches"), { recursive: true });
			await writeFile(join(box.workspace, "agents/otto/watches/probe.md"), FILE);
			await mkdir(join(box.workspace, "watches"), { recursive: true });
			await writeFile(join(box.workspace, "watches/otto-shared.md"), FILE);
			for (const id of ["otto/probe", "otto-shared"])
				await expect(
					accept(harness, workspace, reconcile, baseline, id, shaOf(FILE), NOW, context),
				).rejects.toMatchObject({ status: 409, message: expect.stringContaining("archived") });
			const files = (await harness.snapshot(Accepted, context))?.files ?? {};
			expect(Object.keys(files).filter((path) => path.includes("watches/"))).toEqual([]);
		} finally {
			await close();
		}
	});

	it("a shared file no agent's tool wrote and the store names no owner for wakes the lead, and says nobody asked", async () => {
		const { box, views, close } = await setUp(await tempHome());
		try {
			await mkdir(join(box.workspace, "watches"), { recursive: true });
			await writeFile(join(box.workspace, "watches/x.md"), FILE);
			const view = (await views()).find((each) => each.id === "x") as WatchView;
			expect(view).toMatchObject({ agent: "sancho", shared: true, change: { kind: "added" } });
			expect(view.change && "asked" in view.change ? view.change.asked : undefined).toBeUndefined();
			const [row] = watchRows([view], "sancho", NOW);
			expect(row).toMatchObject({ unasked: true, shared: true, waiting: "set up" });
		} finally {
			await close();
		}
	});

	it("a watches folder that is a link is read as nothing and written through by no tool", async () => {
		const { box, watchAs, receipt, views, close } = await setUp(await tempHome());
		try {
			const { symlink } = await import("node:fs/promises");
			const own = await receipt("curro", { object: "acme/banda#150", ask });
			// Otto's watches folder made a link to Curro's: one file would show as both agents' watches
			await mkdir(join(box.workspace, "agents/otto"), { recursive: true });
			await symlink(join(box.workspace, "agents/curro/watches"), join(box.workspace, "agents/otto/watches"));
			const ids = (await views()).map((each) => each.id);
			expect(ids).toContain(own.id);
			expect(ids.filter((id) => id.startsWith("otto/"))).toEqual([]);
			const refused = await watchAs("otto", { object: "acme/banda#150", ask });
			expect(refused.isError).toBe(true);
			expect(refused.output[0]?.text).toContain("agents/otto/watches is not a folder");
			expect((await views()).filter((each) => each.id.startsWith("curro/"))).toHaveLength(1);
		} finally {
			await close();
		}
	});
});

/** The reading key of Slack channel `channel` as account `account`: the identity a watch on it has, with its agent. */
const slackKey = (channel: string, account = WORK) => `slack/${accountKey(account)}/channel:slack/${channel}`;

/** In `harness`: a card read for Slack channel `channel`, named `name`, as the object's card leaves it. */
const carded = (harness: Harness, channel: string, name: string) =>
	harness.commit(async (tx) => {
		(await tx.doc(Readings)).readings[slackKey(channel)] = {
			connection: "slack",
			account: accountKey(WORK),
			kind: "channel",
			source: "test",
			at: NOW,
			card: { card: "channel", name } as never,
		};
	}, context);

describe("a watch waiting for the owner", () => {
	it("is the same watch when its card's name comes, or changes, before it is allowed: no second file", async () => {
		const { receipt, harness, box, views, close } = await setUp(await tempHome());
		try {
			const [channel] = CHANNELS;
			const first = await receipt("curro", { object: `slack/${channel}`, account: WORK, ask });
			await carded(harness, channel, "#general");
			const second = await receipt("curro", {
				object: `https://acme.slack.com/archives/${channel}`,
				account: WORK,
				ask: `${ask}!`,
			});
			await carded(harness, channel, "#general-renamed");
			const third = await receipt("curro", {
				object: `slack:channel:slack/${channel}`,
				account: WORK,
				ask: `${ask}!!`,
			});
			expect([second.id, third.id]).toEqual([first.id, first.id]);
			expect(
				(await readdir(join(box.workspace, "agents/curro/watches"))).filter((f) => f.endsWith(".md")),
			).toHaveLength(1);
			const waiting = (await views()).filter((each) => each.change !== undefined);
			expect(waiting.map((each) => each.id)).toEqual([first.id]);
			// the card of the first call no longer offers to allow: what waits is the third's
			const all = await views();
			expect(watchState(all, first.id, undefined, 0, first.sha).state).not.toBe("pending");
			expect(watchState(all, third.id, undefined, 0, third.sha).state).toBe("pending");
		} finally {
			await close();
		}
	});

	it("written by any name, is found by what it follows: the tool changes it and the owner's follow waits for it", async () => {
		const { receipt, harness, workspace, box, close } = await setUp(await tempHome());
		try {
			const [channel] = CHANNELS;
			const hand = `---\nobject: slack/${channel}\naccount: ${WORK}\n---\nWritten by hand.\n`;
			await mkdir(join(box.workspace, "agents/curro/watches"), { recursive: true });
			await writeFile(join(box.workspace, "agents/curro/watches/by-hand.md"), hand);
			await expect(
				createWatch(
					harness,
					workspace,
					reconcile,
					baseline,
					{ agent: "curro", object: `slack/${channel}`, account: WORK },
					NOW,
					context,
				),
			).rejects.toMatchObject({
				status: 409,
				message: expect.stringContaining("agents/curro/watches/by-hand.md waits"),
			});
			const again = await receipt("curro", { object: `slack/${channel}`, account: WORK, ask });
			expect(again.id).toBe("curro/by-hand");
			expect((await readdir(join(box.workspace, "agents/curro/watches"))).filter((f) => f.endsWith(".md"))).toEqual([
				"by-hand.md",
			]);
		} finally {
			await close();
		}
	});

	it("calls at once by every form of the object, each batch after its card's name changed, make one file", async () => {
		const { receipt, harness, box, close } = await setUp(await tempHome());
		try {
			const [channel] = CHANNELS;
			const forms = [
				`slack/${channel}`,
				`https://acme.slack.com/archives/${channel}`,
				`slack:channel:slack/${channel}`,
				`  slack/${channel}  `,
			];
			const batch = (round: number) =>
				Promise.all(
					forms.map((object, i) =>
						receipt("curro", { object, account: i % 2 === 0 ? WORK : WORK.toLowerCase(), ask: `${ask} ${round}` }),
					),
				);
			// the first batch with no card; each next one only once the card's name changed, never racing it
			const ids = new Set((await batch(0)).map((each) => each.id));
			await carded(harness, channel, "#one");
			for (const each of await batch(1)) ids.add(each.id);
			await carded(harness, channel, "#two");
			for (const each of await batch(2)) ids.add(each.id);
			expect(ids.size).toBe(1);
			expect(
				(await readdir(join(box.workspace, "agents/curro/watches"))).filter((f) => f.endsWith(".md")),
			).toHaveLength(1);
		} finally {
			await close();
		}
	});
});

describe("a file another identity holds", () => {
	it("is never written over, waiting or in effect, by the tool or by the owner's follow", async () => {
		const { receipt, watchAs, harness, workspace, box, close } = await setUp(await tempHome());
		try {
			const [a, b] = CHANNELS;
			// A's file holds a watch on B, as a hash collision would leave it: waiting, then in effect
			const id = `curro/${identityName(slackKey(a))}`;
			const other = `---\nobject: slack/${b}\naccount: ${WORK}\n---\nAnother watch.\n`;
			await mkdir(join(box.workspace, "agents/curro/watches"), { recursive: true });
			await writeFile(join(box.workspace, watchPath(id)), other);
			const refused = await watchAs("curro", { object: `slack/${a}`, account: WORK, ask });
			expect(refused.isError).toBe(true);
			expect(refused.output[0]?.text).toContain(`${watchPath(id)} holds a watch on something else`);
			expect(await readFile(join(box.workspace, watchPath(id)), "utf8")).toBe(other);
			await expect(
				createWatch(
					harness,
					workspace,
					reconcile,
					baseline,
					{ agent: "curro", object: `slack/${a}`, account: WORK },
					NOW,
					context,
				),
			).rejects.toMatchObject({ status: 409, message: expect.stringContaining("holds a watch on something else") });
			await accept(harness, workspace, reconcile, baseline, id, shaOf(other), NOW, context);
			expect((await watchAs("curro", { object: `slack/${a}`, account: WORK, ask })).isError).toBe(true);
			await expect(
				createWatch(
					harness,
					workspace,
					reconcile,
					baseline,
					{ agent: "curro", object: `slack/${a}`, account: WORK },
					NOW,
					context,
				),
			).rejects.toMatchObject({ status: 409 });
			expect((await harness.snapshot(Accepted, context))?.files[watchPath(id)]?.text).toBe(other);
			expect(await readFile(join(box.workspace, watchPath(id)), "utf8")).toBe(other);
			// B itself, asked for, is the watch already holding it
			expect((await receipt("curro", { object: `slack/${b}`, account: WORK, ask })).id).toBe(id);
		} finally {
			await close();
		}
	});
});

describe("a change that would follow something else", () => {
	it("says in its row what the watch follows now and what it would, by safe ids when no card names them", async () => {
		const { receipt, harness, workspace, box, views, close } = await setUp(await tempHome());
		try {
			const [, b, c] = CHANNELS;
			const own = await receipt("curro", { object: `slack/${b}`, account: WORK, ask });
			await accept(harness, workspace, reconcile, baseline, own.id, own.sha, NOW, context);
			const forged = `---\nobject: slack/${c}\naccount: ${HOME}\n---\n${ask}\n`;
			await writeFile(join(box.workspace, watchPath(own.id)), forged);
			const view = (await views()).find((each) => each.id === own.id) as WatchView;
			expect(view.change).toMatchObject({
				kind: "changed",
				retarget: {
					from: { name: `slack/${b}`, ref: `slack:channel:slack/${b}`, account: WORK },
					to: { name: `slack/${c}`, ref: `slack:channel:slack/${c}`, account: HOME },
				},
			});
			const [row] = watchRows([view], "curro", NOW);
			expect(row).toMatchObject({
				name: `slack/${b}`,
				waiting: "change",
				unasked: true,
				retarget: { from: `slack/${b} as ${WORK}`, to: `slack/${c} as ${HOME}` },
			});
			// a card read since names it instead; a change of what matters alone is no retarget
			await carded(harness, b, "#ops-b");
			const named = (await views()).find((each) => each.id === own.id);
			expect(named?.change && "retarget" in named.change ? named.change.retarget?.from.name : undefined).toBe("#ops-b");
			await writeFile(
				join(box.workspace, watchPath(own.id)),
				`---\nobject: slack/${b}\naccount: ${WORK}\n---\nOnly this.\n`,
			);
			const same = (await views()).find((each) => each.id === own.id);
			expect(same?.change && "retarget" in same.change ? same.change.retarget : undefined).toBeUndefined();
		} finally {
			await close();
		}
	});
});

describe("something at a watch's file that cannot be read as one", () => {
	const cases: [string, (path: string) => Promise<void>][] = [
		["not text", (path) => writeFile(path, Buffer.from([0xff, 0xfe, 0x00, 0x80, 0x2d, 0x2d]))],
		["too big", (path) => writeFile(path, `---\nobject: slack/C0TESTBBB02\n---\n${"x".repeat(MAX_WATCH_BYTES)}\n`)],
		[
			"unreadable",
			async (path) => {
				await writeFile(path, "---\nobject: slack/C0TESTBBB02\n---\nhidden\n");
				await chmod(path, 0o000);
			},
		],
		["a folder", (path) => mkdir(path)],
		["a link", (path) => symlink("/etc/hosts", path)],
	];

	it.each(cases)("%s: is there, and neither the tool nor the owner's follow writes over it", async (_, make) => {
		const { watchAs, harness, workspace, box, close } = await setUp(await tempHome());
		const [a] = CHANNELS;
		const path = join(box.workspace, watchPath(`curro/${identityName(slackKey(a))}`));
		const bytes = async () => {
			const { lstat } = await import("node:fs/promises");
			const info = await lstat(path);
			if (!info.isFile()) return info.isDirectory() ? "a folder" : "a link";
			await chmod(path, 0o600);
			const read = await readFile(path);
			return read.toString("base64");
		};
		try {
			await mkdir(join(box.workspace, "agents/curro/watches"), { recursive: true });
			await make(path);
			const restore = _ === "unreadable" ? () => chmod(path, 0o000) : async () => {};
			const before = await bytes();
			await restore();
			const refused = await watchAs("curro", { object: `slack/${a}`, account: WORK, ask });
			expect(refused.isError).toBe(true);
			expect(refused.output[0]?.text).toContain("holds something that cannot be read as a watch");
			await expect(
				createWatch(
					harness,
					workspace,
					reconcile,
					baseline,
					{ agent: "curro", object: `slack/${a}`, account: WORK },
					NOW,
					context,
				),
			).rejects.toMatchObject({ status: 409, message: expect.stringContaining("cannot be read as a watch") });
			expect(await bytes()).toBe(before);
			const files = (await harness.snapshot(Accepted, context))?.files ?? {};
			expect(Object.keys(files).filter((each) => each.includes("watches/"))).toEqual([]);
		} finally {
			await close();
		}
	});
});
