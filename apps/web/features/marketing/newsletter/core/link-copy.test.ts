import { assertEquals } from "@std/assert";
import type { NewsletterLinkView } from "@projective/types/community";
import { newsletterLinkCopy, type NewsletterLinkPageData } from "./link-copy.ts";

/**
 * What each newsletter link page says for each standing (PRD-E11): one button only where a press
 * changes something, and a link only where it leads somewhere real.
 */

const TOKEN = "0b0e7d5c-34a1-4b7a-9d61-2f1f5c2e9a10";

function data(
	mode: NewsletterLinkPageData["mode"],
	view: Partial<NewsletterLinkView> | null,
	failure: NewsletterLinkPageData["failure"] = null,
): NewsletterLinkPageData {
	return {
		mode,
		token: view ? TOKEN : null,
		view: view
			? {
				subscribed: false,
				unsubscribed: false,
				topics: ["general"],
				pendingTopics: null,
				expired: false,
				...view,
			}
			: null,
		failure,
		throttled: false,
	};
}

Deno.test("confirm: a fresh link offers Confirm for exactly the pending topics", () => {
	const copy = newsletterLinkCopy(data("confirm", { pendingTopics: ["changelog", "general"] }));
	assertEquals(copy.title, "Confirm your subscription");
	assertEquals(copy.topics, "Release notes · The Projective newsletter");
	assertEquals(copy.action?.endpoint, "/api/newsletter/confirm");
	assertEquals(copy.link, null);
});

Deno.test("confirm: an expired link offers no button, only the way to subscribe again", () => {
	const copy = newsletterLinkCopy(data("confirm", { pendingTopics: ["general"], expired: true }));
	assertEquals(copy.title, "This link has expired");
	assertEquals(copy.action, null);
	assertEquals(copy.link, { label: "Subscribe again", href: "#newsletter" });
});

Deno.test("confirm: a subscribed address says so and links to its unsubscribe page", () => {
	const copy = newsletterLinkCopy(data("confirm", { subscribed: true, topics: ["general"] }));
	assertEquals(copy.title, "You're subscribed");
	assertEquals(copy.action, null);
	assertEquals(copy.link?.href, `/newsletter/unsubscribe?token=${TOKEN}`);
});

Deno.test("confirm: an unsubscribed address with nothing pending offers to subscribe again", () => {
	const copy = newsletterLinkCopy(data("confirm", { unsubscribed: true }));
	assertEquals(copy.title, "You've unsubscribed");
	assertEquals(copy.action, null);
});

Deno.test("unsubscribe: an address on the list offers Unsubscribe for everything it holds or awaits", () => {
	const copy = newsletterLinkCopy(
		data("unsubscribe", { subscribed: true, topics: ["general"], pendingTopics: ["changelog"] }),
	);
	assertEquals(copy.topics, "Release notes · The Projective newsletter");
	assertEquals(copy.action?.endpoint, "/api/newsletter/unsubscribe");
});

Deno.test("unsubscribe: an unsubscribed address with a pending request can cancel it; without one, nothing to press", () => {
	assertEquals(
		newsletterLinkCopy(data("unsubscribe", { unsubscribed: true, pendingTopics: ["general"] }))
			.action
			?.label,
		"Cancel the request",
	);
	assertEquals(newsletterLinkCopy(data("unsubscribe", { unsubscribed: true })).action, null);
});

Deno.test("no standing: an unknown link is calm and offers the form; an outage offers nothing", () => {
	const unknown = newsletterLinkCopy(data("confirm", null, "not_found"));
	assertEquals(unknown.title, "We couldn't find this link");
	assertEquals(unknown.action, null);
	assertEquals(unknown.link?.href, "#newsletter");
	const down = newsletterLinkCopy(data("unsubscribe", null, "unavailable"));
	assertEquals([down.action, down.link], [null, null]);
});
