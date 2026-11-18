import type { NewsletterSubscribeOutcome, NewsletterTopic } from "@projective/types/community";

/**
 * subscription-plan.ts — what a newsletter subscribe does to an address's subscription: the pure
 * TypeScript twin of `community.subscribe_newsletter` (00001320, Decision #274).
 *
 * The database function is the authority — it runs this decision under a row lock — and this twin
 * exists so the rule is stated where it can be unit-tested without a database. (The stub path no
 * longer needs it: every subscribe now answers the same public success, PRD-E11.) The
 * probes `supabase/probes/community_editorial_schemas.sql` and `newsletter_double_opt_in.sql` pin the
 * same five outcomes in SQL; a change to one side is a change to both. Whether a confirmation mail is
 * due also needs the last mail's time and the suppression list, so only the SQL decides that.
 */

// #region Types
/** The part of a stored subscription the decision reads. */
export interface ExistingSubscription {
	/** The topics held — sorted and distinct, as the writer stores them. */
	topics: readonly NewsletterTopic[];
	/** Set when the address left the list. */
	unsubscribedAt: string | null;
	/** Set once the owner confirmed through the mailed link; null (or absent) while unconfirmed. */
	confirmedAt?: string | null;
	/**
	 * Topics already pending confirmation (on an unsubscribed or a confirmed address); else null.
	 */
	resubscribeTopics?: readonly NewsletterTopic[] | null;
}

/** The decision: the outcome, what the row holds afterwards, and whether anything is written. */
export interface SubscriptionPlan {
	outcome: NewsletterSubscribeOutcome;
	/**
	 * The topics the row holds afterwards. A `resubscribed` row keeps the topics it was unsubscribed
	 * with: the request is pending, so nothing is sent to any of them.
	 */
	topics: NewsletterTopic[];
	/**
	 * The topics pending afterwards in `resubscribe_topics` (sorted, distinct), or null when none
	 * are: a `resubscribed` or `topic_pending` plan records one. The confirm link applies it, never
	 * the public form.
	 */
	resubscribeTopics: NewsletterTopic[] | null;
	/** Whether the row is inserted or updated (false only for `unchanged`). */
	writes: boolean;
	/**
	 * Whether something awaits the owner's confirmation afterwards (`fn_newsletter_pending_topics`
	 * is not NULL): an unconfirmed address, a re-subscribe request, or a new topic on a confirmed
	 * address. Nothing it covers is sent until then.
	 */
	needsConfirmation: boolean;
	/** True exactly when nothing changed: the address already held this topic. */
	alreadySubscribed: boolean;
}
// #endregion

// #region Decision
/**
 * A topic set in the stored form: distinct and sorted by code point — the order the writer's
 * `ORDER BY … COLLATE "C"` produces.
 */
export function normalizeTopics(topics: readonly NewsletterTopic[]): NewsletterTopic[] {
	return [...new Set(topics)].sort();
}

/**
 * Decide a subscribe of `topic` against the address's current subscription (`null` when there is
 * none):
 *
 *  - none            → `created`, holding only `topic`, unconfirmed;
 *  - unsubscribed    → `resubscribed`: `topic` joins the pending request and NOTHING else changes —
 *                      the opt-out (its time and reason) stays on record and the row stays unsendable
 *                      until the owner confirms through the link sent to the address;
 *  - holds `topic`   → `unchanged` — nothing is written, and `alreadySubscribed` is true;
 *  - confirmed       → `topic_pending`: `topic` joins the pending request, and the address keeps
 *                      receiving what it already holds (each topic is consented to on its own);
 *  - otherwise       → `topic_added`, `topic` joining the set its first confirmation covers.
 */
export function planNewsletterSubscription(
	existing: ExistingSubscription | null,
	topic: NewsletterTopic,
): SubscriptionPlan {
	if (!existing) {
		return {
			outcome: "created",
			topics: [topic],
			resubscribeTopics: null,
			writes: true,
			needsConfirmation: true,
			alreadySubscribed: false,
		};
	}
	if (existing.unsubscribedAt !== null) {
		return {
			outcome: "resubscribed",
			topics: normalizeTopics(existing.topics),
			resubscribeTopics: normalizeTopics([...(existing.resubscribeTopics ?? []), topic]),
			writes: true,
			needsConfirmation: true,
			alreadySubscribed: false,
		};
	}
	const confirmed = (existing.confirmedAt ?? null) !== null;
	const pending = existing.resubscribeTopics?.length
		? normalizeTopics(existing.resubscribeTopics)
		: null;
	if (existing.topics.includes(topic)) {
		return {
			outcome: "unchanged",
			topics: normalizeTopics(existing.topics),
			resubscribeTopics: pending,
			writes: false,
			needsConfirmation: !confirmed || pending !== null,
			alreadySubscribed: true,
		};
	}
	if (confirmed) {
		return {
			outcome: "topic_pending",
			topics: normalizeTopics(existing.topics),
			resubscribeTopics: normalizeTopics([...(pending ?? []), topic]),
			writes: true,
			needsConfirmation: true,
			alreadySubscribed: false,
		};
	}
	return {
		outcome: "topic_added",
		topics: normalizeTopics([...existing.topics, topic]),
		resubscribeTopics: null,
		writes: true,
		needsConfirmation: true,
		alreadySubscribed: false,
	};
}
// #endregion
