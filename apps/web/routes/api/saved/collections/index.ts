import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, serviceResponse } from "@web/utils/service-response.ts";
import { SavedCollectionCreateSchema } from "@projective/types/org";
import { SavedBackendService } from "@server/services/saved/SavedBackendService.ts";

/**
 * `/api/saved/collections` — the caller's named saved collections (Decision #180).
 *
 * - `GET` — `{ collections }`.
 * - `POST { name }` — create one; a name already in use is a 409.
 */
export const handler = define.handlers({
	async GET(ctx) {
		return serviceResponse(await SavedBackendService.collections(readActor(ctx)));
	},

	async POST(ctx) {
		const parsed = SavedCollectionCreateSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalid(parsed.error.issues);
		return serviceResponse(
			await SavedBackendService.createCollection(parsed.data.name, readActor(ctx)),
		);
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
