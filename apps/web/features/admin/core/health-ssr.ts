import type { HealthBody } from "@projective/types/ops";
import { OpsHealthService } from "@server/services/ops/OpsHealthService.ts";

/**
 * health-ssr — the HTTP half of `GET /api/ops/health` (OPS5), the heartbeat an outside monitor polls
 * every 5 minutes with `OPS_HEALTH_TOKEN`. Kept here so the route stays one line and its 404 / 200 /
 * 503 contract is unit-tested. Server only: never import it from an island.
 *
 * It checks the bearer in constant time BEFORE reading anything else and answers 404 otherwise, as
 * every scheduler route does. The body is `{ ok }` and nothing more: which condition failed is the
 * operator's to read in the database, not the monitor's.
 */

/** The heartbeat, as the door sees it; the live service by default, a stub in tests. */
export interface HealthDeps {
	isAuthorised: (authorization: string | null) => boolean;
	heartbeat: () => Promise<HealthBody>;
}

const LIVE: HealthDeps = {
	isAuthorised: (authorization) => OpsHealthService.isHealthAuthorised(authorization),
	heartbeat: () => OpsHealthService.heartbeat(),
};

const NO_STORE = { "cache-control": "no-store" };

/** 200 `{ok: true}` when the platform is healthy, 503 `{ok: false}` when not, 404 without the bearer. */
export async function answerHealth(req: Request, deps: HealthDeps = LIVE): Promise<Response> {
	if (!deps.isAuthorised(req.headers.get("authorization"))) {
		return new Response(null, { status: 404, headers: NO_STORE });
	}
	const { ok } = await deps.heartbeat();
	return Response.json({ ok }, { status: ok ? 200 : 503, headers: NO_STORE });
}
