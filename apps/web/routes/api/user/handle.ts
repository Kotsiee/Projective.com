import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, serviceResponse } from "@web/utils/service-response.ts";
import { ChangeHandleSchema } from "@projective/types/org";
import { AccountLifecycleBackendService } from "@server/services/user/AccountLifecycleBackendService.ts";

/**
 * `GET` / `POST /api/user/handle` — the person's @handle and the change policy.
 *
 * - `GET` → `{ ok, policy }`.
 * - `POST { handle }` → `{ ok, message, policy, previous }`; refusals carry their code in
 *   `details.refusal` (`handle_locked` · `handle_refused` · …) and a namespace refusal its sentence in
 *   `errors.handle`. The caller renews the session afterwards — the token carries the handle.
 *
 * Thin: the actor comes from the session, the body is Zod-validated, the rule is the definer's.
 */
export const handler = define.handlers({
	async GET(ctx) {
		return serviceResponse(await AccountLifecycleBackendService.handlePolicy(readActor(ctx)));
	},

	async POST(ctx) {
		const parsed = ChangeHandleSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return invalidBody("handle", "Enter a handle between 3 and 40 characters.");
		}
		return serviceResponse(
			await AccountLifecycleBackendService.changeHandle(readActor(ctx), parsed.data),
		);
	},
});
