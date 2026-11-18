import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { DataExportBackendService } from "@server/services/user/DataExportBackendService.ts";

const SETTINGS = "/settings/account";

/**
 * `GET /api/user/data-export/download` — the stable address of a person's ready archive (Decision
 * #450). Mints a link that works for a minute and **303→** it, so the link is never stored or
 * rendered. Signed out **303→** `/login?redirectTo=/settings/account`; nothing ready (expired,
 * removed, never built) **303→** `/settings/account?export=unavailable#data-export`. Never cached,
 * never sent as a referrer.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const result = await DataExportBackendService.downloadLink(readActor(ctx));
		const location = result.ok && result.data
			? result.data.url
			: result.status === 401
			? `/login?redirectTo=${encodeURIComponent(SETTINGS)}`
			: `${SETTINGS}?export=unavailable#data-export`;
		return new Response(null, {
			status: 303,
			headers: { location, "cache-control": "no-store", "referrer-policy": "no-referrer" },
		});
	},
});
