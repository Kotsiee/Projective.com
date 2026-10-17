import { assertEquals } from "@std/assert";
import { normalizeTopics, planNewsletterSubscription } from "./subscription-plan.ts";

/**
 * The subscribe decision's four outcomes — the same four `community.subscribe_newsletter` returns and
 * `supabase/probes/community_editorial_schemas.sql` pins in SQL. A change here is a change there.
 */

Deno.test("a new address is created with only the requested topic", () => {
	assertEquals(planNewsletterSubscription(null, "changelog"), {
		outcome: "created",
		topics: ["changelog"],
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

Deno.test("a new topic joins the set, sorted and distinct, without re-confirmation", () => {
	const plan = planNewsletterSubscription(
		{ topics: ["general"], unsubscribedAt: null },
		"changelog",
	);
	assertEquals(plan.outcome, "topic_added");
	assertEquals(plan.topics, ["changelog", "general"]);
	assertEquals(plan.writes, true);
	assertEquals(plan.needsConfirmation, false);
	assertEquals(plan.alreadySubscribed, false);
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

Deno.test("an unsubscribed address reopens with only the requested topic and must confirm again", () => {
	const plan = planNewsletterSubscription(
		{ topics: ["changelog", "general"], unsubscribedAt: "2026-10-01T00:00:00Z" },
		"general",
	);
	assertEquals(plan.outcome, "resubscribed");
	assertEquals(plan.topics, ["general"]);
	assertEquals(plan.needsConfirmation, true);
	assertEquals(plan.alreadySubscribed, false);
});

Deno.test("normalizeTopics is the stored form: distinct, codepoint-sorted", () => {
	assertEquals(normalizeTopics(["general", "changelog", "general"]), ["changelog", "general"]);
	assertEquals(normalizeTopics([]), []);
});
