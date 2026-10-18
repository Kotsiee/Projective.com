import { z } from "zod";
import { timestamp, uuid } from "./common.ts";
import { HELP_CENTRE_SLUG_MAX } from "../editorial/help.ts";

/**
 * community.help_feedback — the Zod SSOT for the help centre's "Was this helpful?" votes (P2,
 * Decision #274): the row of `community.help_feedback` (`00000025`, region `[help_feedback]`), the
 * request body of `POST /api/help/feedback`, what the one writer `community.submit_help_feedback`
 * (`00001320`, region `[community.help_feedback]`) answers, and what the route answers.
 *
 * A vote is anonymous by default and insert-only: the writer stamps the signed-in voter from
 * `auth.uid()` (never from the body), rate-limits, and screens a comment through `comms.mask_pii`
 * before it is stored (Decision #147). No client role reads, updates or deletes a row.
 */

// #region Primitives
/** The longest comment a reader may leave with a "No" (the textarea's `maxlength`). */
export const HELP_FEEDBACK_COMMENT_MAX = 280;

/**
 * The longest a STORED comment may be. Masking can lengthen text — `$ab` becomes `[handle hidden]` —
 * so the table holds up to five times the input limit (`help_feedback_comment_length`); the input
 * limit is enforced before masking, by the schema below and by the writer.
 */
export const HELP_FEEDBACK_STORED_COMMENT_MAX = HELP_FEEDBACK_COMMENT_MAX * 5;

/**
 * An article slug as the request names it: the editorial slug rule, within the help articles' own
 * bound ({@link HELP_CENTRE_SLUG_MAX}), so no published article is one a vote cannot name.
 */
const articleSlug = z.string().trim().toLowerCase().max(HELP_CENTRE_SLUG_MAX).regex(
	/^[a-z0-9]+(?:-[a-z0-9]+)*$/,
	"Name the article this is about.",
);
// #endregion

// #region Request
/**
 * `POST /api/help/feedback` — one vote on one article. A comment is optional and only follows a
 * "No" (it says what was missing); a blank comment is the same as none.
 */
export const HelpFeedbackInputSchema = z.object({
	slug: articleSlug,
	helpful: z.boolean(),
	comment: z.string().max(4_000).optional().transform((value) => {
		const trimmed = value?.trim() ?? "";
		return trimmed.length > 0 ? trimmed : undefined;
	}),
}).superRefine((input, ctx) => {
	if (input.comment === undefined) return;
	if (input.helpful) {
		ctx.addIssue({
			code: "custom",
			path: ["comment"],
			message: "A comment goes with a “No”.",
		});
	}
	if (input.comment.length > HELP_FEEDBACK_COMMENT_MAX) {
		ctx.addIssue({
			code: "custom",
			path: ["comment"],
			message: `Keep it to ${HELP_FEEDBACK_COMMENT_MAX} characters.`,
		});
	}
});
/** A parsed vote. */
export type HelpFeedbackInput = z.infer<typeof HelpFeedbackInputSchema>;
// #endregion

// #region Row and writer
/** A row of `community.help_feedback`. */
export const HelpFeedbackRowSchema = z.object({
	id: uuid,
	article_slug: z.string(),
	helpful: z.boolean(),
	/** The comment as stored — already masked (`[email hidden]` …). */
	comment: z.string().max(HELP_FEEDBACK_STORED_COMMENT_MAX).nullable(),
	/** What `comms.mask_pii` hid in the comment (`email` · `payment_link` · `handle` · `phone`). */
	comment_pii_categories: z.array(z.string()),
	/** The signed-in voter, stamped by the writer; `null` for a guest or a profile-less session. */
	user_id: uuid.nullable(),
	created_at: timestamp,
});
/** A row of `community.help_feedback`. */
export type HelpFeedbackRow = z.infer<typeof HelpFeedbackRowSchema>;

/**
 * What `community.submit_help_feedback` answers: whether a row was written, and whether it was not
 * because this signed-in voter already voted on the article in the last day (`duplicate`).
 */
export const HelpFeedbackRpcResultSchema = z.object({
	recorded: z.boolean(),
	duplicate: z.boolean(),
});
/** The writer's answer. */
export type HelpFeedbackRpcResult = z.infer<typeof HelpFeedbackRpcResultSchema>;

/**
 * What the route answers on success. A duplicate is a success too — the reader sees the same thanks
 * — so a vote never tells anyone whether it was counted twice.
 */
export interface HelpFeedbackResult {
	slug: string;
	helpful: boolean;
}
// #endregion
