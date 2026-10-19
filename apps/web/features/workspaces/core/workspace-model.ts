import { isReservedHandle } from "@projective/types/profile";
import {
	kindFromPath,
	roleRank,
	type WorkspaceMember,
	type WorkspaceProject,
} from "@projective/types/workspace";
import { isModuleKey, type ModuleKey } from "./module-registry.tsx";

/**
 * workspace-model — the pure, presentation-agnostic helpers the `/teams` and `/businesses` islands
 * share: URL parsing, member filtering and sorting, entity-badge initials, and the small formatters
 * the surface needs. A module's sub-views are `sub-views.ts`; the roster index's partitions and canvas
 * rules are `roster-model.ts` (re-exported below where callers already read them from here).
 *
 * Everything here is a **total function of its arguments**: no state, no signals, no DOM, no fetch. That
 * is what lets a server-side slot resolver and a client island call the same helper and agree, which is
 * the only way the first painted byte can match what hydration then re-renders.
 *
 * **Money is conspicuously absent.** Nothing in this file totals, splits, converts or fee-adjusts a
 * figure — every monetary string on the surface is a server-computed `MoneyView.display` (root CLAUDE.md
 * §12 · Decision #55). Shares are integer basis points, resolved server-side; the split editor's local
 * arithmetic is the SSOT's own `rebalanceSplit`, not a helper invented here.
 */

// #region Path parsing
/**
 * The entity reference a workspace URL addresses — its `@handle` (the console address) — or `null` on
 * the roster index.
 *
 * `/teams` → `null` · `/teams/acme` → `"acme"` · `/teams/acme/members` → `"acme"`.
 *
 * A reserved segment is NOT an entity: `/teams/create` is the roster with the create modal open, and
 * `create` is in the shared reserved-handle list precisely so no entity can ever be addressed by it.
 * Treating it as a reference would ask the database for an entity called "create" on every render of
 * the create deep link, and paint the index without its footer when that (correctly) found nothing.
 */
export function workspaceHandleOf(pathname: string): string | null {
	if (kindFromPath(pathname) === null) return null;
	const segment = pathname.split("/").filter(Boolean)[1];
	if (!segment) return null;
	return isReservedHandle(decodeSegment(segment)) ? null : decodeSegment(segment);
}

/** Decode one path segment, keeping the raw text when it is not valid percent-encoding. */
function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

/**
 * The module a workspace URL addresses.
 *
 * An entity URL with no module segment resolves to `overview`, because a bare `/teams/acme` IS the
 * overview rather than an incomplete address. An unrecognised segment resolves to `null` so the route
 * can 404 it honestly instead of silently showing the overview and leaving the reader to wonder why
 * their link went somewhere else. The roster index (`/teams`, `/teams/create`) also returns `null` —
 * it has no module.
 */
export function activeModuleOf(pathname: string): ModuleKey | null {
	if (workspaceHandleOf(pathname) === null) return null;
	const raw = pathname.split("/").filter(Boolean)[2];
	if (raw === undefined) return "overview";
	return isModuleKey(raw) ? raw : null;
}

/**
 * Whether `path` is `base` itself or somewhere beneath it. A bare `startsWith` would count
 * `/teams/north-loop` as inside `/teams/north`, lighting two entity rows at once.
 */
export function isWithinPath(path: string, base: string): boolean {
	return path === base || path.startsWith(`${base}/`);
}

/** The entity kind a path addresses (`/teams` → `team`), or `null` off the workspace surface. */
export { kindFromPath };
// #endregion

// #region Roster partitions
/**
 * The roster index's partition vocabulary, its filter, its counts and the count noun live in the pure
 * `roster-model.ts` (Teams R1), which `deno test` loads without this module's registry; they are
 * re-exported here for the callers that already read them from this file.
 */
export {
	countLabel,
	filterRoster,
	ROSTER_TABS,
	type RosterTab,
	rosterTabCounts,
	rosterTabFromSearch,
	type RosterTabOption,
	toRosterTab,
} from "./roster-model.ts";
// #endregion

// #region Member filtering & sorting
/**
 * How the card grid and the org chart order people. The People table sorts by its own header
 * (Decision #224), so there is no sort control in the body.
 */
export type MemberSort = "role" | "name" | "workload" | "joined";

/** The member-list filter state. Every field is optional — an unset field filters nothing. */
export interface MemberFilter {
	/** Free text over name, handle and title. */
	search?: string;
	/** Restrict to one membership state (`active` · `left`). */
	state?: WorkspaceMember["state"];
	/** Restrict to holders of one role id. */
	roleId?: string;
	/** Restrict to one availability signal. */
	availability?: WorkspaceMember["availability"];
}

