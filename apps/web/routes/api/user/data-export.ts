import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { serviceResponse } from "@web/utils/service-response.ts";
import { DataExportBackendService } from "@server/services/user/DataExportBackendService.ts";

/**
 * `/api/user/data-export` — a person's copy of their own data (Decision #450).
 *
 * - `GET` → `{ ok, dataExport }`: the latest request, when the next may be filed, whether the session
 *   signed in recently enough, and whether an erasure is scheduled.
 * - `POST` (no body) → files a request → `{ ok, message, dataExport }`. Refusals carry
 *   `details.refusal`: 403 `reauth_required` (sign in again), 409 `already_pending` /
 *   `account_closing`, 429 `rate_limited` with `details.retryAt`.
 *
 * The download itself is `GET /api/user/data-export/download`.
 */
export const handler = define.handlers({
	async GET(ctx) {
		return serviceResponse(await DataExportBackendService.state(readActor(ctx)));
	},

	async POST(ctx) {
		return serviceResponse(await DataExportBackendService.request(readActor(ctx)));
	},
});
