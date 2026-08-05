import { define } from "@web/utils/state.ts";
import { toFilesResponse } from "@features/files/core/respond.ts";
import { IntegrationsBackendService } from "@server/services/integrations/IntegrationsBackendService.ts";

/**
 * `GET /api/integrations/providers` — the public provider catalogue, sort-ordered.
 *
 * Delegates to the fat {@link IntegrationsBackendService.providers}. The catalogue is DATA, not an
 * enum, which is why adding a connector is a seed row rather than a migration plus a type change —
 * this route therefore takes no params and filters nothing.
 *
 * Every row is non-sensitive by construction: `defaultScopes` is documentation, and no token or secret
 * has a shape anywhere in `@projective/types/integrations` at all.
 *
 * The transport envelope is the files feature's {@link toFilesResponse} because the connector
 * subsystem has no client feature of its own — the drive picker that consumes it lives in `/files`,
 * and a second identical envelope would be a second place for the shape to drift.
 *
 * No server-side capability guard (Decision #53(b)) — see `../files/list.ts`.
 */
export const handler = define.handlers({
	async GET() {
		return toFilesResponse(await IntegrationsBackendService.providers());
	},
});
