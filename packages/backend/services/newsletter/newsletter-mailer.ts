import type { EmailDeliveryOutcome } from "@projective/types/org";
import {
	NEWSLETTER_LINK_TTL_DAYS,
	NEWSLETTER_PATHS,
	NEWSLETTER_TOPIC_LABELS,
	type NewsletterTopic,
} from "@projective/types/community";
import { deliverMail, type MailerDeps, type MailMessage } from "../mail/transport.ts";

/**
 * newsletter-mailer — the confirmation mail of the newsletter's double opt-in (PRD-E11). How it
 * leaves, and what the caller is told, is `../mail/transport.ts`: the requester's own transactional
 * mail, never the notification dispatcher, because the address has no account.
 *
 * The message carries exactly what its builder is handed: the address it goes to, the topics to
 * confirm and the link's token. Nothing else of the subscription row (its source, locale, history)
 * can reach it. Every newsletter mail carries the RFC 8058 pair, so a mail client can offer one-click
 * unsubscribe; the token is the credential both links carry.
 */

// #region Links
/** The subject every confirmation mail has. */
export const NEWSLETTER_CONFIRM_SUBJECT = "Confirm your Projective newsletter subscription";

/** The two absolute links a newsletter mail carries for one token. */
export interface NewsletterLinks {
	/** The confirm page (`GET` renders the Confirm button; nothing is spent). */
	confirm: string;
	/** The one-click endpoint (`POST` unsubscribes; `GET` forwards to the unsubscribe page). */
	unsubscribe: string;
}

/** Build both links for `token` on the given app origin. */
export function newsletterLinks(appUrl: string, token: string): NewsletterLinks {
	const base = appUrl.replace(/\/+$/, "");
	const query = `?token=${encodeURIComponent(token)}`;
	return {
		confirm: `${base}${NEWSLETTER_PATHS.confirmPage}${query}`,
		unsubscribe: `${base}${NEWSLETTER_PATHS.unsubscribeEndpoint}${query}`,
	};
}

/** The RFC 8058 header pair: a one-click POST to `unsubscribeUrl` with `List-Unsubscribe=One-Click`. */
export function listUnsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
	return {
		"List-Unsubscribe": `<${unsubscribeUrl}>`,
		"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
	};
}

/** Topic labels as one phrase: "A", "A and B", "A, B and C". */
export function topicPhrase(topics: readonly NewsletterTopic[]): string {
	const labels = topics.map((topic) => NEWSLETTER_TOPIC_LABELS[topic]);
	if (labels.length <= 1) return labels[0] ?? "";
	return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
// #endregion

// #region Message
/** The confirmation message for one address. */
export function newsletterConfirmationMessage(
	to: string,
	topics: readonly NewsletterTopic[],
	links: NewsletterLinks,
): MailMessage {
	return {
		to,
		subject: NEWSLETTER_CONFIRM_SUBJECT,
		text: [
			`Please confirm you'd like Projective to email you about: ${topicPhrase(topics)}.`,
			"",
			`Confirm your subscription (the link works for ${NEWSLETTER_LINK_TTL_DAYS} days):`,
			links.confirm,
			"",
			"Didn't ask for this? Ignore this email and nothing more will be sent.",
		].join("\n"),
		headers: listUnsubscribeHeaders(links.unsubscribe),
	};
}
// #endregion

// #region Send
/** What {@link sendNewsletterConfirmation} needs: the address, the topics to confirm, the token. */
export interface NewsletterConfirmationMail {
	to: string;
	token: string;
	topics: readonly NewsletterTopic[];
	appUrl: string;
}

/** Mail the confirmation link to `mail.to`, and say how it left. Never throws. */
export function sendNewsletterConfirmation(
	mail: NewsletterConfirmationMail,
	deps: Partial<MailerDeps> = {},
): Promise<EmailDeliveryOutcome> {
	const links = newsletterLinks(mail.appUrl, mail.token);
	return deliverMail(
		newsletterConfirmationMessage(mail.to, mail.topics, links),
		"newsletter confirmation",
		`[dev mail] Confirm the newsletter for ${mail.to} -> ${links.confirm}`,
		deps,
	);
}
// #endregion
