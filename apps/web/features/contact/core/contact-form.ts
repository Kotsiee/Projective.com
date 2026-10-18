import {
	type ContactIntent,
	type ContactReceipt,
	isContactReference,
	parseContactIntent,
} from "@projective/types/contact";
import type { FieldErrors } from "@server/services/ServiceResult.ts";
import { contactErrorHref, type ContactFormError, contactSentHref } from "./contact-url.ts";

/**
 * contact-form — the no-JS road through `POST /api/contact` (Decision #276).
 *
 * Without JavaScript the intake is a plain `<form method="post" action="/api/contact">`. The route
 * reads the body with {@link submissionFromForm} (the same keys the island sends as JSON), refuses a
 * cross-site post ({@link isCrossSitePost}), and answers with a 303 back to `/contact`: on success
 * carrying the receipt in a short-lived HttpOnly cookie ({@link receiptCookie}) rather than in the
 * address bar, history or a Referer, and on a refusal naming the fields to mark
 * ({@link formFailureHref}). Pure, so every rule is unit-tested.
 */

// #region Body
/** The text fields a contact form posts, by name. */
const TEXT_FIELDS = [
	"intent",
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
	"website",
] as const;

/** The longest value read from any one form field — the schema caps each further. */
const FORM_VALUE_MAX = 6000;

/**
 * A form body as the submission object the schema parses: every known text field as a string, the
 * anonymous box as a boolean (a checkbox posts `on`), and `attachmentIds` as a list (the no-JS form
 * has none — attachments need the upload handshake — but a repeated key is read honestly).
 *
 * An anonymous security report drops `name` and `email` here. Without JavaScript the anonymous box
 * only HIDES those two fields, so the post may still carry whatever was typed before it was ticked;
 * an anonymous report never reads them, and must not be refused over a hidden field either.
 */
export function submissionFromForm(form: URLSearchParams | FormData): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of TEXT_FIELDS) {
		const value = form.get(key);
		if (typeof value === "string") out[key] = value.slice(0, FORM_VALUE_MAX);
	}
	const anonymous = form.get("anonymous");
	if (typeof anonymous === "string") out.anonymous = anonymous === "on" || anonymous === "true";
	if (isAnonymousFormBody(out)) {
		delete out.name;
		delete out.email;
	}
	const ids = form.getAll("attachmentIds").filter((v): v is string =>
		typeof v === "string" && v !== ""
	);
	if (ids.length > 0) out.attachmentIds = ids;
	return out;
}

/** Whether a request body is a form post (the no-JS road) rather than the island's JSON. */
export function isFormPost(req: Request): boolean {
	const type = (req.headers.get("content-type") ?? "").toLowerCase();
	return type.startsWith("application/x-www-form-urlencoded") ||
		type.startsWith("multipart/form-data");
}

/**
 * Whether a form post came from another site. Session cookies are `SameSite=Lax`, so a cross-site
 * POST already arrives signed out; refusing it as well means no other page can file requests in a
 * visitor's name (or spend their address's rate allowance). A missing `Origin` (some privacy modes)
 * falls back to `Sec-Fetch-Site`; with neither, the post is allowed, as a plain form from an old
 * browser would be.
 */
export function isCrossSitePost(req: Request): boolean {
	const origin = req.headers.get("origin");
	if (origin && origin !== "null") {
		try {
			return new URL(origin).host !== new URL(req.url).host;
		} catch {
			return true;
		}
	}
	if (origin === "null") return true;
	const site = req.headers.get("sec-fetch-site");
	return site !== null && site !== "same-origin" && site !== "none";
}
// #endregion

// #region Outcome
/** A refused submission's 303 target, from the service's status and field errors. */
export function formFailureHref(
	intent: ContactIntent,
	status: number,
	errors: FieldErrors | undefined,
): string {
	const error: ContactFormError = status === 429
		? "rate_limited"
		: status === 401
		? "sign_in"
		: status === 422
		? "invalid"
		: "unavailable";
	return contactErrorHref(intent, error, Object.keys(errors ?? {}));
}

/** A successful submission's 303 target. */
export function formSuccessHref(intent: ContactIntent): string {
	return contactSentHref(intent);
}

/** The intent a form body named, for a refusal's return address (default when it named none). */
export function formIntent(body: Record<string, unknown>): ContactIntent {
	return parseContactIntent(typeof body.intent === "string" ? body.intent : null);
}
// #endregion

// #region Receipt cookie
/** The cookie the no-JS road carries its receipt home in. */
export const CONTACT_RECEIPT_COOKIE = "pj_contact_receipt";
/** Ten minutes: long enough to land on the page, short enough not to linger. */
const RECEIPT_MAX_AGE = 600;

function attributes(secure: boolean, maxAge: number): string {
	const base = `Path=/contact; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
	return secure ? `${base}; Secure` : base;
}

/** The marker an anonymous report's receipt carries, so its confirmation says no reply is coming. */
const ANONYMOUS_MARK = "anonymous";

/** What a receipt cookie carries home: the reference, the intent, and whether a reply is coming. */
export interface FormReceipt {
	reference: string;
	intent: ContactIntent;
	/** An anonymous security report — no reply address, so no reply. */
	anonymous: boolean;
}

/**
 * `Set-Cookie` for a receipt: `CT-XXXX-XXXX.<intent>`, or `CT-XXXX-XXXX.security.anonymous` for an
 * anonymous report. The reply address never rides in it.
 */
export function receiptCookie(
	receipt: ContactReceipt,
	secure: boolean,
	anonymous = false,
): string {
	const mark = anonymous && receipt.intent === "security" ? `.${ANONYMOUS_MARK}` : "";
	return `${CONTACT_RECEIPT_COOKIE}=${receipt.reference}.${receipt.intent}${mark}; ${
		attributes(secure, RECEIPT_MAX_AGE)
	}`;
}

/** `Set-Cookie` that clears the receipt once the page has shown it. */
export function clearReceiptCookie(secure: boolean): string {
	return `${CONTACT_RECEIPT_COOKIE}=; ${attributes(secure, 0)}`;
}

/**
 * Read a receipt cookie back; `null` for anything that is not a well-formed reference and intent
 * (with the anonymous marker only on a security report).
 */
export function parseReceiptCookie(value: string | undefined): FormReceipt | null {
	if (!value) return null;
	const parts = value.split(".");
	if (parts.length !== 2 && parts.length !== 3) return null;
	const [reference, intentRaw, mark] = parts;
	if (!isContactReference(reference)) return null;
	const intent = parseContactIntent(intentRaw);
	if (intent !== intentRaw) return null;
	if (mark !== undefined && (mark !== ANONYMOUS_MARK || intent !== "security")) return null;
	return { reference, intent, anonymous: mark === ANONYMOUS_MARK };
}

/** Whether a parsed form body is an anonymous security report (the receipt cookie's marker). */
export function isAnonymousFormBody(body: Record<string, unknown>): boolean {
	return body.intent === "security" && body.anonymous === true;
}
// #endregion