/**
 * Filter a member list. Departed members (`left`) are excluded unless explicitly asked for, because a
 * soft-removed person is retained for audit, not for the roster — showing them by default would make an
 * entity look larger than it is.
 */
export function filterMembers(
	members: readonly WorkspaceMember[],
	filter: MemberFilter = {},
): WorkspaceMember[] {
	const needle = (filter.search ?? "").trim().toLowerCase();
	return members.filter((m) => {
		if (filter.state ? m.state !== filter.state : m.state === "left") return false;
		if (filter.roleId && m.roleId !== filter.roleId) return false;
		if (filter.availability && m.availability !== filter.availability) return false;
		if (!needle) return true;
		return m.name.toLowerCase().includes(needle) ||
			m.handle.toLowerCase().includes(needle) ||
			(m.title ?? "").toLowerCase().includes(needle);
	});
}

/**
 * Sort a member list. Returns a NEW array — mutating a prop array is how a signal-driven list starts
 * re-rendering with an order the server never sent.
 *
 * `role` (the default) is authority-descending with name as the tie-break, so the people who can change
 * things sit where a reader looks first. `workload` is descending because "who is most loaded" is the
 * question a workload column is actually asked.
 */
export function sortMembers(
	members: readonly WorkspaceMember[],
	sort: MemberSort = "role",
	dir: "asc" | "desc" = sort === "name" || sort === "joined" ? "asc" : "desc",
): WorkspaceMember[] {
	const sign = dir === "asc" ? 1 : -1;
	const byName = (a: WorkspaceMember, b: WorkspaceMember) => a.name.localeCompare(b.name, "en-GB");
	const out = [...members];
	out.sort((a, b) => {
		switch (sort) {
			case "name":
				return sign * byName(a, b);
			case "workload":
				return sign * (a.workload - b.workload) || byName(a, b);
			case "joined":
				return sign * a.joinedAt.localeCompare(b.joinedAt) || byName(a, b);
			case "role":
				return sign * (roleRank(a.rolePreset) - roleRank(b.rolePreset)) || byName(a, b);
		}
	});
	return out;
}
// #endregion

// #region Projects
/** Filter the console's project list to a sub-view (`active` · `proposals` · `completed`). */
export function filterProjects(
	projects: readonly WorkspaceProject[],
	view: string,
): WorkspaceProject[] {
	const state = view === "proposals" ? "proposal" : view === "completed" ? "completed" : "active";
	return projects.filter((p) => p.state === state);
}
// #endregion

// #region Presentation helpers
/**
 * Initials for the entity's rounded-square mark — up to two letters, from the first and last
 * significant words, so "Atlas Collective" reads `AC` and "Northwind" reads `N`.
 *
 * Falls back to the handle, then to a single `·`, so the badge is never blank: an empty mark reads as a
 * broken image rather than as an entity that simply has no logo yet.
 */
export function initialsOf(name: string, handle = ""): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) {
		const h = handle.replace(/[^a-z0-9]/gi, "");
		return h ? h.slice(0, 2).toUpperCase() : "·";
	}
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * A short British date from an ISO timestamp — `"12 Aug"`, gaining a year when it falls outside
 * `referenceYear` (`"12 Aug 2025"`).
 *
 * Pass `referenceYear` explicitly from a server-resolved value wherever SSR and hydration must agree
 * byte-for-byte; the default reads the local clock, which is fine for anything rendered client-side but
 * would differ across a New Year boundary between server and client.
 */
export function shortDate(iso: string, referenceYear = new Date().getFullYear()): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
	return date.getFullYear() === referenceYear ? day : `${day} ${date.getFullYear()}`;
}

/**
 * The tonal key for an availability signal, consumed as `data-availability` in CSS so the colour lives
 * in the stylesheet's tokens rather than in a component (§4 — token-only, no inline styles).
 */
export function availabilityTone(
	availability: WorkspaceMember["availability"],
): "success" | "warning" | "muted" {
	if (availability === "available") return "success";
	if (availability === "limited") return "warning";
	return "muted";
}
// #endregion

// #region Refusal copy
/**
 * The business refusal map (BU6 step 4, Decision #243) — one sentence, way forward and ask per
 * business refusal code. The business screens import it from here; it LIVES in the `refusal-copy.ts`
 * leaf so a checkout island can import it without this module's registry and glyphs.
 */
export {
	approverList,
	BUSINESS_REFUSAL_CODES,
	BUSINESS_REFUSAL_COPY,
	type BusinessRefusalCode,
	type BusinessRefusalContext,
	CHECK_AGAIN_LABEL,
	isBusinessRefusalCode,
	possessive,
	type RefusalCopy,
	SPEND_REQUEST_COPY,
	type SpendRequestCopyContext,
	type SpendRequestCopyState,
} from "./refusal-copy.ts";
// #endregion
