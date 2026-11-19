import type { ServiceResult } from "@server/services/ServiceResult.ts";

/**
 * The one HTTP mapping every `/api/reviews/*` route uses (Decision #487), the same transport shape as
 * the catalogue and projects features' `respond.ts`: the service's envelope as the body, its
 * suggested status echoed.
 */

/** The body a reviews route answers with. */
export interface ReviewsResult<T> {
	ok: boolean;
	message?: string;
	errors?: Record<string, string>;
	data?: T;
}

/** Fold a {@link ServiceResult} into the response body and status. */
export function toReviewsResponse<T>(result: ServiceResult<T>): Response {
	const body: ReviewsResult<T> = {
		ok: result.ok,
		message: result.message,
		errors: result.errors,
		data: result.data,
	};
	return Response.json(body, { status: result.status });
}

/** A write's JSON body, parsed on its content; unparseable is `null`, which every schema refuses. */
export async function readJsonBody(req: Request): Promise<unknown> {
	const text = await req.text().catch(() => "");
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/** The 401 a reviews write answers a signed-out caller with, before its body is read. */
export function signedOut(): Response {
	return Response.json({ ok: false, message: "Sign in to review what you completed." }, { status: 401 });
}

/** The 422 for a body its schema refuses, keyed by field path (first message per path wins). */
export function invalid(
	error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> },
): Response {
	const errors: Record<string, string> = {};
	for (const issue of error.issues) {
		const key = issue.path.map(String).join(".") || "form";
		if (!errors[key]) errors[key] = issue.message;
	}
	return Response.json({ ok: false, message: "Check the highlighted fields.", errors }, { status: 422 });
}

/** A review id from the path, or `null` when it is not a uuid (the route answers 404). */
export function reviewIdOf(raw: string | undefined): string | null {
	return raw && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
}

/** The 404 for a path that names no review. */
export function noReview(): Response {
	return Response.json({ ok: false, message: "No such review." }, { status: 404 });
}
