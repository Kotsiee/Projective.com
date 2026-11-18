import { z } from "zod";
import { timestamp, uuid } from "./common.ts";
import { isStorableText } from "../content/text.ts";
import { CaptchaTokenSchema } from "../auth/captcha.ts";

/**
 * community.newsletter — the Zod SSOT for the public "stay updated" capture and its table,
 * `community.newsletter_subscriptions` (Decision #274; moved from `comms`).
 *
 * One request shape, used in three places so they can never drift: the client `NewsletterService`
 * validates a submission against it before hitting the network, the thin `/api/newsletter/subscribe`
 * route re-validates the body, and the fat `NewsletterBackendService` consumes the parsed result and
 * hands it to `community.subscribe_newsletter`. The row and the answers of the double opt-in's doors
 * (subscribe, the link read, confirm, unsubscribe; PRD-E11) are described here too, and the allowed
 * topic and source sets mirror the table's CHECKs value for value (root CLAUDE.md §1, the Zod SSOT
 * rule). Only regex/enum primitives are used so it is stable across Zod majors (matching
 * `explore/items.ts`, `org/enterprises.ts`).
 */

// #region Primitives
/**
 * The longest address the capture accepts (RFC 5321's 254), enforced at every layer: here, the
 * table's `newsletter_subscriptions_email_length` CHECK and `community.subscribe_newsletter`'s guard.
 * An oversized address is then a field error everywhere, never a btree row-size failure.
 */
export const NEWSLETTER_EMAIL_MAX = 254;

/**
 * Shared email shape — the same permissive structure check the auth feature uses (`EMAIL_RE`), and
 * only characters the writer can store ({@link isStorableText}): a NUL or a lone surrogate is a
 * field error here, never a 503 from Postgres or PostgREST.
 */
const email = z.string().trim().max(NEWSLETTER_EMAIL_MAX, "Enter a valid email address.").regex(
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/,
	"Enter a valid email address.",
).refine(isStorableText, "Enter a valid email address.");

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

/** What each topic is called to a reader: in the confirmation mail and on the link's pages. */
export const NEWSLETTER_TOPIC_LABELS: Readonly<Record<NewsletterTopic, string>> = Object.freeze({
	general: "The Projective newsletter",
	changelog: "Release notes",
});

/**
 * The shortest gap between two confirmation mails to one address, in minutes: the writer's
 * `interval '10 minutes'`. A repeat inside it stores the request and mails nothing, so the public
 * form cannot flood an inbox.
 */
export const NEWSLETTER_RESEND_AFTER_MINUTES = 10;

/**
 * How long a confirmation link works after its mail, in days: the confirm door's
 * `interval '7 days'`. An older link answers "expired", and subscribing again mails a fresh one.
 */
export const NEWSLETTER_LINK_TTL_DAYS = 7;

/**
 * Where the mailed link leads. The pages render and write nothing (a mail scanner opens every link);
 * their one button posts to the endpoint beside them. A mail client's RFC 8058 one-click POST goes to
 * the unsubscribe endpoint directly, which is why the `List-Unsubscribe` header names it.
 */
export const NEWSLETTER_PATHS = Object.freeze({
	confirmPage: "/newsletter/confirm",
	unsubscribePage: "/newsletter/unsubscribe",
	confirmEndpoint: "/api/newsletter/confirm",
	unsubscribeEndpoint: "/api/newsletter/unsubscribe",
});

/**
 * What a subscribe did, as `community.subscribe_newsletter` reports it: `created` (a new address,
 * unconfirmed), `resubscribed` (an unsubscribed address: the request is recorded as pending, and the
 * opt-out stands until the confirm link applies it), `topic_added` (an unconfirmed address gained
 * the topic, which its first confirmation covers), `topic_pending` (a confirmed address asked for a
 * new topic: it waits for its own confirmation, Decision #274 flag (c)) or `unchanged` (it already
 * held it — nothing was written).
 */
export const NewsletterSubscribeOutcome = z.enum([
	"created",
	"resubscribed",
	"topic_added",
	"topic_pending",
	"unchanged",
]);
export type NewsletterSubscribeOutcome = z.infer<typeof NewsletterSubscribeOutcome>;
// #endregion

// #region Request / response contracts
/**
 * A newsletter opt-in submission. `source` defaults to the global footer capture and `topic` to the
 * platform newsletter, so a body carrying only `email` subscribes exactly as it always did.
 * `captchaToken` is the Turnstile token the form's widget produced (action `newsletter`); whether
 * one is required is the verifier's decision, never the schema's (`auth/captcha.ts`).
 */
export const NewsletterSubscribeSchema = z.object({
	email,
	source: NewsletterSource.default("footer"),
	topic: NewsletterTopic.default("general"),
	captchaToken: CaptchaTokenSchema,
});
export type NewsletterSubscribe = z.infer<typeof NewsletterSubscribeSchema>;

