import {
	CONTACT_INTENTS,
	type ContactIntent,
	DEFAULT_CONTACT_INTENT,
	parseContactIntent,
} from "@projective/types/contact";

/**
 * contact-url — `/contact`'s URL contract (Decision #276). The intent is URL state
 * (`?intent=sales|support|dispute|security`, default `support`) so every variant is a shareable
 * link, and the no-JS form's outcome comes back as query state too (`?sent=1`, or `?error=` with the
 * fields to mark). Pure and isomorphic: the page controller parses with it, the island writes with it
 * (`history.replaceState`), and the no-JS intent switcher's links are built by it.
 */

/** The page's path. */
export const CONTACT_PATH = "/contact";

/** Why a no-JS submission came back. */
export type ContactFormError = "invalid" | "rate_limited" | "sign_in" | "unavailable";
const FORM_ERRORS: readonly ContactFormError[] = [
	"invalid",
	"rate_limited",
	"sign_in",
	"unavailable",
];

/** What the page reads from its URL. */
export interface ContactUrlState {
	intent: ContactIntent;
	/** The no-JS form came back successful (the receipt itself rides in a cookie). */
	sent: boolean;
	/** The no-JS form came back refused, and why. */
	error: ContactFormError | null;
	/** The fields that refusal named, to mark invalid. */
	fields: string[];
}

/** The fields a no-JS refusal may name — anything else in `?fields=` is ignored. */
const KNOWN_FIELDS = new Set([
	"name",
	"email",
	"company",
	"companySize",
	"budget",
	"accountEmail",
	"topic",
	"engagementSlug",
	"referenceId",
	"reportType",
	"message",
	"attachmentIds",
]);

/** Parse `/contact`'s query. Total: an unknown value reads as its default. */
export function parseContactUrl(url: URL): ContactUrlState {
	const q = url.searchParams;
	const rawError = q.get("error");
	const error = FORM_ERRORS.includes(rawError as ContactFormError)
		? rawError as ContactFormError
		: null;
	const fields = (q.get("fields") ?? "").split(",").map((f) => f.trim()).filter((f) =>
		KNOWN_FIELDS.has(f)
	);
	return {
		intent: parseContactIntent(q.get("intent")),
		sent: q.get("sent") === "1" && error === null,
		error,
		fields: error ? fields : [],
	};
}

/** The address of one intent's form — the default intent is still spelled out, so a link is explicit. */
export function contactHref(intent: ContactIntent, extra: Record<string, string> = {}): string {
	const q = new URLSearchParams({ intent, ...extra });
	return `${CONTACT_PATH}?${q.toString()}`;
}

/** Where a refused no-JS submission returns to. */
export function contactErrorHref(
	intent: ContactIntent,
	error: ContactFormError,
	fields: readonly string[] = [],
): string {
	const known = fields.filter((f) => KNOWN_FIELDS.has(f));
	return contactHref(intent, known.length > 0 ? { error, fields: known.join(",") } : { error });
}

/** Where a successful no-JS submission returns to. */
export function contactSentHref(intent: ContactIntent): string {
	return contactHref(intent, { sent: "1" });
}

/** The sign-in link the dispute intent offers a guest, returning them to the dispute form. */
export function contactLoginHref(intent: ContactIntent = "dispute"): string {
	return `/login?redirectTo=${encodeURIComponent(contactHref(intent))}`;
}

/** Every intent's address, in switcher order (for the no-JS links and the sitemap). */
export function contactIntentHrefs(): Array<{ intent: ContactIntent; href: string }> {
	return CONTACT_INTENTS.map((intent) => ({ intent, href: contactHref(intent) }));
}

export { DEFAULT_CONTACT_INTENT };
