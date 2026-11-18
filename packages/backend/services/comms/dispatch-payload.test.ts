import { assertEquals } from "@std/assert";
import { buildDispatchPayload, deepLink, INBOX_PATH } from "./dispatch-payload.ts";

const APP = "https://staging.projective.test";

Deno.test("buildDispatchPayload — the title, the link and the id; never the body or the payload", () => {
	// A claim row carrying more than the payload may use: the builder copies three fields by name.
	const claimed = {
		notificationId: "6f3d2b0a-1c4e-4d8a-9b7f-0a1b2c3d4e5f",
		title: "Stage 2 was funded",
		actionUrl: "/projects/prj-abc123/stages/stg-def456",
		body: "Private-zone text that must never reach a provider",
		payload: { amount: 12_000, counterparty: "someone" },
	};
	const payload = buildDispatchPayload(claimed, APP);

	assertEquals(Object.keys(payload).sort(), ["link", "notificationId", "title"]);
	assertEquals(payload, {
		notificationId: claimed.notificationId,
		title: "Stage 2 was funded",
		link: `${APP}/projects/prj-abc123/stages/stg-def456`,
	});
	assertEquals("body" in payload || "payload" in payload, false);
});

Deno.test("deepLink — a plain path stays on the app's own origin, query and fragment kept", () => {
	assertEquals(
		deepLink("/messages/cht-a1b2?tab=files#m3", `${APP}/`),
		`${APP}/messages/cht-a1b2?tab=files#m3`,
	);
	assertEquals(new URL(deepLink("/wallet", APP)).origin, APP);
});

Deno.test("deepLink — anything but a same-origin path falls back to the inbox", () => {
	const inbox = `${APP}${INBOX_PATH}`;
	for (
		const unsafe of [
			null,
			"",
			"   ",
			"https://evil.test/phish",
			"//evil.test/phish",
			"/\\evil.test",
			"\\\\evil.test",
			"javascript:alert(1)",
			"projects/prj-abc123",
		]
	) {
		assertEquals(deepLink(unsafe, APP), inbox, String(unsafe));
	}
});
