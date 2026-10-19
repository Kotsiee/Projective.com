import { z } from "zod";
import { HELP_CENTRE_CATEGORY_SLUGS } from "../editorial/help-categories.ts";
import { isStorableText, UNSTORABLE_TEXT_MESSAGE } from "../content/text.ts";

/**
 * contact.intake — the Zod SSOT for `/contact` (Decision #276): the four intents, what each one
 * asks for, the wire shape `POST /api/contact` accepts, what it answers, and the stored row
 * `ops.contact_requests` (00000013).
 *
 * One submission schema serves three readers so they cannot drift: the `ContactIntake` island
 * pre-checks a form against it before spending a request, the thin route re-validates the body (JSON
 * from the island, `application/x-www-form-urlencoded` from the no-JS form), and the fat
 * `ContactBackendService` maps the parsed result onto `ops.submit_contact_request`. The stored
 * payload keys, the intents, the statuses and the reference format are mirrored by the table's
 * CHECKs and the writer's guards value for value (`contact.contract.test.ts` reads the migrations).
 *
 * CSS-free and dependency-light (zod, the help centre's Zod-free category slugs and the schema-free
 * storable-text rule), so an island may import it.
 */

// #region Primitives
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An opaque UUID id. */
const uuid = z.string().regex(UUID_RE, "Expected a UUID.");

/** Field ceilings, shared by the schema, the form's `maxLength` attributes and the writer's guards. */
export const CONTACT_LIMITS = {
	/** A person's name. */
	name: 120,
	/** RFC 5321's 254, as the newsletter and the table's CHECK enforce it. */
	email: 254,
	/** A company name. */
	company: 160,
	/** The shortest message worth a person's reply, and the longest the writer stores. */
	messageMin: 20,
	messageMax: 5000,
	/** A reference a guest pastes for a dispute (a project link, an invoice number). */
	referenceId: 200,
	/** Files on one request. */
	attachments: 5,
} as const;

const EMAIL_MESSAGE = "Enter a valid email address.";
/**
 * Every free-text field the writer stores holds only storable text ({@link isStorableText}): a NUL
 * or a lone surrogate is a 422 naming the field, never a 503 from Postgres (22P05) or PostgREST.
 */
const storable = <S extends z.ZodString>(schema: S, message = UNSTORABLE_TEXT_MESSAGE) =>
	schema.refine(isStorableText, message);
/** The permissive structure check the auth feature and the newsletter use (`EMAIL_RE`). */
const email = storable(
	z.string().trim().max(CONTACT_LIMITS.email, EMAIL_MESSAGE).regex(
		/^[^\s@]+@[^\s@]+\.[^\s@]+$/,
		EMAIL_MESSAGE,
	),
	EMAIL_MESSAGE,
);
const name = storable(
	z.string().trim().min(1, "Tell us your name.").max(
		CONTACT_LIMITS.name,
		`Keep your name under ${CONTACT_LIMITS.name} characters.`,
	),
);
const message = storable(
	z.string().trim()
		.min(
			CONTACT_LIMITS.messageMin,
			`Tell us a little more — at least ${CONTACT_LIMITS.messageMin} characters.`,
		)
		.max(
			CONTACT_LIMITS.messageMax,
			`Keep it under ${CONTACT_LIMITS.messageMax.toLocaleString("en-GB")} characters.`,
		),
);
/**
 * The honeypot, `ctc_hp`. A real visitor never sees or fills it (it sits off-screen, out of the tab
 * order, `autocomplete="off"`); a form-filling script does. Named so no autofill or identity-fill
 * tool recognises it (a `website` field is one they fill, which would silently drop a real
 * person's request). Accepted here so a filled one parses — the service, not the schema, decides
 * what to do about it: it answers exactly as it would a real request (see
 * `ContactBackendService.submit`), so a bot learns nothing, and logs the hit (a count, never the
 * body) so a false positive is visible to operators.
 */
const honeypot = z.string().max(500).optional().default("");
const attachmentIds = z.array(uuid).max(
	CONTACT_LIMITS.attachments,
	`Attach at most ${CONTACT_LIMITS.attachments} files.`,
).optional().default([]);
// #endregion

