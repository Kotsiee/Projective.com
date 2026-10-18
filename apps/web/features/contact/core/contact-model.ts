import {
	type ContactAttachmentPhase,
	type ContactIntent,
	type ContactSubmission,
	ContactSubmissionSchema,
	intentTakesAttachments,
} from "@projective/types/contact";

/**
 * contact-model — the intake form's state as data (Decision #276): one record of every field the four
 * intents use (name, address and message are shared, so switching intent mid-sentence keeps what was
 * typed), the submission each intent builds from it, and the client-side pre-check that runs the SAME
 * Zod schema the route and the service run. Pure — the island holds the state in signals and calls
 * these.
 */

/** Every field the intake can hold, across intents. */
export interface ContactFormState {
	name: string;
	email: string;
	company: string;
	companySize: string;
	budget: string;
	accountEmail: string;
	topic: string;
	engagementSlug: string;
	referenceId: string;
	reportType: string;
	anonymous: boolean;
	message: string;
	/** The honeypot — never shown, never filled by a person. */
	ctc_hp: string;
}

/**
 * The form a visit opens with. Each select opens on a real choice (see `CONTACT_COMPANY_SIZES`), so
 * the no-JS form can always be sent; the report type is a radio with no default, chosen on purpose.
 */
export const EMPTY_CONTACT_FORM: Readonly<ContactFormState> = {
	name: "",
	email: "",
	company: "",
	companySize: "not-say",
	budget: "not-sure",
	accountEmail: "",
	topic: "other",
	engagementSlug: "",
	referenceId: "",
	reportType: "",
	anonymous: false,
	message: "",
	ctc_hp: "",
};

/**
 * The submission body an intent builds from the form — only that intent's fields travel, and an
 * anonymous report carries neither name, address nor files. Untyped on purpose: the schema, not this
 * function, decides whether it is a valid submission ({@link checkSubmission}).
 */
export function submissionInput(
	intent: ContactIntent,
	form: Readonly<ContactFormState>,
	attachmentIds: readonly string[],
): Record<string, unknown> {
	const anonymous = intent === "security" && form.anonymous;
	const files = intentTakesAttachments(intent) && !anonymous ? [...attachmentIds] : [];
	const shared = { intent, message: form.message, ctc_hp: form.ctc_hp };
	const sender = anonymous ? {} : { name: form.name, email: form.email };
	switch (intent) {
		case "sales":
			return {
				...shared,
				...sender,
				company: form.company,
				companySize: form.companySize,
				budget: form.budget,
			};
		case "support":
			return {
				...shared,
				...sender,
				accountEmail: form.accountEmail,
				topic: form.topic,
				attachmentIds: files,
			};
		case "dispute":
			return {
				...shared,
				...sender,
				engagementSlug: form.engagementSlug,
				referenceId: form.referenceId,
				attachmentIds: files,
			};
		case "security":
			return { ...shared, ...sender, anonymous, reportType: form.reportType, attachmentIds: files };
	}
}

/** The pre-check's answer: the parsed submission, or one message per field. */
export type ContactCheck =
	| { ok: true; submission: ContactSubmission }
	| { ok: false; errors: Record<string, string> };

/** Run the shared schema over a body, keyed by the first path segment of each issue. */
export function checkSubmission(input: unknown): ContactCheck {
	const parsed = ContactSubmissionSchema.safeParse(input);
	if (parsed.success) return { ok: true, submission: parsed.data };
	const errors: Record<string, string> = {};
	for (const issue of parsed.error.issues) {
		const key = String(issue.path[0] ?? "form");
		if (!(key in errors)) errors[key] = friendlyIssue(key, issue.message);
	}
	return { ok: false, errors };
}

/** Zod's enum wording ("Invalid option: expected one of …") is for developers; a person gets a sentence. */
function friendlyIssue(field: string, message: string): string {
	if (!/^Invalid/i.test(message)) return message;
	switch (field) {
		case "reportType":
			return "Choose what you're reporting.";
		case "topic":
			return "Choose a topic.";
		case "companySize":
			return "Choose your company's size.";
		case "budget":
			return "Choose a budget range.";
		default:
			return "Check this field.";
	}
}

/** The fields of one intent, in the order the form shows them — the first error's focus target. */
export const INTENT_FIELD_ORDER: Readonly<Record<ContactIntent, readonly string[]>> = {
	sales: ["name", "email", "company", "companySize", "budget", "message"],
	support: ["name", "email", "accountEmail", "topic", "message", "attachmentIds"],
	dispute: ["engagementSlug", "name", "email", "referenceId", "message", "attachmentIds"],
	security: ["reportType", "name", "email", "message", "attachmentIds"],
};

/** The first field (in form order) an error map names, or `null`. */
export function firstErrorField(
	intent: ContactIntent,
	errors: Readonly<Record<string, string>>,
): string | null {
	return INTENT_FIELD_ORDER[intent].find((f) => f in errors) ?? Object.keys(errors)[0] ?? null;
}

/** One file's progress through the attachment pipeline, keyed by the upload queue's id. */
export interface AttachmentEntry {
	phase: ContactAttachmentPhase;
	/**
	 * The server's id for the file, from the moment it is declared — what Remove takes back. A
	 * submission sends it only once the file is `ready` ({@link readyAttachmentIds}).
	 */
	attachmentId?: string;
	/** Why it was refused. */
	message?: string;
}

/** The ids a submission sends: every file the server admitted, in the order they were added. */
export function readyAttachmentIds(entries: Readonly<Record<string, AttachmentEntry>>): string[] {
	return Object.values(entries)
		.filter((e) => e.phase === "ready" && e.attachmentId)
		.map((e) => e.attachmentId as string);
}

/** How many files are still on their way (a request waits for them rather than dropping them). */
export function attachmentsInFlight(entries: Readonly<Record<string, AttachmentEntry>>): number {
	return Object.values(entries).filter((e) =>
		e.phase === "queued" || e.phase === "uploading" || e.phase === "scanning"
	)
		.length;
}

/** The message counter's text — `1,234 / 5,000` (figures change, so the counter is tabular). */
export function counterText(length: number, max: number): string {
	return `${length.toLocaleString("en-GB")} / ${max.toLocaleString("en-GB")}`;
}
