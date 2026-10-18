import type { ProfileView } from "@projective/types/profile";
import { type BusinessPageSim, parseBusinessPageSim } from "./business-page-sim.ts";

/**
 * The development-only TEAM page simulation (Teams P1, root CLAUDE.md §5) — the business page
 * simulation's twin (Decision #244), on its own axis and cookie.
 *
 * Whether a team's `/:handle` opens at all, and what its member notice says, is decided by the
 * DATABASE (`org.fn_profile_visible`'s team arm, `org.get_profile_view`'s `workspace.hidden_reason`)
 * before a byte renders — and every seeded team is `active` + `public`, so no seeded viewer ever
 * meets a draft, archived or invite-only team page. The Dev Context Switcher writes this cookie
 * instead, and the profile middleware honours it only under `IS_DEV`: a hidden reason is laid over
 * the page a member reads (the notice renders, keeping the viewer's Settings door for the link Teams
 * C6 turns on), and `missing` drops the page exactly as an outsider meets it (the 404). It grants
 * nothing — every read and write still meets the database's own rule.
 *
 * Pure, and free of `IS_DEV`/`import.meta.env`, so it loads under `deno test`.
 */

// #region Contract
/** The cookie the Dev Context Switcher writes and the `/[handle]` middleware reads in development. */
export const TEAM_PAGE_SIM_COOKIE = "pj.dev.team-page";

/** A simulated team page: the reason a member is told, or `missing` — the outsider's 404. */
export type TeamPageSim = BusinessPageSim;
// #endregion

// #region Codec
/**
 * Read a cookie value back — the same four values as the business axis. Anything unrecognised is
 * ignored rather than trusted: `null` means no simulation.
 */
export function parseTeamPageSim(raw: string | null | undefined): TeamPageSim | null {
	return parseBusinessPageSim(raw);
}

/**
 * Lay a simulation over the resolved profile. A team only — every other kind, an absent profile and
 * no simulation pass through untouched. `missing` answers `null` (the caller's 404); a reason
 * replaces the member-facing `hiddenReason` and keeps the viewer's real console doors.
 */
export function applyTeamPageSim(
	profile: ProfileView | null,
	sim: TeamPageSim | null,
): ProfileView | null {
	if (!profile || !sim || profile.kind !== "team") return profile;
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
