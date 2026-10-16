import {
	OPERATOR_MODE_OVERRIDE_COOKIE,
	parseOperatorModeOverride,
	type UserContext,
} from "@projective/types/auth";
import {
	TEAM_PERSONA_REASON,
	TEAM_PERSONA_REFUSAL,
	type TeamPersonaDetails,
} from "@projective/types/workspace";
import { canUseTeams } from "@features/shell/core/restricted-surfaces.ts";
import { isRestrictedRequest } from "@web/utils/age-gate.ts";
import { readCookies } from "@web/utils/auth-cookies.ts";

/**
 * Whether a request acts in operator mode: the token's `isOperator` claim, or — when `DENO_ENV` is
 * `development` (the backend's default when unset) — the Dev Context Switcher's `pj.dev.operator-mode`
 * override.
 */
export function isOperatorRequest(req: Request, context: UserContext | null | undefined): boolean {
	const override = isDevelopment()
		? parseOperatorModeOverride(readCookies(req)[OPERATOR_MODE_OVERRIDE_COOKIE])
		: null;
	if (override) return override === "on";
	return context?.isOperator === true;
}

/**
 * Whether a request's context may use Teams ({@link canUseTeams}), with the dev overrides for operator
 * mode and age applied — the dashboard guard's answer for `/teams*`.
 */
export function mayUseTeamsRequest(req: Request, context: UserContext | null | undefined): boolean {
	if (!context) return false;
	return canUseTeams({
		contextType: context.contextType,
		isFreelancer: context.isFreelancer,
		isOperator: isOperatorRequest(req, context),
		restricted: isRestrictedRequest(req, context),
	});
}

/**
 * The team create route's dev mirror of `org.fn_assert_team_persona` (Decision #228 (A)): the persona
 * 403 for a simulated operator (`pj.dev.operator-mode=on`), in the database's own shape, or `null` to
 * carry on. Development only — in live mode the database refuses a real client or operator itself.
 */
export function refuseIfSimulatedOperator(req: Request): Response | null {
	if (!isDevelopment()) return null;
	if (parseOperatorModeOverride(readCookies(req)[OPERATOR_MODE_OVERRIDE_COOKIE]) !== "on") {
		return null;
	}
	const details: TeamPersonaDetails = {
		reason: TEAM_PERSONA_REASON,
		actor: "self",
		persona: "operator",
	};
	return Response.json({ ok: false, message: TEAM_PERSONA_REFUSAL, details }, { status: 403 });
}

function isDevelopment(): boolean {
	try {
		return (Deno.env.get("DENO_ENV") ?? "development").toLowerCase() === "development";
	} catch {
		return false;
	}
}
