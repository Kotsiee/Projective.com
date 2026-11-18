import {
	parseTermsDueOverride,
	TERMS_DUE_OVERRIDE_COOKIE,
	type UserContext,
} from "@projective/types/auth";
import { readCookies } from "@web/utils/auth-cookies.ts";
import { isDevelopmentEnv } from "@web/utils/app-env.ts";

/**
 * Whether a request must accept the Terms again before it reaches the app (Decision #446): the token's
 * `termsDue` claim, or — when `DENO_ENV` is `development` (never when unset) — the Dev Context
 * Switcher's `pj.dev.terms` override. Chrome only: no door reads it.
 */
export function isTermsDueRequest(
	req: Request,
	context: UserContext | null | undefined,
): boolean {
	if (isDevelopmentEnv()) {
		const override = parseTermsDueOverride(readCookies(req)[TERMS_DUE_OVERRIDE_COOKIE]);
		if (override) return override === "due";
	}
	return context?.termsDue === true;
}
