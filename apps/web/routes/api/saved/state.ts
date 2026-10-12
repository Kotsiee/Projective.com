import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, serviceResponse } from "@web/utils/service-response.ts";
import { SavedStateQuerySchema } from "@projective/types/org";
import { SavedBackendService } from "@server/services/saved/SavedBackendService.ts";

/**
 * `GET /api/saved/state?keys=service:slug,profile:handle,…` — which of these the caller has saved, for
 * the cards and lanes whose own read carries no saved flag. Answers `{ saved: string[] }` (the keys as
 * asked). Kinds: service · product · article · profile · project.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const keys = (ctx.url.searchParams.get("keys") ?? "").split(",").filter((k) => k.length > 0);
		const parsed = SavedStateQuerySchema.safeParse({ keys });
		if (!parsed.success) return invalid(parsed.error.issues);
		return serviceResponse(await SavedBackendService.state(parsed.data.keys, readActor(ctx)));
	},
});

/** The 422 for a refused query or body, keyed to its first issue's field. */
function invalid(
	issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): Response {
	const issue = issues[0];
	return invalidBody(
		issue?.path.map(String).join(".") || "form",
		issue?.message ?? "Check the request.",
	);
}
