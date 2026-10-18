import { type Signal, signal } from "@preact/signals";
import { containsPii } from "@projective/types/comms";
import {
	type FeedbackCategory,
	type FeedbackIdea,
	type FeedbackIdeaCreate,
	FeedbackIdeaCreateSchema,
} from "@projective/types/community";

/**
 * compose-state — the suggestion form's state and its client-side checks (Decision #272), apart from
 * the markup, because the form's commit sits in the drawer's or dialog's pinned footer (§B.10.8)
 * while its fields scroll in the body: both read and write one state.
 *
 * The checks are the server's, run early: the Zod create schema (`@projective/types/community`) and
 * the Decision #147 contact-detail rule through the shared twin of `comms.mask_pii`. The server
 * re-checks everything, so these only spare a round trip.
 */

/** The sentence a field with a contact detail shows (the service sends the same). */
export const FEEDBACK_PII_MESSAGE =
	"Ideas are public, so leave out email addresses, phone numbers and payment links.";

/** What the form holds. */
export interface ComposeValues {
	title: string;
	category: FeedbackCategory | "";
	impact: string;
	body: string;
}

/** The form's empty values. */
export const EMPTY_COMPOSE: ComposeValues = Object.freeze({
	title: "",
	category: "",
	impact: "",
	body: "",
});

/** The result of checking the form. */
export type ComposeCheck =
	| { ok: true; input: FeedbackIdeaCreate }
	| { ok: false; errors: Record<string, string> };

/** Check the form as the server will: the create schema, then no contact details in any field. */
export function checkCompose(values: ComposeValues): ComposeCheck {
	const parsed = FeedbackIdeaCreateSchema.safeParse({
		title: values.title,
		category: values.category || undefined,
		impact: values.impact,
		body: values.body.trim() ? values.body : undefined,
	});
	const errors: Record<string, string> = {};
	if (!parsed.success) {
		for (const issue of parsed.error.issues) {
			const key = String(issue.path[0] ?? "form");
			if (!errors[key]) {
				errors[key] = key === "category" ? "Choose what your idea is about." : issue.message;
			}
		}
	}
	for (const field of ["title", "impact", "body"] as const) {
		if (!errors[field] && values[field] && containsPii(values[field])) {
			errors[field] = FEEDBACK_PII_MESSAGE;
		}
	}
	if (Object.keys(errors).length > 0 || !parsed.success) return { ok: false, errors };
	const { body, ...required } = parsed.data;
	return { ok: true, input: body === undefined ? required : { ...required, body } };
}

/** The field a live contact-detail hint belongs to, while the reader is still typing. */
export function piiHintFor(value: string): string | undefined {
	return value && containsPii(value) ? FEEDBACK_PII_MESSAGE : undefined;
}

/** The form's shared state. */
export interface ComposeState {
	values: Signal<ComposeValues>;
	errors: Signal<Record<string, string>>;
	/** A refusal that names no field (a rate limit, a network failure). */
	formError: Signal<string | null>;
	submitting: Signal<boolean>;
	/** The idea once it was sent — the form gives way to the success state. */
	sent: Signal<FeedbackIdea | null>;
}

/** A fresh, empty form. */
export function createComposeState(): ComposeState {
	return {
		values: signal({ ...EMPTY_COMPOSE }),
		errors: signal({}),
		formError: signal(null),
		submitting: signal(false),
		sent: signal(null),
	};
}

/** Empty the form for another idea. */
export function resetCompose(state: ComposeState): void {
	state.values.value = { ...EMPTY_COMPOSE };
	state.errors.value = {};
	state.formError.value = null;
	state.submitting.value = false;
	state.sent.value = null;
}