// #region Intents
/** What a request is about, in the order the switcher shows them. Mirrors `contact_requests_intent_check`. */
export const CONTACT_INTENTS = ["sales", "support", "dispute", "security"] as const;
/** One contact intent. */
export const ContactIntent = z.enum(CONTACT_INTENTS);
export type ContactIntent = z.infer<typeof ContactIntent>;

/** The intent a bare `/contact` opens on. */
export const DEFAULT_CONTACT_INTENT: ContactIntent = "support";

/**
 * Read an intent from a URL value. Total: anything that is not one of {@link CONTACT_INTENTS}
 * (absent, misspelt, another case) is the default, so a pasted link always opens a working form.
 */
export function parseContactIntent(raw: string | null | undefined): ContactIntent {
	const parsed = ContactIntent.safeParse(raw);
	return parsed.success ? parsed.data : DEFAULT_CONTACT_INTENT;
}
// #endregion

// #region Choice lists
/** One option of a closed choice — the value stored and the words shown. */
export interface ContactChoice<V extends string = string> {
	readonly value: V;
	readonly label: string;
}

/**
 * Company size bands (sales). Every choice list a form draws as a select opens on a real value
 * (here "Prefer not to say"), because without JavaScript the select cannot be changed and still
 * posts its value — an empty default would make the no-JS form unsendable.
 */
export const CONTACT_COMPANY_SIZES = [
	{ value: "not-say", label: "Prefer not to say" },
	{ value: "1-10", label: "1–10 people" },
	{ value: "11-50", label: "11–50 people" },
	{ value: "51-200", label: "51–200 people" },
	{ value: "201-1000", label: "201–1,000 people" },
	{ value: "1000-plus", label: "More than 1,000 people" },
] as const satisfies readonly ContactChoice[];
export const ContactCompanySize = z.enum([
	"not-say",
	"1-10",
	"11-50",
	"51-200",
	"201-1000",
	"1000-plus",
]);
export type ContactCompanySize = z.infer<typeof ContactCompanySize>;

/** Budget bands (sales), in GBP because the platform's reference currency is. */
export const CONTACT_BUDGETS = [
	{ value: "not-sure", label: "Not sure yet" },
	{ value: "under-5k", label: "Under £5,000" },
	{ value: "5k-25k", label: "£5,000–£25,000" },
	{ value: "25k-100k", label: "£25,000–£100,000" },
	{ value: "100k-plus", label: "More than £100,000" },
] as const satisfies readonly ContactChoice[];
export const ContactBudget = z.enum(["not-sure", "under-5k", "5k-25k", "25k-100k", "100k-plus"]);
export type ContactBudget = z.infer<typeof ContactBudget>;

/**
 * Support topics: the help centre's categories, one value per category slug, then "Something else"
 * (Decision #279, closing Decision #276 flag (h)). The slugs come from the one list the help centre's
 * categories are pinned to (`HELP_CENTRE_CATEGORY_SLUGS`) and are permanent (Decision #274 (k)), so a
 * stored topic always names a help category; the labels are the categories' own titles, read with
 * them ({@link contactSupportTopics}). The writer's `v_topics` mirrors this enum value for value.
 */
export const ContactSupportTopic = z.enum([...HELP_CENTRE_CATEGORY_SLUGS, "other"]);
export type ContactSupportTopic = z.infer<typeof ContactSupportTopic>;

/** The topic that needs no category — the select opens on it, so the no-JS form posts a real value. */
export const CONTACT_OTHER_TOPIC = {
	value: "other",
	label: "Something else",
} as const satisfies ContactChoice<ContactSupportTopic>;

/**
 * The Topic select's options: each help category given (in the order given — the help centre's hub
 * order) titled as the help centre titles it, then {@link CONTACT_OTHER_TOPIC}. A category that is not
 * a support topic (one added to the help centre before this list) is left out rather than offered and
 * refused.
 */
export function contactSupportTopics(
	categories: ReadonlyArray<{ slug: string; title: string }>,
): ContactChoice<ContactSupportTopic>[] {
	const topics = new Set<string>(HELP_CENTRE_CATEGORY_SLUGS);
	return [
		...categories
			.filter((category) => topics.has(category.slug))
			.map((category) => ({
				value: category.slug as ContactSupportTopic,
				label: category.title,
			})),
		CONTACT_OTHER_TOPIC,
	];
}

