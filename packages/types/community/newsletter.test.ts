import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	NEWSLETTER_EMAIL_MAX,
	NEWSLETTER_LINK_TTL_DAYS,
	NEWSLETTER_PARAM_KEYS,
	NEWSLETTER_PROVIDER_SYNC_FLAG,
	NEWSLETTER_RESEND_AFTER_MINUTES,
	NEWSLETTER_TOPIC_LABELS,
	NEWSLETTER_TOPICS,
	NewsletterConfirmOutcome,
	NewsletterConfirmRpcResultSchema,
	NewsletterLinkRpcResultSchema,
	NewsletterProviderConfigSchema,
	NewsletterProviderEventKind,
	NewsletterProviderEventOutcome,
	NewsletterProviderEventRpcResultSchema,
	NewsletterSource,
	NewsletterSubscribeOutcome,
	NewsletterSubscribeRpcResultSchema,
	NewsletterSubscribeSchema,
	NewsletterSyncAction,
	NewsletterSyncBatchSchema,
	NewsletterSyncRecordAction,
	NewsletterSyncRecordOutcome,
	NewsletterSyncRowSchema,
	NewsletterTopic,
	NewsletterUnsubscribedReason,
	NewsletterUnsubscribeOutcome,
	NewsletterUnsubscribeReason,
	NewsletterUnsubscribeRpcResultSchema,
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
		confirmation_due: true,
		token: "0b0e7d5c-34a1-4b7a-9d61-2f1f5c2e9a10",
		confirm_topics: ["changelog", "general"],
	});
	assert(ok.success);
	const drifted = NewsletterSubscribeRpcResultSchema.safeParse({
		email: "a@b.co",
		topic: "changelog",
		outcome: "added",
		already_subscribed: false,
		confirmation_due: false,
		token: null,
		confirm_topics: null,
	});
	assertFalse(drifted.success);
	// A writer that predates the double opt-in (no `confirmation_due`) is drift too.
	assertFalse(
		NewsletterSubscribeRpcResultSchema.safeParse({
			email: "a@b.co",
			topic: "general",
			outcome: "created",
			already_subscribed: false,
		}).success,
	);
});
// #endregion

// #region Twins of the double opt-in's doors (00001320)
/** The body of one function in 00001320, from its CREATE to its closing `$$;`. */
function functionBody(name: string): string {
	const start = writer.indexOf(`CREATE OR REPLACE FUNCTION community.${name}(`);
	assert(start >= 0, `community.${name} not found in 00001320`);
	return writer.slice(start, writer.indexOf("\n$$;", start));
}

/** Every value of `values` appears as a quoted literal in `body`. */
function quotesEvery(body: string, values: readonly string[]): string[] {
	return values.filter((value) => !body.includes(`'${value}'`));
}

Deno.test("every outcome the Zod enums name is one the doors return", () => {
	assertEquals(
		quotesEvery(functionBody("subscribe_newsletter"), NewsletterSubscribeOutcome.options),
		[],
	);
	assertEquals(
		quotesEvery(functionBody("confirm_newsletter"), NewsletterConfirmOutcome.options),
		[],
	);
	assertEquals(
		quotesEvery(functionBody("unsubscribe_newsletter"), NewsletterUnsubscribeOutcome.options),
		[],
	);
});

Deno.test("NewsletterUnsubscribeReason mirrors the unsubscribe door's reasons value for value", () => {
	const body = functionBody("unsubscribe_newsletter");
	const list = body.slice(body.indexOf("NOT IN ("), body.indexOf(")", body.indexOf("NOT IN (")));
	assertEquals(
		[...list.matchAll(/'([^']+)'/g)].map((m) => m[1]),
		NewsletterUnsubscribeReason.options,
	);
});

Deno.test("the resend spacing and the link's life are the doors' own intervals", () => {
	assert(
		functionBody("subscribe_newsletter").includes(
			`now() - interval '${NEWSLETTER_RESEND_AFTER_MINUTES} minutes'`,
		),
	);
	for (const name of ["read_newsletter_link", "confirm_newsletter"]) {
		assert(
			functionBody(name).includes(`now() - interval '${NEWSLETTER_LINK_TTL_DAYS} days'`),
			name,
		);
	}
});

Deno.test("every topic has a reader-facing label", () => {
	assertEquals(Object.keys(NEWSLETTER_TOPIC_LABELS).sort(), [...NEWSLETTER_TOPICS].sort());
	assert(Object.values(NEWSLETTER_TOPIC_LABELS).every((label) => label.trim().length > 0));
});

Deno.test("the link read, confirm and unsubscribe answers parse; an unknown token reads null", () => {
	assert(
		NewsletterLinkRpcResultSchema.safeParse({
			subscribed: false,
			unsubscribed: false,
			topics: ["general"],
			pending_topics: ["general"],
			expired: false,
		}).success,
	);
	assertEquals(NewsletterLinkRpcResultSchema.parse(null), null);
	assert(
		NewsletterConfirmRpcResultSchema.safeParse({ outcome: "not_found", topics: [] }).success,
	);
	assertFalse(
		NewsletterConfirmRpcResultSchema.safeParse({ outcome: "spent", topics: [] }).success,
	);
	assert(NewsletterUnsubscribeRpcResultSchema.safeParse({ outcome: "unsubscribed" }).success);
});

Deno.test("a Turnstile token is optional and bounded", () => {
	assertEquals(NewsletterSubscribeSchema.parse({ email: "a@b.co" }).captchaToken, undefined);
	assertEquals(
		NewsletterSubscribeSchema.parse({ email: "a@b.co", captchaToken: " tok " }).captchaToken,
		"tok",
	);
	assertFalse(
		NewsletterSubscribeSchema.safeParse({ email: "a@b.co", captchaToken: "x".repeat(2049) })
			.success,
	);
});

