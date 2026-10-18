import { z } from "zod";
import { timestamp, uuid } from "./common.ts";

/**
 * community.newsletter — the Zod SSOT for the public "stay updated" capture and its table,
 * `community.newsletter_subscriptions` (Decision #274; moved from `comms`).
 *
 * One request shape, used in three places so they can never drift: the client `NewsletterService`
 * validates a submission against it before hitting the network, the thin `/api/newsletter/subscribe`
 * route re-validates the body, and the fat `NewsletterBackendService` consumes the parsed result and
 * hands it to `community.subscribe_newsletter`. The row and the writer's result are described here
 * too, and the allowed topic and source sets mirror the table's CHECKs value for value (root
 * CLAUDE.md §1, the Zod SSOT rule). Only regex/enum primitives are used so it is stable across Zod
 * majors (matching `explore/items.ts`, `org/enterprises.ts`).
 */

// #region Primitives
/**
 * The longest address the capture accepts (RFC 5321's 254), enforced at every layer: here, the
 * table's `newsletter_subscriptions_email_length` CHECK and `community.subscribe_newsletter`'s guard.
 * An oversized address is then a field error everywhere, never a btree row-size failure.
 */
export const NEWSLETTER_EMAIL_MAX = 254;

/** Shared email shape — the same permissive structure check the auth feature uses (`EMAIL_RE`). */
const email = z.string().trim().max(NEWSLETTER_EMAIL_MAX, "Enter a valid email address.").regex(
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/,
	"Enter a valid email address.",
);

/**
 * Where the capture originated, so the backend can attribute intent (footer, a campaign, …):
 * `changelog` is the subscribe row on /changelog (Decision #278).
 */
export const NewsletterSource = z.enum(["footer", "landing", "explore", "changelog"]);
export type NewsletterSource = z.infer<typeof NewsletterSource>;

/**
 * The lists an address can opt into, in the order the table's CHECK names them: `general` is the
 * platform newsletter, `changelog` the release notes `/changelog` offers. Adding one is a change to
 * this tuple AND `newsletter_subscriptions_topics_check` (00000025) in the same commit.
 */
export const NEWSLETTER_TOPICS = ["general", "changelog"] as const;

/** One newsletter topic. */
export const NewsletterTopic = z.enum(NEWSLETTER_TOPICS);
export type NewsletterTopic = z.infer<typeof NewsletterTopic>;

/**
 * What a subscribe did, as `community.subscribe_newsletter` reports it: `created` (a new address),
 * `resubscribed` (an unsubscribed address: the request is recorded as pending, and the opt-out stands
 * until the confirm link applies it), `topic_added` (an active address gained the topic) or
 * `unchanged` (it already held it — nothing was written).
 */
export const NewsletterSubscribeOutcome = z.enum([
	"created",
	"resubscribed",
	"topic_added",
	"unchanged",
]);
export type NewsletterSubscribeOutcome = z.infer<typeof NewsletterSubscribeOutcome>;
// #endregion

// #region Request / response contracts
/**
 * A newsletter opt-in submission. `source` defaults to the global footer capture and `topic` to the
 * platform newsletter, so a body carrying only `email` subscribes exactly as it always did.
 */
export const NewsletterSubscribeSchema = z.object({
	email,
	source: NewsletterSource.default("footer"),
	topic: NewsletterTopic.default("general"),
});
export type NewsletterSubscribe = z.infer<typeof NewsletterSubscribeSchema>;

/** The success payload the `/api/newsletter/subscribe` route returns. */
export interface NewsletterSubscribeResult {
	/** Echoed (normalised) address, so the UI can confirm exactly what was captured. */
	email: string;
	/** The topic this submission asked for. */
	topic: NewsletterTopic;
	/**
	 * True when this address already held this topic, so nothing changed — the UI still shows a
	 * friendly success. It never reveals which OTHER topics an address holds.
	 */
	alreadySubscribed: boolean;
}
// #endregion

// #region Database shapes
/**
 * The JSON `community.subscribe_newsletter` returns. Parsed by the fat service before it is mapped
 * to {@link NewsletterSubscribeResult}, so a drifted function fails loudly instead of answering a
 * success it cannot vouch for.
 */
export const NewsletterSubscribeRpcResultSchema = z.object({
	email: z.string(),
	topic: NewsletterTopic,
	outcome: NewsletterSubscribeOutcome,
	already_subscribed: z.boolean(),
});
export type NewsletterSubscribeRpcResult = z.infer<typeof NewsletterSubscribeRpcResultSchema>;

/**
 * One `community.newsletter_subscriptions` row, as PostgREST returns it. Service-role only: `token`
 * is the confirm / unsubscribe capability and must never reach a client.
 */
export const NewsletterSubscriptionRowSchema = z.object({
	id: uuid,
	email: z.string(),
	source: NewsletterSource,
	/** Sorted, distinct and never empty (the table's CHECK and its one writer). */
	topics: z.array(NewsletterTopic).min(1),
	user_id: uuid.nullable(),
	locale: z.string().nullable(),
	confirmed_at: timestamp.nullable(),
	unsubscribed_at: timestamp.nullable(),
	unsubscribed_reason: z.string().nullable(),
	/**
	 * A re-subscribe request pending its owner's confirmation — set only while unsubscribed, sorted,
	 * distinct and never empty; NULL when nothing is pending. Applied by the confirm link, never by
	 * the public form.
	 */
	resubscribe_topics: z.array(NewsletterTopic).min(1).nullable(),
	resubscribe_requested_at: timestamp.nullable(),
	token: uuid,
	created_at: timestamp,
	updated_at: timestamp,
});
export type NewsletterSubscriptionRow = z.infer<typeof NewsletterSubscriptionRowSchema>;
// #endregion