/**
 * Security report kinds — drawn as radios (real inputs), so the no-JS form can choose one and the
 * browser's own `required` check applies.
 */
export const CONTACT_SECURITY_REPORTS = [
	{
		value: "vulnerability",
		label: "A security vulnerability",
		description: "A flaw in Projective that exposes data or accounts",
	},
	{
		value: "abuse",
		label: "Abuse of the platform",
		description: "Fraud, harassment, spam or a fake account",
	},
	{
		value: "whistleblower",
		label: "A whistleblower report",
		description: "Wrongdoing you've seen, inside Projective or a business on it",
	},
] as const satisfies ReadonlyArray<ContactChoice & { description: string }>;
export const ContactSecurityReport = z.enum(["vulnerability", "abuse", "whistleblower"]);
export type ContactSecurityReport = z.infer<typeof ContactSecurityReport>;
// #endregion

// #region Submission (the wire shape)
const SalesSubmission = z.object({
	intent: z.literal("sales"),
	name,
	email,
	company: storable(
		z.string().trim().min(1, "Tell us your company's name.").max(CONTACT_LIMITS.company),
	),
	companySize: ContactCompanySize,
	budget: ContactBudget,
	message,
	ctc_hp: honeypot,
});

const SupportSubmission = z.object({
	intent: z.literal("support"),
	name,
	email,
	/** The account the question is about, when it is not the reply address. */
	accountEmail: z.union([email, z.literal("")]).optional().default(""),
	topic: ContactSupportTopic,
	message,
	attachmentIds,
	ctc_hp: honeypot,
});

const DisputeSubmission = z.object({
	intent: z.literal("dispute"),
	name,
	email,
	/**
	 * A signed-in reader's pick from their own open engagements (`/projects/:slug`). The service
	 * re-resolves it against the caller's engagements and stores what it found, never this string
	 * alone, so a request cannot name an engagement its sender is not on.
	 */
	engagementSlug: storable(z.string().trim().max(120)).optional().default(""),
	/** A guest's free-text pointer: a project link, an invoice or payment reference. */
	referenceId: storable(z.string().trim().max(CONTACT_LIMITS.referenceId)).optional().default(""),
	message,
	attachmentIds,
	ctc_hp: honeypot,
});

const SecuritySubmission = z.object({
	intent: z.literal("security"),
	/**
	 * Anonymous reports carry no name, no reply address and no account (the writer stores no
	 * `user_id`), and so no attachments — an attachment is a file in its uploader's name. A form that
	 * still posts the name and email of an anonymous report (the no-JS road, where they are hidden
	 * rather than removed) has them dropped before parsing (`submissionFromForm`).
	 */
	anonymous: z.boolean().optional().default(false),
	name: z.union([name, z.literal("")]).optional().default(""),
	email: z.union([email, z.literal("")]).optional().default(""),
	reportType: ContactSecurityReport,
	message,
	attachmentIds,
	ctc_hp: honeypot,
}).superRefine((v, ctx) => {
	if (v.anonymous) {
		if (v.attachmentIds.length > 0) {
			ctx.addIssue({
				code: "custom",
				path: ["attachmentIds"],
				message: "An anonymous report can't carry attachments.",
			});
		}
		return;
	}
	if (!v.name) ctx.addIssue({ code: "custom", path: ["name"], message: "Tell us your name." });
	if (!v.email) ctx.addIssue({ code: "custom", path: ["email"], message: EMAIL_MESSAGE });
});

/** A contact submission — one shape per intent, discriminated on `intent`. */
export const ContactSubmissionSchema = z.discriminatedUnion("intent", [
	SalesSubmission,
	SupportSubmission,
	DisputeSubmission,
	SecuritySubmission,
]);
export type ContactSubmission = z.infer<typeof ContactSubmissionSchema>;
/** The un-defaulted input a form builds (`z.input`), before parsing fills the optional fields. */
export type ContactSubmissionInput = z.input<typeof ContactSubmissionSchema>;

