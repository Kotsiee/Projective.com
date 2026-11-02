import { assertEquals } from "@std/assert";
import { loadNavPreview, NAV_PREVIEW_STALE_MS, navPreviews } from "./nav-preview-state.ts";

const row = { ref: "t-1", title: "Mara", image: null, detail: "Hi", at: null, pinned: false };

Deno.test("a preview is read once per stale window, and a failed first read retries", async () => {
	const realFetch = globalThis.fetch;
	const asked: string[] = [];
	let failing = true;
	globalThis.fetch = ((input: string) => {
		asked.push(input);
		return Promise.resolve(
			failing
				? new Response("{}", { status: 503 })
				: Response.json({ ok: true, kind: "messages", items: [row] }),
		);
	}) as typeof fetch;
	try {
		await loadNavPreview("messages", 1_000);
		assertEquals(navPreviews.value.messages, { status: "error" });

		failing = false;
		await loadNavPreview("messages", 2_000);
		assertEquals(navPreviews.value.messages, { status: "ready", items: [row] });

		await loadNavPreview("messages", 2_000 + NAV_PREVIEW_STALE_MS - 1);
		assertEquals(asked.length, 2, "a fresh read answers the repeat right-click");

		await loadNavPreview("messages", 2_000 + NAV_PREVIEW_STALE_MS);
		assertEquals(asked, Array(3).fill("/api/nav/preview?kind=messages"));
	} finally {
		globalThis.fetch = realFetch;
	}
});
