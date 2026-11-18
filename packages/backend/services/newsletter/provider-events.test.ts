import { assertEquals, assertRejects } from "@std/assert";
import { applyNewsletterProviderEvent, newsletterEventArgs } from "./provider-events.ts";

/**
 * The newsletter's share of a Resend webhook event (CD1 step 5, #480 (b)): which events are the
 * newsletter's, what each one asks of `community.record_newsletter_provider_event`, and that a door
 * failure throws (the webhook's 503, so Resend sends it again) while the address never reaches a log.
 */

const TOPIC_IDS = { general: "t-general", changelog: "t-changelog" };
const AT = "2026-11-18T12:00:00.000Z";

const contact = (type: string, data: Record<string, unknown>) => ({ type, created_at: AT, data });

Deno.test("a contact unsubscribed at the provider, and one that is present", () => {
	assertEquals(
		newsletterEventArgs(
			contact("contact.updated", { id: "ct-1", email: "A@B.co", unsubscribed: true }),
			null,
		),
		{
			p_email: "a@b.co",
			p_event: "unsubscribed",
			p_occurred_at: AT,
			p_contact_ref: "ct-1",
			p_opted_out: null,
			p_opted_in: null,
		},
	);
	assertEquals(
		newsletterEventArgs(
			contact("contact.created", { id: "ct-1", email: "a@b.co", unsubscribed: false }),
			null,
		)
			?.p_event,
		"present",
	);
	assertEquals(
		newsletterEventArgs(contact("contact.deleted", { id: "ct-1", email: "a@b.co" }), null)?.p_event,
		"deleted",
	);
});

Deno.test("a topic update names newsletter topics; an unknown topic id is ignored", () => {
	const raw = contact("contact.topics.updated", {
		email: "a@b.co",
		topics: [
			{ id: "t-general", subscription: "opt_out" },
			{ id: "t-changelog", subscription: "opt_in" },
			{ id: "t-someone-elses", subscription: "opt_out" },
		],
	});
	const args = newsletterEventArgs(raw, TOPIC_IDS);
	assertEquals([args?.p_event, args?.p_opted_out, args?.p_opted_in], ["topics", ["general"], [
		"changelog",
	]]);
	// Without the topic ids nothing could be named, so the event is not applied.
	assertEquals(newsletterEventArgs(raw, null), null);
	assertEquals(
		newsletterEventArgs(
			contact("contact.topics.updated", {
				email: "a@b.co",
				topics: [{ id: "x", subscription: "opt_out" }],
			}),
			TOPIC_IDS,
		),
		null,
	);
});

Deno.test("a complaint takes the address from `to`", () => {
	const args = newsletterEventArgs(
		{
			type: "email.complained",
			created_at: AT,
			data: { email_id: "em-1", to: ["Reader@Example.com"] },
		},
		null,
	);
	assertEquals([args?.p_event, args?.p_email, args?.p_contact_ref], [
		"complaint",
		"reader@example.com",
		null,
	]);
});

Deno.test("delivery events, an unreadable address and a contact event without an id are not the newsletter's", () => {
	assertEquals(
		newsletterEventArgs(contact("email.delivered", { email_id: "em-1", to: ["a@b.co"] }), null),
		null,
	);
	assertEquals(
		newsletterEventArgs(contact("contact.updated", { id: "ct-1", email: "nobody" }), null),
		null,
	);
	assertEquals(
		newsletterEventArgs(contact("contact.updated", { email: "a@b.co", unsubscribed: true }), null),
		null,
	);
	assertEquals(newsletterEventArgs("not an event", null), null);
});

Deno.test("apply: records the outcome and logs the event id, never the address", async () => {
	const logs: string[] = [];
	const sent: unknown[] = [];
	const outcome = await applyNewsletterProviderEvent(
		"msg_1",
		contact("contact.updated", { id: "ct-1", email: "secret@example.com", unsubscribed: true }),
		{
			live: true,
			topicIds: () => Promise.resolve(null),
			record: (args) => {
				sent.push(args);
				return Promise.resolve({ data: { outcome: "unsubscribed" }, error: null });
			},
			log: (line) => logs.push(line),
		},
	);
	assertEquals(outcome, "unsubscribed");
	assertEquals(sent.length, 1);
	assertEquals(logs, ["[newsletter:provider] msg_1 contact.updated → unsubscribed"]);
});

Deno.test("apply: nothing while the list is not stored here, or for another event; a door failure throws", async () => {
	let calls = 0;
	const record = () => {
		calls++;
		return Promise.resolve({ data: null, error: { code: "PGRST301", message: "down" } });
	};
	const raw = contact("contact.deleted", { id: "ct-1", email: "a@b.co" });
	assertEquals(
		await applyNewsletterProviderEvent("m", raw, { live: false, record, log: () => {} }),
		null,
	);
	assertEquals(
		await applyNewsletterProviderEvent("m", contact("email.sent", {}), {
			live: true,
			record,
			log: () => {},
		}),
		null,
	);
	assertEquals(calls, 0);
	await assertRejects(() =>
		applyNewsletterProviderEvent("m", raw, { live: true, record, log: () => {} })
	);
	await assertRejects(() =>
		applyNewsletterProviderEvent("m", raw, {
			live: true,
			record: () => Promise.resolve({ data: { outcome: "gone" }, error: null }),
			log: () => {},
		})
	);
});
