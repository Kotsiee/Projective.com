import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { DataExportBackendService } from "@server/services/user/DataExportBackendService.ts";

const SETTINGS = "/settings/account";

/**
 * `GET /api/user/data-export/download` — a person's ready archive (Decision #450), streamed through
 * the app as an attachment (`projective-data-<date>.zip`, the `delivery` header class), so no signed
 * storage URL reaches the browser (`ASSET_DELIVERY_ARCHITECTURE.md` invariant 2, phase 1). Signed out
 * **303→** `/login?redirectTo=/settings/account`; nothing ready (expired, removed, never built) or
 * storage unreachable **303→** `/settings/account?export=unavailable#data-export`. Never cached, never
 * sent as a referrer.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const result = await DataExportBackendService.download(readActor(ctx), ctx.req.signal);
		if (result.ok && result.data) {
			return new Response(result.data.body, { status: 200, headers: result.data.headers });
		}
		const location = result.status === 401
			? `/login?redirectTo=${encodeURIComponent(SETTINGS)}`
			: `${SETTINGS}?export=unavailable#data-export`;
		return new Response(null, {
			status: 303,
			headers: { location, "cache-control": "no-store", "referrer-policy": "no-referrer" },
		});
	},
});