Deno.test("the table carries confirmation_sent_at, and a pending topic may sit on a confirmed row", () => {
	assert(sql.includes("confirmation_sent_at timestamptz,"));
	assert(
		sql.includes(
			"(resubscribe_topics IS NULL OR unsubscribed_at IS NOT NULL OR confirmed_at IS NOT NULL)",
		),
	);
});
// #endregion

// #region Twins of the provider's copy (CD1 step 5)
/** The quoted literals of the first `NOT IN (…)` in `body`. */
function notInList(body: string): string[] {
	const from = body.indexOf("NOT IN (");
	assert(from >= 0, "no NOT IN list");
	return [...body.slice(from, body.indexOf(")", from)).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

Deno.test("NewsletterUnsubscribedReason mirrors the reason CHECK, and the link's reasons are a subset", () => {
	const allowed = literalsAfter("unsubscribed_reason IN (", "IN (", ")");
	assertEquals(NewsletterUnsubscribedReason.options, allowed);
	assert(NewsletterUnsubscribeReason.options.every((r) => allowed.includes(r)));
	// The provider door writes exactly the two reasons the link never does.
	const body = functionBody("record_newsletter_provider_event");
	assert(body.includes("'provider'") && body.includes("'complaint'"));
});

Deno.test("the table carries the provider columns, bounded like the Zod row", () => {
	for (
		const column of [
			"provider_contact_ref text,",
			"provider_synced_at timestamptz,",
			"provider_topics text[],",
		]
	) {
		assert(sql.includes(column), column);
	}
	assert(sql.includes("char_length(provider_contact_ref) BETWEEN 1 AND 128"));
	assertEquals(literalsAfter("provider_topics <@ ARRAY[", "ARRAY[", "]"), [...NEWSLETTER_TOPICS]);
});

Deno.test("the sync's actions, the record's actions and the provider's events are the doors' own", () => {
	assertEquals(
		notInList(functionBody("record_newsletter_sync")),
		NewsletterSyncRecordAction.options,
	);
	assertEquals(
		notInList(functionBody("record_newsletter_provider_event")),
		NewsletterProviderEventKind.options,
	);
	const batch = functionBody("newsletter_sync_batch");
	assertEquals(quotesEvery(batch, NewsletterSyncAction.options), []);
	assertEquals(
		quotesEvery(functionBody("record_newsletter_sync"), NewsletterSyncRecordOutcome.options),
		[],
	);
	assertEquals(
		quotesEvery(
			functionBody("record_newsletter_provider_event"),
			NewsletterProviderEventOutcome.options,
		),
		[],
	);
});

Deno.test("the batch reads the flag and the params this module names", () => {
	assert(
		functionBody("fn_newsletter_provider_sync_enabled").includes(
			`'${NEWSLETTER_PROVIDER_SYNC_FLAG}'`,
		),
	);
	const batch = functionBody("newsletter_sync_batch");
	assert(batch.includes(`'${NEWSLETTER_PARAM_KEYS.segmentId}'`));
	assert(batch.includes(`'${NEWSLETTER_PARAM_KEYS.topicIds}'`));
	const seed = Deno.readTextFileSync(
		new URL("../../../supabase/migrations/00005001_seed_platform_params.sql", import.meta.url),
	).replace(/\r\n/g, "\n");
	for (const key of Object.values(NEWSLETTER_PARAM_KEYS)) assert(seed.includes(`('${key}',`), key);
	assert(seed.includes(`VALUES ('${NEWSLETTER_PROVIDER_SYNC_FLAG}', false,`));
	// One seeded topic id per topic, each empty until an environment sets it.
	assert(seed.includes(`'{${NEWSLETTER_TOPICS.map((t) => `"${t}": null`).join(", ")}}'::jsonb`));
});

Deno.test("a batch parses; a row carrying anything more of the subscription does not", () => {
	const row = {
		id: "0b0e7d5c-34a1-4b7a-9d61-2f1f5c2e9a10",
		email: "a@b.co",
		topics: ["general"],
		action: "upsert",
		contact_ref: null,
		version: "2026-11-18T21:28:12.760158+00:00",
		reconfirmed: true,
	};
	assert(
		NewsletterSyncBatchSchema.safeParse({
			enabled: true,
			segment_id: null,
			topic_ids: null,
			rows: [row],
		}).success,
	);
	assertFalse(NewsletterSyncRowSchema.safeParse({ ...row, source: "footer" }).success);
	assertFalse(NewsletterSyncRowSchema.safeParse({ ...row, action: "create" }).success);
});

Deno.test("the provider config needs the segment and every topic id", () => {
	const topicIds = { general: "t-general", changelog: "t-changelog" };
	assert(NewsletterProviderConfigSchema.safeParse({ segmentId: "seg", topicIds }).success);
	assertFalse(NewsletterProviderConfigSchema.safeParse({ segmentId: null, topicIds }).success);
	assertFalse(
		NewsletterProviderConfigSchema.safeParse({
			segmentId: "seg",
			topicIds: { general: "t", changelog: null },
		})
			.success,
	);
	assertFalse(NewsletterProviderConfigSchema.safeParse({ segmentId: " ", topicIds }).success);
});

Deno.test("the provider door's answer parses, and a drifted one does not", () => {
	assert(NewsletterProviderEventRpcResultSchema.safeParse({ outcome: "topics_removed" }).success);
	assertFalse(NewsletterProviderEventRpcResultSchema.safeParse({ outcome: "removed" }).success);
});
// #endregion
