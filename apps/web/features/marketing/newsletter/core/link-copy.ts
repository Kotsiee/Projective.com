import {
	NEWSLETTER_LINK_TTL_DAYS,
	NEWSLETTER_PATHS,
	NEWSLETTER_TOPIC_LABELS,
	type NewsletterLinkView,
	type NewsletterTopic,
} from "@projective/types/community";
import {
	NEWSLETTER_FORM_ANCHOR,
	type NewsletterLinkMode,
	newsletterPageHref,
} from "./newsletter-link.ts";

/**
 * link-copy — what each newsletter link page says, decided once from the address's standing (PRD-E11).
 * Pure, so every state is unit-tested without rendering. A page offers at most one button (a POST),
 * and a link only where it leads somewhere real: the footer's subscribe form, or the other page.
 */

// #region Types
/** Why a page has no standing to show. */
export type NewsletterLinkFailure = "not_found" | "unavailable";

/** What a page handler hands its island. */
export interface NewsletterLinkPageData {
	mode: NewsletterLinkMode;
	/** The link's token, carried through unspent; null when the page has no standing to act on. */
	token: string | null;
	view: NewsletterLinkView | null;
	failure: NewsletterLinkFailure | null;
	/** The last press of Confirm was throttled. */
	throttled: boolean;
}

/** One page's words and controls. */
export interface NewsletterLinkCopy {
	title: string;
	lede: string;
	/** The topics in question, in the body register; null when none are. */
	topics: string | null;
	/** The page's one button: a form POST of the token to `endpoint`. */
	action: { label: string; busyLabel: string; endpoint: string } | null;
	/** One plain link: to the subscribe form or to the other page. */
	link: { label: string; href: string } | null;
	/** A quiet line under the button. */
	aside: string | null;
}
// #endregion

// #region Copy
/** Topic labels as one middot line, in the set's stored order. */
export function topicLine(topics: readonly NewsletterTopic[]): string {
	return topics.map((topic) => NEWSLETTER_TOPIC_LABELS[topic]).join(" · ");
}

const SUBSCRIBE_AGAIN = { label: "Subscribe again", href: NEWSLETTER_FORM_ANCHOR } as const;

function failureCopy(failure: NewsletterLinkFailure): NewsletterLinkCopy {
	return failure === "not_found"
		? {
			title: "We couldn't find this link",
			lede:
				"It may be incomplete. Try opening it from the email again, or subscribe with the form at the foot of this page.",
			topics: null,
			action: null,
			link: { label: "Subscribe", href: NEWSLETTER_FORM_ANCHOR },
			aside: null,
		}
		: {
			title: "We couldn't check this link just now",
			lede: "Nothing has changed. Please open it again in a minute.",
			topics: null,
			action: null,
			link: null,
			aside: null,
		};
}

function confirmCopy(view: NewsletterLinkView, token: string | null): NewsletterLinkCopy {
	if (view.pendingTopics && !view.expired) {
		return {
			title: "Confirm your subscription",
			lede: "Press Confirm and Projective will email you about:",
			topics: topicLine(view.pendingTopics),
			action: {
				label: "Confirm subscription",
				busyLabel: "Confirming…",
				endpoint: NEWSLETTER_PATHS.confirmEndpoint,
			},
			link: null,
			aside: "Didn't ask for this? Close this page and nothing will be sent.",
		};
	}
	if (view.pendingTopics) {
		return {
			title: "This link has expired",
			lede:
				`Confirmation links work for ${NEWSLETTER_LINK_TTL_DAYS} days. Subscribe again and we'll email you a fresh one.`,
			topics: null,
			action: null,
			link: SUBSCRIBE_AGAIN,
			aside: null,
		};
	}
	if (view.subscribed) {
		return {
			title: "You're subscribed",
			lede: "Projective will email you about:",
			topics: topicLine(view.topics),
			action: null,
			link: { label: "Unsubscribe", href: newsletterPageHref("unsubscribe", token) },
			aside: null,
		};
	}
	return {
		title: "You've unsubscribed",
		lede: "Projective won't email this address. Changed your mind?",
		topics: null,
		action: null,
		link: SUBSCRIBE_AGAIN,
		aside: null,
	};
}

function unsubscribeCopy(view: NewsletterLinkView): NewsletterLinkCopy {
	const action = (label: string) => ({
		label,
		busyLabel: "Unsubscribing…",
		endpoint: NEWSLETTER_PATHS.unsubscribeEndpoint,
	});
	if (!view.unsubscribed) {
		const held = view.subscribed ? view.topics : [];
		const all = [...new Set([...held, ...(view.pendingTopics ?? [])])].sort();
		return {
			title: "Unsubscribe from Projective emails?",
			lede: "This address will stop getting:",
			topics: topicLine(all),
			action: action("Unsubscribe"),
			link: null,
			aside: "You can subscribe again at any time.",
		};
	}
	if (view.pendingTopics) {
		return {
			title: "You've unsubscribed",
			lede:
				"A request to subscribe this address again is waiting for confirmation. Cancel it to stay unsubscribed.",
			topics: topicLine(view.pendingTopics),
			action: action("Cancel the request"),
			link: null,
			aside: null,
		};
	}
	return {
		title: "You're unsubscribed",
		lede: "Projective won't email this address again unless it subscribes and confirms.",
		topics: null,
		action: null,
		link: null,
		aside: null,
	};
}

/** The words and controls for one page. */
export function newsletterLinkCopy(data: NewsletterLinkPageData): NewsletterLinkCopy {
	if (data.failure || !data.view) return failureCopy(data.failure ?? "not_found");
	return data.mode === "confirm" ? confirmCopy(data.view, data.token) : unsubscribeCopy(data.view);
}
// #endregion
