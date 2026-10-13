import {
	parsePayoutOverride,
	PAYOUT_NOT_READY_REASON,
	PAYOUT_NOT_READY_REFUSAL,
	PAYOUT_OVERRIDE_COOKIE,
	PAYOUT_SETUP_HREF,
	type PayoutGateDetails,
} from "@projective/types/finance";
import { readCookies } from "@web/utils/auth-cookies.ts";

/**
 * Whether the Dev Context Switcher simulates the viewer as not payout-ready (`pj.dev.payout=not_ready`).
 * Honoured only when `DENO_ENV` is `development` (the backend's default when unset); readiness itself
 * is a database fact the routes never read.
 */
export function isPayoutNotReadyRequest(req: Request): boolean {
	if (!isDevelopment()) return false;
	return parsePayoutOverride(readCookies(req)[PAYOUT_OVERRIDE_COOKIE]) === "not_ready";
}

function isDevelopment(): boolean {
	try {
		return (Deno.env.get("DENO_ENV") ?? "development").toLowerCase() === "development";
	} catch {
		return false;
	}
}

/**
 * The API layer's dev mirror of `finance.fn_assert_payout_ready` (Decision #196): the 403 a route that
 * lands a gig or seats a team member answers a simulated not-ready viewer with, in the database's own
 * shape, or `null` to carry on. In live mode the database refuses a really unready person regardless.
 */
export function refuseIfPayoutNotReady(req: Request): Response | null {
	if (!isPayoutNotReadyRequest(req)) return null;
	const details: PayoutGateDetails = {
		reason: PAYOUT_NOT_READY_REASON,
		actor: "self",
		href: PAYOUT_SETUP_HREF,
		members: null,
	};
	return Response.json({ ok: false, message: PAYOUT_NOT_READY_REFUSAL, details }, { status: 403 });
}