/** The intents whose form takes attachments. */
export const CONTACT_ATTACHMENT_INTENTS: readonly ContactIntent[] = [
	"support",
	"dispute",
	"security",
];

/** Whether a submission's intent accepts attachments. */
export function intentTakesAttachments(intent: ContactIntent): boolean {
	return CONTACT_ATTACHMENT_INTENTS.includes(intent);
}
// #endregion

// #region Stored payload
/**
 * The keys `ops.contact_requests.payload` may hold for each intent — mirrored key for key by
 * `ops.submit_contact_request`'s whitelist, so a direct RPC call cannot store a key no reader expects.
 * The reply address, the account and the attachments are columns and a link table, never payload.
 */
export const CONTACT_PAYLOAD_KEYS: Readonly<Record<ContactIntent, readonly string[]>> = {
	sales: ["name", "company", "companySize", "budget", "message"],
	support: ["name", "accountEmail", "topic", "message"],
	dispute: ["name", "referenceId", "engagement", "message"],
	security: ["name", "reportType", "message"],
};

/** The engagement a signed-in dispute names, as the service resolved it. */
export const ContactEngagementRefSchema = z.object({
	slug: z.string().min(1).max(120),
	title: z.string().min(1).max(160),
	format: z.enum(["one_off", "pipeline", "session"]),
});
export type ContactEngagementRef = z.infer<typeof ContactEngagementRefSchema>;

/**
 * One of a signed-in reader's open engagements, as the dispute intent lists them: what it is, where
 * it lives (`/projects/:slug`, where a session's no-show claim is filed) and who is on the other side.
 */
export const ContactEngagementOptionSchema = ContactEngagementRefSchema.extend({
	status: z.enum(["active", "on_hold"]),
	/** The other party's display name, when the engagement has one. */
	counterparty: z.string().max(120).nullable(),
});
export type ContactEngagementOption = z.infer<typeof ContactEngagementOptionSchema>;

/** Where an engagement's own workspace is — the existing home of its dispute tools. */
export function engagementHref(slug: string): string {
	return `/projects/${encodeURIComponent(slug)}`;
}

/**
 * The payload a submission stores: its intent's fields minus the honeypot, the reply address and
 * the attachment ids; empty optional strings dropped; a dispute's engagement as resolved by the
 * service (never the client's slug). Pure, so the stub and the live writer store the same thing.
 */
export function toStoredPayload(
	submission: ContactSubmission,
	engagement: ContactEngagementRef | null = null,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	const put = (key: string, value: unknown) => {
		if (value === undefined || value === null || value === "") return;
		out[key] = value;
	};
	switch (submission.intent) {
		case "sales":
			put("name", submission.name);
			put("company", submission.company);
			put("companySize", submission.companySize);
			put("budget", submission.budget);
			break;
		case "support":
			put("name", submission.name);
			put("accountEmail", submission.accountEmail.toLowerCase());
			put("topic", submission.topic);
			break;
		case "dispute":
			put("name", submission.name);
			put("referenceId", submission.referenceId);
			put("engagement", engagement);
			break;
		case "security":
			if (!submission.anonymous) put("name", submission.name);
			put("reportType", submission.reportType);
			break;
	}
	put("message", submission.message);
	return out;
}

/** The reply address a submission stores (`null` for an anonymous report), lower-cased. */
export function replyAddressOf(submission: ContactSubmission): string | null {
	if (submission.intent === "security" && submission.anonymous) return null;
	return submission.email ? submission.email.toLowerCase() : null;
}

/** Whether a submission is an anonymous security report. */
export function isAnonymousSubmission(submission: ContactSubmission): boolean {
	return submission.intent === "security" && submission.anonymous;
}
// #endregion

// #region Reference
/**
 * The reference alphabet — Crockford base32 (no I, L, O or U), so a reference read aloud or copied
 * by hand cannot be mistaken for another. 32 symbols, so `byte & 31` picks one uniformly.
 */
export const CONTACT_REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** `CT-XXXX-XXXX` over {@link CONTACT_REFERENCE_ALPHABET} — `contact_requests_reference_check`. */
export const CONTACT_REFERENCE_PATTERN = /^CT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/**
 * Format eight random bytes as a reference (`CT-7K4Q-2M9X`): 32⁸ ≈ 1.1 × 10¹² values, unique by
 * constraint and re-drawn on collision by the writer. The SQL twin is `ops.fn_contact_reference()`.
 */
