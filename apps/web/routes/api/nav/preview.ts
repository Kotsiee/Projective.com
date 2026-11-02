import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { NavPreviewKind } from "@projective/types/user";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, serviceResponse } from "@web/utils/service-response.ts";
import { NavPreviewBackendService } from "@server/services/user/NavPreviewBackendService.ts";

/**
 * `GET /api/nav/preview?kind=messages|projects|catalogue|teams|businesses` — thin route: validate the
 * destination, then delegate to the fat {@link NavPreviewBackendService} for the viewer's top rows,
 * saved and starred things pinned first (Decision #370). The rail asks for it only when a right-click
 * menu opens, never on page load. A guest gets a 401.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const kind = NavPreviewKind.safeParse(ctx.url.searchParams.get("kind"));
		if (!kind.success) return invalidBody("kind", "Unknown preview.");
		const context = asAuthenticatedContext(ctx.state.userContext);
		return serviceResponse(
			await NavPreviewBackendService.preview(kind.data, readActor(ctx), context.displayCurrency),
		);
	},
});
