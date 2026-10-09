import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { serviceResponse } from "@web/utils/service-response.ts";
import { IdentitiesBackendService } from "@server/services/auth/IdentitiesBackendService.ts";

/**
 * `GET /api/user/identities` — the sign-in providers on the person's account
 * (`{ ok, identities, available, canDisconnect }`).
 */
export const handler = define.handlers({
	async GET(ctx) {
		return serviceResponse(await IdentitiesBackendService.list(readActor(ctx)));
	},
});
