import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { serviceResponse } from "@web/utils/service-response.ts";
import { SavedBackendService } from "@server/services/saved/SavedBackendService.ts";

/**
 * `DELETE /api/saved/collections/:id` — delete one of the caller's collections. What was in it stays
 * saved, unfiled.
 */
export const handler = define.handlers({
	async DELETE(ctx) {
		return serviceResponse(await SavedBackendService.deleteCollection(ctx.params.id, readActor(ctx)));
	},
});
