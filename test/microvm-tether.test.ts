import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, it } from "vitest";
import { tether } from "../src/box/microvm.ts";
import { until } from "./helpers.ts";

const ANSWER =
	"HTTP/1.1 407 Proxy Authentication Required\r\ncontent-type: text/plain; charset=utf-8\r\n" +
	'proxy-authenticate: Basic realm="banda"\r\ncontent-length: 38\r\n\r\nbanda: this proxy needs banda\'s login\n';

const open: ReturnType<typeof tether>[] = [];
afterEach(() => {
	for (const each of open.splice(0)) each.fall();
});

/** A tether to a connection the test plays the far end of: what was asked on it, and how it was run. */
function fixture(every?: number) {
	const child = Object.assign(new EventEmitter(), {
		stdin: new PassThrough(),
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		killed: false,
		kill() {
			child.killed = true;
			return true;
		},
	});
	const asked: string[] = [];
	child.stdin.on("data", (data: Buffer) => asked.push(data.toString()));
	const ran: { name: string; user: string; argv: readonly string[] }[] = [];
	const tied = tether(
		{
			stream: (command) => {
				ran.push(command);
				return child as never;
			},
		},
		"banda-microvm-0000000000-000000000000-proxy",
		every,
	);
	open.push(tied);
	return { tied, child, asked, ran, answer: (text = ANSWER) => child.stdout.write(text) };
}

it("stands only once the guard answered its knock, over the proxy's own connector", async () => {
	const { tied, asked, ran, answer } = fixture();
	expect(ran).toEqual([
		{
			name: "banda-microvm-0000000000-000000000000-proxy",
			user: "1000:1000",
			argv: ["/usr/local/bin/python3", "/banda/connect.py"],
		},
	]);
	await until(() => asked.length === 1);
	expect(asked[0]).toBe("GET http://banda.invalid/ HTTP/1.1\r\nHost: banda.invalid\r\n\r\n");
	expect(tied.stands()).toBe(false);
	expect(tied.fallen()).toBe(false);
	// an answer in pieces is no answer until it is whole
	answer(ANSWER.slice(0, 30));
	await delay(20);
	expect(tied.stands()).toBe(false);
	answer(ANSWER.slice(30, -5));
	await delay(20);
	expect(tied.stands()).toBe(false);
	answer(ANSWER.slice(-5));
	await until(() => tied.stands());
	expect(tied.fallen()).toBe(false);
});

it.each([
	["another server's answer", "HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok"],
	["another proxy's refusal", "HTTP/1.1 407 Proxy Authentication Required\r\ncontent-length: 4\r\n\r\nnope"],
	["what was asked, come back", "GET http://banda.invalid/ HTTP/1.1\r\nHost: banda.invalid\r\n\r\n"],
	[
		"an answer of no stated length",
		"HTTP/1.1 407 Proxy Authentication Required\r\n\r\nbanda: this proxy needs banda's login\n",
	],
	["more than the answer", `${ANSWER}HTTP/1.1 200 OK\r\n\r\n`],
	["a flood", "x".repeat(10_000)],
])("falls for good on %s", async (_, text) => {
	const { tied, child, asked, answer } = fixture();
	await until(() => asked.length === 1);
	answer(text);
	await until(() => tied.fallen());
	expect(tied.stands()).toBe(false);
	expect(child.killed).toBe(true);
	// nothing said afterwards raises it again
	answer();
	await delay(20);
	expect(tied.stands()).toBe(false);
});

it.each(["close", "error"])("falls when its connection ends (%s)", async (event) => {
	const { tied, child, asked, answer } = fixture();
	await until(() => asked.length === 1);
	answer();
	await until(() => tied.stands());
	child.emit(event, event === "error" ? new Error("spawn failed") : 1);
	expect(tied.stands()).toBe(false);
	expect(tied.fallen()).toBe(true);
});

it("falls when what it has to say cannot be written", async () => {
	const { tied, child } = fixture();
	child.stdin.emit("error", new Error("EPIPE"));
	expect(tied.fallen()).toBe(true);
});

it("an answer nobody asked for fells it", async () => {
	const { tied, asked, answer } = fixture();
	await until(() => asked.length === 1);
	answer();
	await until(() => tied.stands());
	answer();
	await until(() => tied.fallen());
});

it("knocks again now and then, stands while each knock is answered, and falls at the first that is not", async () => {
	const { tied, child, asked, answer } = fixture(40);
	await until(() => asked.length === 1);
	answer();
	await until(() => tied.stands());
	await until(() => asked.length === 2);
	// between a knock and its answer it stands on the connection, which is still the one that answered
	expect(tied.stands()).toBe(true);
	answer();
	await until(() => asked.length === 3);
	expect(tied.stands()).toBe(true);
	// this one goes unanswered: at the next it has fallen, and knocks no more
	await until(() => tied.fallen());
	expect(child.killed).toBe(true);
	expect(asked.length).toBe(3);
	await delay(100);
	expect(asked.length).toBe(3);
});