/**
 * The success payload the `/api/newsletter/subscribe` route returns. The same for every address,
 * whatever it already held and whether a mail went out: the answer never says whether an address is
 * on the list (no enumeration).
 */
export interface NewsletterSubscribeResult {
	/** Echoed (normalised) address, so the UI can confirm exactly what was captured. */
	email: string;
	/** The topic this submission asked for. */
	topic: NewsletterTopic;
}

/** The mailed link's credential: the row's `token`, a UUID. */
export const NewsletterTokenSchema = uuid;

/** Why an address left the list, as `community.unsubscribe_newsletter` accepts it. */
export const NewsletterUnsubscribeReason = z.enum(["link", "one_click"]);
export type NewsletterUnsubscribeReason = z.infer<typeof NewsletterUnsubscribeReason>;

/** What a press of Confirm came to (`community.confirm_newsletter`). */
export const NewsletterConfirmOutcome = z.enum([
	"confirmed",
	"already_confirmed",
	"expired",
	"unsubscribed",
	"not_found",
]);
export type NewsletterConfirmOutcome = z.infer<typeof NewsletterConfirmOutcome>;

/** What an unsubscribe came to (`community.unsubscribe_newsletter`). */
export const NewsletterUnsubscribeOutcome = z.enum([
	"unsubscribed",
	"already_unsubscribed",
	"not_found",
]);
export type NewsletterUnsubscribeOutcome = z.infer<typeof NewsletterUnsubscribeOutcome>;

/**
 * What the mailed link's pages show for a token: the address's standing, never the address.
 * `pendingTopics` is what Confirm would apply (null when nothing awaits), and `expired` says Confirm
 * would refuse it because the link's mail is more than {@link NEWSLETTER_LINK_TTL_DAYS} days old.
 */
export interface NewsletterLinkView {
	/** Confirmed and not unsubscribed: mail is sent to this address. */
	subscribed: boolean;
	/** The address has left the list. */
	unsubscribed: boolean;
	/** The topics the address holds. */
	topics: NewsletterTopic[];
	/** What Confirm would apply, or null. */
	pendingTopics: NewsletterTopic[] | null;
	/** Confirm would refuse the pending topics: the link is too old. */
	expired: boolean;
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
	/** A confirmation mail is due now; the service sends it once the write has committed. */
	confirmation_due: z.boolean(),
	/** The link's credential, present only when the mail is due. Never leaves the server. */
	token: uuid.nullable(),
	/** The topics the mail asks the owner to confirm, present only when the mail is due. */
	confirm_topics: z.array(NewsletterTopic).min(1).nullable(),
});
export type NewsletterSubscribeRpcResult = z.infer<typeof NewsletterSubscribeRpcResultSchema>;

/** The JSON `community.read_newsletter_link` returns; null for an unknown token. */
export const NewsletterLinkRpcResultSchema = z.object({
	subscribed: z.boolean(),
	unsubscribed: z.boolean(),
	topics: z.array(NewsletterTopic).min(1),
	pending_topics: z.array(NewsletterTopic).min(1).nullable(),
	expired: z.boolean(),
}).nullable();
export type NewsletterLinkRpcResult = z.infer<typeof NewsletterLinkRpcResultSchema>;

/** The JSON `community.confirm_newsletter` returns: the outcome and the topics now held. */
export const NewsletterConfirmRpcResultSchema = z.object({
	outcome: NewsletterConfirmOutcome,
	topics: z.array(NewsletterTopic),
});
export type NewsletterConfirmRpcResult = z.infer<typeof NewsletterConfirmRpcResultSchema>;

/** The JSON `community.unsubscribe_newsletter` returns. */
export const NewsletterUnsubscribeRpcResultSchema = z.object({
	outcome: NewsletterUnsubscribeOutcome,
});
export type NewsletterUnsubscribeRpcResult = z.infer<typeof NewsletterUnsubscribeRpcResultSchema>;

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
	 * Topics pending their owner's confirmation — on an unsubscribed address (a re-subscribe) or a
	 * confirmed one (a new topic), sorted, distinct and never empty; NULL when nothing is pending.
	 * Applied by the confirm link, never by the public form.
	 */
	resubscribe_topics: z.array(NewsletterTopic).min(1).nullable(),
	resubscribe_requested_at: timestamp.nullable(),
	/** When the last confirmation mail went to the mailer; NULL when none has. */
	confirmation_sent_at: timestamp.nullable(),
	token: uuid,
	created_at: timestamp,
	updated_at: timestamp,
});
export type NewsletterSubscriptionRow = z.infer<typeof NewsletterSubscriptionRowSchema>;
// #endregion
