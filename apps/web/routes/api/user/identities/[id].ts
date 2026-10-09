import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { serviceResponse } from "@web/utils/service-response.ts";
import { IdentitiesBackendService } from "@server/services/auth/IdentitiesBackendService.ts";

/**
 * `DELETE /api/user/identities/[id]` — disconnect one sign-in provider. Refused (409) for the email
 * identity and for the last way to sign in; answers the remaining list.
 */
export const handler = define.handlers({
	async DELETE(ctx) {
		return serviceResponse(await IdentitiesBackendService.unlink(readActor(ctx), ctx.params.id));
	},
});
