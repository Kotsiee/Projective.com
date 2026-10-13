import {
	OPERATOR_DESK_OVERRIDE_COOKIE,
	type OperatorDeskOverride,
	parseOperatorDeskOverride,
} from "@projective/types/finance";
import { readCookies } from "@web/utils/auth-cookies.ts";

/**
 * The Dev Context Switcher's operator-desk preview (`pj.dev.operator`, the `operatorDesk` axis): which
 * sample queue `/admin/disputes` renders instead of the live read, or `null` for none. Honoured only
 * when `DENO_ENV` is `development` (the backend's default when unset). It grants nothing: the page
 * renders sample cases, and a ruling on one still goes to the database, which refuses it.
 */
export function operatorDeskOverride(req: Request): OperatorDeskOverride | null {
	if (!isDevelopment()) return null;
	return parseOperatorDeskOverride(readCookies(req)[OPERATOR_DESK_OVERRIDE_COOKIE]);
}

function isDevelopment(): boolean {
	try {
		return (Deno.env.get("DENO_ENV") ?? "development").toLowerCase() === "development";
	} catch {
		return false;
	}
}
