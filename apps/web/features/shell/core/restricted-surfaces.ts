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
