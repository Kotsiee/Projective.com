import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	NEWSLETTER_EMAIL_MAX,
	NEWSLETTER_TOPICS,
	NewsletterSource,
	NewsletterSubscribeRpcResultSchema,
	NewsletterSubscribeSchema,
	NewsletterTopic,
} from "./newsletter.ts";

/**
 * The newsletter's Zod SSOT against its request contract and against the table's CHECKs. The CHECK
 * literals are read out of the migration (the `catalog.contract.test.ts` technique), so adding a
 * topic to one side and not the other fails here, on a laptop with no database.
 */

const MIGRATION = new URL(
	"../../../supabase/migrations/00000025_tables_community.sql",
	import.meta.url,
);
const sql = Deno.readTextFileSync(MIGRATION).replace(/\r\n/g, "\n");
const writer = Deno.readTextFileSync(
	new URL(
		"../../../supabase/migrations/00001320_functions_editorial_community.sql",
		import.meta.url,
	),
).replace(/\r\n/g, "\n");

/** The quoted literals inside the first `ARRAY[…]` / `IN (…)` following `marker`. */
function literalsAfter(marker: string, open: string, close: string): string[] {
	const start = sql.indexOf(marker);
	assert(start >= 0, `${marker} not found in 00000025`);
	const from = sql.indexOf(open, start) + open.length;
	const body = sql.slice(from, sql.indexOf(close, from));
	return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

// #region Request shape
Deno.test("topic is optional and defaults to the platform newsletter", () => {
	const parsed = NewsletterSubscribeSchema.parse({ email: "a@b.co" });
	assertEquals(parsed, { email: "a@b.co", source: "footer", topic: "general" });
});

Deno.test("the changelog topic is accepted", () => {
	const parsed = NewsletterSubscribeSchema.parse({
		email: "  reader@example.com ",
		source: "landing",
		topic: "changelog",
	});
	assertEquals(parsed.topic, "changelog");
	assertEquals(parsed.email, "reader@example.com");
});

Deno.test("an unknown topic or source is refused, naming the field", () => {
	const topic = NewsletterSubscribeSchema.safeParse({ email: "a@b.co", topic: "weekly" });
	assertFalse(topic.success);
	assertEquals(topic.error.issues[0].path, ["topic"]);

	const source = NewsletterSubscribeSchema.safeParse({ email: "a@b.co", source: "sidebar" });
	assertFalse(source.success);
	assertEquals(source.error.issues[0].path, ["source"]);
});

Deno.test("the changelog's capture is its own source", () => {
	const parsed = NewsletterSubscribeSchema.parse({
		email: "reader@example.com",
		source: "changelog",
		topic: "changelog",
	});
	assertEquals([parsed.source, parsed.topic], ["changelog", "changelog"]);
});

Deno.test("a malformed address is still refused on the email field", () => {
	const parsed = NewsletterSubscribeSchema.safeParse({ email: "not-an-address", topic: "general" });
	assertFalse(parsed.success);
	assertEquals(parsed.error.issues[0].path, ["email"]);
});

Deno.test("an address over 254 characters is a field error; 254 is accepted", () => {
	const at = (n: number) => `${"a".repeat(n - "@example.com".length)}@example.com`;
	assert(NewsletterSubscribeSchema.safeParse({ email: at(NEWSLETTER_EMAIL_MAX) }).success);
	const long = NewsletterSubscribeSchema.safeParse({ email: at(NEWSLETTER_EMAIL_MAX + 1) });
	assertFalse(long.success);
	assertEquals(long.error.issues[0].path, ["email"]);
	assertEquals(long.error.issues[0].message, "Enter a valid email address.");
	// Measured after the trim, so surrounding spaces never push a valid address over.
	assert(NewsletterSubscribeSchema.safeParse({ email: `  ${at(NEWSLETTER_EMAIL_MAX)}  ` }).success);
});
// #endregion

// #region Twins of the table
Deno.test("NEWSLETTER_TOPICS mirrors newsletter_subscriptions_topics_check value for value", () => {
	const allowed = literalsAfter("topics <@ ARRAY[", "ARRAY[", "]");
	assertEquals([...NEWSLETTER_TOPICS], allowed);
	assertEquals(NewsletterTopic.options, allowed);
	assert(sql.includes("topics text[] NOT NULL DEFAULT ARRAY['general']::text[]"));
});

Deno.test("a pending re-subscribe holds the same topic set as the row's topics", () => {
	const allowed = literalsAfter("resubscribe_topics <@ ARRAY[", "ARRAY[", "]");
	assertEquals([...NEWSLETTER_TOPICS], allowed);
});

Deno.test("NEWSLETTER_EMAIL_MAX is the table's CHECK and the writer's guard", () => {
	assert(sql.includes(`CHECK (char_length(email) <= ${NEWSLETTER_EMAIL_MAX})`));
	assert(writer.includes(`char_length(v_email) > ${NEWSLETTER_EMAIL_MAX}`));
});

Deno.test("NewsletterSource mirrors newsletter_subscriptions_source_check value for value", () => {
	const allowed = literalsAfter("newsletter_subscriptions_source_check CHECK", "IN (", ")");
	assertEquals(NewsletterSource.options, allowed);
});

Deno.test("the writer's result parses, and a drifted one does not", () => {
	const ok = NewsletterSubscribeRpcResultSchema.safeParse({
		email: "a@b.co",
		topic: "changelog",
		outcome: "topic_added",
		already_subscribed: false,
	});
	assert(ok.success);
	const drifted = NewsletterSubscribeRpcResultSchema.safeParse({
		email: "a@b.co",
		topic: "changelog",
		outcome: "added",
		already_subscribed: false,
	});
	assertFalse(drifted.success);
});
// #endregion
