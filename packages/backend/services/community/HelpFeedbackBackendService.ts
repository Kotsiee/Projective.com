import {
	type HelpFeedbackInput,
	HelpFeedbackInputSchema,
	type HelpFeedbackResult,
	HelpFeedbackRpcResultSchema,
} from "@projective/types/community";
import { isHelpCentreArticleVisible } from "@projective/types/editorial";
import { UNSTORABLE_TEXT_MESSAGE } from "@projective/types/content/text";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getAnonClient, getUserClient } from "../../core/supabase.ts";
import { type RateLimitRule, SlidingWindowLimiter } from "../../core/rate-limit.ts";
import { isUnstorableInputError } from "../../core/text.ts";
import { communityRpc, communitySource } from "./community-source.ts";
import { HELP_ARTICLES } from "../editorial/content/help.ts";

/**
 * HelpFeedbackBackendService — the FAT service behind `POST /api/help/feedback`, the help centre's
 * "Was this helpful?" (P2, Decision #274).
 *
 * The thin route parses the body and hands over who is asking — the verified access token of a
 * signed-in reader, and the request's transport address — and this service decides the rest:
 *
 *  - **Validation** against the Zod SSOT (`HelpFeedbackInputSchema`): a comment only with a "No", at
 *    most 280 characters.
 *  - **The first rate limit**, per process: {@link HELP_FEEDBACK_RULE} per signed-in voter, and
 *    {@link HELP_FEEDBACK_GUEST_RULE} per transport address for a guest — looser, because behind a
 *    proxy many guests can share one address (the deployment names no trusted client-IP header yet).
 *    The durable limits are the writer's own (`PH429`): see `community.submit_help_feedback`.
 *  - **The write**, live (`COMMUNITY_BACKEND_LIVE`): `community.submit_help_feedback` with the
 *    caller's own client — the voter's JWT client, so the writer stamps them from `auth.uid()`, or
 *    the anon client for a guest. The writer refuses an unpublished article (`PH404` → 404), masks a
 *    comment through `comms.mask_pii` and quietly ignores a signed-in voter's second vote on an
 *    article inside a day; both answer the same thanks.
 *  - **The fixture road** (gate off): validated and answered, nothing stored — the article is checked
 *    against the help content source, so a vote on a missing article is the same 404 either way.
 */

// #region Limits
/** At most ten votes per signed-in voter in ten minutes, per process — a double press is fine, a script is not. */
export const HELP_FEEDBACK_RULE: RateLimitRule = { max: 10, windowMs: 10 * 60_000 };

/** At most twenty guest votes per transport address a minute, per process. */
export const HELP_FEEDBACK_GUEST_RULE: RateLimitRule = { max: 20, windowMs: 60_000 };

const voterLimiter = new SlidingWindowLimiter(HELP_FEEDBACK_RULE);
const guestLimiter = new SlidingWindowLimiter(HELP_FEEDBACK_GUEST_RULE);

/** The thanks every accepted vote answers. */
export const HELP_FEEDBACK_THANKS = "Thanks for telling us.";
// #endregion

// #region Seams
/**
 * The writer call, given the voter's access token (`null` for a guest); injectable so tests run
 * without a database.
 */
export type HelpFeedbackRpc = (
	accessToken: string | null,
	args: { p_article_slug: string; p_helpful: boolean; p_comment: string | null },
) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;

/** Who is voting, as the route resolved it. */
export interface HelpFeedbackVoter {
	/** The verified session's access token, when the reader is signed in. */
	accessToken?: string;
	/** The signed-in user's id, when there is one — the per-process limit's key. */
	userId?: string;
	/** The request's transport address — a guest's per-process limit key. */
	clientKey: string;
}

/** Overrides for {@link HelpFeedbackBackendService.submit} — tests pass them; the route passes none. */
export interface HelpFeedbackDeps {
	/** Force the live or the fixture road instead of reading the gate. */
	live?: boolean;
	/** The writer call. */
	rpc?: HelpFeedbackRpc;
	/** The signed-in voters' limiter; defaults to the process-wide one. */
	limiter?: SlidingWindowLimiter;
	/** The guests' limiter; defaults to the process-wide one. */
	guestLimiter?: SlidingWindowLimiter;
	/** "Today" for the fixture road's visibility check. */
	now?: Date;
}

/** The default writer: `community.submit_help_feedback` as the caller (their JWT, or anon). */
const callerRpc: HelpFeedbackRpc = (accessToken, args) =>
	communityRpc(
		accessToken ? getUserClient(accessToken) : getAnonClient(),
		"submit_help_feedback",
		args,
	);
// #endregion

export class HelpFeedbackBackendService {
	/** Record one "Was this helpful?" answer (see the class docblock). */
	static async submit(
		input: unknown,
		voter: HelpFeedbackVoter,
		deps: HelpFeedbackDeps = {},
	): Promise<ServiceResult<HelpFeedbackResult>> {
		const parsed = HelpFeedbackInputSchema.safeParse(input);
		if (!parsed.success) {
			const first = parsed.error.issues[0];
			return fail(422, {
				message: first?.message ?? "Check your answer and try again.",
				errors: { [first?.path.join(".") || "helpful"]: first?.message ?? "Invalid answer." },
			});
		}
		const vote: HelpFeedbackInput = parsed.data;

		const decision = voter.userId
			? (deps.limiter ?? voterLimiter).take(`user:${voter.userId}`)
			: (deps.guestLimiter ?? guestLimiter).take(`client:${voter.clientKey}`);
		if (!decision.allowed) return tooMany(decision.retryAfterMs);

		const result: HelpFeedbackResult = { slug: vote.slug, helpful: vote.helpful };
		const live = deps.live ?? communitySource() === "live";
		if (!live) {
			const today = (deps.now ?? new Date()).toISOString().slice(0, 10);
			const known = HELP_ARTICLES.some((a) =>
				a.slug === vote.slug && isHelpCentreArticleVisible(a, today)
			);
			if (!known) return notFound();
			return ok(result, { message: HELP_FEEDBACK_THANKS });
		}

		const { data, error } = await (deps.rpc ?? callerRpc)(voter.accessToken ?? null, {
			p_article_slug: vote.slug,
			p_helpful: vote.helpful,
			p_comment: vote.comment ?? null,
		});
		if (error) {
			if (error.code === "PH404") return notFound();
			if (error.code === "PH429") return tooMany(60 * 60_000);
			if (error.code === "22023") {
				return fail(422, { message: error.message, errors: { comment: error.message } });
			}
			if (isUnstorableInputError(error.code)) {
				return fail(422, {
					message: UNSTORABLE_TEXT_MESSAGE,
					errors: { comment: UNSTORABLE_TEXT_MESSAGE },
				});
			}
			return fail(503, {
				message: "We couldn't save that just now. Please try again shortly.",
				details: { code: error.code ?? null },
			});
		}
		if (!HelpFeedbackRpcResultSchema.safeParse(data).success) {
			return fail(502, {
				message: "We couldn't confirm that was saved. Please try again shortly.",
			});
		}
		return ok(result, { message: HELP_FEEDBACK_THANKS });
	}
}

/** The 404 a vote on an article nobody can read answers. */
function notFound(): ServiceResult<HelpFeedbackResult> {
	return fail(404, { message: "That help article doesn't exist." });
}

/** The 429 a voter over a limit answers, with when to try again. */
function tooMany(retryAfterMs: number): ServiceResult<HelpFeedbackResult> {
	return fail(429, {
		message: "You've sent a lot of answers in a short time. Please try again later.",
		details: { retryAt: new Date(Date.now() + retryAfterMs).toISOString() },
	});
}
