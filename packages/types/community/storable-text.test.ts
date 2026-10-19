/**
 * The community writes refuse text no layer below can store (`isStorableText`): a NUL byte, another
 * C0 control or an unpaired surrogate is a 422 field error at the schema — on the client and the
 * route alike — instead of reaching Postgres (22P05) or PostgREST (PGRST102) and coming back a 503.
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import { NewsletterSubscribeSchema } from "./newsletter.ts";
import { HelpFeedbackInputSchema } from "./help-feedback.ts";
import { FeedbackIdeaCreateSchema, FeedbackModerationSchema } from "./feedback.ts";

const NUL = "\u0000";
const LONE = "\ud800";

/** The first issue's path and message, or null when the value parsed. */
function firstIssue(
	result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } },
): { path: string; message: string } | null {
	if (result.success) return null;
	const issue = result.error?.issues[0];
	return issue ? { path: issue.path.join("."), message: issue.message } : null;
}

Deno.test("newsletter: a NUL or a lone surrogate in the address is the email field's error", () => {
	for (const bad of [NUL, LONE, "\u0007"]) {
		const issue = firstIssue(
			NewsletterSubscribeSchema.safeParse({ email: `reader${bad}.1@example.com` }),
		);
		assertEquals(issue, { path: "email", message: "Enter a valid email address." });
	}
	assert(NewsletterSubscribeSchema.safeParse({ email: "reader.1@example.com" }).success);
});

Deno.test("help feedback: a comment with a NUL or a lone surrogate is the comment's error", () => {
	for (const bad of [NUL, LONE]) {
		const issue = firstIssue(
			HelpFeedbackInputSchema.safeParse({
				slug: "choose-a-project-type",
				helpful: false,
				comment: `missing ${bad} detail`,
			}),
		);
		assertEquals(issue?.path, "comment");
	}
	const ok = HelpFeedbackInputSchema.safeParse({
		slug: "choose-a-project-type",
		helpful: false,
		comment: "It didn't say\nwhat happens to the escrow.",
	});
	assert(ok.success);
});

Deno.test("feedback idea: title, impact and details each refuse unstorable text by name", () => {
	const idea = {
		title: "Bulk export of invoices",
		category: "other",
		impact: "Accountants need every invoice for the year at once.",
		body: "A zip of PDFs would do.",
	};
	assert(FeedbackIdeaCreateSchema.safeParse(idea).success);
	for (const field of ["title", "impact", "body"] as const) {
		for (const bad of [NUL, LONE]) {
			const issue = firstIssue(
				FeedbackIdeaCreateSchema.safeParse({ ...idea, [field]: `${idea[field]} ${bad}` }),
			);
			assertEquals(issue?.path, field, `${field} with ${JSON.stringify(bad)}`);
		}
	}
});

Deno.test("feedback moderation: a note or a response with a NUL is refused", () => {
	assertFalse(FeedbackModerationSchema.safeParse({ status: "ready", note: `n${NUL}` }).success);
	assertFalse(FeedbackModerationSchema.safeParse({ response: `r${LONE}` }).success);
	assert(FeedbackModerationSchema.safeParse({ status: "ready", note: "Planned for Q1." }).success);
});
