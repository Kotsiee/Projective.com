import {
	type EditReviewInput,
	type Reviewable,
	ReviewActionsSchema,
	type ReviewReplyInput,
	type ReviewViewer,
	type SubmitReviewInput,
} from "@projective/types/reviews";
import { z } from "zod";
import { getUserClient, isExploreBackendLive } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { reviewRefusal, toReviewables, toReviewViewers } from "./reviews-model.ts";

/**
 * ReviewsBackendService — the FAT service behind writing a review, the target's one reply, and what a
 * viewer may do to a review on a list (Decision #487; PRODUCT_SPEC §Reputation 3).
 *
 * It decides no rule the database decides. Every call runs as the signed-in person through the
 * definers in `00001670` (`submit_review`, `edit_review`, `withdraw_review`, `reply_to_review`,
 * `edit_reply`, `get_reviewables`, `get_review_actions`), which check the anchor, the party, the
 * 30-day window and the one reply, and answer each refusal with its own SQLSTATE; this service maps
 * those onto HTTP statuses and keeps the database's sentence. With `EXPLORE_BACKEND_LIVE=false` the
 * reads answer nothing to review and a write answers that reviews need the live backend: there is no
 * fixture world of engagements to anchor one on.
 */

const SIGNED_OUT = "Sign in to review what you completed.";
const OFFLINE = "Reviews need the live backend.";
const UNREACHABLE = "We couldn't reach reviews just now. Try again in a moment.";

export class ReviewsBackendService {
	/**
	 * What the signed-in person may review on one project — each provider of the engagement, and the
	 * provider of each of their session seats on it — with their party's review where one exists.
	 * `[]` when they are not its client party or attendee; 404 for a project that does not exist.
	 */
	static async reviewables(projectSlug: string, actor: ReadActor): Promise<ServiceResult<Reviewable[]>> {
		if (!isExploreBackendLive()) return ok([]);
		if (!canReadLive(actor)) return fail(401, { message: SIGNED_OUT });
		try {
			const db = getUserClient(actor.accessToken);
			const { data, error } = await db.schema("reviews").rpc("get_reviewables", {
				p_project_slug: projectSlug,
			});
			if (error) return reviewRefusal(error);
			if (data === null) return fail(404, { message: "No such project." });
			return ok(toReviewables(data));
		} catch (error) {
			console.error("[reviews:reviewables]", error instanceof Error ? error.message : error);
			return fail(503, { message: UNREACHABLE });
		}
	}

	/** Write a review (reviews.submit_review) and answer its id. */
	static async submit(input: SubmitReviewInput, actor: ReadActor): Promise<ServiceResult<{ id: string }>> {
		if (!isExploreBackendLive()) return fail(503, { message: OFFLINE });
		if (!canReadLive(actor)) return fail(401, { message: SIGNED_OUT });
		try {
			const db = getUserClient(actor.accessToken);
			const { data, error } = await db.schema("reviews").rpc("submit_review", {
				p_anchor_kind: input.anchorKind,
				p_anchor_id: input.anchorId,
				p_target_type: input.targetType,
				p_target_id: input.targetId,
				p_rating: input.rating,
				p_title: input.title,
				p_comment: input.comment,
			});
			if (error) return reviewRefusal(error);
			return ok({ id: String(data) }, { status: 201, message: "Review posted." });
		} catch (error) {
			console.error("[reviews:submit]", error instanceof Error ? error.message : error);
			return fail(503, { message: UNREACHABLE });
		}
	}

	/** Rewrite the caller's review while its window is open and before the reply (reviews.edit_review). */
	static async edit(reviewId: string, input: EditReviewInput, actor: ReadActor): Promise<ServiceResult<null>> {
		return await ReviewsBackendService.call("edit_review", {
			p_review: reviewId,
			p_rating: input.rating,
			p_title: input.title,
			p_comment: input.comment,
		}, actor, "Review updated.");
	}

	/** Withdraw the caller's review: kept, gone from every reader (reviews.withdraw_review). */
	static async withdraw(reviewId: string, actor: ReadActor): Promise<ServiceResult<null>> {
		return await ReviewsBackendService.call("withdraw_review", { p_review: reviewId }, actor, "Review withdrawn.");
	}

	/** The target's one public reply (reviews.reply_to_review). */
	static async reply(reviewId: string, input: ReviewReplyInput, actor: ReadActor): Promise<ServiceResult<null>> {
		return await ReviewsBackendService.call("reply_to_review", { p_review: reviewId, p_body: input.body }, actor, "Reply posted.");
	}

	/** Rewrite the reply, for 7 days after it was posted (reviews.edit_reply). */
	static async editReply(reviewId: string, input: ReviewReplyInput, actor: ReadActor): Promise<ServiceResult<null>> {
		return await ReviewsBackendService.call("edit_reply", { p_review: reviewId, p_body: input.body }, actor, "Reply updated.");
	}

	/**
	 * What the viewer may do to each review on a list — edit or withdraw their own, reply or edit the
	 * reply for what they answer for — keyed by review id. Empty for a guest, and when reviews are not
	 * live: a list then renders no actions rather than actions that would fail.
	 */
	static async viewerActions(
		reviewIds: string[],
		actor: ReadActor,
	): Promise<ServiceResult<Record<string, ReviewViewer>>> {
		if (!reviewIds.length || !isExploreBackendLive() || !canReadLive(actor)) return ok({});
		try {
			const db = getUserClient(actor.accessToken);
			const { data, error } = await db.schema("reviews").rpc("get_review_actions", { p_ids: reviewIds });
			if (error) return reviewRefusal(error);
			return ok(toReviewViewers(z.array(ReviewActionsSchema).parse(data ?? [])));
		} catch (error) {
			console.error("[reviews:actions]", error instanceof Error ? error.message : error);
			return ok({});
		}
	}

	// #region One door call
	private static async call(
		door: "edit_review" | "withdraw_review" | "reply_to_review" | "edit_reply",
		args: Record<string, unknown>,
		actor: ReadActor,
		message: string,
	): Promise<ServiceResult<null>> {
		if (!isExploreBackendLive()) return fail(503, { message: OFFLINE });
		if (!canReadLive(actor)) return fail(401, { message: SIGNED_OUT });
		try {
			const db = getUserClient(actor.accessToken);
			const { error } = await db.schema("reviews").rpc(door, args);
			if (error) return reviewRefusal(error);
			return ok(null, { message });
		} catch (error) {
			console.error(`[reviews:${door}]`, error instanceof Error ? error.message : error);
			return fail(503, { message: UNREACHABLE });
		}
	}
	// #endregion
}
