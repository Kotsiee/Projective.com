import { define } from "@web/utils/state.ts";
import { clientKey } from "@web/utils/client-key.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";

/**
 * `/api/auth/*` — every GoTrue call these routes make forwards the caller's address
 * (`X-Forwarded-For`), so GoTrue's own per-IP limits count the client rather than this server
 * (IW-H3). The address is the one the app's limiter keys on, never a header the client wrote.
 */
export default define.middleware((ctx) =>
	AuthBackendService.withClientAddress(
		clientKey(ctx.info.remoteAddr, ctx.req.headers),
		() => ctx.next(),
	)
);
