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

/** Fold a fat-service result into the workspace HTTP response. */
export function toWorkspaceResponse<T>(result: ServiceResult<T>): Response {
	const body: WorkspaceResult<T> = {
		ok: result.ok,
		message: result.message,
		errors: result.errors,
		data: result.data,
	};
	return Response.json(body, { status: result.status });
}

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
