import type { NewsletterSubscribeOutcome, NewsletterTopic } from "@projective/types/community";

/**
 * subscription-plan.ts — what a newsletter subscribe does to an address's subscription: the pure
 * TypeScript twin of `community.subscribe_newsletter` (00001320, Decision #274).
 *
 * The database function is the authority — it runs this decision under a row lock — and this twin
 * exists so the rule is stated where it can be unit-tested without a database, and so the stub path
 * (`NEWSLETTER_BACKEND_LIVE` off) answers exactly what the live path would for a new address. The
 * probe `supabase/probes/community_editorial_schemas.sql` pins the same four outcomes in SQL; a
 * change to one side is a change to both.
 */

// #region Types
/** The part of a stored subscription the decision reads. */
export interface ExistingSubscription {
	/** The topics held — sorted and distinct, as the writer stores them. */
	topics: readonly NewsletterTopic[];
	/** Set when the address left the list. */
	unsubscribedAt: string | null;
	/** A re-subscribe request already pending confirmation (only while unsubscribed); else null. */
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
	 * The re-subscribe request pending afterwards (sorted, distinct), or null when none is. Only a
	 * `resubscribed` plan has one; the confirm link applies it, never the public form.
	 */
	resubscribeTopics: NewsletterTopic[] | null;
	/** Whether the row is inserted or updated (false only for `unchanged`). */
	writes: boolean;
	/**
	 * Whether the address's owner must confirm before anything is sent — true for a new address and
	 * for a re-subscribe request, whose opt-out stands until then.
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
 *  - none            → `created`, holding only `topic`;
 *  - unsubscribed    → `resubscribed`: `topic` joins the pending request and NOTHING else changes —
 *                      the opt-out (its time and reason) stays on record and the row stays unsendable
 *                      until the owner confirms through the link sent to the address;
 *  - holds `topic`   → `unchanged` — nothing is written, and `alreadySubscribed` is true;
 *  - otherwise       → `topic_added`, `topic` joining the set.
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
	if (existing.topics.includes(topic)) {
		return {
			outcome: "unchanged",
			topics: normalizeTopics(existing.topics),
			resubscribeTopics: null,
			writes: false,
			needsConfirmation: false,
			alreadySubscribed: true,
		};
	}
	return {
		outcome: "topic_added",
		topics: normalizeTopics([...existing.topics, topic]),
		resubscribeTopics: null,
		writes: true,
		needsConfirmation: false,
		alreadySubscribed: false,
	};
}
// #endregion
