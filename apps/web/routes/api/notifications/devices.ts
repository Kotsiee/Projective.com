import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { invalidFields, serviceResponse } from "@web/utils/service-response.ts";
import { RevokeWebPushSchema, WebPushSubscriptionSchema } from "@projective/types/comms";
import { PushDeviceBackendService } from "@server/services/comms/PushDeviceBackendService.ts";

/**
 * `/api/notifications/devices` — this browser's Web Push subscription (COMMS NT4), thin over
 * {@link PushDeviceBackendService}, under the caller's own session (JSON, origin-guarded):
 *
 * - `POST` `PushSubscription.toJSON()` (+ `label?`) → `comms.register_device` → **201**
 *   `{ deviceId }`. **422** a malformed body or an endpoint that is not a known push service; **404**
 *   while push is not configured.
 * - `DELETE` `{ endpoint }` → `comms.revoke_device` on the caller's live device with that endpoint →
 *   `{ revoked }` (idempotent).
 */
export const handler = define.handlers({
	async POST(ctx) {
		const parsed = WebPushSubscriptionSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidFields(parsed.error.issues);
		return serviceResponse(
			await PushDeviceBackendService.register(
				readActor(ctx),
				parsed.data,
				ctx.req.headers.get("user-agent"),
			),
		);
	},

	async DELETE(ctx) {
		const parsed = RevokeWebPushSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidFields(parsed.error.issues);
		return serviceResponse(await PushDeviceBackendService.revoke(readActor(ctx), parsed.data));
	},
});
