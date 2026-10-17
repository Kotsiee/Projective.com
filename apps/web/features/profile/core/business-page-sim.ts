import type { ProfileHiddenReason, ProfileView } from "@projective/types/profile";

/**
 * The development-only business page simulation (Decision #244, root CLAUDE.md §5).
 *
 * Whether a business's `/:handle` opens at all, and what its member notice says, is decided by the
 * DATABASE (`org.fn_profile_visible`, `org.get_profile_view`'s `workspace.hidden_reason`) before a
 * byte renders — and both seeded businesses are `active` + `public`, so no seeded viewer ever meets a
 * draft, archived or invite-only page. The Dev Context Switcher writes this cookie instead, and the
 * profile middleware honours it only under `IS_DEV`: a hidden reason is laid over the page a member
 * reads (the notice renders), and `missing` drops the page exactly as an outsider meets it (the 404).
 * It grants nothing — every read and write still meets the database's own rule.
 *
 * Pure, and free of `IS_DEV`/`import.meta.env`, so it loads under `deno test`. Deciding whether it
 * may apply at all is the caller's job.
 */

// #region Contract
/** The cookie the Dev Context Switcher writes and the `/[handle]` middleware reads in development. */
export const BUSINESS_PAGE_SIM_COOKIE = "pj.dev.business-page";

/** A simulated page: the reason a member is told, or `missing` — the page as an outsider meets it. */
export type BusinessPageSim = ProfileHiddenReason | "missing";

/**
 * Every value the cookie may carry. A plain list rather than the `ProfileHiddenReason` schema: the
 * middleware reads it on every profile request, so it must hold no runtime dependency beyond this file.
 */
const BUSINESS_PAGE_SIMS: ReadonlyArray<BusinessPageSim> = [
	"draft",
	"archived",
	"invite_only",
	"missing",
];
// #endregion

// #region Codec
/**
 * Read a cookie value back. Anything unrecognised — a hand-edited cookie, a value from an older build
 * — is ignored rather than trusted, so a typo can never invent a state: `null` means no simulation.
 */
export function parseBusinessPageSim(raw: string | null | undefined): BusinessPageSim | null {
	if (!raw) return null;
	return BUSINESS_PAGE_SIMS.find((sim) => sim === raw) ?? null;
}

/**
 * Lay a simulation over the resolved profile. A business only — every other kind, an absent profile
 * and no simulation pass through untouched. `missing` answers `null` (the caller's 404); a reason
 * replaces the member-facing `hiddenReason` and keeps the viewer's real console doors.
 */
export function applyBusinessPageSim(
	profile: ProfileView | null,
	sim: BusinessPageSim | null,
): ProfileView | null {
	if (!profile || !sim || profile.kind !== "business") return profile;
	if (sim === "missing") return null;
	return {
		...profile,
		workspace: {
			hiddenReason: sim,
			consoleHref: profile.workspace?.consoleHref ?? null,
			settingsHref: profile.workspace?.settingsHref ?? null,
		},
	};
}
// #endregion
