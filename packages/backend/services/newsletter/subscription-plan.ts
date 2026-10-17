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
}

/** The decision: the outcome, the topic set to store, and whether anything is written. */
export interface SubscriptionPlan {
	outcome: NewsletterSubscribeOutcome;
	/** The topics the row holds afterwards. */
	topics: NewsletterTopic[];
	/** Whether the row is inserted or updated (false only for `unchanged`). */
	writes: boolean;
	/** Whether the double opt-in must be (re)done — true for a new or reopened address. */
	needsConfirmation: boolean;
	/** True exactly when nothing changed: the address already held this topic. */
	alreadySubscribed: boolean;
}
// #endregion

// #region Decision
/** A topic set in the stored form: distinct and sorted (codepoint order, as `ORDER BY` on ASCII). */
export function normalizeTopics(topics: readonly NewsletterTopic[]): NewsletterTopic[] {
	return [...new Set(topics)].sort();
}

/**
 * Decide a subscribe of `topic` against the address's current subscription (`null` when there is
 * none):
 *
 *  - none            → `created`, holding only `topic`;
 *  - unsubscribed    → `resubscribed`, holding only `topic` (the old topics were withdrawn with the
 *                      unsubscribe), and the double opt-in starts again;
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
			writes: true,
			needsConfirmation: true,
			alreadySubscribed: false,
		};
	}
	if (existing.unsubscribedAt !== null) {
		return {
			outcome: "resubscribed",
			topics: [topic],
			writes: true,
			needsConfirmation: true,
			alreadySubscribed: false,
		};
	}
	if (existing.topics.includes(topic)) {
		return {
			outcome: "unchanged",
			topics: normalizeTopics(existing.topics),
			writes: false,
			needsConfirmation: false,
			alreadySubscribed: true,
		};
	}
	return {
		outcome: "topic_added",
		topics: normalizeTopics([...existing.topics, topic]),
		writes: true,
		needsConfirmation: false,
		alreadySubscribed: false,
	};
}
// #endregion
