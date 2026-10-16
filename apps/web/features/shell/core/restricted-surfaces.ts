import type { UserContext } from "@projective/types/auth";

/**
 * The surfaces a restricted (13–17) account never sees (PRODUCT_SPEC §Age guardrails, Decision #192):
 * money, selling and the workspaces that exist to buy or sell. One list, read by the dashboard guard
 * (a direct visit is sent home) and by the chrome (the entry is left out), so a hidden link and a
 * guarded page can never disagree. The database refuses every action behind them on its own
 * (`org.fn_assert_adult`); this decides only what is drawn.
 */
export const RESTRICTED_PATH_PREFIXES: readonly string[] = [
	"/wallet",
	"/businesses",
	"/basket",
	"/checkout",
	"/catalogue",
	"/services",
	"/products",
	"/teams",
	"/analytics",
	"/become-partner",
	"/settings/verification",
	"/settings/billing",
	"/settings/scheduling",
];

/** Whether `path` is, or sits under, one of {@link RESTRICTED_PATH_PREFIXES}. */
export function isRestrictedPath(path: string): boolean {
	return RESTRICTED_PATH_PREFIXES.some((prefix) =>
		path === prefix || path.startsWith(`${prefix}/`)
	);
}

/** Where the dashboard guard sends a restricted account that asked for a hidden surface. */
export const RESTRICTED_FALLBACK_PATH = "/home";

// #region Teams persona
/** The surface the Teams persona rule governs, at any depth. */
export const TEAMS_PATH_PREFIX = "/teams";

/** The `?notice=` code the dashboard guard carries when it sends a refused persona home. */
export const TEAMS_PERSONA_NOTICE = "teams-freelancer";

/** The facts the Teams persona rule reads from a context. */
export type TeamsPersonaFacts = Pick<
	UserContext,
	"contextType" | "isFreelancer" | "isOperator" | "restricted"
>;

/**
 * Whether a context may use Teams (Decision #228 (A)): a freelancer outside operator mode, or a member
 * acting as a team. A restricted (13–17) account never may. The one predicate behind the sidebar's
 * Teams entry, the Create menu, the account popover and the dashboard guard; the database refuses
 * every team write on its own (`org.fn_assert_team_persona`).
 */
export function canUseTeams(context: TeamsPersonaFacts): boolean {
	if (context.restricted) return false;
	return context.contextType === "team" || (context.isFreelancer && !context.isOperator);
}

/** Whether `path` is `/teams` or sits under it. */
export function isTeamsPath(path: string): boolean {
	return path === TEAMS_PATH_PREFIX || path.startsWith(`${TEAMS_PATH_PREFIX}/`);
}

/** Where the dashboard guard sends a context that may not use Teams: home, flashing why. */
export const TEAMS_PERSONA_FALLBACK = `${RESTRICTED_FALLBACK_PATH}?notice=${TEAMS_PERSONA_NOTICE}`;
// #endregion
