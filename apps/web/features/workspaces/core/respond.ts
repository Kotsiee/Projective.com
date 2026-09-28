import type { ServiceResult } from "@server/services/ServiceResult.ts";
import type { WorkspaceResult } from "../types/results.ts";

/**
 * respond — the single mapper every `/api/workspace/*` (and `/api/context/switch`) route uses to fold a
 * fat-service {@link ServiceResult} into the client {@link WorkspaceResult} HTTP body, echoing the
 * service's suggested status. Mirrors the catalogue / projects / messaging features' `respond.ts`, so
 * the transport shape is defined in exactly one place per feature and a route never invents its own
 * envelope.
 *
 * Note it deliberately does NOT forward `result.session`: session tokens belong in HttpOnly cookies
 * minted by the auth routes, never in a JSON body a script could read.
 */

// #region Envelopes
/** The JSON body for a fat-service result. Shared by the plain POST routes and the three read routes. */
export function toWorkspaceBody<T>(result: ServiceResult<T>): WorkspaceResult<T> {
	return {
		ok: result.ok,
		message: result.message,
		errors: result.errors,
		data: result.data,
	};
}

/** Fold a fat-service result into the workspace HTTP response. */
export function toWorkspaceResponse<T>(result: ServiceResult<T>): Response {
	return Response.json(toWorkspaceBody(result), { status: result.status });
}
// #endregion

// #region Refusals a route answers on its own
/**
 * The `401` every workspace route answers a caller with no session with.
 *
 * Refused at the route, before any parsing: the whole surface is a signed-in member's console, so a
 * guest learning which of their payloads would have validated is information with no use to them.
 * `apiFetch` treats this status as "refresh the session and retry", so an expired token recovers
 * silently rather than surfacing as this sentence.
 */
export function guestRefusal(): Response {
	return Response.json(
		{ ok: false, message: "Sign in to manage your teams and businesses." },
		{ status: 401 },
	);
}

/** A `422` for a payload that failed its schema, with the issues keyed to the fields they concern. */
export function invalidPayload(
	error: {
		issues: ReadonlyArray<{ path: ReadonlyArray<string | number | symbol>; message: string }>;
	},
	message = "Check the highlighted fields.",
): Response {
	return Response.json(
		{ ok: false, message, errors: toFieldErrors(error) },
		{ status: 422 },
	);
}

/** A `400` for a body that is not JSON at all. */
export function unreadableBody(): Response {
	return Response.json({ ok: false, message: "Expected a JSON body." }, { status: 400 });
}
// #endregion

// #region Field errors
/**
 * Fold a Zod `safeParse` error into a field-keyed error map (first message per path wins, so the
 * reader gets the most specific complaint about a field rather than a stack of them).
 *
 * A path-less issue is keyed `form`, which is how a whole-payload complaint reaches a form's general
 * banner instead of being silently dropped.
 */
export function toFieldErrors(
	error: {
		issues: ReadonlyArray<{ path: ReadonlyArray<string | number | symbol>; message: string }>;
	},
): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const issue of error.issues) {
		const key = issue.path.map(String).join(".") || "form";
		if (!errors[key]) errors[key] = issue.message;
	}
	return errors;
}
// #endregion
