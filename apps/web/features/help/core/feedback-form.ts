/**
 * feedback-form.ts — the no-JavaScript road of "Was this helpful?" (P2). Without JavaScript the
 * helpfulness block is a plain `<form method="post" action="/api/help/feedback">`; the route reads it
 * with these helpers and answers a 303 back to the article instead of JSON. Pure, so the field names
 * and the redirect rule are tested in one place and the island's markup uses the same names.
 */

/** The form's field names. */
export const FEEDBACK_FIELD = {
	slug: "slug",
	helpful: "helpful",
	comment: "comment",
	back: "back",
} as const;

/** The `helpful` button values. */
export const FEEDBACK_YES = "yes";
export const FEEDBACK_NO = "no";

/** The query parameter the article reads to show the result of a form post. */
export const FEEDBACK_RESULT_PARAM = "helpful";

/** The anchor of the helpfulness block, where a form post returns the reader. */
export const FEEDBACK_ANCHOR = "was-this-helpful";

/** What a submitted form says, as the feedback service's input. */
export interface FeedbackFormInput {
	slug: string;
	helpful: boolean | undefined;
	comment?: string;
}

/** Whether a request body is a form post (urlencoded or multipart) rather than JSON. */
export function isFormPost(contentType: string | null): boolean {
	const type = (contentType ?? "").toLowerCase();
	return type.startsWith("application/x-www-form-urlencoded") ||
		type.startsWith("multipart/form-data");
}

/** Read the form's fields. An unknown `helpful` value is `undefined`, which the service refuses. */
export function parseFeedbackForm(
	form: { get(name: string): FormDataEntryValue | null },
): FeedbackFormInput {
	const text = (name: string): string => {
		const value = form.get(name);
		return typeof value === "string" ? value : "";
	};
	const helpful = text(FEEDBACK_FIELD.helpful);
	const comment = text(FEEDBACK_FIELD.comment);
	return {
		slug: text(FEEDBACK_FIELD.slug),
		helpful: helpful === FEEDBACK_YES ? true : helpful === FEEDBACK_NO ? false : undefined,
		...(comment.trim().length > 0 ? { comment } : {}),
	};
}

/** A path the form may return to: the help hub, a category or an article — nothing else. */
const BACK_PATH = /^\/help(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){0,2}$/;

/**
 * Where a form post sends the reader: back to the article it came from (`back`, refused unless it is
 * a help path — never an open redirect), at the helpfulness block, with the outcome in the query.
 */
export function feedbackReturnUrl(back: string | null, outcome: "thanks" | "error"): string {
	const path = back && BACK_PATH.test(back) ? back : "/help";
	return `${path}?${FEEDBACK_RESULT_PARAM}=${outcome}#${FEEDBACK_ANCHOR}`;
}
