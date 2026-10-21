import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { apiSellerActor } from "@features/catalogue/core/seller-scope.ts";
import { UpdateListingInputSchema } from "@projective/types/catalogue";
import {
	invalid,
	readJsonBody,
	signedOut,
	toCatalogueResponse,
} from "@features/catalogue/core/respond.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";

/**
 * `POST /api/catalogue/update` — thin route: Zod-validate the Update-Listing patch (a partial over
 * the editable body), then delegate to the fat {@link CatalogueBackendService.update}, which saves
 * the listing and its product or service blueprint together (`catalogue.save_listing`) as the
 * seller who created it. The workspace calls this on debounced autosave, and flushes through it
 * with `navigator.sendBeacon` when the page is hidden, so the body is read as JSON whether it
 * arrives as `application/json` or as a beacon's `text/plain`. A stale `expectedUpdatedAt` is a
 * 409.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = await apiSellerActor(ctx.url, readActor(ctx));
		if (actor instanceof Response) return actor;
		if (!actor.userId) return signedOut();
		const parsed = UpdateListingInputSchema.safeParse(await readJsonBody(ctx.req));
		if (!parsed.success) return invalid(parsed.error);
		return toCatalogueResponse(await CatalogueBackendService.update(parsed.data, actor));
	},
});
