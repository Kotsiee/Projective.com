import {
	type ClientTrustWarning,
	ClientTrustWarningRowSchema,
	type Reviewable,
	ReviewableSchema,
	type ReviewActions,
	type ReviewViewer,
} from "@projective/types/reviews";
import { z } from "zod";
import { fail, type ServiceResult } from "../ServiceResult.ts";
import { mediaUrl, parseMediaRef } from "../files/public-media.ts";

/**
 * reviews-model — the pure mapping between the review doors (`00001670`, Decision #487) and the app:
 * each refusal's SQLSTATE onto an HTTP status, and the two reads into their app shapes. No client, no
 * environment, so it loads under `deno test`.
 */

const UNREACHABLE = "We couldn't reach reviews just now. Try again in a moment.";

// #region Refusals
/** A door's refusal (SQLSTATE + message) onto a ServiceResult; the message is the database's own. */
export function reviewRefusal<T>(error: { code?: string; message?: string }): ServiceResult<T> {
	const message = error.message?.replace(
		/^(review|reply|hide|reviewables|warning|acknowledgement) refused: /,
		"",
	) ??
		UNREACHABLE;
	const sentence = message.charAt(0).toUpperCase() + message.slice(1) +
		(message.endsWith(".") ? "" : ".");
	switch (error.code) {
		case "42501":
			return fail(403, { message: sentence });
		case "PM403":
		case "PT403":
			return fail(403, { message: sentence });
		case "PT404":
			return fail(404, { message: sentence });
		case "PT409":
			return fail(409, { message: sentence });
		case "PT410":
			return fail(410, { message: sentence });
		case "22023":
		case "PT422":
			return fail(422, { message: sentence });
		case "PT501":
			return fail(501, { message: sentence });
		case "PT428":
			return fail(428, { message: sentence });
		default:
			return fail(503, { message: UNREACHABLE });
	}
}
// #endregion

// #region Mapping
/** get_reviewables' items, each target's avatar ref resolved to its public URL. */
export function toReviewables(raw: unknown): Reviewable[] {
	const rows = Array.isArray(raw) ? raw : [];
	return z.array(ReviewableSchema).parse(rows.map((row) => {
		const target = (row as { target?: { avatar?: unknown } | null }).target;
		return target
			? { ...row, target: { ...target, avatar: mediaUrl(parseMediaRef(target.avatar), "sm") } }
			: row;
	}));
}

/** reviews.get_client_trust_warning's answer in the app's casing (Decision #486 (C)). */
export function toClientTrustWarning(raw: unknown): ClientTrustWarning {
	const row = ClientTrustWarningRowSchema.parse(raw);
	if (!row.warned) {
		return {
			warned: false,
			score: null,
			reviewCount: null,
			reviewsHref: null,
			acknowledged: false,
		};
	}
	return {
		warned: true,
		score: row.score,
		reviewCount: row.review_count,
		reviewsHref: row.reviews_href,
		acknowledged: row.acknowledged,
	};
}

/** get_review_actions' rows, keyed by review id, in the app's casing. */
export function toReviewViewers(rows: ReviewActions[]): Record<string, ReviewViewer> {
	const out: Record<string, ReviewViewer> = {};
	for (const r of rows) {
		out[r.id] = {
			canEdit: r.can_edit,
			canReply: r.can_reply,
			canEditReply: r.can_edit_reply,
			editHref: r.edit_href,
		};
	}
	return out;
}
// #endregion