export function formatContactReference(bytes: Uint8Array): string {
	if (bytes.length < 8) throw new RangeError("A reference needs eight random bytes.");
	let chars = "";
	for (let i = 0; i < 8; i++) chars += CONTACT_REFERENCE_ALPHABET[bytes[i] & 31];
	return `CT-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

/** Whether a string is a well-formed reference. */
export function isContactReference(value: string): boolean {
	return CONTACT_REFERENCE_PATTERN.test(value);
}
// #endregion

// #region Lifecycle
/**
 * A request's state, on the unified machine (PRODUCT_MANAGEMENT §3.1; no bespoke statuses): it
 * arrives in `backlog`, an operator takes it `in_progress`, and it ends `complete` (answered) or
 * `archived` (spam, a duplicate, nothing to do). Mirrors `contact_requests_status_check`.
 */
export const CONTACT_REQUEST_STATUSES = ["backlog", "in_progress", "complete", "archived"] as const;
export const ContactRequestStatus = z.enum(CONTACT_REQUEST_STATUSES);
export type ContactRequestStatus = z.infer<typeof ContactRequestStatus>;

/** The legal moves — `ops.fn_guard_contact_request` refuses every other one. `archived` is terminal. */
export const CONTACT_STATUS_TRANSITIONS: Readonly<
	Record<ContactRequestStatus, readonly ContactRequestStatus[]>
> = {
	backlog: ["in_progress", "archived"],
	in_progress: ["complete", "archived"],
	complete: ["archived"],
	archived: [],
};

/** Whether a request may move from one state to another. */
export function canMoveContactRequest(
	from: ContactRequestStatus,
	to: ContactRequestStatus,
): boolean {
	return CONTACT_STATUS_TRANSITIONS[from].includes(to);
}
// #endregion

// #region Durable ceilings
/**
 * What `ops.submit_contact_request` refuses with `PR429`, per rolling hour: requests from one reply
 * address, requests from one signed-in account, named requests from guests platform-wide, and
 * anonymous security reports platform-wide (a guest can rotate addresses and an anonymous report has
 * none, and the writer cannot see an IP). The service's per-process limiter (per IP, per address)
 * answers first; these hold when it is bypassed by calling the writer directly — at the cost that a
 * flood shuts guests (never signed-in senders) out for up to an hour (Decision #276 (j)).
 */
export const CONTACT_DB_CEILINGS = {
	perEmailPerHour: 5,
	perUserPerHour: 10,
	guestPerHour: 60,
	anonymousPerHour: 30,
} as const;
// #endregion

// #region Answer + row
/** What a successful submission answers. */
export const ContactReceiptSchema = z.object({
	reference: z.string().regex(CONTACT_REFERENCE_PATTERN),
	intent: ContactIntent,
	status: ContactRequestStatus,
	/** ISO instant the request was received. */
	receivedAt: z.string(),
});
export type ContactReceipt = z.infer<typeof ContactReceiptSchema>;

/** `ops.submit_contact_request`'s answer (snake_case, the database's own document). */
export const ContactSubmitRpcResultSchema = z.object({
	id: uuid,
	reference: z.string().regex(CONTACT_REFERENCE_PATTERN),
	intent: ContactIntent,
	status: ContactRequestStatus,
	created_at: z.string(),
});
export type ContactSubmitRpcResult = z.infer<typeof ContactSubmitRpcResultSchema>;

/** One `ops.contact_requests` row — readable by operators only (`security.is_admin()`). */
export const ContactRequestRowSchema = z.object({
	id: uuid,
	reference: z.string().regex(CONTACT_REFERENCE_PATTERN),
	intent: ContactIntent,
	status: ContactRequestStatus,
	email: z.string().max(CONTACT_LIMITS.email).nullable(),
	user_id: uuid.nullable(),
	anonymous: z.boolean(),
	payload: z.record(z.string(), z.unknown()),
	created_at: z.string(),
	updated_at: z.string(),
});
export type ContactRequestRow = z.infer<typeof ContactRequestRowSchema>;
// #endregion
