import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { invalidFields, serviceResponse } from "@web/utils/service-response.ts";
import { RevokeWebPushSchema } from "@projective/types/comms";
import { PushDeviceBackendService } from "@server/services/comms/PushDeviceBackendService.ts";

/**
 * `POST /api/notifications/devices/status` `{ endpoint }` → `{ live, stopped }` (COMMS NT4, PROJECTS NO3): whether this
 * browser's push subscription is the caller's own live device, so Settings → This device shows "on"
 * only for it, never for a browser another account turned on. A POST because the endpoint is a
 * capability URL and must not sit in a query string or an access log. Writes nothing.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const parsed = RevokeWebPushSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidFields(parsed.error.issues);
		const res = serviceResponse(await PushDeviceBackendService.status(readActor(ctx), parsed.data));
		res.headers.set("cache-control", "no-store");
		return res;
	},
});
