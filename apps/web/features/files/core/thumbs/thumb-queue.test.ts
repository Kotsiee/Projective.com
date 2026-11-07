import { assertEquals } from "@std/assert";
import { createThumbQueue, type ThumbLane } from "./thumb-queue.ts";

/** A job the test finishes by hand. */
function gate() {
	let open: (value: string) => void = () => undefined;
	const done = new Promise<string>((resolve) => (open = resolve));
	return { done, open };
}

const noIdle = () => Promise.resolve();
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const live = () => new AbortController();

function queue(concurrency: Partial<Record<ThumbLane, number>> = {}) {
	return createThumbQueue({
		concurrency: { net: 1, decode: 1, gpu: 1, ...concurrency },
		idle: noIdle,
	});
}

Deno.test("a lane runs no more than its limit at once, and the rest wait", async () => {
	const q = queue({ net: 2 });
	const gates = [gate(), gate(), gate()];
	let started = 0;
	gates.forEach((g, i) =>
		q.request(`k${i}`, "net", () => {
			started += 1;
			return g.done;
		}, live().signal)
	);
	await settle();
	assertEquals(started, 2);
	assertEquals(q.stats(), { waiting: 1, running: 2 });
	gates.forEach((g) => g.open("x"));
	await settle();
	assertEquals(started, 3);
	assertEquals(q.stats(), { waiting: 0, running: 0 });
});

Deno.test("the newest request goes first, because that is the card in view", async () => {
	const q = queue();
	const order: string[] = [];
	const first = gate();
	q.request("busy", "decode", () => first.done, live().signal);
	await settle();
	for (const key of ["old", "middle", "new"]) {
		q.request(key, "decode", () => {
			order.push(key);
			return Promise.resolve(key);
		}, live().signal);
	}
	first.open("x");
	await settle();
	assertEquals(order, ["new", "middle", "old"]);
});

Deno.test("asking again for a queued job moves it to the front", async () => {
	const q = queue();
	const order: string[] = [];
	const first = gate();
	const run = (key: string) => () => {
		order.push(key);
		return Promise.resolve(key);
	};
	q.request("busy", "decode", () => first.done, live().signal);
	await settle();
	q.request("a", "decode", run("a"), live().signal);
	q.request("b", "decode", run("b"), live().signal);
	q.request("a", "decode", run("a"), live().signal);
	first.open("x");
	await settle();
	assertEquals(order, ["a", "b"]);
});

Deno.test("two cards showing one file share one job", async () => {
	const q = queue();
	let runs = 0;
	const g = gate();
	const task = () => {
		runs += 1;
		return g.done;
	};
	const results = Promise.all([
		q.request("same", "net", task, live().signal),
		q.request("same", "net", task, live().signal),
	]);
	await settle();
	g.open("done");
	assertEquals(await results, ["done", "done"]);
	assertEquals(runs, 1);
});

Deno.test("a card scrolled away before its turn never starts", async () => {
	const q = queue();
	const first = gate();
	let ran = false;
	q.request("busy", "decode", () => first.done, live().signal);
	await settle();
	const leaving = live();
	const answer = q.request("gone", "decode", () => {
		ran = true;
		return Promise.resolve("x");
	}, leaving.signal);
	leaving.abort();
	assertEquals(await answer, null);
	first.open("x");
	await settle();
	assertEquals(ran, false);
});

Deno.test("a running job is aborted once nobody wants it, and frees its lane", async () => {
	const q = queue();
	let aborted = false;
	const leaving = live();
	q.request("gone", "decode", (signal) =>
		new Promise((_, reject) => {
			signal.addEventListener("abort", () => {
				aborted = true;
				reject(new Error("aborted"));
			});
		}), leaving.signal);
	await settle();
	leaving.abort();
	await settle();
	assertEquals(aborted, true);
	assertEquals(q.stats(), { waiting: 0, running: 0 });
});

Deno.test("a job one card still wants survives another card leaving", async () => {
	const q = queue();
	const g = gate();
	let aborted = false;
	const task = (signal: AbortSignal) => {
		signal.addEventListener("abort", () => (aborted = true));
		return g.done;
	};
	const leaving = live();
	q.request("shared", "net", task, leaving.signal);
	const staying = q.request("shared", "net", task, live().signal);
	await settle();
	leaving.abort();
	g.open("kept");
	assertEquals(await staying, "kept");
	assertEquals(aborted, false);
});

Deno.test("a failed job answers null and the next one still runs", async () => {
	const q = queue();
	const failed = q.request("bad", "net", () => Promise.reject(new Error("boom")), live().signal);
	const next = q.request("good", "net", () => Promise.resolve("ok"), live().signal);
	assertEquals(await failed, null);
	assertEquals(await next, "ok");
});

Deno.test("heavy lanes wait for an idle moment; the light lane does not", async () => {
	const waited: string[] = [];
	const q = createThumbQueue({
		concurrency: { net: 1, decode: 1, gpu: 1 },
		idle: () => {
			waited.push("idle");
			return Promise.resolve();
		},
	});
	await q.request("a", "net", () => Promise.resolve(1), live().signal);
	assertEquals(waited, []);
	await q.request("b", "decode", () => Promise.resolve(1), live().signal);
	assertEquals(waited, ["idle"]);
});

Deno.test("an already-aborted request does nothing", async () => {
	const q = queue();
	const gone = live();
	gone.abort();
	let ran = false;
	const answer = await q.request("x", "net", () => {
		ran = true;
		return Promise.resolve(1);
	}, gone.signal);
	assertEquals(answer, null);
	assertEquals(ran, false);
});
