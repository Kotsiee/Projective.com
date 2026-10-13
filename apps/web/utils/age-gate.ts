import {
	AGE_OVERRIDE_COOKIE,
	AGE_RESTRICTED_REASON,
	parseAgeOverride,
	RESTRICTED_REFUSAL,
	type UserContext,
} from "@projective/types/auth";
import { readCookies } from "@web/utils/auth-cookies.ts";

/**
 * Whether a request acts as a restricted (13–17) account: the token's `isRestricted` claim, or — when
 * `DENO_ENV` is `development` (the backend's default when unset) — the Dev Context Switcher's
 * `pj.dev.age` override.
 */
export function isRestrictedRequest(
	req: Request,
	context: UserContext | null | undefined,
): boolean {
	if (isDevelopment()) {
		const override = parseAgeOverride(readCookies(req)[AGE_OVERRIDE_COOKIE]);
		if (override) return override === "minor";
	}
	return context?.restricted === true;
}

function isDevelopment(): boolean {
	try {
		return (Deno.env.get("DENO_ENV") ?? "development").toLowerCase() === "development";
	} catch {
		return false;
	}
}

/**
 * The API layer's mirror of `org.fn_assert_adult` (Decision #190): the 403 a buy/sell route answers a
 * restricted account with before it calls a service, or `null` to carry on. The database refuses the
 * same request on its own, so this only spares the round trip and keeps the copy uniform.
 */
export function refuseIfRestricted(
	req: Request,
	context: UserContext | null | undefined,
): Response | null {
	if (!isRestrictedRequest(req, context)) return null;
	return Response.json(
		{ ok: false, message: RESTRICTED_REFUSAL, details: { reason: AGE_RESTRICTED_REASON } },
		{ status: 403 },
	);
}
