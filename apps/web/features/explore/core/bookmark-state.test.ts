import { assertEquals } from "jsr:@std/assert@^1";
import { hydrateSaved, savedIds, setSaved } from "./bookmark-state.ts";

interface Call {
	method: string;
	body: unknown;
}

Deno.test("bookmark-state: one load per page, optimistic toggles, a refused write reverts", async () => {
	const calls: Call[] = [];
	let refuseWrites = false;
	let releaseLoad: () => void = () => {};
	const loadGate = new Promise<void>((resolve) => (releaseLoad = resolve));
	const realFetch = globalThis.fetch;
	globalThis.fetch = async (
		_input: string | URL | Request,
		init?: RequestInit,
	): Promise<Response> => {
		const method = init?.method ?? "GET";
		calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : null });
		if (method === "GET") {
			await loadGate;
			return Response.json({ ok: true, data: { itemIds: ["logo-sprint", "north-studio"] } });
		}
		return refuseWrites
			? Response.json({ ok: false, message: "Saving is unavailable." }, { status: 503 })
			: Response.json({ ok: true, data: { itemId: "x", saved: true } });
	};
	try {
		const first = hydrateSaved();
		const second = hydrateSaved();

		const early = await setSaved("brand-refresh", true);
		assertEquals(early.ok, true);
		releaseLoad();
		await first;
		await second;
		assertEquals(calls.filter((c) => c.method === "GET").length, 1);
		assertEquals([...savedIds.value].sort(), ["brand-refresh", "logo-sprint", "north-studio"]);

		refuseWrites = true;
		const refused = await setSaved("logo-sprint", false);
		assertEquals(refused, { ok: false, saved: true, message: "Saving is unavailable." });
		assertEquals(savedIds.value.has("logo-sprint"), true);

		const posts = calls.filter((c) => c.method === "POST").map((c) => c.body);
		assertEquals(posts, [
			{ itemId: "brand-refresh", saved: true },
			{ itemId: "logo-sprint", saved: false },
		]);
	} finally {
		globalThis.fetch = realFetch;
	}
});
