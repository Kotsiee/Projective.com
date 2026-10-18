import {
	type ContactEngagementRef,
	type ContactReceipt,
	type ContactSubmission,
	ContactSubmitRpcResultSchema,
	formatContactReference,
	isAnonymousSubmission,
	replyAddressOf,
	toStoredPayload,
} from "@projective/types/contact";
import { fail, type FieldErrors, ok, type ServiceResult } from "../ServiceResult.ts";

/**
 * contact-rpc — the pure half of the `/contact` intake: what `ops.submit_contact_request` is handed,
 * how its answer becomes a receipt, and how each of its refusals becomes a field error a person can
 * act on. No I/O, so the live path and the stub share every rule and both are unit-tested.
 */

// #region Arguments
/** The writer's named arguments (00001655). */
export interface SubmitRpcArgs {
	p_intent: ContactSubmission["intent"];
	p_email: string | null;
	p_anonymous: boolean;
	p_payload: Record<string, unknown>;
	p_attachment_ids: string[];
}

/** Map a parsed submission (and a resolved engagement) onto the writer's arguments. */
export function submitRpcArgs(
	submission: ContactSubmission,
	engagement: ContactEngagementRef | null = null,
): SubmitRpcArgs {
	const anonymous = isAnonymousSubmission(submission);
	return {
		p_intent: submission.intent,
		p_email: replyAddressOf(submission),
		p_anonymous: anonymous,
		p_payload: toStoredPayload(submission, engagement),
		p_attachment_ids: submission.intent === "sales" || anonymous
			? []
			: [...submission.attachmentIds],
	};
}
// #endregion

// #region Answers
/** The receipt the writer's answer reads as; `null` when it does not parse (a drifted writer). */
export function receiptFromRpc(data: unknown): ContactReceipt | null {
	const parsed = ContactSubmitRpcResultSchema.safeParse(data);
	if (!parsed.success) return null;
	return {
		reference: parsed.data.reference,
		intent: parsed.data.intent,
		status: parsed.data.status,
		receivedAt: parsed.data.created_at,
	};
}

/**
 * A receipt minted without the database — the development stub's, and the honeypot's. The reference
 * is drawn exactly as the writer draws one, so the two are indistinguishable in shape.
 */
export function localReceipt(
	intent: ContactSubmission["intent"],
	now: Date = new Date(),
): ContactReceipt {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return {
		reference: formatContactReference(bytes),
		intent,
		status: "backlog",
		receivedAt: now.toISOString(),
	};
}
// #endregion

// #region Refusals
/** The field a writer's 22023 message names, so the form can mark the control it is about. */
export function fieldOfRefusal(message: string): string | null {
	const m = message.toLowerCase();
	if (m.includes("attachment")) return "attachmentIds";
	if (m.includes("message")) return "message";
	if (m.includes("email") || m.includes("address")) return "email";
	if (m.includes("name")) return "name";
	if (m.includes("intent")) return "intent";
	return null;
}

/** The words a field's refusal shows (the writer's own sentences are written for operators). */
const FIELD_WORDS: Readonly<Record<string, string>> = {
	attachmentIds: "One of the attachments can't be sent — remove it and attach it again.",
	message: "Tell us a little more — at least 20 characters, and no more than 5,000.",
	email: "Enter a valid email address.",
	name: "Tell us your name.",
	intent: "Choose what this is about.",
};

/**
 * Turn a writer refusal into the answer the route sends:
 *  - `PR429` (a durable ceiling) → 429;
 *  - `22023` (a malformed field) → 422 naming the field when the writer's sentence does;
 *  - `42501` (attachments without a session) → 401;
 *  - anything else → 503 with the code, never a false success.
 */
export function submitRefusal(error: { code?: string; message: string }): ServiceResult<never> {
	switch (error.code) {
		case "PR429":
			return fail(429, {
				message: "You've sent several requests in the last hour. Please try again a little later.",
			});
		case "22023": {
			const field = fieldOfRefusal(error.message);
			const errors: FieldErrors | undefined = field ? { [field]: FIELD_WORDS[field] } : undefined;
			return fail(422, {
				message: field ? "Check the highlighted field." : "Some of this request couldn't be read.",
				errors,
			});
		}
		case "42501":
			return fail(401, {
				message: "Sign in to attach files.",
				errors: { attachmentIds: "Sign in to attach files." },
			});
		default:
			return fail(503, {
				message: "We couldn't send your request just now. Please try again shortly.",
				details: { code: error.code ?? null },
			});
	}
}

/** The success envelope for a receipt (201, a request was created). */
export function receiptResult(receipt: ContactReceipt): ServiceResult<ContactReceipt> {
	return ok(receipt, { status: 201, message: `Request ${receipt.reference} received.` });
}
// #endregion
