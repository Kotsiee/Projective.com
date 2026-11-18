import type { EmailDeliveryOutcome } from "@projective/types/org";
import {
	NEWSLETTER_LINK_TTL_DAYS,
	NEWSLETTER_PARAM_KEYS,
	NEWSLETTER_PATHS,
	NEWSLETTER_TOPIC_LABELS,
	type NewsletterTopic,
} from "@projective/types/community";
import {
	configuredTransport,
	deliverMail,
	type MailerDeps,
	type MailMessage,
	type MailTransport,
	resendTransport,
} from "../mail/transport.ts";
import { serverEnv } from "../../core/env.ts";
import { getServiceClient } from "../../core/supabase.ts";

/**
 * newsletter-mailer — the confirmation mail of the newsletter's double opt-in (PRD-E11). How it
 * leaves, and what the caller is told, is `../mail/transport.ts`: the requester's own transactional
 * mail, never the notification dispatcher, because the address has no account.
 *
 * The message carries exactly what its builder is handed: the address it goes to, the topics to
 * confirm and the link's token. Nothing else of the subscription row (its source, locale, history)
 * can reach it. Every newsletter mail carries the RFC 8058 pair, so a mail client can offer one-click
 * unsubscribe; the token is the credential both links carry.
 *
 * **The sender (Decision #480 (a), PRD-E14).** Newsletter mail leaves from its own subdomain
 * (providers spec §8.5 setup 1), so a complaint about an unwanted confirmation lands on `news.`, never
 * on the `notify.` subdomain that carries password resets. The address is the platform param
 * `newsletter_mail_from`, set per environment once `news.<domain>` is verified; while it is unset or
 * not an address, the mail falls back to `MAIL_FROM` and says so once in the log.
 */

// #region Sender
/** `Name <local@domain>` or a bare `local@domain`: one address, no header injection. */
const SENDER_RE =
	/^(?:[^<>\r\n"]{1,80} <[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/;

/** Whether `value` is a sender a provider will take as `from`. */
export function isNewsletterSender(value: unknown): value is string {
	return typeof value === "string" && SENDER_RE.test(value.trim());
}

const SENDER_TTL_MS = 60_000;
let senderCache: { value: string | null; at: number } | null = null;
let warnedFallback = false;

/** `newsletter_mail_from`, reused for a minute; null when unset, unreadable or not an address. */
export async function newsletterSender(
	read: () => PromiseLike<{ data: unknown; error: unknown }> = () =>
		getServiceClient().schema("security").from("platform_params").select("value")
			.eq("key", NEWSLETTER_PARAM_KEYS.mailFrom).maybeSingle(),
	now: number = Date.now(),
): Promise<string | null> {
	if (senderCache && now - senderCache.at < SENDER_TTL_MS) return senderCache.value;
	let value: string | null = null;
	try {
		const { data, error } = await read();
		const raw = (data as { value?: unknown } | null)?.value;
		value = !error && isNewsletterSender(raw) ? raw.trim() : null;
	} catch {
		value = null;
	}
	senderCache = { value, at: now };
	return value;
}

/**
 * The transport newsletter mail leaves through: Resend from the newsletter's own sender, else the
 * environment's transport (`MAIL_FROM`), else none.
 */
export async function newsletterTransport(
	sender: () => Promise<string | null> = () => newsletterSender(),
	warn: (line: string) => void = (line) => console.warn(line),
): Promise<MailTransport | null> {
	const { resendApiKey } = serverEnv();
	if (!resendApiKey?.startsWith("re_")) return configuredTransport();
	const from = await sender();
	if (from) return resendTransport(resendApiKey, from);
	if (!warnedFallback) {
		warnedFallback = true;
		warn("[newsletter] newsletter_mail_from is not set: newsletter mail leaves from MAIL_FROM");
	}
	return configuredTransport();
}
// #endregion

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

/**
 * Mail the confirmation link to `mail.to` from the newsletter's sender, and say how it left. Never
 * throws. A `transport` in `deps` (tests) is used as given.
 */
export async function sendNewsletterConfirmation(
	mail: NewsletterConfirmationMail,
	deps: Partial<MailerDeps> = {},
): Promise<EmailDeliveryOutcome> {
	const links = newsletterLinks(mail.appUrl, mail.token);
	const transport = "transport" in deps
		? deps.transport
		: await newsletterTransport().catch(() => null);
	return deliverMail(
		newsletterConfirmationMessage(mail.to, mail.topics, links),
		"newsletter confirmation",
		`[dev mail] Confirm the newsletter for ${mail.to} -> ${links.confirm}`,
		{ ...deps, transport: transport ?? null },
	);
}
// #endregion
