import { CONTACT_INTENTS, type ContactIntent } from "@projective/types/contact";

/**
 * contact-copy — every word `/contact` shows that is not a field label (Decision #276): the four
 * intents' names and one-line descriptions, each form's legend and commit, the reply targets, the
 * entity facts and the "what happens next" steps. One module, so the switcher, the form, the rail,
 * the confirmation and the JSON-LD cannot disagree about what an intent is called or how fast it is
 * answered. Pure and CSS-free.
 *
 * The reply targets are TARGETS, phrased as such ("we aim to"), not a measured service level: there
 * is no support-desk data to state one from. They and the entity facts are the owner's to confirm
 * (Decision #276 flags); the facts are `XXXX-XXXX` until they are supplied, never invented.
 */

/** What one intent is called and promises. */
export interface IntentCopy {
	/** The switcher's label. */
	label: string;
	/** The switcher's one-line description. */
	description: string;
	/** The form's legend. */
	legend: string;
	/** The submit button. */
	submit: string;
	/** The rail's short reply target. */
	replyTarget: string;
	/** The confirmation's sentence about who reads it. */
	readBy: string;
	/** schema.org `contactType` for the Organization's `contactPoint`. */
	contactType: string;
}

/** The four intents' words, in switcher order. */
export const INTENT_COPY: Readonly<Record<ContactIntent, IntentCopy>> = {
	sales: {
		label: "Sales",
		description: "Plans, pricing and bringing a team on",
		legend: "Tell us about your team",
		submit: "Send to sales",
		replyTarget: "We aim to reply within 1 business day",
		readBy: "Someone on our sales team will read it",
		contactType: "sales",
	},
	support: {
		label: "Support",
		description: "Help with your account or a project",
		legend: "What do you need help with?",
		submit: "Send to support",
		replyTarget: "We aim to reply within 2 business days",
		readBy: "Someone on our support team will read it",
		contactType: "customer support",
	},
	dispute: {
		label: "Dispute",
		description: "A problem with an engagement or a payment",
		legend: "Tell us what went wrong",
		submit: "Send to our disputes team",
		replyTarget: "We aim to reply within 2 business days",
		readBy: "Someone on our disputes team will read it",
		contactType: "dispute resolution",
	},
	security: {
		label: "Security",
		description: "Report a vulnerability, abuse or wrongdoing",
		legend: "Report a security concern",
		submit: "Send report",
		replyTarget: "We aim to acknowledge it within 3 business days",
		readBy: "Our security team will read it",
		contactType: "security",
	},
};

/** The switcher's options (label + description), in order. */
export function intentOptions(): Array<
	{ value: ContactIntent; label: string; description: string }
> {
	return CONTACT_INTENTS.map((intent) => ({
		value: intent,
		label: INTENT_COPY[intent].label,
		description: INTENT_COPY[intent].description,
	}));
}

/** One verified-entity fact the rail lists. */
export interface EntityFact {
	term: string;
	value: string;
}

/** The placeholder every unsupplied entity fact shows (root CLAUDE.md §6 zero-trust placeholders). */
export const ENTITY_PLACEHOLDER = "XXXX-XXXX";

/** The legal entity behind Projective — placeholders until the owner supplies them. */
export const ENTITY_FACTS: readonly EntityFact[] = [
	{ term: "Legal name", value: ENTITY_PLACEHOLDER },
	{ term: "Company number", value: ENTITY_PLACEHOLDER },
	{ term: "Registered address", value: ENTITY_PLACEHOLDER },
	{ term: "Support hours", value: ENTITY_PLACEHOLDER },
];

/**
 * The Projective sales profile whose availability the discovery-call flow would book against
 * (`/:handle` → the call offer, Decision #80). `null` until one exists: none is in the seed, so the
 * "Book a discovery call" control renders disabled with {@link BOOKING_UNAVAILABLE_REASON}.
 */
export const PROJECTIVE_SALES_HANDLE: string | null = null;

/** Why the discovery call cannot be booked yet — shown beside the disabled control. */
export const BOOKING_UNAVAILABLE_REASON =
	"Calls with our sales team can't be booked here yet. Send this form and we'll offer you times.";

/** The note under a security report about responsible disclosure. */
export const DISCLOSURE_NOTE =
	"Please give us a reasonable time to fix a vulnerability before you share it, and don't access, " +
	"change or delete data that isn't yours while testing.";

/**
 * Where the answer to a request goes: a known address (the island knows what was typed), the address
 * the sender gave (the no-JS road carries only the reference and intent home, never the address), or
 * nowhere — an anonymous report has no reply address.
 */
export type ReceiptReply =
	| { kind: "address"; email: string }
	| { kind: "given" }
	| { kind: "none" };

/** The confirmation's "what happens next", for the request just sent. */
export function nextSteps(
	intent: ContactIntent,
	reference: string,
	reply: ReceiptReply,
): string[] {
	const copy = INTENT_COPY[intent];
	if (reply.kind === "none") {
		return [
			`${copy.readBy}. ${copy.replyTarget}.`,
			"An anonymous report has no reply address, so we can't write back or ask you anything.",
			`If you want an answer later, send a new report with an address and mention ${reference}.`,
		];
	}
	return [
		`${copy.readBy}. ${copy.replyTarget}.`,
		reply.kind === "address"
			? `We'll write to ${reply.email} and quote ${reference}.`
			: `We'll write to the address you gave and quote ${reference}.`,
		`To add something, send another request and mention ${reference}.`,
	];
}
