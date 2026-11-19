import { serviceResponse } from "@web/utils/service-response.ts";
import {
	DEFAULT_ALERT_LIMIT,
	MAX_ALERT_LIMIT,
	OpsAlertService,
} from "@server/services/ops/OpsAlertService.ts";

/**
 * alert-sweep-ssr — the HTTP half of `POST /api/ops/cron/alerts`, the `ops-deliver-alerts` job (MR4,
 * Decision #461), kept here so the route stays one line and its 404 / 200 contract is unit-tested.
 * Server only: never import it from an island.
 *
 * It checks `OPS_CRON_SECRET` in constant time BEFORE reading anything else and answers 404 otherwise,
 * as every cron route does: an endpoint that sends on Projective's behalf does not advertise itself.
 */

/** The sweep, as the door sees it; the live service by default, a stub in tests. */
export interface AlertSweepDeps {
	isAuthorised: (authorization: string | null) => boolean;
	deliver: typeof OpsAlertService.deliver;
}

const LIVE: AlertSweepDeps = {
	isAuthorised: (authorization) => OpsAlertService.isCronAuthorised(authorization),
	deliver: (limit) => OpsAlertService.deliver(limit),
};

/** One sweep, its batch bounded to 1–500 (`limit`, default 50). The body is ignored. */
export async function answerAlertSweep(
	req: Request,
	url: URL,
	deps: AlertSweepDeps = LIVE,
): Promise<Response> {
	if (!deps.isAuthorised(req.headers.get("authorization"))) {
		return new Response(null, { status: 404 });
	}
	const requested = Number(url.searchParams.get("limit") ?? DEFAULT_ALERT_LIMIT) ||
		DEFAULT_ALERT_LIMIT;
	const limit = Math.min(Math.max(Math.trunc(requested), 1), MAX_ALERT_LIMIT);
	return serviceResponse(await deps.deliver(limit));
}
