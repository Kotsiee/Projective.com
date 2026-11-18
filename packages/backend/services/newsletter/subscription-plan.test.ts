import { assertEquals } from "@std/assert";
import { normalizeTopics, planNewsletterSubscription } from "./subscription-plan.ts";

/**
 * The subscribe decision's five outcomes — the same five `community.subscribe_newsletter` returns and
 * `supabase/probes/community_editorial_schemas.sql` and `newsletter_double_opt_in.sql` pin in SQL.
 * A change here is a change there.
 */

Deno.test("a new address is created with only the requested topic", () => {
	assertEquals(planNewsletterSubscription(null, "changelog"), {
		outcome: "created",
		topics: ["changelog"],
		resubscribeTopics: null,
		writes: true,
		needsConfirmation: true,
		alreadySubscribed: false,
	});
});

Deno.test("re-subscribing to a held topic is idempotent: nothing written, alreadySubscribed", () => {
	const plan = planNewsletterSubscription(
		{ topics: ["general"], unsubscribedAt: null },
		"general",
	);
	assertEquals(plan.outcome, "unchanged");
	assertEquals(plan.writes, false);
	assertEquals(plan.alreadySubscribed, true);
	assertEquals(plan.topics, ["general"]);
});

Deno.test("an unconfirmed address's new topic joins the set its first confirmation covers", () => {
	const plan = planNewsletterSubscription(
		{ topics: ["general"], unsubscribedAt: null },
		"changelog",
	);
	assertEquals(plan.outcome, "topic_added");
	assertEquals(plan.topics, ["changelog", "general"]);
	assertEquals(plan.resubscribeTopics, null);
	assertEquals(plan.writes, true);
	assertEquals(plan.needsConfirmation, true);
	assertEquals(plan.alreadySubscribed, false);
});

Deno.test("a confirmed address's new topic waits for its own confirmation (#274 flag (c))", () => {
	const plan = planNewsletterSubscription(
		{ topics: ["general"], unsubscribedAt: null, confirmedAt: "2026-11-01T00:00:00Z" },
		"changelog",
	);
	assertEquals(plan.outcome, "topic_pending");
	// What it already holds keeps going out; the new topic is pending only.
	assertEquals(plan.topics, ["general"]);
	assertEquals(plan.resubscribeTopics, ["changelog"]);
	assertEquals(plan.writes, true);
	assertEquals(plan.needsConfirmation, true);
	assertEquals(plan.alreadySubscribed, false);
});

Deno.test("a confirmed address holding the topic is unchanged and awaits nothing", () => {
	const plan = planNewsletterSubscription(
		{ topics: ["general"], unsubscribedAt: null, confirmedAt: "2026-11-01T00:00:00Z" },
		"general",
	);
	assertEquals(plan.outcome, "unchanged");
	assertEquals(plan.needsConfirmation, false);
	assertEquals(plan.writes, false);
});

Deno.test("adding the topic twice converges: the second subscribe is unchanged", () => {
	const first = planNewsletterSubscription(
		{ topics: ["general"], unsubscribedAt: null },
		"changelog",
	);
	const second = planNewsletterSubscription(
		{ topics: first.topics, unsubscribedAt: null },
		"changelog",
	);
	assertEquals(second.outcome, "unchanged");
	assertEquals(second.topics, first.topics);
});

Deno.test("an unsubscribed address keeps its opt-out: the request is recorded, pending", () => {
	const plan = planNewsletterSubscription(
		{ topics: ["general", "changelog"], unsubscribedAt: "2026-10-01T00:00:00Z" },
		"general",
	);
	assertEquals(plan.outcome, "resubscribed");
	// The row's topics are untouched (and unsendable while unsubscribed); the request waits.
	assertEquals(plan.topics, ["changelog", "general"]);
	assertEquals(plan.resubscribeTopics, ["general"]);
	assertEquals(plan.writes, true);
	assertEquals(plan.needsConfirmation, true);
	assertEquals(plan.alreadySubscribed, false);
});

Deno.test("a second request on an unsubscribed address joins the pending set", () => {
	const plan = planNewsletterSubscription(
		{
			topics: ["general"],
			unsubscribedAt: "2026-10-01T00:00:00Z",
			resubscribeTopics: ["general"],
		},
		"changelog",
	);
	assertEquals(plan.outcome, "resubscribed");
	assertEquals(plan.resubscribeTopics, ["changelog", "general"]);
	assertEquals(plan.alreadySubscribed, false);
	const again = planNewsletterSubscription(
		{
			topics: ["general"],
			unsubscribedAt: "2026-10-01T00:00:00Z",
			resubscribeTopics: plan.resubscribeTopics,
		},
		"general",
	);
	assertEquals(again.outcome, "resubscribed");
	assertEquals(again.resubscribeTopics, ["changelog", "general"]);
});

Deno.test("normalizeTopics is the stored form: distinct, codepoint-sorted", () => {
	assertEquals(normalizeTopics(["general", "changelog", "general"]), ["changelog", "general"]);
	assertEquals(normalizeTopics([]), []);
});
