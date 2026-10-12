import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, serviceResponse } from "@web/utils/service-response.ts";
import { SavedListParamsSchema, SavedToggleSchema } from "@projective/types/org";
import { SavedBackendService } from "@server/services/saved/SavedBackendService.ts";

/** POST body — the thing to save, optionally filed into a collection. */
const SaveSchema = SavedToggleSchema.omit({ saved: true });

/**
 * `/api/saved` — thin routes over {@link SavedBackendService} (Decision #174). The actor comes from the
 * session; the service answers 401 for a guest and 503 without the live backend.
 *
 * - `GET ?tab=&collection=&cursor=&limit=` — one page of saved things + the caller's collections.
 * - `POST { type, ref, collectionId? }` — save (idempotent); with `collectionId`, file or re-file it.
 * - `DELETE ?type=&ref=` — un-save (idempotent).
 */
export const handler = define.handlers({
	async GET(ctx) {
		const q = ctx.url.searchParams;
		const parsed = SavedListParamsSchema.safeParse({
			tab: q.get("tab") ?? undefined,
			collection: q.get("collection") ?? undefined,
			cursor: q.get("cursor") ?? undefined,
			limit: q.get("limit") ?? undefined,
		});
		if (!parsed.success) return invalid(parsed.error.issues);
		return serviceResponse(await SavedBackendService.list(parsed.data, readActor(ctx)));
	},

	async POST(ctx) {
		const parsed = SaveSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalid(parsed.error.issues);
		return serviceResponse(
			await SavedBackendService.toggle({ ...parsed.data, saved: true }, readActor(ctx)),
		);
	},

	async DELETE(ctx) {
		const q = ctx.url.searchParams;
		const parsed = SavedToggleSchema.safeParse({
			type: q.get("type"),
			ref: q.get("ref"),
			saved: false,
		});
		if (!parsed.success) return invalid(parsed.error.issues);
		return serviceResponse(await SavedBackendService.toggle(parsed.data, readActor(ctx)));
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
