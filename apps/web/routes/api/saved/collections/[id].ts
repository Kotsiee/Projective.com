import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, serviceResponse } from "@web/utils/service-response.ts";
import { SavedCollectionCreateSchema } from "@projective/types/org";
import { SavedBackendService } from "@server/services/saved/SavedBackendService.ts";

/**
 * `/api/saved/collections/:id` — one of the caller's collections (a "list" in the UI).
 *
 * - `PATCH { name }` — rename it; a name already in use is a 409.
 * - `DELETE` — delete it. What was in it stays saved, unfiled.
 */
export const handler = define.handlers({
	async PATCH(ctx) {
		const parsed = SavedCollectionCreateSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return invalidBody("name", parsed.error.issues[0]?.message ?? "Name the list.");
		}
		return serviceResponse(
			await SavedBackendService.renameCollection(ctx.params.id, parsed.data.name, readActor(ctx)),
		);
	},

	async DELETE(ctx) {
		return serviceResponse(
			await SavedBackendService.deleteCollection(ctx.params.id, readActor(ctx)),
		);
	},
});
