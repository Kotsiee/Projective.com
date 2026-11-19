import { assert, assertEquals } from "@std/assert";

/**
 * `apps/web/static/sw.js`'s push and notificationclick handlers (COMMS NT4), run against a stubbed
 * worker scope. The click opens only a same-origin path; a crafted URL opens "/".
 */

const ORIGIN = "https://app.projective.test";
const source = await Deno.readTextFile(new URL("../../../static/sw.js", import.meta.url));

interface Harness {
	handlers: Record<string, (event: unknown) => void>;
	shown: {
		title: string;
		options: NotificationOptions & { data?: { url: string; id: string | null } };
	}[];
	opened: string[];
	focused: string[];
}

function load(windows: string[] = [], scriptUrl = `${ORIGIN}/sw.js`): Harness {
	const h: Harness = { handlers: {}, shown: [], opened: [], focused: [] };
	const self = {
		location: new URL(scriptUrl),
		addEventListener: (type: string, fn: (event: unknown) => void) => (h.handlers[type] = fn),
		skipWaiting: () => Promise.resolve(),
		registration: {
			showNotification: (title: string, options: Harness["shown"][number]["options"]) => {
				h.shown.push({ title, options });
				return Promise.resolve();
			},
		},
		clients: {
			claim: () => Promise.resolve(),
			matchAll: () =>
				Promise.resolve(
					windows.map((url) => ({ url, focus: () => (h.focused.push(url), Promise.resolve()) })),
				),
			openWindow: (url: string) => (h.opened.push(url), Promise.resolve(null)),
		},
	};
	new Function("self", "caches", "fetch", source)(
		self,
		{ keys: () => Promise.resolve([]) },
		() => Promise.reject(),
	);
	return h;
}

async function dispatch(h: Harness, type: string, event: Record<string, unknown>): Promise<void> {
	let pending: Promise<unknown> = Promise.resolve();
	h.handlers[type]({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
	await pending;
}

function pushEvent(payload: unknown) {
	return { data: { json: () => (typeof payload === "string" ? JSON.parse(payload) : payload) } };
}

Deno.test("push — shows the title with a generic line, tags by Topic, keeps a safe path and the id", async () => {
	const h = load();
	await dispatch(
		h,
		"push",
		pushEvent({
			title: "Stage 2 was funded",
			url: "/projects/prj-abc?tab=money",
			id: "n1",
			tag: "T1",
		}),
	);
	assertEquals(h.shown.length, 1);
	const { title, options } = h.shown[0];
	assertEquals(title, "Stage 2 was funded");
	assertEquals(options.body, "Open Projective to see it.");
	assertEquals(options.tag, "T1");
	assertEquals(options.data, { url: "/projects/prj-abc?tab=money", id: "n1" });
});

Deno.test("push — an unreadable or empty payload still shows a plain notification that opens /", async () => {
	const h = load();
	await dispatch(h, "push", {
		data: {
			json: () => {
				throw new Error("not json");
			},
		},
	});
	assertEquals(h.shown[0].title, "Projective");
	assertEquals(h.shown[0].options.data?.url, "/");
});

Deno.test("notificationclick — a same-origin path opens that path", async () => {
	const h = load();
	let closed = false;
	await dispatch(h, "notificationclick", {
		notification: { data: { url: "/messages/cht-a1b2#m3" }, close: () => (closed = true) },
	});
	assert(closed);
	assertEquals(h.opened, [`${ORIGIN}/messages/cht-a1b2#m3`]);
});

Deno.test("notificationclick — a crafted url (absolute, protocol-relative, backslash, script) opens /", async () => {
	for (
		const url of [
			"https://evil.example",
			"//evil.example/x",
			"/\\evil.example",
			"javascript:alert(1)",
			42,
			null,
		]
	) {
		const h = load();
		await dispatch(h, "notificationclick", { notification: { data: { url }, close: () => {} } });
		assertEquals(h.opened, [`${ORIGIN}/`], String(url));
	}
});

Deno.test("notificationclick — an already-open window at the path is focused, not reopened", async () => {
	const h = load([`${ORIGIN}/wallet`]);
	await dispatch(h, "notificationclick", {
		notification: { data: { url: "/wallet" }, close: () => {} },
	});
	assertEquals([h.focused, h.opened], [[`${ORIGIN}/wallet`], []]);
});

Deno.test("push-only mode (/sw.js?mode=push) handles no fetch, so nothing is cached in development", () => {
	const h = load([], `${ORIGIN}/sw.js?mode=push`);
	let responded = false;
	h.handlers.fetch({
		request: new Request(`${ORIGIN}/app.js`),
		respondWith: () => (responded = true),
	});
	assertEquals(responded, false);
	assert(h.handlers.push && h.handlers.notificationclick);
});
