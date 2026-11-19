import { assertEquals } from "@std/assert";
import { handler } from "../routes/api/explore/events.ts";

/**
 * `POST /api/explore/events` — the thin route in front of discovery telemetry and listing page views.
 * Pins the two answers that never reach the service: automation is accepted and stores nothing, and
 * a batch the Zod SSOT refuses is a `422`.
 */

// #region Harness
type Handler = (ctx: unknown) => Response | Promise<Response>;

const BROWSER =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function post(body: unknown, userAgent: string | null) {
	const url = new URL("https://app.example.test/api/explore/events");
	const headers = new Headers({ "content-type": "application/json" });
	if (userAgent) headers.set("user-agent", userAgent);
	const req = new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
	const res = await (handler as unknown as Record<string, Handler>).POST({
		req,
		url,
		params: {},
		state: {},
		info: { remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 1 } },
	});
	return { status: res.status, body: await res.json() };
}

const view = {
	sessionId: "session-0001",
	surface: "view.entity",
	events: [{ name: "discovery.view", itemId: "logo-design", itemType: "services", at: 1 }],
};
// #endregion

Deno.test("a crawler's or a headless browser's batch is accepted and stores nothing", async () => {
	for (
		const ua of [
			"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36",
			null,
		]
	) {
		assertEquals(
			await post(view, ua),
			{ status: 202, body: { ok: true, accepted: 0 } },
			String(ua),
		);
	}
});

Deno.test("a view sent from a discovery surface is refused by the schema", async () => {
	const res = await post({ ...view, surface: "explore.results" }, BROWSER);
	assertEquals(res.status, 422);
});

Deno.test("a listing page that sends more than its one view is refused by the schema", async () => {
	const res = await post({ ...view, events: [...view.events, ...view.events] }, BROWSER);
	assertEquals(res.status, 422);
});
