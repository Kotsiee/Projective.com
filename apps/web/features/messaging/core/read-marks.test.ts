import { assert, assertEquals } from "@std/assert";
import type { ConversationSummary } from "../types/messaging-types.ts";
import {
	markConversationSeen,
	readMarks,
	type VisibilitySource,
	whenSeen,
	withRead,
} from "./read-marks.ts";

/**
 * The read mark's client half (CAS M10, PRD-C11): it is sent once, only when the page is visible,
 * as a bodiless background POST, and the lane's overlay follows what the server answered.
 */

// #region Harness
/** A document whose visibility a test flips, counting its live `visibilitychange` listeners. */
function fakeDocument(initial: string): VisibilitySource & {
	show(): void;
	hide(): void;
	listeners(): number;
} {
	let state = initial;
	const set = new Set<() => void>();
	return {
		get visibilityState() {
			return state;
		},
		addEventListener: (_type, listener) => void set.add(listener),
		removeEventListener: (_type, listener) => void set.delete(listener),
		show() {
			state = "visible";
			for (const l of [...set]) l();
		},
		hide() {
			state = "hidden";
			for (const l of [...set]) l();
		},
		listeners: () => set.size,
	};
}

const ROW = { id: "dm-mara", unread: true } as ConversationSummary;

/** Answer every `fetch` with `status`, recording what was sent. */
async function withFetch(
	status: number,
	fn: (sent: { url: string; init: RequestInit | undefined }[]) => Promise<void>,
): Promise<void> {
	const original = globalThis.fetch;
	const sent: { url: string; init: RequestInit | undefined }[] = [];
	globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
		sent.push({ url: String(input), init });
		const body = status === 204
			? null
			: JSON.stringify({ ok: false, message: "No such conversation." });
		return Promise.resolve(new Response(body, { status }));
	}) as typeof fetch;
	try {
		await fn(sent);
	} finally {
		globalThis.fetch = original;
		readMarks.value = {};
	}
}
// #endregion

// #region whenSeen
Deno.test("whenSeen: a visible page acts at once, exactly once, and leaves no listener", () => {
	const doc = fakeDocument("visible");
	let runs = 0;
	whenSeen(doc, () => runs++);
	doc.hide();
	doc.show();
	assertEquals(runs, 1);
	assertEquals(doc.listeners(), 0);
});

Deno.test("whenSeen: a background tab waits for its first visibilitychange to visible", () => {
	const doc = fakeDocument("hidden");
	let runs = 0;
	whenSeen(doc, () => runs++);
	assertEquals(runs, 0);
	doc.hide();
	assertEquals(runs, 0, "a change that leaves the page hidden is not a sighting");
	doc.show();
	doc.hide();
	doc.show();
	assertEquals(runs, 1);
	assertEquals(doc.listeners(), 0);
});

Deno.test("whenSeen: cancelling before the page is seen sends nothing and drops the listener", () => {
	const doc = fakeDocument("hidden");
	let runs = 0;
	const cancel = whenSeen(doc, () => runs++);
	cancel();
	doc.show();
	assertEquals(runs, 0);
	assertEquals(doc.listeners(), 0);
});
// #endregion

// #region withRead
Deno.test("withRead: a marked conversation loses its dot; others keep theirs", () => {
	assertEquals(withRead(ROW, { "dm-mara": true }).unread, false);
	assertEquals(withRead(ROW, { "dm-theo": true }).unread, true);
	assertEquals(withRead(ROW, {}), ROW, "an unmarked row is the same object");
});
// #endregion

// #region markConversationSeen
Deno.test("markConversationSeen: a bodiless background POST, kept alive across navigation", async () => {
	await withFetch(204, async (sent) => {
		assert(await markConversationSeen("dm-mara"));
		assertEquals(sent.length, 1);
		const { url, init } = sent[0];
		assertEquals(url, "/api/messaging/conversations/dm-mara/read");
		assertEquals(init?.method, "POST");
		assertEquals(init?.body, undefined, "no body, so the origin guard's bodiless rule applies");
		assertEquals(init?.keepalive, true);
		const headers = new Headers(init?.headers);
		assertEquals(headers.get("content-type"), null);
		assertEquals(headers.get("x-pj-background"), "1");
		assertEquals(readMarks.value, { "dm-mara": true });
	});
});

Deno.test("markConversationSeen: a refusal leaves the thread unread and says nothing", async () => {
	await withFetch(404, async () => {
		assertEquals(await markConversationSeen("dm-mara"), false);
		assertEquals(readMarks.value, {});
	});
});

Deno.test("markConversationSeen: the id is one path segment, whatever it is spelled with", async () => {
	await withFetch(204, async (sent) => {
		await markConversationSeen("grp/../../x");
		assertEquals(sent[0].url, "/api/messaging/conversations/grp%2F..%2F..%2Fx/read");
	});
});
// #endregion
