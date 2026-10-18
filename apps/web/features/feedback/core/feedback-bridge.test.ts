import { assertEquals } from "@std/assert";
import { feedbackFallbackHref, onOpenFeedback, openFeedback } from "./feedback-bridge.ts";

Deno.test("a mounted host claims the request, and receives what was asked for", () => {
	const seen: string[] = [];
	const off = onOpenFeedback((detail) => {
		seen.push(detail.view);
		return true;
	});
	try {
		assertEquals(openFeedback(), true);
		assertEquals(openFeedback({ view: "compose" }), true);
		assertEquals(seen, ["board", "compose"]);
	} finally {
		off();
	}
});

Deno.test("with no host — or one that declines — the request is not claimed", () => {
	assertEquals(openFeedback(), false);
	const off = onOpenFeedback(() => false);
	try {
		assertEquals(openFeedback(), false);
	} finally {
		off();
	}
});

Deno.test("the fallback is the board's own page, at the view asked for", () => {
	assertEquals(feedbackFallbackHref({ view: "board" }), "/feedback");
	assertEquals(feedbackFallbackHref({ view: "compose" }), "/feedback?compose=1");
});
