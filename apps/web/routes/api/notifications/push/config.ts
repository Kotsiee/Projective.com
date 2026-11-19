import { define } from "@web/utils/state.ts";
import { serviceResponse } from "@web/utils/service-response.ts";
import { PushDeviceBackendService } from "@server/services/comms/PushDeviceBackendService.ts";

/**
 * `GET /api/notifications/push/config` — the VAPID public key a browser subscribes with (COMMS NT4;
 * providers spec §8.2): `{ publicKey }`, or **404** while push is not configured (no well-formed
 * `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`), in which case Settings offers no
 * device control. The key is public by design; nothing else is served.
 */
export const handler = define.handlers({
	GET() {
		const res = serviceResponse(PushDeviceBackendService.config());
		res.headers.set("cache-control", "no-store");
		return res;
	},
});
